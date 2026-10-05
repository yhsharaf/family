-- Family Kart v33: room chat, "Ready" before a race, and a longer start for the "Family are you Ready! 3 2 1 Go Family!!!" intro.
-- Everyone except the host presses Ready (the host's Start counts as theirs); the race can only start when everyone in the room is ready,
-- and after each start everybody is un-readied again for the next race.
alter table kart_room_players add column if not exists ready boolean not null default false;

create table if not exists kart_room_chat (
  id bigserial primary key, code text not null references kart_rooms(code) on delete cascade,
  name text not null, msg text not null check (char_length(msg) between 1 and 120), at timestamptz not null default now()
);
create index if not exists kart_room_chat_code on kart_room_chat (code, id desc);
alter table kart_room_chat enable row level security;
revoke all on kart_room_chat from anon, authenticated;

-- who is still in the room (seen in the last 15 s), now with their Ready
create or replace function kart_room_view(p_code text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', p.name, 'joined', p.joined_at, 'finish', p.finish_ms, 'ready', p.ready) order by p.joined_at), '[]'::json)
  from kart_room_players p where p.code = p_code and p.seen > now() - interval '15 seconds';
$$;

create or replace function kart_room_ready(p_code text, p_tok uuid, p_ready boolean) returns json
language plpgsql security definer set search_path = public as $$
declare me kart_room_players;
begin
  perform rl_check('kart_room_ready', 60, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  update kart_room_players set ready = coalesce(p_ready, false), seen = now() where code = p_code and name = me.name;
  return json_build_object('r', 'ok');
end $$;

create or replace function kart_room_say(p_code text, p_tok uuid, p_msg text) returns json
language plpgsql security definer set search_path = public as $$
declare me kart_room_players; m text := left(regexp_replace(trim(coalesce(p_msg, '')), '\s+', ' ', 'g'), 120); cid bigint;
begin
  perform rl_check('kart_room_say', 20, 30);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  if char_length(m) < 1 then return json_build_object('r', 'empty'); end if;
  insert into kart_room_chat (code, name, msg) values (p_code, me.name, m) returning id into cid;
  delete from kart_room_chat where code = p_code and id < cid - 200;
  return json_build_object('r', 'ok', 'id', cid, 'name', me.name, 'msg', m);
end $$;

create or replace function kart_room_state(p_code text, p_tok uuid, p_prog real default null) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players; nh text;
begin
  perform rl_check('kart_room_state', 120, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  update kart_room_players set seen = now(),
    prog = case when p_prog is not null and finish_ms is null then greatest(0, least(1, p_prog)) else prog end
    where code = p_code and name = me.name;
  select * into rm from kart_rooms where code = p_code;
  if not exists (select 1 from kart_room_players where code = p_code and name = rm.host and seen > now() - interval '15 seconds') then
    select name into nh from kart_room_players where code = p_code and seen > now() - interval '15 seconds' order by joined_at limit 1;
    if nh is not null then update kart_rooms set host = nh where code = p_code returning * into rm; end if;
  end if;
  if rm.status = 'racing' then perform kart_room_score(p_code); select * into rm from kart_rooms where code = p_code; end if;
  return json_build_object('r', 'ok', 'me', me.name, 'host', rm.host, 'track', rm.track, 'status', rm.status, 'race_no', rm.race_no, 'public', rm.is_public,
    'starts_in', case when rm.started_at is null then null else extract(epoch from rm.started_at - now()) end,
    'ends_in', case when rm.status = 'racing' and rm.first_finish is not null then extract(epoch from rm.first_finish + interval '10 seconds' - now()) end,
    'players', kart_room_view(p_code), 'results', rm.last_results,
    'chat', coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'msg', c.msg) order by c.id)
      from (select * from kart_room_chat where code = p_code order by id desc limit 40) c), '[]'::json));
end $$;

-- the host starts: everyone else in the room must be Ready; 8 seconds for loading and the intro
create or replace function kart_room_start(p_code text, p_tok uuid, p_track text) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players; waiting text[];
begin
  perform rl_check('kart_room_start', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code for update;
  if me.name is null or rm.host <> me.name then return json_build_object('r', 'host'); end if;
  if rm.status = 'racing' then return json_build_object('r', 'running'); end if;
  if p_track !~ '^(henesys|town|forest|en[123]|sw[123]|zk[123]|ld[123])(@50|@100)?$' then return json_build_object('r', 'track'); end if;
  if (select count(*) from kart_room_players where code = p_code and seen > now() - interval '15 seconds') < 2 then return json_build_object('r', 'few'); end if;
  select array_agg(name order by joined_at) into waiting from kart_room_players
    where code = p_code and seen > now() - interval '15 seconds' and name <> me.name and not ready;
  if waiting is not null then return json_build_object('r', 'notready', 'who', waiting); end if;
  delete from kart_room_players where code = p_code and seen < now() - interval '15 seconds';
  update kart_room_players set finish_ms = null, prog = 0, ready = false where code = p_code;
  update kart_rooms set status = 'racing', track = p_track, started_at = now() + interval '8 seconds', first_finish = null, race_no = race_no + 1, last_results = null
    where code = p_code returning * into rm;
  return json_build_object('r', 'ok', 'race_no', rm.race_no, 'starts_in', 8);
end $$;

revoke all on function kart_room_view(text) from public, anon, authenticated;
revoke all on function kart_room_ready(text, uuid, boolean), kart_room_say(text, uuid, text), kart_room_state(text, uuid, real), kart_room_start(text, uuid, text) from public, anon, authenticated;
grant execute on function kart_room_ready(text, uuid, boolean), kart_room_say(text, uuid, text), kart_room_state(text, uuid, real), kart_room_start(text, uuid, text) to anon;
select 'family kart v33 ready' as done;
