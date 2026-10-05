-- Star Force v8: a player's equipment SET (8 classic items, each with its own Star Force, like the game's equipment slots).
-- Results only count when the player SHARES the set: then it's scored and closed, and a brand new set starts at 0 stars.
-- "New game" closes it without sharing. The score of a set = the sum over its items of
--   (average cost to reach that item's best star) x sqrt(that average / what was really spent on the item)
-- so higher stars are worth more, and luck / knowing when to stop matters. Average costs come from 2,000 simulated climbs (sf_value).
create table if not exists sf_value (star int primary key, avg numeric not null);
insert into sf_value (star, avg) values (1, 2), (2, 4), (3, 8), (4, 14), (5, 22), (6, 33), (7, 48), (8, 67), (9, 91), (10, 122), (11, 170), (12, 225), (13, 286), (14, 378), (15, 490), (16, 586), (17, 749), (18, 990), (19, 1278), (20, 1623), (21, 2976), (22, 6428), (23, 11564), (24, 20339), (25, 42762), (26, 93176), (27, 263320), (28, 731716), (29, 2347536), (30, 7251198)
on conflict (star) do update set avg = excluded.avg;
alter table sf_value enable row level security;
revoke all on sf_value from anon, authenticated;
drop policy if exists "read sf value" on sf_value;
create policy "read sf value" on sf_value for select using (true);
grant select on sf_value to anon;

create table if not exists sf_sets (
  id bigserial primary key, token uuid not null default gen_random_uuid() unique, player text not null check (char_length(player) between 2 and 20),
  closed boolean not null default false, shared boolean not null default false, closed_at timestamptz,
  score bigint, spent numeric, avg numeric, created_at timestamptz not null default now()
);
create index if not exists sf_sets_player on sf_sets (lower(player));
alter table sf_sets enable row level security;
revoke all on sf_sets from anon, authenticated;
alter table sf_runs add column if not exists set_id bigint references sf_sets(id) on delete cascade;
create unique index if not exists sf_runs_set_item on sf_runs (set_id, item) where set_id is not null;

-- what one item cost, in "Star Force cost" units (1 = a scroll; 25,000 mesos = 1; 50 red diamonds = 1), and its score
create or replace function sf_item_spent(r sf_runs) returns numeric language sql immutable as $$
  select r.scrolls + r.mesos / 25000.0 + r.red / 50.0;
$$;
create or replace function sf_item_score(r sf_runs) returns numeric language sql stable set search_path = public as $$
  select case when r.best <= 0 then 0 else
    v.avg * sqrt(least(9, greatest(.1, v.avg / greatest(1, sf_item_spent(r))))) end
  from sf_value v where v.star = greatest(r.best, 1);
$$;

-- the player's open set (created if they don't have one)
create or replace function sf_open(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare nm text := left(trim(coalesce(p_name, '')), 20); g text; st sf_sets;
begin
  perform rl_check('sf_start', 20, 60);
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select dg.name into g from draw_guild dg where lower(dg.name) = lower(nm) limit 1;
  select * into st from sf_sets where lower(player) = lower(coalesce(g, nm)) and not closed order by id desc limit 1;
  if st.id is null then insert into sf_sets (player) values (coalesce(g, nm)) returning * into st; end if;
  return json_build_object('r', 'ok', 'token', st.token, 'player', st.player);
end $$;

-- look the open set up without creating one
create or replace function sf_find(p_name text) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'token', s.token) from sf_sets s
    where lower(s.player) = lower(coalesce((select dg.name from draw_guild dg where lower(dg.name) = lower(trim(p_name)) limit 1), trim(p_name)))
      and not s.closed order by s.id desc limit 1), json_build_object('r', 'none'));
$$;

create or replace function sf_item_json(r sf_runs) returns json language sql stable as $$
  select json_build_object('item', r.item, 'star', r.star, 'best', r.best, 'attempts', r.attempts, 'scrolls', r.scrolls, 'mesos', r.mesos,
    'booms', r.booms, 'reached', r.reached, 'pity', r.pity_st, 'red', r.red, 'broken', r.broken, 'restores', r.restores);
$$;

-- the whole set
drop function if exists sf_get(uuid);
create or replace function sf_get(p_tok uuid) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'player', s.player, 'closed', s.closed,
      'items', coalesce((select json_object_agg(r.item, sf_item_json(r)) from sf_runs r where r.set_id = s.id), '{}'::json))
    from sf_sets s where s.token = p_tok), json_build_object('r', 'gone'));
$$;

-- enhance one item of the set (same rules as v5-v7: real odds, per-stage Enhancement Points, mitigation, boom -> 12 stars until restored)
drop function if exists sf_roll(uuid, int, int, boolean, int, boolean, boolean);
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
  if r.id is null then insert into sf_runs (player, item, set_id) values (st.player, p_item, st.id) returning * into r; end if;
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

