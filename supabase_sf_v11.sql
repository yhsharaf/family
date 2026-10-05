-- Star Force v11: "Most Money Wasted": each player's biggest SINGLE shared set (one game of 8 items), by scrolls used
-- (the page prices scrolls at 12 for $4.36). Before, it added up every set a player ever shared.
create or replace function sf_board(p_start int default 0) returns json
language sql security definer set search_path = public as $$
  with sh as (select s.* from sf_sets s join draw_guild dg on dg.name = s.player where s.shared and s.start = case when p_start = 20 then 20 else 0 end),
  best as (select distinct on (lower(player)) player, score, spent, avg,
      (select max(r.best) from sf_runs r where r.set_id = sh.id) as best, (select count(*) from sf_runs r where r.set_id = sh.id and r.best > r.base) as items
    from sh order by lower(player), score desc),
  fast as (select distinct on (lower(r.player)) r.player, r.item, (r.reached -> '30' ->> 0)::bigint as tries, r.scrolls as scr, r.mesos, r.red,
      r.booms as bm, r.restores, r.updated_at as at
    from sf_runs r join sf_sets s on s.id = r.set_id join draw_guild dg on dg.name = r.player
    where r.best >= 30 and s.start = case when p_start = 20 then 20 else 0 end
    order by lower(r.player), (r.reached -> '30' ->> 0)::bigint),
  lucky as (select distinct on (lower(player)) player, spent, avg, avg / greatest(spent, 1) as luck,
      (select max(r.best) from sf_runs r where r.set_id = sh.id) as best from sh where avg > 0 order by lower(player), avg / greatest(spent, 1) desc),
  burned as (select distinct on (lower(x.player)) x.* from (select sh.player, sh.id, sum(r.scrolls) as scrolls, sum(r.booms) as booms, sum(r.mesos) as mesos, sum(r.red) as red, max(r.best) as best
      from sh join sf_runs r on r.set_id = sh.id group by sh.player, sh.id) x order by lower(x.player), x.scrolls desc)
  select json_build_object(
    'score', coalesce((select json_agg(b order by b.score desc) from (select * from best order by score desc limit 15) b), '[]'::json),
    'fast30', coalesce((select json_agg(f order by f.tries) from (select * from fast order by tries limit 10) f), '[]'::json),
    'lucky', coalesce((select json_agg(l order by l.luck desc) from (select * from lucky where best >= 20 order by luck desc limit 10) l), '[]'::json),
    'burned', coalesce((select json_agg(u order by u.scrolls desc) from (select * from burned where scrolls > 0 order by scrolls desc limit 10) u), '[]'::json));
$$;

grant execute on function sf_board(int) to anon;
select 'star force v11 ready' as done;
