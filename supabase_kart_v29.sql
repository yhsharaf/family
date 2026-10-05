-- Family Kart v6: when the first player finishes a room race, everyone else has 10 seconds. After that the race ends and anyone
-- still racing is ranked by how far along the track they got (and gets the points for that place).
alter table kart_room_players add column if not exists prog real not null default 0;   -- 0..1 of the whole race, sent while racing

create or replace function kart_room_score(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; res json; n int;
begin
  select * into rm from kart_rooms where code = p_code for update;
  if rm.status is distinct from 'racing' then return; end if;
  if exists (select 1 from kart_room_players where code = p_code and seen > now() - interval '15 seconds' and finish_ms is null)
     and not (rm.first_finish is not null and now() > rm.first_finish + interval '10 seconds') then return; end if;
  select count(*) into n from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds');
  with ranked as (
    select name, finish_ms, prog, row_number() over (order by finish_ms nulls last, prog desc, joined_at) as place
    from kart_room_players where code = p_code and (finish_ms is not null or seen > now() - interval '15 seconds')
  ), scored as (
    select r.*, case when n >= 2 and exists (select 1 from draw_guild dg where dg.name = r.name)
      then (array[10, 8, 6, 4, 3, 2, 1, 0])[least(r.place, 8)] else 0 end as pts from ranked r
  ), ins as (
    insert into kart_points as k (player, points, races, wins)
      select name, pts, 1, (place = 1)::int from scored where exists (select 1 from draw_guild dg where dg.name = scored.name) and n >= 2
    on conflict (player) do update set points = k.points + excluded.points, races = k.races + 1, wins = k.wins + excluded.wins, updated_at = now()
    returning 1
  )
  select json_agg(json_build_object('name', name, 'ms', finish_ms, 'prog', round(prog::numeric, 3), 'place', place, 'pts', pts) order by place) into res from scored;
  update kart_rooms set status = 'lobby', last_results = res where code = p_code;
end $$;

drop function if exists kart_room_state(text, uuid);
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
    select name into nh from kart_room_players where code = p_code and seen > now() - interval '15 seconds' order by joined_at limit 1;
    if nh is not null then update kart_rooms set host = nh where code = p_code returning * into rm; end if;
  end if;
  if rm.status = 'racing' then perform kart_room_score(p_code); select * into rm from kart_rooms where code = p_code; end if;
  return json_build_object('r', 'ok', 'me', me.name, 'host', rm.host, 'track', rm.track, 'status', rm.status, 'race_no', rm.race_no,
    'starts_in', case when rm.started_at is null then null else extract(epoch from rm.started_at - now()) end,
    'ends_in', case when rm.status = 'racing' and rm.first_finish is not null then extract(epoch from rm.first_finish + interval '10 seconds' - now()) end,
    'players', kart_room_view(p_code), 'results', rm.last_results);
end $$;

create or replace function kart_room_finish(p_code text, p_tok uuid, p_ms int) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players;
begin
  perform rl_check('kart_room_finish', 10, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  select * into rm from kart_rooms where code = p_code;
  if me.name is null or rm.status <> 'racing' or me.finish_ms is not null then return json_build_object('r', 'no'); end if;
  if rm.first_finish is not null and now() > rm.first_finish + interval '11 seconds' then return json_build_object('r', 'late'); end if;
  if p_ms < 54000 or p_ms > extract(epoch from now() - rm.started_at) * 1000 + 4000 then return json_build_object('r', 'time'); end if;
  update kart_room_players set finish_ms = p_ms, prog = 1, seen = now() where code = p_code and name = me.name;
  update kart_rooms set first_finish = coalesce(first_finish, now()) where code = p_code;
  perform kart_room_score(p_code);
  return json_build_object('r', 'ok');
end $$;

revoke all on function kart_room_score(text) from public, anon, authenticated;
revoke all on function kart_room_state(text, uuid, real), kart_room_finish(text, uuid, int) from public, anon, authenticated;
grant execute on function kart_room_state(text, uuid, real), kart_room_finish(text, uuid, int) to anon;
select 'family kart v6 ready' as done;
