import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,realpath,symlink,rm,access,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploy,rollback } from '../ops/deploy.mjs';
import { sha256 } from '../ops/runtime.mjs';
const OLD='1'.repeat(40),NEXT='2'.repeat(40),HASH='a'.repeat(64);
async function fixture(t,mode) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'shishka-deploy-test-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const releases=join(root,'releases'),old=join(releases,OLD,'client'),current=join(root,'current');
  await mkdir(old,{recursive:true});await mkdir(join(root,'uploads'));
  await writeFile(join(old,'server-pg.mjs'),'old-secure-code');
  await writeFile(join(old,'release.json'),JSON.stringify({id:OLD,archiveSha256:HASH}));
  await symlink(old,current);
  const archive=join(root,'release.tar.gz');await writeFile(archive,'artifact');
  const config={lockFile:join(root,'release.lock'),layoutVersion:1,releaseRoot:releases,current,uploadsDir:join(root,'uploads'),maintenanceFile:join(root,'maintenance'),maintenanceUrl:'http://localhost/api/ping',publicHost:'example.test',healthUrl:'http://127.0.0.1:3777/api/ping',healthAttempts:1,service:'shishka',appOwner:'app',appGroup:'app',backup:{}};
  const calls=[];let active=true;let checkpoint=false;
  const run=async(file,args=[],options={})=>{
    calls.push({file,args,options});
    if(file==='python3') {
      const dest=args.at(-1);await mkdir(join(dest,'client'),{recursive:true});
      await writeFile(join(dest,'.nvmrc'),'24');await writeFile(join(dest,'client','server-pg.mjs'),'new-code');
    }
    if(file==='npm'&&mode==='npm-failure')throw new Error('npm failure');
    if(file==='node')return {stdout:'v24.14.0',code:0};
    if(file==='systemctl') {
      if(args.includes('show'))return {stdout:args.includes('--property=WorkingDirectory')?current:current+'/server-cluster.mjs',code:0};
      if(args[0]==='stop'){active=false;return {stdout:'',code:0};}
      if(args[0]==='start'){active=true;return {stdout:'',code:0};}
      if(args[0]==='is-active')return {stdout:active?'active':'inactive',code:active?0:3};
    }
    return {stdout:'',code:0};
  };
  const check=async(url,host)=>{
    if(host)return {status:mode==='bad-maintenance'?200:503,body:{}};
    if(!active)return null;
    if(mode==='bad-health')return {status:200,body:{ok:true,db:'error'}};
    if(url.endsWith('/release.json'))return {status:200,body:JSON.parse(await readFile(join(await realpath(current),'release.json')))};
    return {status:200,body:{ok:true,db:'ok'}};
  };
  const backup=async(c,opts)=>{
    calls.push({file:'CHECKPOINT'});
    assert.equal(active,false);assert.equal(await realpath(current),old);
    assert.equal(opts.checkpoint,true);
    if(mode==='backup-failure')throw new Error('backup failure');
    checkpoint=true;return {id:'snapshot',path:join(root,'snapshot'),mode:'checkpoint',restoreVerified:true};
  };
  return {root,old,archive,current,config,calls,run,check,backup,active:()=>active,checkpoint:()=>checkpoint,
    execute:()=>deploy(config,{id:NEXT,archive,expectedSha256:''},{run,check,backup,delay:async()=>{}})};
}
async function execute(f,checksum){return deploy(f.config,{id:NEXT,archive:f.archive,expectedSha256:checksum||await sha256(f.archive)},{run:f.run,check:f.check,backup:f.backup,delay:async()=>{}});}
async function present(path){try{await access(path);return true;}catch{return false;}}

test('release is staged, checkpointed while stopped, switched atomically, then health checked',async(t)=>{
  const f=await fixture(t);await execute(f);
  assert.equal(await readFile(join(f.old,'server-pg.mjs'),'utf8'),'old-secure-code');
  assert.equal(await realpath(f.current),join(f.config.releaseRoot,NEXT,'client'));
  assert.equal(f.checkpoint(),true);assert.equal(f.active(),true);
  assert.equal(await present(f.config.maintenanceFile),false);
  const npm=f.calls.findIndex((c)=>c.file==='npm'),stop=f.calls.findIndex((c)=>c.file==='systemctl'&&c.args[0]==='stop'),backup=f.calls.findIndex((c)=>c.file==='CHECKPOINT'),start=f.calls.findIndex((c)=>c.file==='systemctl'&&c.args[0]==='start');
  assert.ok(npm<stop&&stop<backup&&backup<start);
  assert.notEqual(f.calls[npm].options.cwd,f.old);
});

