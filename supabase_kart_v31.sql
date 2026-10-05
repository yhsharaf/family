-- Family Kart v8: public rooms. A public room shows up in the "Open rooms" list on the Family Kart page, so people can join
-- with one tap instead of sharing a link. Private rooms (link only) still work as before.
alter table kart_rooms add column if not exists is_public boolean not null default false;

drop function if exists kart_room_join(text, text, uuid);
create or replace function kart_room_join(p_code text, p_name text, p_tok uuid, p_public boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare cd text := upper(left(coalesce(p_code, ''), 8)); nm text := left(trim(coalesce(p_name, '')), 20); rm kart_rooms; pl kart_room_players;
begin
  perform rl_check('kart_room', 30, 60);
  delete from kart_rooms where created_at < now() - interval '6 hours';
  if cd !~ '^[A-Z0-9]{4,8}$' then return json_build_object('r', 'code'); end if;
  if p_tok is not null then
    select * into pl from kart_room_players where code = cd and token = p_tok;
    if pl.name is not null then update kart_room_players set seen = now() where code = cd and name = pl.name; return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select * into rm from kart_rooms where code = cd for update;
  if rm.code is null then
    if (select count(*) from kart_rooms where created_at > now() - interval '1 hour') >= 40 then return json_build_object('r', 'busy'); end if;
    insert into kart_rooms (code, host, is_public) values (cd, nm, coalesce(p_public, false)) returning * into rm;   -- the first one in is the host
  end if;
  if rm.status = 'racing' then return json_build_object('r', 'running'); end if;
  delete from kart_room_players where code = cd and seen < now() - interval '30 seconds';
  if exists (select 1 from kart_room_players where code = cd and lower(name) = lower(nm)) then return json_build_object('r', 'taken'); end if;
  if (select count(*) from kart_room_players where code = cd) >= 8 then return json_build_object('r', 'full'); end if;
  insert into kart_room_players (code, name) values (cd, nm) returning * into pl;
  if not exists (select 1 from kart_room_players where code = cd and name = rm.host and seen > now() - interval '15 seconds') then update kart_rooms set host = nm where code = cd; end if;
  return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name);
end $$;

-- the open public rooms: someone still in them, newest first
create or replace function kart_room_list() returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created desc), '[]'::json) from (
    select r.code, r.host, r.track, r.status, r.created_at as created,
      (select count(*) from kart_room_players p where p.code = r.code and p.seen > now() - interval '15 seconds') as n
    from kart_rooms r where r.is_public and r.created_at > now() - interval '6 hours'
  ) x where x.n > 0 limit 20;
$$;

-- the room state also says whether it's public
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
  return json_build_object('r', 'ok', 'me', me.name, 'host', rm.host, 'track', rm.track, 'status', rm.status, 'race_no', rm.race_no, 'public', rm.is_public,
    'starts_in', case when rm.started_at is null then null else extract(epoch from rm.started_at - now()) end,
    'ends_in', case when rm.status = 'racing' and rm.first_finish is not null then extract(epoch from rm.first_finish + interval '10 seconds' - now()) end,
    'players', kart_room_view(p_code), 'results', rm.last_results);
end $$;

revoke all on function kart_room_join(text, text, uuid, boolean), kart_room_list(), kart_room_state(text, uuid, real) from public, anon, authenticated;
grant execute on function kart_room_join(text, text, uuid, boolean), kart_room_list(), kart_room_state(text, uuid, real) to anon;
select 'family kart v8 ready' as done;
