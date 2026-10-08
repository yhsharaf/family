-- Family Kart: start everything again from zero. This PERMANENTLY deletes every Family Kart record: all Time Trial times and
-- ghosts, all room race times, everyone's points and wins, and the mesos counted from all races. It can't be undone.
-- Run it yourself in the Supabase SQL editor only if you're sure. (Rooms and their chat are left alone: they clear themselves.)
begin;
delete from kart_times;
delete from kart_race_times;
delete from kart_points;
delete from kart_mesos;
commit;
select 'family kart scores reset to zero' as done;
