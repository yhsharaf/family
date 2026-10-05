-- Family Kart v7: the El Nath, Sleepywood, Zakum and Ludibrium cups (applied together with v31).
-- 1. Time Trial: accept the 12 new track ids. The Zakum runs have no laps (one long climb), so they send a single time instead of 3 laps.
drop function if exists kart_submit(text, text, int[], text);
create or replace function kart_submit(p_track text, p_name text, p_laps int[], p_ghost text default null) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; total int; bestlap int; minlap int := 18000; nlaps int := 3; r kart_times; g text;
begin
  perform rl_check('kart', 12, 60);
  if p_track not in ('henesys2', 'town', 'forest', 'elnath1', 'elnath2', 'elnath3', 'sleepy1', 'sleepy2', 'sleepy3',
                     'zakum1', 'zakum2', 'zakum3', 'ludi1', 'ludi2', 'ludi3') then return json_build_object('r', 'track'); end if;
  if p_track like 'zakum%' then nlaps := 1; minlap := 36000; end if;   -- one run up the mountain, at least ~36 s
  select dg.name into nm from draw_guild dg where lower(dg.name) = lower(trim(coalesce(p_name, ''))) limit 1;
  if nm is null then return json_build_object('r', 'guest'); end if;
  if p_laps is null or array_length(p_laps, 1) <> nlaps then return json_build_object('r', 'laps'); end if;
  if (select min(x) from unnest(p_laps) x) < minlap or (select max(x) from unnest(p_laps) x) > 600000 then return json_build_object('r', 'laps'); end if;
  total := (select sum(x) from unnest(p_laps) x); bestlap := (select min(x) from unnest(p_laps) x);
  g := case when p_ghost is not null and length(p_ghost) between 10 and 150000 and left(p_ghost, 2) = '[[' then p_ghost end;
  insert into kart_times as k (track, player, race_ms, lap_ms, ghost) values (p_track, nm, total, bestlap, g)
  on conflict (track, player) do update set
    ghost = case when excluded.race_ms < k.race_ms then excluded.ghost else k.ghost end,
    race_ms = least(k.race_ms, excluded.race_ms), lap_ms = least(k.lap_ms, excluded.lap_ms), races = k.races + 1, updated_at = now()
  returning * into r;
  return json_build_object('r', 'ok', 'race', r.race_ms, 'lap', r.lap_ms,
    'rank', (select count(*) + 1 from kart_times where track = p_track and race_ms < r.race_ms));
end $$;
revoke all on function kart_submit(text, text, int[], text) from public, anon, authenticated;
grant execute on function kart_submit(text, text, int[], text) to anon;

-- 2. Multiplayer rooms: the host can pick any of the 15 tracks
create or replace function kart_room_start(p_code text, p_tok uuid, p_track text) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players;
begin
  perform rl_check('kart_room_start', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code for update;
  if me.name is null or rm.host <> me.name then return json_build_object('r', 'host'); end if;
  if rm.status = 'racing' then return json_build_object('r', 'running'); end if;
  if p_track not in ('henesys', 'town', 'forest', 'en1', 'en2', 'en3', 'sw1', 'sw2', 'sw3', 'zk1', 'zk2', 'zk3', 'ld1', 'ld2', 'ld3') then return json_build_object('r', 'track'); end if;
  if (select count(*) from kart_room_players where code = p_code and seen > now() - interval '15 seconds') < 2 then return json_build_object('r', 'few'); end if;
  delete from kart_room_players where code = p_code and seen < now() - interval '15 seconds';
  update kart_room_players set finish_ms = null, prog = 0 where code = p_code;
  update kart_rooms set status = 'racing', track = p_track, started_at = now() + interval '5 seconds', first_finish = null, race_no = race_no + 1, last_results = null
    where code = p_code returning * into rm;
  return json_build_object('r', 'ok', 'race_no', rm.race_no, 'starts_in', 5);
end $$;

-- 3. A room finish can't be faster than 54 s (3 laps x 18 s); a Zakum run can't be faster than 36 s
create or replace function kart_room_finish(p_code text, p_tok uuid, p_ms int) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players;
begin
  perform rl_check('kart_room_finish', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code;
  if me.name is null or rm.status <> 'racing' or me.finish_ms is not null then return json_build_object('r', 'no'); end if;
  if rm.first_finish is not null and now() > rm.first_finish + interval '11 seconds' then return json_build_object('r', 'late'); end if;
  if p_ms < (case when rm.track like 'zk%' then 36000 else 54000 end) or p_ms > extract(epoch from now() - rm.started_at) * 1000 + 4000 then return json_build_object('r', 'time'); end if;
  update kart_room_players set finish_ms = p_ms, prog = 1, seen = now() where code = p_code and name = me.name;
  update kart_rooms set first_finish = coalesce(first_finish, now()) where code = p_code;
  perform kart_room_score(p_code);
  return json_build_object('r', 'ok');
end $$;
revoke all on function kart_room_start(text, uuid, text), kart_room_finish(text, uuid, int) from public, anon, authenticated;
grant execute on function kart_room_start(text, uuid, text), kart_room_finish(text, uuid, int) to anon;
select 'family kart v7 ready' as done;
