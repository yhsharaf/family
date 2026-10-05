-- Family Kart v5: multiplayer rooms (2-8 players, the first one in is the host) and a points board fed only by multiplayer races.
-- Live positions go through Realtime broadcast; the database keeps the room, who's in it, the start time and the finish times,
-- and gives out points (10-8-6-4-3-2-1-0 by place, guild members only) once per race.
create table if not exists kart_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{4,8}$'),
  host text not null, track text not null default 'henesys', status text not null default 'lobby',
  created_at timestamptz not null default now(), started_at timestamptz, first_finish timestamptz, race_no int not null default 0,
  last_results json
);
create table if not exists kart_room_players (
  code text not null references kart_rooms(code) on delete cascade, name text not null check (char_length(name) between 2 and 20),
  token uuid not null default gen_random_uuid(), joined_at timestamptz not null default now(), seen timestamptz not null default now(),
  finish_ms int, primary key (code, name)
);
create table if not exists kart_points (
  player text primary key check (char_length(player) <= 40), points int not null default 0, races int not null default 0, wins int not null default 0,
  updated_at timestamptz not null default now()
);
alter table kart_rooms enable row level security;
alter table kart_room_players enable row level security;
alter table kart_points enable row level security;
revoke all on kart_rooms, kart_room_players, kart_points from anon, authenticated;
drop policy if exists "read kart points" on kart_points;
create policy "read kart points" on kart_points for select using (true);
grant select on kart_points to anon;

