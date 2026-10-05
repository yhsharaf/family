-- Family Kart v34: the Time Trial table still only allowed the Henesys tracks (a rule from v26), so times on every other map
-- (and the 50cc / 100cc boards) were refused when saving. Allow every track and speed class, same as kart_submit checks.
alter table kart_times drop constraint if exists kart_times_track_check;
alter table kart_times add constraint kart_times_track_check
  check (track ~ '^(henesys|henesys2|town|forest|elnath[123]|sleepy[123]|zakum[123]|ludi[123])(_50|_100)?$');
select 'family kart v34 ready' as done;
