import {stat,rm,writeFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import {command,required,absolute,sha256} from './runtime.mjs';

const MiB=1024*1024;
export function validateS3(c,{allowLoopbackHttp=false}={}) {
  if(!c||c.provider!=='selectel')throw new Error('Selectel S3 configuration required');
  let u;try{u=new URL(required(c.endpoint,'S3 endpoint'));}catch{throw new Error('Invalid S3 endpoint');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if((u.protocol!=='https:'&&!(allowLoopbackHttp&&loopback&&u.protocol==='http:'))||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw new Error('S3 endpoint must be HTTPS without credentials or path');
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(c.bucket||''))throw new Error('Invalid S3 bucket');
  for(const key of ['region','profile'])if(!/^[a-zA-Z0-9_.-]+$/.test(c[key]||''))throw new Error('Invalid S3 '+key);
  const prefix=c.prefix||'snapshots';
  if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix))throw new Error('Invalid S3 prefix');
  const credentialsFile=absolute(c.credentialsFile,'S3 credentialsFile'),configFile=absolute(c.configFile,'S3 configFile');
  return {...c,endpoint:u.origin,prefix,credentialsFile,configFile};
}
function awsOptions(c){return {env:{AWS_SHARED_CREDENTIALS_FILE:c.credentialsFile,AWS_CONFIG_FILE:c.configFile,AWS_PROFILE:c.profile,AWS_DEFAULT_REGION:c.region,AWS_EC2_METADATA_DISABLED:'true',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off',AWS_REQUEST_CHECKSUM_CALCULATION:'when_required',AWS_RESPONSE_CHECKSUM_VALIDATION:'when_required',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',AWS_SESSION_TOKEN:'',AWS_SECURITY_TOKEN:'',AWS_WEB_IDENTITY_TOKEN_FILE:'',AWS_ROLE_ARN:'',AWS_CONTAINER_CREDENTIALS_FULL_URI:'',AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:''}};}
async function invoke(c,operation,args,run){
  try{
    const r=await run('aws',['--endpoint-url',c.endpoint,'--region',c.region,'--profile',c.profile,'--output','json','s3api',operation,...args],awsOptions(c));
    if(r.code!==0)throw new Error('CLI failure');
    return r.stdout?.trim()?JSON.parse(r.stdout):{};
  }catch{throw new Error('S3 '+operation+' failed');}
}
function version(r){if(typeof r.VersionId!=='string'||!r.VersionId||r.VersionId==='null')throw new Error('S3 object version missing');return r.VersionId;}
export async function preflightS3(config,{run=command,...options}={}){
 const c=validateS3(config,options);
 for(const p of [c.credentialsFile,c.configFile]){const s=await stat(p);if(!s.isFile()||(s.mode&0o077))throw new Error('S3 credential/config files must be private regular files');}
 const state=await invoke(c,'get-bucket-versioning',['--bucket',c.bucket],run);
 if(state.Status!=='Enabled')throw new Error('S3 bucket versioning must be Enabled');
 return c;
}
export function snapshotKey(c,id,name='bundle.tar.gpg'){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(id)||!['bundle.tar.gpg','receipt.json'].includes(name))throw new Error('Invalid backup object name');
 return c.prefix+'/'+id+'/'+name;
}
export async function getVerifiedS3(c,key,versionId,path,digest,bytes,{run=command}={}){
 if(!/^[0-9a-f]{64}$/.test(digest)||!Number.isSafeInteger(bytes)||bytes<=0||typeof versionId!=='string'||!versionId||versionId==='null')throw new Error('Invalid expected S3 receipt');
 const r=await invoke(c,'get-object',['--bucket',c.bucket,'--key',key,'--version-id',versionId,path],run);
 if(version(r)!==versionId||(await stat(path)).size!==bytes||await sha256(path)!==digest)throw new Error('S3 downloaded object checksum/version mismatch');
 return path;
}
// Streaming multipart uploads avoid loading the bundle in RAM and support files >100 MiB.
export async function putVerifiedS3(c,key,path,{run=command,partSize=64*MiB}={}){
 const bytes=(await stat(path)).size;
 if(bytes<=0||bytes>5*1024**4)throw new Error('Invalid S3 archive size');
 const digest=await sha256(path);let uploaded;
 if(bytes<=partSize){
  uploaded=await invoke(c,'put-object',['--bucket',c.bucket,'--key',key,'--body',path,'--metadata','sha256='+digest,'--if-none-match','*'],run);
 }else{
  const size=Math.max(partSize,Math.ceil(bytes/9999/MiB)*MiB),parts=[];
  const created=await invoke(c,'create-multipart-upload',['--bucket',c.bucket,'--key',key,'--metadata','sha256='+digest],run);
  if(typeof created.UploadId!=='string'||!created.UploadId)throw new Error('S3 multipart upload ID missing');
  const uploadId=created.UploadId,temp=path+'.part-'+randomUUID(),list=temp+'.json';let completed=false;
  try{
   for(let start=0,n=1;start<bytes;start+=size,n++){
    await pipeline(createReadStream(path,{start,end:Math.min(bytes-1,start+size-1)}),createWriteStream(temp,{flags:'wx',mode:0o600}));
    const r=await invoke(c,'upload-part',['--bucket',c.bucket,'--key',key,'--upload-id',uploadId,'--part-number',String(n),'--body',temp],run);
    if(typeof r.ETag!=='string'||!r.ETag)throw new Error('S3 part ETag missing');parts.push({PartNumber:n,ETag:r.ETag});await rm(temp);
   }
   await writeFile(list,JSON.stringify({Parts:parts}),{flag:'wx',mode:0o600});
   uploaded=await invoke(c,'complete-multipart-upload',['--bucket',c.bucket,'--key',key,'--upload-id',uploadId,'--multipart-upload','file://'+list,'--if-none-match','*'],run);completed=true;
  }finally{
   if(!completed)await invoke(c,'abort-multipart-upload',['--bucket',c.bucket,'--key',key,'--upload-id',uploadId],run).catch(()=>{});
   await rm(temp,{force:true});await rm(list,{force:true});
  }
 }
 const versionId=version(uploaded),download=path+'.verify-'+randomUUID();
 try{await getVerifiedS3(c,key,versionId,download,digest,bytes,{run});}finally{await rm(download,{force:true});}
 return {kind:'s3',endpoint:c.endpoint,bucket:c.bucket,key,versionId,bytes,sha256:digest};
}
