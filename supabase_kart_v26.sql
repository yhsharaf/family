-- Family Kart v3: the Henesys Cup has 3 tracks, each with its own Time Trial board.
alter table kart_times drop constraint if exists kart_times_track_check;
alter table kart_times add constraint kart_times_track_check check (track in ('henesys', 'henesys2', 'town', 'forest'));

create or replace function kart_submit(p_track text, p_name text, p_laps int[]) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; total int; bestlap int; minlap int := 18000; r kart_times;
begin
  perform rl_check('kart', 12, 60);
  if p_track not in ('henesys2', 'town', 'forest') then return json_build_object('r', 'track'); end if;
  select dg.name into nm from draw_guild dg where lower(dg.name) = lower(trim(coalesce(p_name, ''))) limit 1;
  if nm is null then return json_build_object('r', 'guest'); end if;
  if p_laps is null or array_length(p_laps, 1) <> 3 then return json_build_object('r', 'laps'); end if;
  if (select min(x) from unnest(p_laps) x) < minlap or (select max(x) from unnest(p_laps) x) > 600000 then return json_build_object('r', 'laps'); end if;
  total := (select sum(x) from unnest(p_laps) x); bestlap := (select min(x) from unnest(p_laps) x);
  insert into kart_times as k (track, player, race_ms, lap_ms) values (p_track, nm, total, bestlap)
  on conflict (track, player) do update set race_ms = least(k.race_ms, excluded.race_ms), lap_ms = least(k.lap_ms, excluded.lap_ms),
    races = k.races + 1, updated_at = now()
  returning * into r;
  return json_build_object('r', 'ok', 'race', r.race_ms, 'lap', r.lap_ms,
    'rank', (select count(*) + 1 from kart_times where track = p_track and race_ms < r.race_ms));
end $$;
revoke all on function kart_submit(text, text, int[]) from public, anon, authenticated;
grant execute on function kart_submit(text, text, int[]) to anon;
select 'family kart v3 ready' as done;
