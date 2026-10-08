-- Family Kart v62: the new Mount Wario (board "mtwario", one run) is quicker than the old one (about 79 s at 200cc), so its fastest
-- allowed time drops from 70 s to 60 s. Nothing else changes. Run it once in the Supabase SQL editor.
create or replace function kart_submit(p_track text, p_name text, p_laps int[], p_ghost text default null) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; total int; bestlap int; minlap int := 18000; nlaps int := 3; r kart_times; g text;
begin
  perform rl_check('kart', 12, 60);
  if p_track !~ '^(henesys2|henesys3|town|meadows2|gorge|pets2|snowland|sherbet|mtwario|mtelnath|elsummit|treetop|golemtemple|goldcave|phantomlake|golemfurnace|deadmine|zakumaltar|toyfactory|starroad|discovery|cad64|woods|jungle|boolake|goldmine|volcano|thwomp|rrsnes|rrwii|ticktock|forest|elnath[123]|sleepy[123]|zakum[123]|ludi[123])(_50|_100|_200)?$' then return json_build_object('r', 'track'); end if;
  if p_track like 'zakum%' then nlaps := 1; minlap := 36000; end if;
  if p_track like 'mtwario%' then nlaps := 1; minlap := 60000; end if;
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
select 'family kart v62 ready' as done;
