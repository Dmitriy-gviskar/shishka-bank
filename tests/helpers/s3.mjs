import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function s3Fixture(root){
 const credentialsFile=join(root,'aws-credentials'),configFile=join(root,'aws-config');
 await writeFile(credentialsFile,'[test]\naws_access_key_id = local\naws_secret_access_key = local-secret\n',{mode:0o600});
 await writeFile(configFile,'[profile test]\nregion = us-east-1\ns3 =\n    addressing_style = path\n',{mode:0o600});
 return {sourceFailureDomain:'vps-provider',offsiteFailureDomain:'ssh-provider',s3:{provider:'selectel',failureDomain:'selectel',endpoint:'https://s3.example.test',bucket:'test-backups',region:'us-east-1',profile:'test',credentialsFile,configFile}};
}
export function s3Mock(){
 const objects=new Map(),parts=new Map();let n=0;
 const run=async(args)=>{
  const op=args[args.indexOf('s3api')+1],value=k=>args[args.indexOf(k)+1];let result={};
  if(op==='get-bucket-versioning')result={Status:'Enabled'};
  if(op==='put-object'){const key=value('--key');if(objects.has(key))throw Error('PreconditionFailed');const VersionId='version-'+(++n);objects.set(key,{data:await readFile(value('--body')),VersionId});result={VersionId};}
  if(op==='get-object'){const obj=objects.get(value('--key'));await writeFile(args.at(-1),obj.data,{mode:0o600});result={VersionId:obj.VersionId};}
  if(op==='create-multipart-upload')result={UploadId:'upload'};
  if(op==='upload-part'){parts.set(Number(value('--part-number')),await readFile(value('--body')));result={ETag:'"part"'};}
  if(op==='complete-multipart-upload'){const key=value('--key');if(objects.has(key))throw Error('PreconditionFailed');const VersionId='version-'+(++n);objects.set(key,{data:Buffer.concat([...parts.values()]),VersionId});result={VersionId};}
  return {stdout:JSON.stringify(result),code:0};
 };
 run.objects=objects;return run;
}
