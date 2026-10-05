-- Family Kart v4: Time Trial ghosts on the guild board. Each player's best run on a track keeps its ghost (positions 10 times a
-- second), so everyone can race the #1 guild member's ghost. The board itself never reads the ghost column (it's only fetched
-- for the top time).
alter table kart_times add column if not exists ghost text;

drop function if exists kart_submit(text, text, int[]);
create or replace function kart_submit(p_track text, p_name text, p_laps int[], p_ghost text default null) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; total int; bestlap int; minlap int := 18000; r kart_times; g text;
begin
  perform rl_check('kart', 12, 60);
  if p_track not in ('henesys2', 'town', 'forest') then return json_build_object('r', 'track'); end if;
  select dg.name into nm from draw_guild dg where lower(dg.name) = lower(trim(coalesce(p_name, ''))) limit 1;
  if nm is null then return json_build_object('r', 'guest'); end if;
  if p_laps is null or array_length(p_laps, 1) <> 3 then return json_build_object('r', 'laps'); end if;
  if (select min(x) from unnest(p_laps) x) < minlap or (select max(x) from unnest(p_laps) x) > 600000 then return json_build_object('r', 'laps'); end if;
  total := (select sum(x) from unnest(p_laps) x); bestlap := (select min(x) from unnest(p_laps) x);
  g := case when p_ghost is not null and length(p_ghost) between 10 and 150000 and left(p_ghost, 2) = '[[' then p_ghost end;
  insert into kart_times as k (track, player, race_ms, lap_ms, ghost) values (p_track, nm, total, bestlap, g)
  on conflict (track, player) do update set
    ghost = case when excluded.race_ms < k.race_ms then excluded.ghost else k.ghost end,   -- only the best run's ghost
    race_ms = least(k.race_ms, excluded.race_ms), lap_ms = least(k.lap_ms, excluded.lap_ms), races = k.races + 1, updated_at = now()
  returning * into r;
  return json_build_object('r', 'ok', 'race', r.race_ms, 'lap', r.lap_ms,
    'rank', (select count(*) + 1 from kart_times where track = p_track and race_ms < r.race_ms));
end $$;
revoke all on function kart_submit(text, text, int[], text) from public, anon, authenticated;
grant execute on function kart_submit(text, text, int[], text) to anon;
select 'family kart v4 ready' as done;