-- who is still in the room (seen in the last 15 s)
create or replace function kart_room_view(p_code text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', p.name, 'joined', p.joined_at, 'finish', p.finish_ms) order by p.joined_at), '[]'::json)
  from kart_room_players p where p.code = p_code and p.seen > now() - interval '15 seconds';
$$;

-- give out points once, when everyone still here has finished, or 60 s after the first finisher
create or replace function kart_room_score(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; res json; n int;
begin
  select * into rm from kart_rooms where code = p_code for update;
  if rm.status <> 'racing' then return; end if;
  if exists (select 1 from kart_room_players where code = p_code and seen > now() - interval '15 seconds' and finish_ms is null)
     and not (rm.first_finish is not null and now() > rm.first_finish + interval '60 seconds') then return; end if;
  select count(*) into n from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds');
  with ranked as (
    select name, finish_ms, row_number() over (order by finish_ms nulls last, joined_at) as place
    from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds')
  ), scored as (
    select r.*, case when n >= 2 and r.finish_ms is not null and exists (select 1 from draw_guild dg where dg.name = r.name)
      then (array[10, 8, 6, 4, 3, 2, 1, 0])[least(r.place, 8)] else 0 end as pts from ranked r
  ), ins as (
    insert into kart_points as k (player, points, races, wins)
      select name, pts, 1, (place = 1)::int from scored where finish_ms is not null and exists (select 1 from draw_guild dg where dg.name = scored.name)
    on conflict (player) do update set points = k.points + excluded.points, races = k.races + 1, wins = k.wins + excluded.wins, updated_at = now()
    returning 1
  )
  select json_agg(json_build_object('name', name, 'ms', finish_ms, 'place', place, 'pts', pts) order by place) into res from scored;
  update kart_rooms set status = 'lobby', last_results = res where code = p_code;
end $$;

create or replace function kart_room_join(p_code text, p_name text, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare cd text := upper(left(coalesce(p_code, ''), 8)); nm text := left(trim(coalesce(p_name, '')), 20); rm kart_rooms; pl kart_room_players;
begin
  perform rl_check('kart_room', 30, 60);
  delete from kart_rooms where created_at < now() - interval '6 hours';
  if cd !~ '^[A-Z0-9]{4,8}$' then return json_build_object('r', 'code'); end if;
  if p_tok is not null then
    select * into pl from kart_room_players where code = cd and token = p_tok;
    if pl.name is not null then update kart_room_players set seen = now() where code = cd and name = pl.name; return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select * into rm from kart_rooms where code = cd for update;
  if rm.code is null then
    if (select count(*) from kart_rooms where created_at > now() - interval '1 hour') >= 40 then return json_build_object('r', 'busy'); end if;
    insert into kart_rooms (code, host) values (cd, nm) returning * into rm;   -- the first one in is the host
  end if;
  if rm.status = 'racing' then return json_build_object('r', 'running'); end if;
  delete from kart_room_players where code = cd and seen < now() - interval '30 seconds';
  if exists (select 1 from kart_room_players where code = cd and lower(name) = lower(nm)) then return json_build_object('r', 'taken'); end if;
  if (select count(*) from kart_room_players where code = cd) >= 8 then return json_build_object('r', 'full'); end if;
  insert into kart_room_players (code, name) values (cd, nm) returning * into pl;
  if not exists (select 1 from kart_room_players where code = cd and name = rm.host and seen > now() - interval '15 seconds') then update kart_rooms set host = nm where code = cd; end if;
  return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name);
end $$;

create or replace function kart_room_state(p_code text, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players; nh text;
begin
  perform rl_check('kart_room_state', 120, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  update kart_room_players set seen = now() where code = p_code and name = me.name;
  select * into rm from kart_rooms where code = p_code;
  -- the host left: the next person who joined takes over
  if not exists (select 1 from kart_room_players where code = p_code and name = rm.host and seen > now() - interval '15 seconds') then
    select name into nh from kart_room_players where code = p_code and seen > now() - interval '15 seconds' order by joined_at limit 1;
    if nh is not null then update kart_rooms set host = nh where code = p_code returning * into rm; end if;
  end if;
  if rm.status = 'racing' then perform kart_room_score(p_code); select * into rm from kart_rooms where code = p_code; end if;
  return json_build_object('r', 'ok', 'me', me.name, 'host', rm.host, 'track', rm.track, 'status', rm.status, 'race_no', rm.race_no,
    'starts_in', case when rm.started_at is null then null else extract(epoch from rm.started_at - now()) end,
    'players', kart_room_view(p_code), 'results', rm.last_results);
end $$;

create or replace function kart_room_start(p_code text, p_tok uuid, p_track text) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players;
begin
  perform rl_check('kart_room_start', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code for update;
  if me.name is null or rm.host <> me.name then return json_build_object('r', 'host'); end if;
  if rm.status = 'racing' then return json_build_object('r', 'running'); end if;
  if p_track not in ('henesys', 'town', 'forest') then return json_build_object('r', 'track'); end if;
  if (select count(*) from kart_room_players where code = p_code and seen > now() - interval '15 seconds') < 2 then return json_build_object('r', 'few'); end if;
  delete from kart_room_players where code = p_code and seen < now() - interval '15 seconds';
  update kart_room_players set finish_ms = null where code = p_code;
  update kart_rooms set status = 'racing', track = p_track, started_at = now() + interval '5 seconds', first_finish = null, race_no = race_no + 1, last_results = null
    where code = p_code returning * into rm;
  return json_build_object('r', 'ok', 'race_no', rm.race_no, 'starts_in', 5);
end $$;

-- your own finish time only; it can't be shorter than the time since the start, or faster than 3 x 18 s
create or replace function kart_room_finish(p_code text, p_tok uuid, p_ms int) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players;
begin
  perform rl_check('kart_room_finish', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code;
  if me.name is null or rm.status <> 'racing' or me.finish_ms is not null then return json_build_object('r', 'no'); end if;
  if p_ms < 54000 or p_ms > extract(epoch from now() - rm.started_at) * 1000 + 4000 then return json_build_object('r', 'time'); end if;
  update kart_room_players set finish_ms = p_ms, seen = now() where code = p_code and name = me.name;
  update kart_rooms set first_finish = coalesce(first_finish, now()) where code = p_code;
  perform kart_room_score(p_code);
  return json_build_object('r', 'ok');
end $$;

create or replace function kart_room_leave(p_code text, p_tok uuid) returns void
language sql security definer set search_path = public as $$
  delete from kart_room_players where code = p_code and token = p_tok;
$$;

revoke all on function kart_room_view(text), kart_room_score(text) from public, anon, authenticated;
revoke all on function kart_room_join(text, text, uuid), kart_room_state(text, uuid), kart_room_start(text, uuid, text), kart_room_finish(text, uuid, int), kart_room_leave(text, uuid) from public, anon, authenticated;
grant execute on function kart_room_join(text, text, uuid), kart_room_state(text, uuid), kart_room_start(text, uuid, text), kart_room_finish(text, uuid, int), kart_room_leave(text, uuid) to anon;
select 'family kart v5 ready' as done;
