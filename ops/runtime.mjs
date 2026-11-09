import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export async function command(file, args = [], options = {}) {
  const env={...process.env,...options.env};
  if(options.env?.PGSERVICE)for(const key of ['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGOPTIONS'])if(!(key in options.env))delete env[key];
  try {
    const {stdout} = await exec(file,args,{cwd:options.cwd,env,timeout:options.timeoutMs??15*60*1000,maxBuffer:8*1024*1024});
    return {stdout,code:0};
  } catch (error) {
    if (options.allowFailure && Number.isInteger(error.code)) return {stdout:error.stdout||'',code:error.code};
    throw new Error(`${file} failed`,{cause:new Error(`exit ${Number.isInteger(error.code)?error.code:'unavailable'}`)});
  }
}
export function required(value,label) { if(typeof value!=='string'||!value.trim())throw new Error(`Missing ${label}`);return value; }
export function absolute(value,label) {required(value,label);if(!isAbsolute(value)||resolve(value)==='/')throw new Error(`Unsafe ${label}`);return resolve(value);}
export async function exists(path) {try{await access(path);return true;}catch{return false;}}
export async function sha256(path) {return createHash('sha256').update(await readFile(path)).digest('hex');}
export async function json(path,value) {await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
export const quote=(value)=>"'"+String(value).replaceAll("'","'\\''")+"'";
export async function probe(url,host) {
  const target=new URL(url);
  if(!['127.0.0.1','[::1]','localhost'].includes(target.hostname)||target.username||target.password)throw new Error('Probe must use loopback without credentials');
  try {
    const res=await fetch(url,{headers:host?{host}:{},signal:AbortSignal.timeout(3000)});
    const body=await res.json().catch(()=>null);
    return {status:res.status,body};
  } catch{return null;}
}
