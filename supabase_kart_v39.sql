-- Family Kart v39: the room view also gives each racer's progress (0..1), so a game that stops getting live position messages
-- can still place everyone correctly (and knows who finished).
create or replace function kart_room_view(p_code text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', p.name, 'joined', p.joined_at, 'finish', p.finish_ms, 'ready', p.ready, 'bot', p.is_bot, 'spec', p.spectating, 'prog', round(p.prog::numeric, 4)) order by p.is_bot, p.joined_at), '[]'::json)
  from kart_room_players p where p.code = p_code and p.seen > now() - interval '15 seconds';
$$;
revoke all on function kart_room_view(text) from public, anon, authenticated;
select 'family kart v39 ready' as done;
