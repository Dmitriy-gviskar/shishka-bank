import { mkdir, lstat, realpath, readFile, writeFile, symlink, rename, rm } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, probe, absolute, required, sha256, json } from './runtime.mjs';
import { createBackup } from './backup.mjs';

const EXTRACT = `import tarfile,pathlib,sys,shutil,os
archive,dest=sys.argv[1:]
with tarfile.open(archive,'r:gz') as tar:
 items=tar.getmembers()
 if sum(m.size for m in items)>4*1024**3 or len(items)>100000: raise ValueError('archive too large')
 for m in items:
  p=pathlib.PurePosixPath(m.name)
  if p.is_absolute() or '..' in p.parts or not p.parts or (p.parts[0]!='client' and str(p)!='.nvmrc') or not (m.isfile() or m.isdir()) or 'uploads' in p.parts or any(x.startswith('.env') for x in p.parts): raise ValueError('unsafe archive member')
 for m in items:
  target=pathlib.Path(dest)/m.name
  if m.isdir(): target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   with tar.extractfile(m) as src,open(target,'xb') as out: shutil.copyfileobj(src,out)
   os.chmod(target,0o700 if m.mode & 0o111 else 0o600)
`;
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
function releaseId(value){if(!/^[0-9a-f]{40}$/.test(value||''))throw new Error('Release must be a full Git SHA');return value;}
async function validateLayout(config,run) {
  if(config.layoutVersion!==1)throw new Error('Release layout must be provisioned first');
  const root=await realpath(absolute(config.releaseRoot,'releaseRoot')),current=absolute(config.current,'current');
  if(!(await lstat(current)).isSymbolicLink())throw new Error('Current must be a symlink; in-place deployment is forbidden');
  const old=await realpath(current);
  const rel=relative(root,old);
  if(rel.startsWith('..')||resolve(root)===old)throw new Error('Current release must be inside releaseRoot');
  const unit=required(config.service,'service');
  if(!/^[a-zA-Z0-9_.@-]+$/.test(unit))throw new Error('Unsafe service name');
  const working=(await run('systemctl',['show','--property=WorkingDirectory','--value',unit])).stdout.trim();
  const exec=(await run('systemctl',['show','--property=ExecStart','--value',unit])).stdout;
  if(working!==current||!exec.includes(current+'/server-'))throw new Error('Systemd must use the provisioned current release');
  return {root,current,old,unit};
}
async function stopped(run,unit) {
  await run('systemctl',['stop',unit]);
  const state=await run('systemctl',['is-active',unit],{allowFailure:true});
  if(state.stdout.trim()!=='inactive')throw new Error('Service did not stop');
}
async function ready(config,id,check,delay) {
  const attempts=Math.min(60,Math.max(1,config.healthAttempts??30));
  const identity=new URL('/release.json',config.healthUrl).href;
  for(let i=0;i<attempts;i++) {
    const health=await check(config.healthUrl);
    const version=await check(identity);
    if(health?.status===200&&health.body?.ok===true&&health.body.db==='ok'&&version?.status===200&&version.body?.id===id)return;
    if(i+1<attempts)await delay(2000);
  }
  throw new Error('Release failed readiness or identity check');
}
async function maintenance(config,check) {
  const path=absolute(config.maintenanceFile,'maintenanceFile');
  await writeFile(path,'maintenance\n',{flag:'wx',mode:0o600});
  const response=await check(required(config.maintenanceUrl,'maintenanceUrl'),required(config.publicHost,'publicHost'));
  if(response?.status!==503)throw new Error('Nginx did not enable maintenance');
}
async function switchLink(current,target,id) {
  const next=current+'.next-'+id;
  await symlink(target,next);
  try{await rename(next,current);}finally{await rm(next,{force:true});}
}
async function deployUnlocked(config,{id,archive,expectedSha256},{run=command,check=probe,backup=createBackup,delay=sleep}={}) {
  releaseId(id);
  if(!/^[0-9a-f]{64}$/.test(expectedSha256||''))throw new Error('Missing archive checksum');
  archive=absolute(archive,'archive');
  if(await sha256(archive)!==expectedSha256)throw new Error('Archive checksum mismatch');
  const {root,current,old,unit}=await validateLayout(config,run);
  const incoming=join(root,id),candidate=join(incoming,'client');
  await mkdir(incoming,{mode:0o750}); // No overwriting a previously staged release.
  let cutover=false;
  let checkpoint;
  try {
    await run('python3',['-c',EXTRACT,archive,incoming]);
    const major=(await readFile(join(incoming,'.nvmrc'),'utf8')).trim();
    const node=(await run('node',['--version'])).stdout.trim();
    if(!/^\d+$/.test(major)||!node.startsWith('v'+major+'.'))throw new Error('Node version does not match release');
    await run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:candidate});
    await symlink(absolute(config.uploadsDir,'uploadsDir'),join(candidate,'uploads'));
    await json(join(candidate,'release.json'),{id,archiveSha256:expectedSha256});
    for(const key of ['appOwner','appGroup'])if(!/^[a-z_][a-z0-9_-]*\$?$/i.test(config[key]||''))throw new Error('Missing app ownership');
    await run('chown',['-R','--no-dereference','root:'+config.appGroup,incoming]);
    await run('chmod',['-R','u=rwX,g=rX,o=',incoming]);
    await maintenance(config,check);
    cutover=true;
    await stopped(run,unit);
    if(await check(config.healthUrl))throw new Error('A backend is still listening after service stop');
    checkpoint=await backup({...config.backup,appDir:old,uploadsDir:config.uploadsDir,maintenanceFile:config.maintenanceFile,service:unit},{run,checkpoint:true});
    if(checkpoint.mode!=='checkpoint'||!checkpoint.restoreVerified)throw new Error('Verified checkpoint required');
    await json(join(incoming,'deployment.json'),{id,previous:old,checkpoint,status:'prepared'});
    await switchLink(current,candidate,id);
    await run('systemctl',['start',unit]);
    await ready(config,id,check,delay);
    await json(join(incoming,'deployment.json'),{id,previous:old,checkpoint,status:'ready'});
    await rm(config.maintenanceFile);
    return {id,checkpoint,previous:old};
  } catch(error) {
    if(cutover) {
      // Unknown/old code is never restarted automatically. Maintenance stays enabled.
      await stopped(run,unit).catch(()=>{});
      await json(join(incoming,'deployment.json'),{id,previous:old,checkpoint,status:'failed',reason:error.message}).catch(()=>{});
    }
    throw error;
  }
}
async function rollbackUnlocked(config,id,{run=command,check=probe,delay=sleep}={}) {
  releaseId(id);
  const approved=config.approvedFallbacks?.[id];
  if(!/^[0-9a-f]{64}$/.test(approved||''))throw new Error('Fallback must be explicitly approved and retain security fixes');
  const {root,current,unit}=await validateLayout(config,run);
  const target=join(root,id,'client');
  const identity=JSON.parse(await readFile(join(target,'release.json'),'utf8'));
  if(identity.id!==id||identity.archiveSha256!==approved)throw new Error('Fallback identity mismatch');
  // An existing maintenance flag is intentionally retained until readiness succeeds.
  try {await writeFile(config.maintenanceFile,'maintenance\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const response=await check(config.maintenanceUrl,config.publicHost);
  if(response?.status!==503)throw new Error('Maintenance required for rollback');
  try {
    await stopped(run,unit);
    await switchLink(current,target,id);
    await run('systemctl',['start',unit]);
    await ready(config,id,check,delay);
    await rm(config.maintenanceFile);
  } catch(error){await stopped(run,unit).catch(()=>{});throw error;}
  // No database restoration: receipts and post-release transactions are preserved.
}
async function withReleaseLock(config,fn) {
  const lock=absolute(config.lockFile,'lockFile');
  await writeFile(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
  try{return await fn();}finally{await rm(lock);}
}
export async function deploy(config,input,deps) {return withReleaseLock(config,()=>deployUnlocked(config,input,deps));}
export async function rollback(config,id,deps) {return withReleaseLock(config,()=>rollbackUnlocked(config,id,deps));}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const [configPath,mode,id,archive,digest]=process.argv.slice(2);
    const config=JSON.parse(await readFile(required(configPath,'config path'),'utf8'));
    if(mode==='rollback')await rollback(config,id);
    else if(mode==='deploy')await deploy(config,{id,archive,expectedSha256:digest});
    else throw new Error('Use deploy or rollback');
    console.log('OK',mode,id);
  } catch(error){console.error('FAIL release:',error.message);process.exitCode=1;}
}
