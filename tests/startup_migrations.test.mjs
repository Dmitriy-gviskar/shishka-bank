import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, cp, symlink, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setupDb } from './helpers/db.mjs';
import { runMigrations } from '../client/lib/migrations.mjs';
const root=fileURLToPath(new URL('../client/',import.meta.url));
const pg=createRequire(new URL('../client/package.json',import.meta.url))('pg');
async function fixture(t) {
  const db=await setupDb();
  const pool=new pg.Pool({connectionString:db.url,max:3});
  const dir=await mkdtemp(join(tmpdir(),'shishka-migrations-'));
  t.after(async()=>{await pool.end();await rm(dir,{recursive:true,force:true});});
  return {db,pool,dir};
}

test('migration SQL error rolls back its changes, skips following files and releases advisory lock',async(t)=>{
  const {pool,dir}=await fixture(t);
  await writeFile(join(dir,'first.sql'),'create table migration_first(id int); insert into migration_first values(1);');
  await writeFile(join(dir,'bad.sql'),'create table migration_partial(id int); select migration_missing_function();');
  await writeFile(join(dir,'later.sql'),'create table migration_later(id int);');
  await assert.rejects(runMigrations(pool,dir,['first.sql','bad.sql','later.sql'],()=>{}),/migration bad.sql/);
  const result=await pool.query("select to_regclass('migration_first')::text as first, to_regclass('migration_partial')::text as partial, to_regclass('migration_later')::text as later");
  assert.equal(result.rows[0].first,'migration_first');
  assert.equal(result.rows[0].partial,null);
  assert.equal(result.rows[0].later,null);
  const client=await pool.connect();
  try {
    assert.equal((await client.query('select pg_try_advisory_lock(87236401) as acquired')).rows[0].acquired,true);
    await client.query('select pg_advisory_unlock(87236401)');
  } finally {client.release();}
});

test('missing and empty required migrations fail instead of being silently skipped',async(t)=>{
  const {pool,dir}=await fixture(t);
  await assert.rejects(runMigrations(pool,dir,['missing.sql'],()=>{}),/migration missing.sql/);
  await writeFile(join(dir,'empty.sql'),' \n\t');
  await assert.rejects(runMigrations(pool,dir,['empty.sql'],()=>{}),/empty migration/);
});

test('the session lock and migration transactions use one connection even with a multi-connection pool',async(t)=>{
  const {pool,dir}=await fixture(t);
  let entered;
  const running=new Promise((r)=>{entered=r;});
  await writeFile(join(dir,'hold.sql'),'select pg_sleep(0.2); create table migration_backends(pid int); insert into migration_backends values(pg_backend_pid());');
  await writeFile(join(dir,'next.sql'),'insert into migration_backends values(pg_backend_pid());');
  // Observe the real DB lock while the first SQL file is running.
  const wrapped={connect:async()=>{
    const client=await pool.connect();
    return {query:(sql)=>{const result=client.query(sql);if(sql.includes('pg_sleep'))entered();return result;},release:(error)=>client.release(error)};
  }};
  const job=runMigrations(wrapped,dir,['hold.sql','next.sql'],()=>{});
  await running;
  const observer=await pool.connect();
  try {
    assert.equal((await observer.query('select pg_try_advisory_lock(87236401) as acquired')).rows[0].acquired,false);
    await job;
    assert.equal((await observer.query('select count(distinct pid)::int as n from migration_backends')).rows[0].n,1);
    assert.equal((await observer.query('select pg_try_advisory_lock(87236401) as acquired')).rows[0].acquired,true);
    await observer.query('select pg_advisory_unlock(87236401)');
  } finally {observer.release();}
});

async function freePort(){
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve)=>server.close(resolve));
  return port;
}
async function startupFixture(t,mode) {
  const {db,dir}=await fixture(t);
  for(const file of ['server-pg.mjs','server-cluster.mjs'])await cp(join(root,file),join(dir,file));
  for(const sub of ['lib','routes','node_modules'])await symlink(join(root,sub),join(dir,sub),'dir');
  await cp(join(root,'migrations'),join(dir,'migrations'),{recursive:true});
  const first=join(dir,'migrations','migration_quest_daily10.sql');
  if(mode==='missing')await unlink(first);
  else await writeFile(first,mode==='empty'?' \n':'create table startup_partial(id int); select startup_missing_function();');
  return {db,dir,port:await freePort()};
}
async function expectStartupFailure(t,{db,dir,port},cluster=false){
  const proc=spawn(process.execPath,[join(dir,cluster?'server-cluster.mjs':'server-pg.mjs')],{
    env:{...process.env,DATABASE_URL:db.url,PARENT_PIN:'testpin',PORT:String(port),CLUSTER_WORKERS:'2'},stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(proc.exitCode==null)proc.kill('SIGKILL');});
  let stdout='',stderr='';
  proc.stdout.on('data',(d)=>{stdout+=d;});proc.stderr.on('data',(d)=>{stderr+=d;});
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{proc.kill('SIGKILL');reject(new Error('startup failure did not terminate: '+stderr));},15000);
    proc.once('error',(e)=>{clearTimeout(timer);reject(e);});
    proc.once('close',(value)=>{clearTimeout(timer);resolve(value);});
  });
  assert.equal(code,78,stderr);
  assert.match(stderr,/migration.*migration_quest_daily10.sql/);
  assert.doesNotMatch(stdout,/http:\/\//);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/ping`));
  return {stdout,stderr};
}

for(const mode of ['sql','missing','empty'])test(`server refuses to listen on ${mode} migration failure`,async(t)=>{
  const setup=await startupFixture(t,mode);
  await expectStartupFailure(t,setup);
});

test('cluster exits on migration failure instead of respawning the failed worker',async(t)=>{
  const setup=await startupFixture(t,'sql');
  const {stderr}=await expectStartupFailure(t,setup,true);
  assert.match(stderr,/останавливаю кластер/);
  assert.doesNotMatch(stderr,/перезапускаю/);
});
