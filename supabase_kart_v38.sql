-- Family Kart v38: joining a room while it's racing lets you WATCH that race (you're a spectator: not in its results),
-- and you're in for the next race. The room still holds 8 real players at most (bots don't take a real player's seat).
alter table kart_room_players add column if not exists spectating boolean not null default false;

create or replace function kart_room_view(p_code text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', p.name, 'joined', p.joined_at, 'finish', p.finish_ms, 'ready', p.ready, 'bot', p.is_bot, 'spec', p.spectating) order by p.is_bot, p.joined_at), '[]'::json)
  from kart_room_players p where p.code = p_code and p.seen > now() - interval '15 seconds';
$$;

create or replace function kart_room_join(p_code text, p_name text, p_tok uuid, p_public boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare cd text := upper(left(coalesce(p_code, ''), 8)); nm text := left(trim(coalesce(p_name, '')), 20); rm kart_rooms; pl kart_room_players;
begin
  perform rl_check('kart_room', 30, 60);
  delete from kart_rooms where created_at < now() - interval '6 hours';
  if cd !~ '^[A-Z0-9]{4,8}$' then return json_build_object('r', 'code'); end if;
  if p_tok is not null then
    select * into pl from kart_room_players where code = cd and token = p_tok;
    if pl.name is not null then update kart_room_players set seen = now() where code = cd and name = pl.name; return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name, 'spec', pl.spectating); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select * into rm from kart_rooms where code = cd for update;
  if rm.code is null then
    if (select count(*) from kart_rooms where created_at > now() - interval '1 hour') >= 40 then return json_build_object('r', 'busy'); end if;
    insert into kart_rooms (code, host, is_public) values (cd, nm, coalesce(p_public, false)) returning * into rm;   -- the first one in is the host
  end if;
  if rm.status <> 'racing' then delete from kart_room_players where code = cd and seen < now() - interval '30 seconds'; end if;
  if exists (select 1 from kart_room_players where code = cd and lower(name) = lower(nm)) then return json_build_object('r', 'taken'); end if;
  if (select count(*) from kart_room_players where code = cd and not is_bot) >= 8 then return json_build_object('r', 'full'); end if;
  insert into kart_room_players (code, name, spectating) values (cd, nm, rm.status = 'racing') returning * into pl;   -- mid-race: you watch this one
  if not exists (select 1 from kart_room_players where code = cd and name = rm.host and seen > now() - interval '15 seconds') then update kart_rooms set host = nm where code = cd; end if;
  return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name, 'spec', pl.spectating);
end $$;

create or replace function kart_room_start(p_code text, p_tok uuid, p_track text, p_bots int default 0) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players; waiting text[]; humans int; nb int;
  names text[] := array['Orange Mushroom', 'Ribbon Pig', 'Blue Snail', 'Stump', 'Green Mushroom', 'Horny Mushroom', 'Pig'];