drop function if exists sf_fix(uuid, int);
create or replace function sf_fix(p_tok uuid, p_item text, p_star int) returns json
language plpgsql security definer set search_path = public as $$
declare st sf_sets; r sf_runs; c sf_restore;
begin
  perform rl_check('sf_roll', 300, 60);
  select * into st from sf_sets where token = p_tok;
  if st.id is null or st.closed then return json_build_object('r', 'gone'); end if;
  select * into r from sf_runs where set_id = st.id and item = p_item for update;
  if r.id is null or not r.broken then return json_build_object('r', 'notbroken'); end if;
  select * into c from sf_restore where star = p_star; if c.star is null then return json_build_object('r', 'star'); end if;
  update sf_runs set red = red + c.red, mesos = mesos + c.mesos, scrolls = scrolls + c.scrolls, restores = restores + 1,
    star = p_star, broken = false, updated_at = now() where id = r.id returning * into r;
  return json_build_object('r', 'ok', 'run', sf_item_json(r));
end $$;

-- share (score it, it goes on the board) or start a new game (thrown away); either way a fresh set starts at 0
create or replace function sf_close(p_tok uuid, p_share boolean) returns json
language plpgsql security definer set search_path = public as $$
declare st sf_sets; ns sf_sets; sc numeric; sp numeric; av numeric; rk int;
begin
  perform rl_check('sf_start', 20, 60);
  select * into st from sf_sets where token = p_tok for update;
  if st.id is null or st.closed then return json_build_object('r', 'gone'); end if;
  select coalesce(sum(sf_item_score(r)), 0), coalesce(sum(sf_item_spent(r)), 0), coalesce(sum(case when r.best > 0 then (select v.avg from sf_value v where v.star = r.best) else 0 end), 0)
    into sc, sp, av from sf_runs r where r.set_id = st.id;
  update sf_sets set closed = true, shared = coalesce(p_share, false) and sp > 0, closed_at = now(), score = round(sc), spent = sp, avg = av where id = st.id;
  insert into sf_sets (player) values (st.player) returning * into ns;
  select count(*) + 1 into rk from (select distinct on (lower(s.player)) s.score from sf_sets s join draw_guild dg on dg.name = s.player
    where s.shared order by lower(s.player), s.score desc) b where b.score > round(sc);
  return json_build_object('r', 'ok', 'token', ns.token, 'score', round(sc), 'rank', case when coalesce(p_share, false) then rk end);
end $$;

-- leaderboards from SHARED sets, guild members only
create or replace function sf_board() returns json
language sql security definer set search_path = public as $$
  with sh as (select s.* from sf_sets s join draw_guild dg on dg.name = s.player where s.shared),
  best as (select distinct on (lower(player)) player, score, spent, avg,
      (select max(r.best) from sf_runs r where r.set_id = sh.id) as best, (select count(*) from sf_runs r where r.set_id = sh.id and r.best > 0) as items
    from sh order by lower(player), score desc),
  fast as (select r.player, (r.reached -> '30' ->> 0)::bigint as tries, (r.reached -> '30' ->> 1)::bigint as scr, (r.reached -> '30' ->> 2)::int as bm, r.item
    from sf_runs r join sh on sh.id = r.set_id where r.best >= 30),
  lucky as (select distinct on (lower(player)) player, spent, avg, avg / greatest(spent, 1) as luck,
      (select max(r.best) from sf_runs r where r.set_id = sh.id) as best from sh where avg > 0 order by lower(player), avg / greatest(spent, 1) desc),
  burned as (select r.player, sum(r.scrolls) as scrolls, sum(r.booms) as booms from sf_runs r join sf_sets s on s.id = r.set_id
    join draw_guild dg on dg.name = r.player group by r.player)
  select json_build_object(
    'score', coalesce((select json_agg(b order by b.score desc) from (select * from best order by score desc limit 15) b), '[]'::json),
    'fast30', coalesce((select json_agg(f order by f.tries) from (select * from fast order by tries limit 10) f), '[]'::json),
    'lucky', coalesce((select json_agg(l order by l.luck desc) from (select * from lucky where best >= 20 order by luck desc limit 10) l), '[]'::json),
    'burned', coalesce((select json_agg(u order by u.scrolls desc) from (select * from burned where scrolls > 0 order by scrolls desc limit 10) u), '[]'::json));
$$;

drop function if exists sf_start(text, text);
revoke all on function sf_item_spent(sf_runs), sf_item_score(sf_runs), sf_item_json(sf_runs) from public, anon, authenticated;
revoke all on function sf_open(text), sf_find(text), sf_get(uuid), sf_roll(uuid, text, int, int, boolean, int, boolean, boolean), sf_fix(uuid, text, int), sf_close(uuid, boolean), sf_board() from public, anon, authenticated;
grant execute on function sf_open(text), sf_find(text), sf_get(uuid), sf_roll(uuid, text, int, int, boolean, int, boolean, boolean), sf_fix(uuid, text, int), sf_close(uuid, boolean), sf_board() to anon;
select 'star force v8 ready' as done;
