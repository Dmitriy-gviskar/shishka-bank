import { mkdtemp, mkdir, rm, rename, writeFile, stat, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { preflightS3, putVerifiedS3, snapshotKey } from './s3.mjs';
import { command, required, absolute, exists, sha256, json, quote } from './runtime.mjs';

export async function createBackup(config,{run=command,checkpoint=false,...s3Options}={}) {
  const domains=[config.sourceFailureDomain,config.offsiteFailureDomain,config.s3?.failureDomain];
  if(domains.some(x=>typeof x!=='string'||!x.trim())||new Set(domains.map(x=>x.trim().toLowerCase())).size!==3)throw new Error('Three independent failure domains required');
  const root=absolute(config.backupRoot,'backupRoot');
  const app=absolute(config.appDir,'appDir'), uploads=absolute(config.uploadsDir,'uploadsDir');
  const gitRepo=absolute(config.gitRepo,'gitRepo');
  const service=required(config.pgService,'pgService');
  const restoreService=required(config.restoreService,'restoreService');
  const database=required(config.expectedDatabase,'expectedDatabase');
  const recipient=required(config.gpgRecipient,'gpgRecipient');
  const host=required(config.offsiteHost,'offsiteHost');
  if(!/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host))throw new Error('Unsafe offsiteHost');
  const remoteRoot=absolute(config.offsiteRoot,'offsiteRoot');
  if(!/^\/[a-zA-Z0-9_./-]+$/.test(remoteRoot))throw new Error('Unsafe offsiteRoot');
  if(!Array.isArray(config.configPaths)||!config.configPaths.length)throw new Error('Missing configPaths');
  const configs=config.configPaths.map((p)=>absolute(p,'config path'));
  for(const p of [app,uploads,gitRepo,...configs])if(!await exists(p))throw new Error('Required backup source is missing');
  if(checkpoint) {
    if(!await exists(absolute(config.maintenanceFile,'maintenanceFile')))throw new Error('Checkpoint requires maintenance');
    const state=await run('systemctl',['is-active',required(config.service,'service')],{allowFailure:true});
    if(state.stdout.trim()!=='inactive')throw new Error('Checkpoint requires a stopped service');
  }
  const sourceEnv={PGSERVICE:service};
  const actual=(await run('psql',['-XAt','-c','select current_database()'],{env:sourceEnv})).stdout.trim();
  if(actual!==database)throw new Error('Backup database identity mismatch');
  if(restoreService===service)throw new Error('Restore validation needs a separate service');
  await mkdir(root,{recursive:true,mode:0o700});
  const lockPath=join(root,'.backup.lock');
  const lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Error('Backup lock exists; investigate before removing it');});
  try {await lock.writeFile(JSON.stringify({pid:process.pid,started:new Date().toISOString()})+'\n');return await lockedBackup();} finally {await lock.close();await rm(lockPath);}
  async function lockedBackup(){
  const s3=await preflightS3(config.s3,{run,...s3Options});
  const gitHead=async()=> (await run('git',['-C',gitRepo,'rev-parse','HEAD'])).stdout.trim();
  const remoteHead=async()=> (await run('git',['-C',gitRepo,'ls-remote','origin','refs/heads/main'])).stdout.trim().split(/\s/)[0];
  const before=await gitHead();
  if((await run('git',['-C',gitRepo,'status','--porcelain'])).stdout.trim()||!before||before!==await remoteHead())throw new Error('Git metadata mirror not confirmed remotely or dirty; reconcile manually');
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  const final=join(root,id);
  const pending=await mkdtemp(join(root,'.pending-'));
  const payload=join(pending,'payload');
  const restoreDb='shishka_restore_'+randomUUID().replaceAll('-','');
  let createdRestore=false;
  let committed=false;
  try {
    await mkdir(payload,{mode:0o700});
    const dump=join(payload,'database.dump');
    await run('pg_dump',['--format=custom','--no-owner','--file='+dump],{env:sourceEnv});
    if(!(await stat(dump)).size)throw new Error('Empty database dump');
    await run('pg_restore',['--list',dump]);
    await run('tar',['-czf',join(payload,'code.tar.gz'),'-C',app,'.']);
    await run('tar',['-czf',join(payload,'uploads.tar.gz'),'-C',uploads,'.']);
    await run('tar',['-czf',join(payload,'config.tar.gz'),'-C','/',...configs.map((p)=>p.slice(1))]);
    for(const name of ['code.tar.gz','uploads.tar.gz','config.tar.gz'])await run('tar',['-tzf',join(payload,name)]);
    // Restore into a unique scratch database; never use a production name or --clean.
    await run('createdb',[restoreDb],{env:{PGSERVICE:restoreService}});
    createdRestore=true;
    await run('pg_restore',['--exit-on-error','--no-owner','--dbname='+restoreDb,dump],{env:{PGSERVICE:restoreService}});
    const tables=(await run('psql',['-XAt','--dbname='+restoreDb,'-c',"select count(*) from information_schema.tables where table_schema='public' and table_name in ('users','wallets','transactions','user_cards')"],{env:{PGSERVICE:restoreService}})).stdout.trim();
    if(tables!=='4')throw new Error('Restored database is incomplete');
    await run('dropdb',[restoreDb],{env:{PGSERVICE:restoreService}});
    createdRestore=false;
    const hashes={};
    for(const name of ['database.dump','code.tar.gz','uploads.tar.gz','config.tar.gz'])hashes[name]=await sha256(join(payload,name));
    const manifest={id,mode:checkpoint?'checkpoint':'online',database,restoreVerified:true,hashes};
    await json(join(payload,'manifest.json'),manifest);
    const clear=join(pending,'bundle.tar');
    const encrypted=join(pending,'bundle.tar.gpg');
    await run('tar',['-cf',clear,'-C',payload,'.']);
    await run('gpg',['--batch','--yes','--encrypt','--recipient',recipient,'--output',encrypted,clear]);
    if(!(await stat(encrypted)).size)throw new Error('Empty encrypted backup');
    await rm(clear);await rm(payload,{recursive:true});
    const digest=await sha256(encrypted);
    await writeFile(join(pending,'bundle.tar.gpg.sha256'),digest+'  bundle.tar.gpg\n',{mode:0o600});
    const remote=remoteRoot+'/'+id;
    const sshOptions=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20'];
    await run('ssh',[...sshOptions,host,'umask 077; mkdir -- '+quote(remote)]);
    await run('scp',[...sshOptions,encrypted,join(pending,'bundle.tar.gpg.sha256'),host+':'+remote+'/']);
    await run('ssh',[...sshOptions,host,'cd '+quote(remote)+' && sha256sum --check --status bundle.tar.gpg.sha256']);
    const s3Copy=await putVerifiedS3(s3,snapshotKey(s3,id),encrypted,{run,...s3Options});
    const receipt={schema:2,id,mode:manifest.mode,restoreVerified:true,bytes:(await stat(encrypted)).size,sha256:digest,copies:[s3Copy,{kind:'ssh',host,directory:remote,bytes:(await stat(encrypted)).size,sha256:digest}]};
    const receiptPath=join(pending,'receipt.json');await json(receiptPath,receipt);
    await run('scp',[...sshOptions,receiptPath,host+':'+remote+'/']);
    await putVerifiedS3(s3,snapshotKey(s3,id,'receipt.json'),receiptPath,{run,...s3Options});
    // GitHub receives only a small receipt. Never stage the archive or old pending commits.
    if(before!==await gitHead())throw new Error('Git metadata HEAD changed during backup');
    const gitPath='metadata-v2/'+id+'.json';
    await mkdir(join(gitRepo,'metadata-v2'),{recursive:true,mode:0o700});
    await writeFile(join(gitRepo,gitPath),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    await run('git',['-C',gitRepo,'add','--',gitPath]);
    await run('git',['-C',gitRepo,'commit','--only','-m','backup receipt '+id,'--',gitPath]);
    await run('git',['-C',gitRepo,'push','origin','HEAD:main']);
    const local=await gitHead();
    if(!local||local!==await remoteHead())throw new Error('Git backup not confirmed remotely');
    await json(join(pending,'SUCCESS.json'),{...manifest,encryptedSha256:digest,gitCommit:local,copies:receipt.copies});
    await rename(pending,final);committed=true;
    return {id,path:final,mode:manifest.mode,restoreVerified:true};
  } finally {
    try {if(createdRestore)await run('dropdb',[restoreDb],{env:{PGSERVICE:restoreService}});}
    finally {if(!committed)await rm(pending,{recursive:true,force:true});}
  }
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const path=process.argv[2]||'/root/shishka-backup.json';
    const config=JSON.parse(await readFile(path,'utf8'));
    const result=await createBackup(config);
    console.log('OK verified encrypted backup:',basename(result.path));
  } catch(error){console.error('FAIL backup:',error.message);process.exitCode=1;}
}
