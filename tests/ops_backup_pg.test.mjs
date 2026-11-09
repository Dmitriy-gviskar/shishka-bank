import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupDb } from './helpers/db.mjs';
import { createBackup } from '../ops/backup.mjs';
import { command } from '../ops/runtime.mjs';

test('backup validation performs a real pg_dump and pg_restore in a separate scratch database',async(t)=>{
  const db=await setupDb();const url=new URL(db.url);
  const root=await mkdtemp(join(tmpdir(),'shishka-real-backup-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const d of ['app','uploads','git'])await mkdir(join(root,d));
  await writeFile(join(root,'app','file'),'application');await writeFile(join(root,'uploads','photo'),'photo');
  await writeFile(join(root,'config'),'private');
  const services=join(root,'pg_service.conf');
  const common=`host=127.0.0.1\nport=${url.port}\nuser=${url.username}\nsslmode=disable\n`;
  await writeFile(services,`[source]\n${common}dbname=${url.pathname.slice(1)}\n[restore]\n${common}dbname=postgres\n`,{mode:0o600});
  let restored=false;
  const run=async(file,args=[],options={})=>{
    if(file==='gpg'){await writeFile(args[args.indexOf('--output')+1],'encrypted-test-fixture');return {stdout:'',code:0};}
    if(['ssh','scp'].includes(file))return {stdout:'',code:0};
    if(file==='git')return {stdout:args.includes('rev-parse')?'same\n':args.includes('ls-remote')?'same\trefs/heads/main\n':'',code:0};
    const result=await command(file,args,{...options,env:{...options.env,PGSERVICEFILE:services}});
    if(file==='pg_restore'&&args.includes('--exit-on-error'))restored=true;
    return result;
  };
  const result=await createBackup({backupRoot:join(root,'backups'),appDir:join(root,'app'),uploadsDir:join(root,'uploads'),gitRepo:join(root,'git'),configPaths:[join(root,'config')],pgService:'source',restoreService:'restore',expectedDatabase:url.pathname.slice(1),gpgRecipient:'fixture',offsiteHost:'fixture.example',offsiteRoot:'/backups'},{run});
  assert.equal(restored,true);
  assert.equal(JSON.parse(await readFile(join(result.path,'SUCCESS.json'))).restoreVerified,true);
});
