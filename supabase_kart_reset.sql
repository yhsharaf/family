-- Family Kart: start everything again from zero. This PERMANENTLY deletes every Family Kart record: all Time Trial times and
-- ghosts, all room race times, everyone's points and wins, and the mesos counted from all races. It can't be undone.
-- It also closes any open rooms (with their chat). Run it yourself in the Supabase SQL editor only if you're sure.
begin;
delete from kart_times;
delete from kart_race_times;
delete from kart_points;
delete from kart_mesos;
delete from kart_room_chat;
delete from kart_room_players;
delete from kart_rooms;
commit;
select 'family kart scores reset to zero' as done;
