-- Family Kart v36: computer racers fill empty seats in rooms. The host picks "up to 4" or "up to 8" racers; the missing seats get
-- MapleStory monster bots for that race only. The host's game drives them and reports their progress / finish here.
-- Bots count toward the 4-racer minimum, but a race only counts (points + race times) with at least 2 REAL players,
-- and bots never get points or times themselves.
alter table kart_room_players add column if not exists is_bot boolean not null default false;

create or replace function kart_room_view(p_code text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', p.name, 'joined', p.joined_at, 'finish', p.finish_ms, 'ready', p.ready, 'bot', p.is_bot) order by p.is_bot, p.joined_at), '[]'::json)
  from kart_room_players p where p.code = p_code and p.seen > now() - interval '15 seconds';
$$;

drop function if exists kart_room_start(text, uuid, text);
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
  update kart_room_players set finish_ms = null, prog = 0, ready = false where code = p_code;
  nb := greatest(0, least(8, case when p_bots >= 8 then 8 when p_bots >= 4 then 4 else 0 end) - humans);
  insert into kart_room_players (code, name, is_bot, ready, seen, joined_at)
    select p_code, n, true, true, now(), now() + (i || ' milliseconds')::interval
    from unnest(names[1:nb]) with ordinality as t(n, i)
    where not exists (select 1 from kart_room_players q where q.code = p_code and q.name = t.n);
  update kart_rooms set status = 'racing', track = p_track, started_at = now() + interval '8 seconds', first_finish = null, race_no = race_no + 1, last_results = null
    where code = p_code returning * into rm;
  return json_build_object('r', 'ok', 'race_no', rm.race_no, 'starts_in', 8, 'bots', nb);
end $$;

-- the host reports its bots: {"Ribbon Pig": {"p": 0.42}, "Stump": {"p": 1, "f": 81234}}
create or replace function kart_room_bots(p_code text, p_tok uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players; k text; v jsonb;
begin
  perform rl_check('kart_room_bots', 90, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code;
  if me.name is null or rm.host <> me.name or rm.status <> 'racing' or p_data is null then return; end if;
  for k, v in select * from jsonb_each(p_data) loop
    update kart_room_players set seen = now(),
      prog = greatest(0, least(1, coalesce((v ->> 'p')::real, prog))),
      finish_ms = coalesce(finish_ms, case when (v ->> 'f') is not null then greatest(30000, (v ->> 'f')::int) end)
      where code = p_code and name = k and is_bot;
  end loop;
  -- (a bot crossing the line does NOT start the 10-second clock: only real players do)
  perform kart_room_score(p_code);
end $$;

create or replace function kart_room_score(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; res json; n int; humans int; counted boolean; tk text;
begin
  select * into rm from kart_rooms where code = p_code for update;
  if rm.status is distinct from 'racing' then return; end if;
  if exists (select 1 from kart_room_players where code = p_code and seen > now() - interval '15 seconds' and finish_ms is null)
     and not (rm.first_finish is not null and now() > rm.first_finish + interval '10 seconds') then return; end if;
  select count(*), count(*) filter (where not is_bot) into n, humans from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds');
  counted := n >= 4 and humans >= 2;
  tk := split_part(rm.track, '@', 1) || case when rm.track like '%@%' then '_' || split_part(rm.track, '@', 2) else '' end;
  with ranked as (
    select name, finish_ms, prog, is_bot, row_number() over (order by finish_ms nulls last, prog desc, joined_at) as place
    from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds')
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
end $$;

-- a new host is never a bot
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
    select name into nh from kart_room_players where code = p_code and not is_bot and seen > now() - interval '15 seconds' order by joined_at limit 1;
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

revoke all on function kart_room_view(text), kart_room_score(text) from public, anon, authenticated;
revoke all on function kart_room_start(text, uuid, text, int), kart_room_bots(text, uuid, jsonb), kart_room_state(text, uuid, real) from public, anon, authenticated;
grant execute on function kart_room_start(text, uuid, text, int), kart_room_bots(text, uuid, jsonb), kart_room_state(text, uuid, real) to anon;
select 'family kart v36 ready' as done;
