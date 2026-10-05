-- Star Force v10: two game modes. "From 0★" (as before) and "From 20★" (every item starts at 20★).
-- Each mode has its own open set per player and its own leaderboards. In 20★ mode an item's score only counts what was done after 20★:
-- the average cost from the start star to the best star (sf_value(best) - sf_value(start)) compared with what was spent.
alter table sf_sets add column if not exists start int not null default 0;
alter table sf_sets drop constraint if exists sf_sets_start_ok;
alter table sf_sets add constraint sf_sets_start_ok check (start in (0, 20));
alter table sf_runs add column if not exists base int not null default 0;

create or replace function sf_item_avg(r sf_runs) returns numeric language sql stable set search_path = public as $$
  select case when r.best <= r.base then 0 else
    (select v.avg from sf_value v where v.star = r.best) - coalesce((select v.avg from sf_value v where v.star = r.base), 0) end;
$$;
create or replace function sf_item_score(r sf_runs) returns numeric language sql stable set search_path = public as $$
  select case when sf_item_avg(r) <= 0 then 0 else
    sf_item_avg(r) * sqrt(least(9, greatest(.1, sf_item_avg(r) / greatest(1, sf_item_spent(r))))) end;
$$;

drop function if exists sf_open(text);
create or replace function sf_open(p_name text, p_start int default 0) returns json
language plpgsql security definer set search_path = public as $$
declare nm text := left(trim(coalesce(p_name, '')), 20); g text; st sf_sets; s0 int := case when p_start = 20 then 20 else 0 end;
begin
  perform rl_check('sf_start', 20, 60);
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select dg.name into g from draw_guild dg where lower(dg.name) = lower(nm) limit 1;
  select * into st from sf_sets where lower(player) = lower(coalesce(g, nm)) and start = s0 and not closed order by id desc limit 1;
  if st.id is null then insert into sf_sets (player, start) values (coalesce(g, nm), s0) returning * into st; end if;
  return json_build_object('r', 'ok', 'token', st.token, 'player', st.player, 'start', st.start);
end $$;

drop function if exists sf_find(text);
create or replace function sf_find(p_name text, p_start int default 0) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'token', s.token) from sf_sets s
    where lower(s.player) = lower(coalesce((select dg.name from draw_guild dg where lower(dg.name) = lower(trim(p_name)) limit 1), trim(p_name)))
      and s.start = case when p_start = 20 then 20 else 0 end and not s.closed order by s.id desc limit 1), json_build_object('r', 'none'));
$$;

create or replace function sf_get(p_tok uuid) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'player', s.player, 'closed', s.closed, 'start', s.start,
      'items', coalesce((select json_object_agg(r.item, sf_item_json(r)) from sf_runs r where r.set_id = s.id), '{}'::json))
    from sf_sets s where s.token = p_tok), json_build_object('r', 'gone'));
$$;

