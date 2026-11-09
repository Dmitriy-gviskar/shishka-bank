-- Private, durable game attempts. Never accept a client score as proof of play.
create table if not exists game_attempts (
 id uuid primary key default gen_random_uuid(),
 child_id uuid not null references users(id) on delete cascade,
 game text not null check(game in ('multiply','count','guess','memory','word','odd','number','compare','story','quiz','logic')),
 epoch uuid not null, level integer not null, promised integer not null,
 max_score integer not null, label text not null, challenge jsonb not null,
 answers jsonb not null default '{}'::jsonb, result jsonb,
 created_at timestamptz not null default now(),
 answer_until timestamptz not null,
 expires_at timestamptz not null default now()+interval '30 minutes'
);
create index if not exists game_attempts_child_idx on game_attempts(child_id,created_at);
create table if not exists game_daily_claims (
 child_id uuid not null references users(id) on delete cascade,
 game text not null, day date not null,
 attempt_id uuid not null references game_attempts(id),
 primary key(child_id,game,day)
);

create or replace function answer_game_attempt(p_child uuid,p_id uuid,p_epoch uuid,p_index integer,p_answer text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a game_attempts; previous jsonb; expected text; output jsonb; answered integer;
begin
 select * into a from game_attempts where id=p_id and child_id=p_child for update;
 if not found then raise exception using errcode='22023',message='attempt not found'; end if;
 if a.epoch is distinct from p_epoch then raise exception using errcode='P0503',message='restored generation'; end if;
 if a.game='memory' or p_index is null or p_index<0 or p_index>=jsonb_array_length(a.challenge->'answers') or p_answer is null or length(p_answer)>200 then
  raise exception using errcode='22023',message='invalid answer';
 end if;
 previous:=a.answers->p_index::text;
 if previous is not null then
  if previous->>'answer' is distinct from p_answer then raise exception using errcode='P0409',message='answer conflict'; end if;
  return previous->'result';
 end if;
 if a.result is not null or now()>a.expires_at or now()>a.answer_until then raise exception using errcode='P0409',message='attempt ended'; end if;
 select count(*) into answered from jsonb_object_keys(a.answers);
 if p_index<>answered then raise exception using errcode='P0409',message='answer order'; end if;
 expected:=a.challenge->'answers'->>p_index;
 output:=jsonb_build_object('correct',lower(trim(p_answer))=lower(trim(expected)),'expected',expected);
 update game_attempts set answers=answers||jsonb_build_object(p_index::text,jsonb_build_object('answer',p_answer,'result',output)) where id=a.id;
 return output;
end $$;

create or replace function flip_game_tile(p_child uuid,p_id uuid,p_epoch uuid,p_move integer,p_tile integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a game_attempts; moves jsonb; matched jsonb; opened integer; previous jsonb; output jsonb; same boolean:=false; code text;
begin
 select * into a from game_attempts where id=p_id and child_id=p_child for update;
 if not found then raise exception using errcode='22023',message='attempt not found'; end if;
 if a.epoch is distinct from p_epoch then raise exception using errcode='P0503',message='restored generation'; end if;
 if a.game<>'memory' or p_move is null or p_move<0 or p_tile is null or p_tile<0 or p_tile>=jsonb_array_length(a.challenge->'deck') then raise exception using errcode='22023',message='invalid flip'; end if;
 moves:=coalesce(a.answers->'moves','[]'::jsonb);
 if p_move<jsonb_array_length(moves) then
  previous:=moves->p_move;
  if (previous->>'tile')::int<>p_tile then raise exception using errcode='P0409',message='move conflict'; end if;
  return previous->'result';
 end if;
 if a.result is not null or now()>a.expires_at or p_move<>jsonb_array_length(moves) then raise exception using errcode='P0409',message='attempt ended or move order'; end if;
 matched:=coalesce(a.answers->'matched','[]'::jsonb);opened:=(a.answers->>'open')::int;
 if matched @> jsonb_build_array(p_tile) or opened=p_tile then raise exception using errcode='P0409',message='tile already open'; end if;
 code:=a.challenge->'deck'->>p_tile;
 if opened is not null then
  same:=(a.challenge->'deck'->>opened)=code;
  if same then matched:=matched||jsonb_build_array(opened,p_tile); end if;
 end if;
 output:=jsonb_build_object('tile',p_tile,'code',code,'matched',same,'pairedWith',opened,'matchedCount',jsonb_array_length(matched)/2);
 moves:=moves||jsonb_build_array(jsonb_build_object('tile',p_tile,'result',output));
 update game_attempts set answers=jsonb_build_object('moves',moves,'matched',matched,'open',case when opened is null then p_tile else null end) where id=a.id;
 return output;
end $$;

create or replace function finish_game_attempt(p_child uuid,p_id uuid,p_epoch uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a game_attempts; points integer; answered integer; rew integer:=0; bal integer; today date:=(now() at time zone 'Europe/Moscow')::date; already boolean; output jsonb;
begin
 -- Same player lock precedes daily checks, progress, wallet and history writes.
 perform 1 from wallets where user_id=p_child for update;
 if not found then raise exception using errcode='22023',message='wallet not found'; end if;
 select * into a from game_attempts where id=p_id and child_id=p_child for update;
 if not found then raise exception using errcode='22023',message='attempt not found'; end if;
 if a.epoch is distinct from p_epoch then raise exception using errcode='P0503',message='restored generation'; end if;
 if a.result is not null then return a.result; end if;
 if now()>a.expires_at then raise exception using errcode='P0409',message='attempt expired'; end if;
 if a.game='memory' then
  points:=jsonb_array_length(coalesce(a.answers->'matched','[]'::jsonb))/2;
 else
  select count(*),count(*) filter(where (value->'result'->>'correct')::boolean) into answered,points from jsonb_each(a.answers);
  if a.game<>'count' and answered<>jsonb_array_length(a.challenge->'answers') then raise exception using errcode='P0409',message='attempt incomplete'; end if;
 end if;
 points:=least(a.max_score,points);
 select exists(select 1 from game_daily_claims where child_id=p_child and game=a.game and day=today)
  or exists(select 1 from transactions where to_user=p_child and type='reward' and message=a.label and (created_at at time zone 'Europe/Moscow')::date=today) into already;
 if not already then
  rew:=case when a.game='count' then points else greatest(0,a.promised-(a.max_score-points)) end;
  insert into mini_games(child_id,game,level,score,last_played) values(p_child,a.game,a.level,points,today)
   on conflict(child_id,game) do update set level=excluded.level,score=mini_games.score+excluded.score,last_played=excluded.last_played;
  if rew>0 then
   insert into game_daily_claims(child_id,game,day,attempt_id) values(p_child,a.game,today,a.id);
   update wallets set balance=balance+rew,total_earned=total_earned+rew where user_id=p_child;
   insert into transactions(circle_id,to_user,amount,type,message,ref_id)
    select circle_id,p_child,rew,'reward',a.label,a.id from users where id=p_child;
  end if;
  perform check_achievements(p_child);
 end if;
 select balance into bal from wallets where user_id=p_child;
 output:=jsonb_build_object('ok',true,'attemptId',a.id,'score',points,'reward',rew,'balance',bal,'already',already);
 update game_attempts set result=output where id=a.id;
 return output;
end $$;

-- The proxy/migration owner executes these; private answers must not be a public RPC.
revoke all on game_attempts,game_daily_claims from public;
revoke all on function answer_game_attempt(uuid,uuid,uuid,integer,text) from public;
revoke all on function flip_game_tile(uuid,uuid,uuid,integer,integer) from public;
revoke all on function finish_game_attempt(uuid,uuid,uuid) from public;
