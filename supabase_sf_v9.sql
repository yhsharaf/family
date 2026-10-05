-- Star Force v9: the "Fastest 30★" board is about ONE item. It counts as soon as the item hits 30★ (it can't go higher, so it stops there),
-- no need to share the set first. It also shows everything that item cost: scrolls, mesos and red diamonds (just for fun).
-- "Most scrolls" counts shared sets only.
create or replace function sf_board() returns json
language sql security definer set search_path = public as $$
  with sh as (select s.* from sf_sets s join draw_guild dg on dg.name = s.player where s.shared),
  best as (select distinct on (lower(player)) player, score, spent, avg,
      (select max(r.best) from sf_runs r where r.set_id = sh.id) as best, (select count(*) from sf_runs r where r.set_id = sh.id and r.best > 0) as items
    from sh order by lower(player), score desc),
  fast as (select distinct on (lower(r.player)) r.player, r.item, (r.reached -> '30' ->> 0)::bigint as tries, r.scrolls as scr, r.mesos, r.red,
      r.booms as bm, r.restores, r.updated_at as at
    from sf_runs r join draw_guild dg on dg.name = r.player where r.set_id is not null and r.best >= 30
    order by lower(r.player), (r.reached -> '30' ->> 0)::bigint),
  lucky as (select distinct on (lower(player)) player, spent, avg, avg / greatest(spent, 1) as luck,
      (select max(r.best) from sf_runs r where r.set_id = sh.id) as best from sh where avg > 0 order by lower(player), avg / greatest(spent, 1) desc),
  burned as (select r.player, sum(r.scrolls) as scrolls, sum(r.booms) as booms from sf_runs r join sh on sh.id = r.set_id group by r.player)
  select json_build_object(
    'score', coalesce((select json_agg(b order by b.score desc) from (select * from best order by score desc limit 15) b), '[]'::json),
    'fast30', coalesce((select json_agg(f order by f.tries) from (select * from fast order by tries limit 10) f), '[]'::json),
    'lucky', coalesce((select json_agg(l order by l.luck desc) from (select * from lucky where best >= 20 order by luck desc limit 10) l), '[]'::json),
    'burned', coalesce((select json_agg(u order by u.scrolls desc) from (select * from burned where scrolls > 0 order by scrolls desc limit 10) u), '[]'::json));
$$;
revoke all on function sf_board() from public, anon, authenticated;
grant execute on function sf_board() to anon;
select 'star force v9 ready' as done;