begin
  perform rl_check('kart_room_start', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code for update;
  if me.name is null or rm.host <> me.name then return json_build_object('r', 'host'); end if;
  if rm.status = 'racing' then return json_build_object('r', 'running'); end if;
  if p_track !~ '^(henesys|town|forest|en[123]|sw[123]|zk[123]|ld[123])(@50|@100)?$' then return json_build_object('r', 'track'); end if;
  delete from kart_room_players where code = p_code and is_bot;
  select count(*) into humans from kart_room_players where code = p_code and seen > now() - interval '15 seconds';
  if humans < 2 and coalesce(p_bots, 0) = 0 then return json_build_object('r', 'few'); end if;
  select array_agg(name order by joined_at) into waiting from kart_room_players
    where code = p_code and seen > now() - interval '15 seconds' and name <> me.name and not ready;
  if waiting is not null then return json_build_object('r', 'notready', 'who', waiting); end if;
  delete from kart_room_players where code = p_code and seen < now() - interval '15 seconds';
  update kart_room_players set finish_ms = null, prog = 0, ready = false, spectating = false where code = p_code;
  nb := greatest(0, least(8, case when p_bots >= 8 then 8 when p_bots >= 4 then 4 else 0 end) - humans);
  insert into kart_room_players (code, name, is_bot, ready, seen, joined_at)
    select p_code, n, true, true, now(), now() + (i || ' milliseconds')::interval
    from unnest(names[1:nb]) with ordinality as t(n, i)
    where not exists (select 1 from kart_room_players q where q.code = p_code and q.name = t.n);
  update kart_rooms set status = 'racing', track = p_track, started_at = now() + interval '8 seconds', first_finish = null, race_no = race_no + 1, last_results = null
    where code = p_code returning * into rm;
  return json_build_object('r', 'ok', 'race_no', rm.race_no, 'starts_in', 8, 'bots', nb);
end $$;

create or replace function kart_room_score(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; res json; n int; humans int; counted boolean; tk text;
begin
  select * into rm from kart_rooms where code = p_code for update;
  if rm.status is distinct from 'racing' then return; end if;
  if exists (select 1 from kart_room_players where code = p_code and not spectating and seen > now() - interval '15 seconds' and finish_ms is null)
     and not (rm.first_finish is not null and now() > rm.first_finish + interval '10 seconds')
     and not (now() > rm.started_at + interval '5 minutes') then return; end if;   -- a race always ends after 5 minutes (someone quit, nobody finished…)
  select count(*), count(*) filter (where not is_bot) into n, humans from kart_room_players where code = p_code and not spectating and (finish_ms is not null or seen > now() - interval '15 seconds');
  counted := n >= 4 and humans >= 2;
  tk := split_part(rm.track, '@', 1) || case when rm.track like '%@%' then '_' || split_part(rm.track, '@', 2) else '' end;
  with ranked as (
    select name, finish_ms, prog, is_bot, row_number() over (order by finish_ms nulls last, prog desc, joined_at) as place
    from kart_room_players where code = p_code and not spectating and (finish_ms is not null or seen > now() - interval '15 seconds')
  ), scored as (
    select r.*, case when counted and not r.is_bot and exists (select 1 from draw_guild dg where dg.name = r.name)
      then (array[10, 8, 6, 4, 3, 2, 1, 0])[least(r.place, 8)] else 0 end as pts from ranked r
  ), ins as (
    insert into kart_points as k (player, points, races, wins)
      select name, pts, 1, (place = 1)::int from scored where counted and not is_bot and exists (select 1 from draw_guild dg where dg.name = scored.name)
    on conflict (player) do update set points = k.points + excluded.points, races = k.races + 1, wins = k.wins + excluded.wins, updated_at = now()
    returning 1
  ), times as (
    insert into kart_race_times as t (track, player, best_ms)
      select tk, name, finish_ms from scored where counted and not is_bot and finish_ms is not null and exists (select 1 from draw_guild dg where dg.name = scored.name)
    on conflict (track, player) do update set best_ms = least(t.best_ms, excluded.best_ms), races = t.races + 1, updated_at = now()
    returning 1
  )
  select json_agg(json_build_object('name', name, 'ms', finish_ms, 'prog', round(prog::numeric, 3), 'place', place, 'pts', pts, 'counted', counted, 'n', n, 'humans', humans, 'bot', is_bot) order by place) into res from scored;
  update kart_rooms set status = 'lobby', last_results = res where code = p_code;
  delete from kart_room_players where code = p_code and is_bot;   -- bots only exist for one race
  update kart_room_players set spectating = false where code = p_code;   -- watchers are in for the next race
end $$;

revoke all on function kart_room_view(text), kart_room_score(text) from public, anon, authenticated;
revoke all on function kart_room_join(text, text, uuid, boolean), kart_room_start(text, uuid, text, int) from public, anon, authenticated;
grant execute on function kart_room_join(text, text, uuid, boolean), kart_room_start(text, uuid, text, int) to anon;
select 'family kart v38 ready' as done;
