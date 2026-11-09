import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,readFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {s3Fixture} from './helpers/s3.mjs';
import {preflightS3,putVerifiedS3} from '../ops/s3.mjs';
// Real AWS CLI against a local S3 protocol fixture; no cloud credentials or requests.
test('real AWS CLI uploads >100 MiB using conditional multipart and downloads exact version',async t=>{
 const root=await mkdtemp(join(tmpdir(),'shishka-s3-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const parts=new Map();let signed=0,conditional=false;const object=join(root,'stored');
 const server=createServer(async(req,res)=>{try{
  assert.match(req.headers.authorization||'',/^AWS4-HMAC-SHA256 /);signed++;
  const u=new URL(req.url,'http://localhost');
  const xml=s=>{res.setHeader('Content-Type','application/xml');res.end(s);};
  if(u.searchParams.has('versioning'))return xml('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
  if(req.method==='POST'&&u.searchParams.has('uploads'))return xml('<InitiateMultipartUploadResult><Bucket>test-backups</Bucket><Key>snapshots/test/bundle.tar.gpg</Key><UploadId>local-upload</UploadId></InitiateMultipartUploadResult>');
  if(req.method==='PUT'&&u.searchParams.has('partNumber')){const path=join(root,'part-'+u.searchParams.get('partNumber'));await pipeline(req,createWriteStream(path));parts.set(Number(u.searchParams.get('partNumber')),path);res.setHeader('ETag','"part-'+u.searchParams.get('partNumber')+'"');return res.end();}
  if(req.method==='POST'&&u.searchParams.has('uploadId')){conditional=req.headers['if-none-match']==='*';for await(const _ of req){}const dest=await open(object,'wx');try{for(const [,path] of [...parts].sort((a,b)=>a[0]-b[0]))for await(const chunk of createReadStream(path))await dest.write(chunk);}finally{await dest.close();}res.setHeader('x-amz-version-id','verified-version');return xml('<CompleteMultipartUploadResult><ETag>"multipart-not-a-sha256"</ETag></CompleteMultipartUploadResult>');}
  if(req.method==='GET'){assert.equal(u.searchParams.get('versionId'),'verified-version');res.setHeader('x-amz-version-id','verified-version');return await pipeline(createReadStream(object),res);}
  res.statusCode=400;res.end();
 }catch(e){res.statusCode=500;res.end('fixture error');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const {s3}=await s3Fixture(root);s3.endpoint='http://127.0.0.1:'+server.address().port;
 const path=join(root,'large-archive');const f=await open(path,'wx');try{const block=Buffer.alloc(1024*1024,42);for(let i=0;i<101;i++)await f.write(block);}finally{await f.close();}
 const config=await preflightS3(s3,{allowLoopbackHttp:true});const receipt=await putVerifiedS3(config,'snapshots/test/bundle.tar.gpg',path);
 assert.equal(receipt.bytes,101*1024*1024);assert.equal(receipt.versionId,'verified-version');assert.equal(conditional,true);assert.equal(parts.size,2);assert.ok(signed>=6);
});