test('checksum or dependency failure never touches the running release',async(t)=>{
  const f=await fixture(t,'npm-failure');
  await assert.rejects(execute(f,'0'.repeat(64)),/checksum/);
  assert.equal(f.calls.length,0);
  await assert.rejects(execute(f),/npm failure/);
  assert.equal(await realpath(f.current),f.old);assert.equal(f.active(),true);
  assert.equal(await present(f.config.maintenanceFile),false);
});

test('legacy in-place layout is rejected before any service operation',async(t)=>{
  const f=await fixture(t);await rm(f.current);await mkdir(f.current);
  await assert.rejects(execute(f),/symlink/);
  assert.equal(f.calls.length,0);
});

test('backup failure prevents switch and retains maintenance with all workers stopped',async(t)=>{
  const f=await fixture(t,'backup-failure');
  await assert.rejects(execute(f),/backup failure/);
  assert.equal(await realpath(f.current),f.old);assert.equal(f.active(),false);
  assert.equal(await present(f.config.maintenanceFile),true);
  assert.ok(!f.calls.some((c)=>c.file==='systemctl'&&c.args[0]==='start'));
});

test('a failed DB readiness never reopens traffic or silently restarts old code',async(t)=>{
  const f=await fixture(t,'bad-health');
  await assert.rejects(execute(f),/readiness/);
  assert.equal(f.active(),false);assert.equal(await present(f.config.maintenanceFile),true);
  assert.equal(await realpath(f.current),join(f.config.releaseRoot,NEXT,'client'));
  assert.equal(await readFile(join(f.old,'server-pg.mjs'),'utf8'),'old-secure-code');
});

test('unconfigured nginx maintenance prevents the cutover',async(t)=>{
  const f=await fixture(t,'bad-maintenance');
  await assert.rejects(execute(f),/Nginx/);
  assert.equal(await realpath(f.current),f.old);assert.equal(f.active(),true);
  assert.equal(f.checkpoint(),false);
});

test('only explicitly approved compatible fallback may be activated; database is not restored',async(t)=>{
  const f=await fixture(t);await execute(f);
  await assert.rejects(rollback(f.config,OLD,{run:f.run,check:f.check}),/explicitly approved/);
  f.config.approvedFallbacks={[OLD]:HASH};
  await rollback(f.config,OLD,{run:f.run,check:f.check,delay:async()=>{}});
  assert.equal(await realpath(f.current),f.old);assert.equal(f.active(),true);
  assert.equal(await present(f.config.maintenanceFile),false);
  assert.ok(!f.calls.some((c)=>['pg_restore','dropdb','psql'].includes(c.file)));
});

for(const [name,member,kind] of [['parent traversal','../../escape','file'],['symbolic link','client/link','link'],['uploads in archive','client/uploads/photo','file']])test(`real archive extraction rejects ${name} before maintenance`,async(t)=>{
  const {command}=await import('../ops/runtime.mjs');
  const f=await fixture(t);
  const py="import tarfile,io,sys\nwith tarfile.open(sys.argv[1],'w:gz') as t:\n m=tarfile.TarInfo(sys.argv[2]);m.size=1\n if sys.argv[3]=='link': m.type=tarfile.SYMTYPE;m.linkname='/tmp/elsewhere';m.size=0\n t.addfile(m,io.BytesIO(b'x'))\n";
  await command('python3',['-c',py,f.archive,member,kind]);
  const run=(file,args,options)=>file==='python3'?command(file,args,options):f.run(file,args,options);
  await assert.rejects(deploy(f.config,{id:NEXT,archive:f.archive,expectedSha256:await sha256(f.archive)},{run,check:f.check,backup:f.backup,delay:async()=>{}}),/python3 failed/);
  assert.equal(await realpath(f.current),f.old);assert.equal(f.active(),true);
  assert.equal(await present(f.config.maintenanceFile),false);
});

test('host release lock prevents a manual rollback racing another deployment',async(t)=>{
  const f=await fixture(t);
  await writeFile(f.config.lockFile,'another-operation');
  await assert.rejects(execute(f),/EEXIST/);
  await assert.rejects(rollback(f.config,OLD,{run:f.run,check:f.check}),/EEXIST/);
  assert.equal(f.calls.length,0);
  assert.equal(await readFile(f.config.lockFile,'utf8'),'another-operation');
});

test('remote deploy entry point returns failure without touching a service when config is missing',async(t)=>{
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const {fileURLToPath}=await import('node:url');
  const f=await fixture(t);
  await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../ops/deploy.mjs',import.meta.url)),join(f.root,'missing.json'),'deploy',NEXT]),(e)=>{assert.equal(e.code,1);assert.match(e.stderr,/FAIL release/);assert.doesNotMatch(e.stdout,/OK/);return true;});
  assert.equal(f.active(),true);assert.equal(await realpath(f.current),f.old);
});
