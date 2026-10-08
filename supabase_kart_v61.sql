-- Family Kart v61: CAD64 (the Star Road, renamed) is the only track for now. Its Time Trial board is "cad64" (one long lap, 45 s floor),
-- there's a new 200cc class (boards end in _200), and multiplayer rooms can race CAD64 (room track "star", with @150 / @200).
-- Every other board is unchanged. Run it once in the Supabase SQL editor.
alter table kart_times drop constraint if exists kart_times_track_check;
alter table kart_times add constraint kart_times_track_check
  check (track ~ '^(henesys|henesys2|henesys3|town|park|meadows|pets|meadows2|gorge|pets2|snowland|sherbet|mtwario|mtelnath|elsummit|treetop|golemtemple|goldcave|phantomlake|golemfurnace|deadmine|zakumaltar|toyfactory|starroad|discovery|cad64|woods|jungle|boolake|goldmine|volcano|thwomp|rrsnes|rrwii|ticktock|forest|elnath[123]|sleepy[123]|zakum[123]|ludi[123])(_50|_100|_200)?$');
create or replace function kart_submit(p_track text, p_name text, p_laps int[], p_ghost text default null) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; total int; bestlap int; minlap int := 18000; nlaps int := 3; r kart_times; g text;
begin
  perform rl_check('kart', 12, 60);
  if p_track !~ '^(henesys2|henesys3|town|meadows2|gorge|pets2|snowland|sherbet|mtwario|mtelnath|elsummit|treetop|golemtemple|goldcave|phantomlake|golemfurnace|deadmine|zakumaltar|toyfactory|starroad|discovery|cad64|woods|jungle|boolake|goldmine|volcano|thwomp|rrsnes|rrwii|ticktock|forest|elnath[123]|sleepy[123]|zakum[123]|ludi[123])(_50|_100|_200)?$' then return json_build_object('r', 'track'); end if;
  if p_track like 'zakum%' then nlaps := 1; minlap := 36000; end if;
  if p_track like 'mtwario%' then nlaps := 1; minlap := 70000; end if;
  if p_track like 'starroad%' then nlaps := 1; minlap := 45000; end if;
  if p_track like 'cad64%' then nlaps := 1; minlap := 45000; end if;
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

alter table kart_race_times drop constraint if exists kart_race_times_track_check;
alter table kart_race_times add constraint kart_race_times_track_check
  check (track ~ '^(henesys|town|forest|en[123]|sw[123]|zk[123]|ld[123]|star)(_50|_100|_150|_200)?$');
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
  if p_track !~ '^(henesys|town|forest|en[123]|sw[123]|zk[123]|ld[123]|star)(@50|@100|@150|@200)?$' then return json_build_object('r', 'track'); end if;
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
select 'family kart v61 ready' as done;
