import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setupDb,startServer} from './helpers/db.mjs';
const pg=createRequire(new URL('../client/package.json',import.meta.url))('pg');
async function fixture(t){
 const db=await setupDb();const pool=new pg.Pool({connectionString:db.url});
 t.after(()=>pool.end());
 const q=(s,a=[])=>pool.query(s,a).then((r)=>r.rows);
 return {db,pool,q};
}

test('real legacy metrics survive repeat guild migration without fake surprises or zero functions',async(t)=>{
 const {db,q}=await fixture(t);const id=db.childA1.id;
 assert.equal((await q("select to_regclass('public.surprises') as v"))[0].v,null);
 await q("insert into mini_games(child_id,game,score) values($1,'multiply',77)",[id]);
 await q("insert into transactions(circle_id,from_user,to_user,amount,type,message,is_anonymous,revealed) values($1,$2,$3,5,'transfer','Any gift',true,true)",[db.circleA,id,db.childA2.id]);
 const metrics=['math_score','cones_earned','cones_spent','current_balance','gifts_sum','transfers_count','investigations_done','guild_founded'];
 const read=()=>q('select metric,achievement_metric($1,metric) as value from unnest($2::text[]) metric order by metric',[id,metrics]);
 const before=await read();assert.equal(before.find((x)=>x.metric==='math_score').value,77);assert.equal(before.find((x)=>x.metric==='gifts_sum').value,5);
 assert.equal((await q("select achievement_metric($1,'investigations_done') as v",[db.childA2.id]))[0].v,1);
 const sql=await readFile(new URL('../client/migrations/migration_guilds_v3.sql',import.meta.url),'utf8');
 await q(sql);await q(sql);
 assert.deepEqual(await read(),before);
 const actual=await q('select metric,achievement_metric_legacy($1,metric) as value from unnest($2::text[]) metric order by metric',[id,metrics]);
 assert.deepEqual(actual,before);
 assert.ok((await q("select pg_get_functiondef('achievement_metric_legacy(uuid,text)'::regprocedure) as body"))[0].body.includes('mini_games'));
});

test('guild payout allocates the whole order and updates both guild metrics before granting badges',async(t)=>{
 const {db,q}=await fixture(t);const a=db.childA1.id,b=db.childA2.id;
 const [created]=await q("select (create_guild($1,'Payout probe')).id",[a]);const g=created.id;
 await q('select join_guild($1,$2)',[g,b]);await q('select guild_set_share($1,$2,3,$3)',[g,b,a]);
 await q("insert into achievements(code,title,description,metric,threshold,reward) values('guild_regression_order','Order','Order','guild_orders',1,0)").catch(async(error)=>{throw error;});
 const [paid]=await q("select guild_payout($1,11,'Probe order') as n",[g]);assert.equal(paid.n,11);
 const payouts=await q("select to_user,amount from transactions where ref_id=$1 and type='reward' order by to_user",[g]);
 assert.equal(payouts.length,2);assert.equal(payouts.reduce((n,x)=>n+x.amount,0),11);
 for(const child of [a,b]){
  assert.equal((await q("select achievement_metric($1,'guild_orders') as n",[child]))[0].n,1);
  assert.equal((await q("select achievement_metric($1,'guild_cones') as n",[child]))[0].n,payouts.find((x)=>x.to_user===child).amount);
  assert.equal((await q("select count(*)::int as n from user_achievements where child_id=$1 and code='guild_regression_order'",[child]))[0].n,1);
 }
 assert.equal((await q('select status from guilds where id=$1',[g]))[0].status,'open');
});

test('roles, shares and repeat joining cannot remove founder authority or reset managed shares',async(t)=>{
 const {db,q}=await fixture(t);const a=db.childA1.id,b=db.childA2.id,c=db.childB1.id;
 const [created]=await q("select (create_guild($1,'Role probe')).id",[a]);const g=created.id;
 await q('select join_guild($1,$2)',[g,b]);
 await assert.rejects(q("select guild_set_role($1,$2,'treasurer',$3)",[g,b,c]),/only founder/);
 await assert.rejects(q("select guild_set_role($1,$2,'member',$2)",[g,a]),/demote founder/);
 await q("select guild_set_role($1,$2,'treasurer',$3)",[g,b,a]);
 await q('select guild_set_share($1,$2,3,$3)',[g,b,b]);await q('select join_guild($1,$2)',[g,b]);
 assert.equal((await q('select share from guild_members where guild_id=$1 and child_id=$2',[g,b]))[0].share,3);
 await assert.rejects(q('select guild_set_share($1,$2,0,$3)',[g,b,a]),/positive/);
 await assert.rejects(q('select guild_set_share($1,$2,5,$3)',[g,b,c]),/only founder or treasurer/);
});

test('boot migration bundle contains v2/v3 before invites, and absent guild functions are repaired at startup',async(t)=>{
 const {db,q}=await fixture(t);
 await q('drop function sweep_sleeping_guilds(int)');
 await q('drop function guild_awaken(uuid)');
 const server=await startServer(db.url);t.after(()=>server.stop());
 assert.ok((await q("select to_regprocedure('sweep_sleeping_guilds(integer)') is not null as ready"))[0].ready);
 assert.ok((await q("select to_regprocedure('guild_awaken(uuid)') is not null as ready"))[0].ready);
 assert.equal((await server.api('/api/ping')).body.db,'ok');
});

test('startup upgrades backup-era create_guild so every new guild has a founder and history',async(t)=>{
 const {db,q}=await fixture(t);
 await q(`create or replace function create_guild(p_creator uuid,p_name text,p_share int default 1)
 returns guilds language plpgsql security definer set search_path=public as $$
 declare g guilds; c_id uuid;
 begin
 select circle_id into c_id from users where id=p_creator;
 insert into guilds(circle_id,name,created_by) values(c_id,p_name,p_creator) returning * into g;
 insert into guild_members(guild_id,child_id,share) values(g.id,p_creator,greatest(p_share,1));
 return g;
 end $$;`);
 const server=await startServer(db.url);t.after(()=>server.stop());
 const made=await server.api('/api/guild/create',{method:'POST',headers:{'content-type':'application/json','x-child-code':db.childA1.code},body:JSON.stringify({name:'Restored founder'})});
 assert.equal(made.status,200);
 assert.equal((await q('select role from guild_members where guild_id=$1 and child_id=$2',[made.body.id,db.childA1.id]))[0].role,'founder');
 assert.equal((await q("select count(*)::int as n from guild_history where guild_id=$1 and kind='member_joined'",[made.body.id]))[0].n,1);
});
