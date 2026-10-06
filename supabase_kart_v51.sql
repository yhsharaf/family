-- Family Kart v51: the room-check limit is sized for up to 5 phones on one home Wi-Fi (each checks the room ~40-50 times a minute):
-- 250 a minute per internet address (v50 had 600, the old limit was 120, enough for only 2-3 phones).
create or replace function kart_room_state(p_code text, p_tok uuid, p_prog real default null) returns json
language plpgsql security definer set search_path = public as $$
declare rm kart_rooms; me kart_room_players; nh text;
begin
  perform rl_check('kart_room_state', 250, 60);
  select * into me from kart_room_players where code = p_code and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  update kart_room_players set seen = now(),
    prog = case when p_prog is not null and finish_ms is null then greatest(0, least(1, p_prog)) else prog end
    where code = p_code and name = me.name;
  select * into rm from kart_rooms where code = p_code;
  if not exists (select 1 from kart_room_players where code = p_code and name = rm.host and seen > now() - interval '15 seconds') then
    select name into nh from kart_room_players where code = p_code and not is_bot and seen > now() - interval '15 seconds' order by joined_at limit 1;
    if nh is not null then update kart_rooms set host = nh where code = p_code returning * into rm; end if;
  end if;
  if rm.status = 'racing' then perform kart_room_score(p_code); select * into rm from kart_rooms where code = p_code; end if;
  return json_build_object('r', 'ok', 'me', me.name, 'host', rm.host, 'track', rm.track, 'status', rm.status, 'race_no', rm.race_no, 'public', rm.is_public, 'key', rm.secret,
    'starts_in', case when rm.started_at is null then null else extract(epoch from rm.started_at - now()) end,
    'ends_in', case when rm.status = 'racing' and rm.first_finish is not null then extract(epoch from rm.first_finish + interval '10 seconds' - now()) end,
    'players', kart_room_view(p_code), 'results', rm.last_results,
    'chat', coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'msg', c.msg) order by c.id)
      from (select * from kart_room_chat where code = p_code order by id desc limit 40) c), '[]'::json));
end $$;
revoke all on function kart_room_state(text, uuid, real) from public, anon, authenticated;
grant execute on function kart_room_state(text, uuid, real) to anon;
select 'family kart v51 ready' as done;
