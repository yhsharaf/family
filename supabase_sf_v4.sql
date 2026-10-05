-- Star Force v4: the real restore prices from the game (5,000 red diamonds + mesos + Star Force scrolls, by the star you restore to)
insert into sf_restore (star, red, mesos, scrolls) values
  (12, 5000, 1000000, 0), (13, 5000, 1720000, 38), (14, 5000, 2720000, 94), (15, 5000, 3910000, 161), (16, 5000, 4960000, 220),
  (17, 5000, 6800000, 320), (18, 5000, 9460000, 460), (19, 5000, 13210000, 651), (20, 5000, 18810000, 932)
on conflict (star) do update set red = excluded.red, mesos = excluded.mesos, scrolls = excluded.scrolls;
select 'star force v4 ready' as done;
