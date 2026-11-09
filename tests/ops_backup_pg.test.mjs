import {s3Fixture,s3Mock} from './helpers/s3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,cp } from 'node:fs/promises';
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
  const extra=await s3Fixture(root),aws=s3Mock();
  const home=join(root,'gnupg');await mkdir(home,{mode:0o700});
  const gpgEnv={GNUPGHOME:home};
  await command('gpg',['--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key','Shishka local backup test','rsa2048','encr','0'],{env:gpgEnv});
  const sshCopies=join(root,'ssh-copies');await mkdir(sshCopies);
  let restored=false;
  const run=async(file,args=[],options={})=>{
    if(file==='aws')return aws(args);
    if(file==='gpg')return command(file,args,{env:gpgEnv});
    if(file==='scp'){for(const path of args.slice(6,-1))await cp(path,join(sshCopies,path.split('/').at(-1)));return {stdout:'',code:0};}
    if(file==='ssh')return {stdout:'',code:0};
    if(file==='git')return {stdout:args.includes('rev-parse')?'same\n':args.includes('ls-remote')?'same\trefs/heads/main\n':'',code:0};
    const result=await command(file,args,{...options,env:{...options.env,PGSERVICEFILE:services}});
    if(file==='pg_restore'&&args.includes('--exit-on-error'))restored=true;
    return result;
  };
  const result=await createBackup({...extra,backupRoot:join(root,'backups'),appDir:join(root,'app'),uploadsDir:join(root,'uploads'),gitRepo:join(root,'git'),configPaths:[join(root,'config')],pgService:'source',restoreService:'restore',expectedDatabase:url.pathname.slice(1),gpgRecipient:'Shishka local backup test',offsiteHost:'fixture.example',offsiteRoot:'/backups'},{run});
  assert.equal(restored,true);
  const s3Archive=[...aws.objects].find(([key])=>key.endsWith('/bundle.tar.gpg'))[1].data;
  const downloaded=join(root,'s3-copy.gpg');await writeFile(downloaded,s3Archive);
  assert.deepEqual(await readFile(join(sshCopies,'bundle.tar.gpg')),s3Archive);
  for(const [index,path] of [downloaded,join(sshCopies,'bundle.tar.gpg')].entries()){
    const clear=join(root,'decrypted-'+index+'.tar'),unpacked=join(root,'unpacked-'+index);await mkdir(unpacked);
    await command('gpg',['--batch','--yes','--output',clear,'--decrypt',path],{env:gpgEnv});
    await command('tar',['-xf',clear,'-C',unpacked]);
    await command('pg_restore',['--list',join(unpacked,'database.dump')]);
    const photo=await command('tar',['-xOzf',join(unpacked,'uploads.tar.gz'),'./photo']);assert.equal(photo.stdout,'photo');
    const code=await command('tar',['-xOzf',join(unpacked,'code.tar.gz'),'./file']);assert.equal(code.stdout,'application');
    const config=await command('tar',['-xOzf',join(unpacked,'config.tar.gz'),join(root,'config').slice(1)]);assert.equal(config.stdout,'private');
  }
  assert.equal(JSON.parse(await readFile(join(result.path,'SUCCESS.json'))).restoreVerified,true);
});
