-- Family Kart v37: a room race always ends after 5 minutes, so a room can't get stuck "racing" when nobody finishes.
create or replace function kart_room_score(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; res json; n int; humans int; counted boolean; tk text;
begin
  select * into rm from kart_rooms where code = p_code for update;
  if rm.status is distinct from 'racing' then return; end if;
  if exists (select 1 from kart_room_players where code = p_code and seen > now() - interval '15 seconds' and finish_ms is null)
     and not (rm.first_finish is not null and now() > rm.first_finish + interval '10 seconds')
     and not (now() > rm.started_at + interval '5 minutes') then return; end if;   -- a race always ends after 5 minutes (someone quit, nobody finished…)
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

revoke all on function kart_room_score(text) from public, anon, authenticated;
select 'family kart v37 ready' as done;