create or replace function sf_roll(p_tok uuid, p_item text, p_n int, p_stop int default 30, p_boom_stop boolean default true, p_restore int default null,
  p_dec boolean default false, p_des boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare st sf_sets; r sf_runs; rt sf_rates; c sf_restore; x numeric; seq text := ''; o text; i int := 0; at int; pts int; add int;
  dec numeric; des numeric; mult int;
begin
  perform rl_check('sf_roll', 300, 60);
  select * into st from sf_sets where token = p_tok;
  if st.id is null or st.closed then return json_build_object('r', 'gone'); end if;
  if p_item !~ '^[a-z_]{2,30}$' then return json_build_object('r', 'item'); end if;
  select * into r from sf_runs where set_id = st.id and item = p_item for update;
  if r.id is null then insert into sf_runs (player, item, set_id, star, best, base) values (st.player, p_item, st.id, st.start, st.start, st.start) returning * into r; end if;
  while i < least(greatest(coalesce(p_n, 1), 1), 1000) and r.star < 30 loop
    if r.broken then
      select * into c from sf_restore where star = p_restore;
      exit when c.star is null;
      r.red := r.red + c.red; r.mesos := r.mesos + c.mesos; r.scrolls := r.scrolls + c.scrolls; r.restores := r.restores + 1;
      r.star := c.star; r.broken := false; seq := seq || chr(97 + c.star - 12);
    end if;
    select * into rt from sf_rates where star = r.star;
    dec := rt.decrease; des := rt.destroy; mult := 1;
    if coalesce(p_dec, false) and rt.decrease > 0 then dec := rt.decrease_m; mult := mult + 1; end if;
    if coalesce(p_des, false) and rt.destroy > 0 then des := rt.destroy_m; mult := mult + 1; end if;
    at := r.star; pts := coalesce((r.pity_st ->> at::text)::int, 0); add := 0;
    r.attempts := r.attempts + 1; r.scrolls := r.scrolls + rt.scrolls * mult; r.mesos := r.mesos + rt.mesos * mult;
    if rt.pity_max is not null and pts >= rt.pity_max then o := 'G'; r.star := r.star + 1;
    else
      x := random() * 100;
      if x < rt.success then o := 'S'; r.star := r.star + 1;
      elsif x < rt.success + des then o := 'B'; r.star := 12; r.broken := true; r.booms := r.booms + 1; add := 4;
      elsif x < rt.success + des + dec then o := 'D'; r.star := r.star - 1; add := 2;
      else o := 'M'; add := 1; end if;
    end if;
    if rt.pity_max is not null then
      if o in ('S', 'G') then r.pity_st := r.pity_st - at::text;
      else r.pity_st := r.pity_st || jsonb_build_object(at::text, least(pts + add, rt.pity_max)); end if;
    end if;
    seq := seq || o; i := i + 1;
    if r.star > r.best then r.best := r.star; end if;
    if o in ('S', 'G') and not (r.reached ? r.star::text) then r.reached := r.reached || jsonb_build_object(r.star::text, jsonb_build_array(r.attempts, r.scrolls, r.booms)); end if;
    exit when (o = 'B' and (coalesce(p_boom_stop, true) or p_restore is null)) or r.star >= coalesce(p_stop, 30);
  end loop;
  update sf_runs set star = r.star, best = r.best, attempts = r.attempts, scrolls = r.scrolls, mesos = r.mesos, booms = r.booms, reached = r.reached,
    pity_st = r.pity_st, red = r.red, broken = r.broken, restores = r.restores, updated_at = now() where id = r.id;
  return json_build_object('r', 'ok', 'seq', seq, 'run', sf_item_json(r));
end $$;

create or replace function sf_close(p_tok uuid, p_share boolean) returns json
language plpgsql security definer set search_path = public as $$
declare st sf_sets; ns sf_sets; sc numeric; sp numeric; av numeric; rk int;
begin
  perform rl_check('sf_start', 20, 60);
  select * into st from sf_sets where token = p_tok for update;
  if st.id is null or st.closed then return json_build_object('r', 'gone'); end if;
  select coalesce(sum(sf_item_score(r)), 0), coalesce(sum(sf_item_spent(r)), 0), coalesce(sum(sf_item_avg(r)), 0) into sc, sp, av from sf_runs r where r.set_id = st.id;
  update sf_sets set closed = true, shared = coalesce(p_share, false) and sp > 0, closed_at = now(), score = round(sc), spent = sp, avg = av where id = st.id;
  insert into sf_sets (player, start) values (st.player, st.start) returning * into ns;
  select count(*) + 1 into rk from (select distinct on (lower(s.player)) s.score from sf_sets s join draw_guild dg on dg.name = s.player
    where s.shared and s.start = st.start order by lower(s.player), s.score desc) b where b.score > round(sc);
  return json_build_object('r', 'ok', 'token', ns.token, 'score', round(sc), 'rank', case when coalesce(p_share, false) then rk end);
end $$;

drop function if exists sf_board();
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
  burned as (select r.player, sum(r.scrolls) as scrolls, sum(r.booms) as booms from sf_runs r join sh on sh.id = r.set_id group by r.player)
  select json_build_object(
    'score', coalesce((select json_agg(b order by b.score desc) from (select * from best order by score desc limit 15) b), '[]'::json),
    'fast30', coalesce((select json_agg(f order by f.tries) from (select * from fast order by tries limit 10) f), '[]'::json),
    'lucky', coalesce((select json_agg(l order by l.luck desc) from (select * from lucky where best >= 20 order by luck desc limit 10) l), '[]'::json),
    'burned', coalesce((select json_agg(u order by u.scrolls desc) from (select * from burned where scrolls > 0 order by scrolls desc limit 10) u), '[]'::json));
$$;

revoke all on function sf_item_avg(sf_runs) from public, anon, authenticated;
revoke all on function sf_open(text, int), sf_find(text, int), sf_board(int) from public, anon, authenticated;
grant execute on function sf_open(text, int), sf_find(text, int), sf_board(int) to anon;
select 'star force v10 ready' as done;
