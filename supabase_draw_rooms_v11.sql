-- Draw & Guess: at most 5 rooms at once (the public room is always open + up to 4 private rooms).
-- Rooms are Realtime channels, so players check in here when joining and every 30s while inside; a room nobody has
-- checked in to for 90 seconds is gone. One connection can open at most 2 new private rooms per 10 minutes.
create table if not exists draw_rooms (room text primary key check (char_length(room) <= 20), seen_at timestamptz not null default now());
alter table draw_rooms enable row level security;
revoke all on draw_rooms from anon, authenticated;

create or replace function draw_room(p_room text) returns json
language plpgsql security definer set search_path = public as $$
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20);
begin
  perform rl_check('draw_room', 30, 60);
  delete from draw_rooms where seen_at < now() - interval '90 seconds';
  update draw_rooms set seen_at = now() where room = rm;
  if found then return json_build_object('r', 'ok'); end if;
  if rm <> 'public' then
    if (select count(*) from draw_rooms where room <> 'public') >= 4 then return json_build_object('r', 'busy'); end if;
    begin perform rl_check('draw_new', 2, 600); exception when sqlstate 'P0429' then return json_build_object('r', 'slow'); end;
  end if;
  insert into draw_rooms (room) values (rm) on conflict (room) do update set seen_at = now();
  return json_build_object('r', 'ok');
end $$;
revoke all on function draw_room(text) from public, anon, authenticated;
grant execute on function draw_room(text) to anon;
select 'ok' as done;
