-- Family Kart v1: best time-trial times per track for guild members (guests can race but aren't on the board).
-- The page sends the 3 lap times; kart_submit keeps each player's best race and best lap, and turns away laps
-- that are faster than the kart can physically drive (the Henesys Loop is ~4100 units, top speed with a boost ~340/s).
create table if not exists kart_times (
  track text not null check (track in ('henesys')),
  player text not null check (char_length(player) <= 40),
  race_ms int not null, lap_ms int not null, races int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (track, player)
);
alter table kart_times enable row level security;
revoke all on kart_times from anon, authenticated;
drop policy if exists "read kart times" on kart_times;
create policy "read kart times" on kart_times for select using (true);
grant select on kart_times to anon;

create or replace function kart_submit(p_track text, p_name text, p_laps int[]) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; total int; bestlap int; minlap int := 13000; r kart_times;
begin
  perform rl_check('kart', 12, 60);
  if p_track is distinct from 'henesys' then return json_build_object('r', 'track'); end if;
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
select 'family kart v1 ready' as done;
