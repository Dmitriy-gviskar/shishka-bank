import {s3Fixture,s3Mock} from './helpers/s3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup } from '../ops/backup.mjs';
async function fixture(t,fail) {
  const root=await mkdtemp(join(tmpdir(),'shishka-backup-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const dir of ['app','uploads','git','backups'])await mkdir(join(root,dir));
  await writeFile(join(root,'config'),'secret-config');
  await writeFile(join(root,'maintenance'),'on');
  const config={backupRoot:join(root,'backups'),appDir:join(root,'app'),uploadsDir:join(root,'uploads'),gitRepo:join(root,'git'),pgService:'source',restoreService:'restore',expectedDatabase:'shishka_test_source',gpgRecipient:'test-recipient',offsiteHost:'backup.example',offsiteRoot:'/private-backups',configPaths:[join(root,'config')],maintenanceFile:join(root,'maintenance'),service:'shishka'};
  Object.assign(config,await s3Fixture(root));
  const aws=s3Mock();
  const calls=[];
  const run=async(file,args=[],options={})=>{
    calls.push({file,args,options});
    if(fail?.(file,args))throw new Error('injected '+file+' failure');
    if(file==='aws')return aws(args);
    if(file==='systemctl')return {stdout:'inactive\n',code:3};
    if(file==='psql')return {stdout:args.includes('select current_database()')?'shishka_test_source\n':'4\n',code:0};
    if(file==='pg_dump')await writeFile(args.find((x)=>x.startsWith('--file=')).slice(7),'dump-data');
    if(file==='tar'&&['-czf','-cf'].includes(args[0]))await writeFile(args[1],'archive-data');
    if(file==='gpg')await writeFile(args[args.indexOf('--output')+1],'encrypted-data');
    if(file==='git'&&args.includes('rev-parse'))return {stdout:'123456\n',code:0};
    if(file==='git'&&args.includes('ls-remote'))return {stdout:'123456\trefs/heads/main\n',code:0};
    return {stdout:'',code:0};
  };
  return {root,config,run,calls};
}

test('verified backup is unique, encrypted, restored and confirmed by both destinations',async(t)=>{
  const f=await fixture(t);
  const first=await createBackup(f.config,{run:f.run,checkpoint:true});
  const second=await createBackup(f.config,{run:f.run,checkpoint:true});
  assert.notEqual(first.id,second.id);
  const success=JSON.parse(await readFile(join(first.path,'SUCCESS.json')));
  assert.equal(success.mode,'checkpoint');assert.equal(success.restoreVerified,true);
  assert.deepEqual((await readdir(first.path)).sort(),['SUCCESS.json','bundle.tar.gpg','bundle.tar.gpg.sha256','receipt.json']);
  assert.ok(f.calls.some((c)=>c.file==='pg_restore'&&c.args.includes('--exit-on-error')));
  const restore=f.calls.find((c)=>c.file==='pg_restore'&&c.args.includes('--exit-on-error'));
  assert.ok(restore.args.some((x)=>x.startsWith('--dbname=shishka_restore_')));
  assert.ok(!restore.args.includes('--clean'));
  assert.ok(f.calls.some((c)=>c.file==='ssh'&&c.args.at(-1).includes('sha256sum --check')));
  assert.ok(f.calls.some((c)=>c.file==='git'&&c.args.includes('ls-remote')));
});

for(const [name,fail] of [
  ['database dump',(f)=>f==='pg_dump'],
  ['uploads archive',(f,a)=>f==='tar'&&a[1]?.endsWith('uploads.tar.gz')],
  ['restore validation',(f,a)=>f==='pg_restore'&&a.includes('--exit-on-error')],
  ['encryption',(f)=>f==='gpg'],
  ['offsite transfer',(f)=>f==='scp'],
  ['offsite checksum',(f,a)=>f==='ssh'&&a.at(-1).includes('sha256sum')],
  ['Git push',(f,a)=>f==='git'&&a.includes('push')],
])test(`backup fails closed on ${name} error without deleting an earlier backup`,async(t)=>{
  const f=await fixture(t,fail);
  await mkdir(join(f.config.backupRoot,'previous'));
  await writeFile(join(f.config.backupRoot,'previous','keep'),'previous-backup');
  await assert.rejects(createBackup(f.config,{run:f.run,checkpoint:true}),/injected/);
  assert.deepEqual(await readdir(f.config.backupRoot),['previous']);
  assert.equal(await readFile(join(f.config.backupRoot,'previous','keep'),'utf8'),'previous-backup');
  if(fail('gpg',[]))assert.ok(!f.calls.some((c)=>c.file==='scp'||(c.file==='git'&&c.args.includes('push'))));
});

test('database identity mismatch and missing encryption configuration fail before backup',async(t)=>{
  const f=await fixture(t);
  await assert.rejects(createBackup({...f.config,expectedDatabase:'wrong'},{run:f.run}),/identity mismatch/);
  await assert.rejects(createBackup({...f.config,gpgRecipient:''},{run:f.run}),/gpgRecipient/);
  assert.ok(!f.calls.some((c)=>c.file==='pg_dump'));
});

test('a live service cannot produce a deployment checkpoint',async(t)=>{
  const f=await fixture(t);
  const run=(file,args,options)=>file==='systemctl'?Promise.resolve({stdout:'active\n',code:0}):f.run(file,args,options);
  await assert.rejects(createBackup(f.config,{run,checkpoint:true}),/stopped service/);
  assert.ok(!f.calls.some((c)=>c.file==='pg_dump'));
});

test('remote Git mismatch is a failure, not a successful backup',async(t)=>{
  const f=await fixture(t);
  const run=(file,args,options)=>file==='git'&&args.includes('ls-remote')?Promise.resolve({stdout:'different refs/heads/main',code:0}):f.run(file,args,options);
  await assert.rejects(createBackup(f.config,{run}),/not confirmed remotely/);
  assert.deepEqual(await readdir(f.config.backupRoot),[]);
});

test('cron wrapper preserves nonzero exit and never prints OK when configuration is missing',async(t)=>{
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const {fileURLToPath}=await import('node:url');
  const root=await mkdtemp(join(tmpdir(),'shishka-backup-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await assert.rejects(promisify(execFile)('bash',[fileURLToPath(new URL('../ops/backup-shishka.sh',import.meta.url))],{env:{...process.env,SHISHKA_BACKUP_CONFIG:join(root,'missing.json')}}),(e)=>{assert.equal(e.code,1);assert.match(e.stderr,/FAIL backup/);assert.doesNotMatch(e.stdout,/OK/);return true;});
});

test('GitHub receives receipts only; both full remote copies are recorded',async t=>{
 const f=await fixture(t);const result=await createBackup(f.config,{run:f.run});
 const files=await readdir(join(f.config.gitRepo,'metadata-v2'));assert.equal(files.length,1);
 const receipt=JSON.parse(await readFile(join(f.config.gitRepo,'metadata-v2',files[0])));assert.deepEqual(receipt.copies.map(c=>c.kind),['s3','ssh']);
 assert.ok((await readFile(join(f.config.gitRepo,'metadata-v2',files[0]))).length<65536);
 for(const call of f.calls.filter(c=>c.file==='git'&&(c.args.includes('add')||c.args.includes('commit'))))assert.match(call.args.at(-1),/^metadata-v2\/.*\.json$/);
 assert.equal((await readdir(result.path)).includes('receipt.json'),true);
});
test('shared failure domains and dirty or unpublished Git mirror fail before dump',async t=>{
 const f=await fixture(t);
 await assert.rejects(createBackup({...f.config,sourceFailureDomain:'SELECTEL'},{run:f.run}),/independent/);
 const run=(file,args,options)=>file==='git'&&args.includes('status')?Promise.resolve({code:0,stdout:'?? old-large-archive'}):f.run(file,args,options);
 await assert.rejects(createBackup(f.config,{run}),/dirty/);assert.ok(!f.calls.some(c=>c.file==='pg_dump'));
});
test('S3 verification failure never records success or pushes Git metadata',async t=>{
 const f=await fixture(t,(file,args)=>file==='aws'&&args.includes('get-object'));
 await assert.rejects(createBackup(f.config,{run:f.run}),/get-object failed/);
 assert.deepEqual(await readdir(f.config.backupRoot),[]);assert.ok(!f.calls.some(c=>c.file==='git'&&c.args.includes('push')));
});
test('backup lock prevents overlapping writers and is released after errors',async t=>{
 const f=await fixture(t);await writeFile(join(f.config.backupRoot,'.backup.lock'),'owned by another backup');
 await assert.rejects(createBackup(f.config,{run:f.run}),/lock exists/);
 assert.equal(await readFile(join(f.config.backupRoot,'.backup.lock'),'utf8'),'owned by another backup');
 await rm(join(f.config.backupRoot,'.backup.lock'));await createBackup(f.config,{run:f.run});
 assert.ok(!(await readdir(f.config.backupRoot)).includes('.backup.lock'));
});
