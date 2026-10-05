-- Family Kart v35: guild (room) races only count with 4 or more racers. Then guild members get their points as before AND their
-- finishing time is saved on a "Race times" board per track and speed class (best time per player). Smaller races still get
-- results on screen, but no points and no times.
create table if not exists kart_race_times (
  track text not null check (track ~ '^(henesys|town|forest|en[123]|sw[123]|zk[123]|ld[123])(_50|_100)?$'),
  player text not null, best_ms int not null, races int not null default 1, updated_at timestamptz not null default now(),
  primary key (track, player)
);
alter table kart_race_times enable row level security;
revoke all on kart_race_times from anon, authenticated;
drop policy if exists "read kart race times" on kart_race_times;
create policy "read kart race times" on kart_race_times for select using (true);
grant select on kart_race_times to anon;

create or replace function kart_room_score(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; res json; n int; counted boolean; tk text;
begin
  select * into rm from kart_rooms where code = p_code for update;
  if rm.status is distinct from 'racing' then return; end if;
  if exists (select 1 from kart_room_players where code = p_code and seen > now() - interval '15 seconds' and finish_ms is null)
     and not (rm.first_finish is not null and now() > rm.first_finish + interval '10 seconds') then return; end if;
  select count(*) into n from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds');
  counted := n >= 4;
  tk := split_part(rm.track, '@', 1) || case when rm.track like '%@%' then '_' || split_part(rm.track, '@', 2) else '' end;   -- henesys@100 -> henesys_100
  with ranked as (
    select name, finish_ms, prog, row_number() over (order by finish_ms nulls last, prog desc, joined_at) as place
    from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds')
  ), scored as (
    select r.*, case when counted and exists (select 1 from draw_guild dg where dg.name = r.name)
      then (array[10, 8, 6, 4, 3, 2, 1, 0])[least(r.place, 8)] else 0 end as pts from ranked r
  ), ins as (
    insert into kart_points as k (player, points, races, wins)
      select name, pts, 1, (place = 1)::int from scored where counted and exists (select 1 from draw_guild dg where dg.name = scored.name)
    on conflict (player) do update set points = k.points + excluded.points, races = k.races + 1, wins = k.wins + excluded.wins, updated_at = now()
    returning 1
  ), times as (
    insert into kart_race_times as t (track, player, best_ms)
      select tk, name, finish_ms from scored where counted and finish_ms is not null and exists (select 1 from draw_guild dg where dg.name = scored.name)
    on conflict (track, player) do update set best_ms = least(t.best_ms, excluded.best_ms), races = t.races + 1, updated_at = now()
    returning 1
  )
  select json_agg(json_build_object('name', name, 'ms', finish_ms, 'prog', round(prog::numeric, 3), 'place', place, 'pts', pts, 'counted', counted, 'n', n) order by place) into res from scored;
  update kart_rooms set status = 'lobby', last_results = res where code = p_code;
end $$;
revoke all on function kart_room_score(text) from public, anon, authenticated;
select 'family kart v35 ready' as done;
