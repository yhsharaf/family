-- Star Force simulator (MapleStory Idle rates from mapleidle.gg, Oct 2026). Every enhancement is rolled on the server, so the
-- leaderboard can be trusted. Scrolls are unlimited: we just count how many each run has used.
create table if not exists sf_rates (star int primary key, success numeric not null, maintain numeric not null, decrease numeric not null,
  destroy numeric not null, scrolls int not null, mesos int not null);
insert into sf_rates (star, success, maintain, decrease, destroy, scrolls, mesos) values
  (0, 100, 0, 0, 0, 1, 20000),
  (1, 100, 0, 0, 0, 1, 30000),
  (2, 90, 10, 0, 0, 2, 40000),
  (3, 85, 15, 0, 0, 3, 50000),
  (4, 80, 20, 0, 0, 4, 60000),
  (5, 70, 30, 0, 0, 5, 70000),
  (6, 65, 35, 0, 0, 6, 90000),
  (7, 60, 40, 0, 0, 7, 110000),
  (8, 55, 45, 0, 0, 8, 130000),
  (9, 50, 50, 0, 0, 9, 150000),
  (10, 35, 65, 0, 0, 10, 170000),
  (11, 34, 66, 0, 0, 11, 190000),
  (12, 33, 67, 0, 0, 12, 210000),
  (13, 32.5, 67.5, 0, 0, 18, 325000),
  (14, 31.5, 68.5, 0, 0, 21, 370000),
  (15, 31, 69, 0, 0, 18, 320000),
  (16, 29, 71, 0, 0, 28, 520000),
  (17, 26, 74, 0, 0, 37, 700000),
  (18, 23, 77, 0, 0, 38, 770000),
  (19, 21, 79, 0, 0, 42, 850000),
  (20, 12.8, 76.2, 0, 11, 21, 420000),
  (21, 11.5, 70.5, 8, 10, 38, 750000),
  (22, 11.3, 77.7, 4, 7, 40, 790000),
  (23, 9, 82, 4, 5, 44, 820000),
  (24, 7.5, 81, 4, 7.5, 50, 950000),
  (25, 7, 81.5, 4, 7.5, 54, 1000000),
  (26, 4.5, 85, 3, 7.5, 68, 1300000),
  (27, 4, 86.5, 3, 6.5, 71, 1400000),
  (28, 2, 92, 4, 2, 75, 1750000),
  (29, 2, 92, 4, 2, 80, 1800000)
on conflict (star) do update set success = excluded.success, maintain = excluded.maintain, decrease = excluded.decrease, destroy = excluded.destroy,
  scrolls = excluded.scrolls, mesos = excluded.mesos;

-- one row per item someone is enhancing (a "run"); the token in their browser is the only way to roll on it
create table if not exists sf_runs (
  id bigserial primary key, token uuid not null default gen_random_uuid() unique,
  player text not null check (char_length(player) between 2 and 20), item text not null default 'zakum_helmet',
  star int not null default 0, best int not null default 0, attempts bigint not null default 0, scrolls bigint not null default 0,
  mesos bigint not null default 0, booms int not null default 0,
  reached jsonb not null default '{}'::jsonb,   -- star -> [attempts, scrolls, booms] the first time this run reached it
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists sf_runs_player on sf_runs (player);
alter table sf_rates enable row level security;
alter table sf_runs enable row level security;
revoke all on sf_rates, sf_runs from anon, authenticated;
drop policy if exists "read sf rates" on sf_rates;
create policy "read sf rates" on sf_rates for select using (true);
grant select on sf_rates to anon;

-- start a new item (guild names are matched to the roster's spelling)
create or replace function sf_start(p_name text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare nm text := left(trim(coalesce(p_name, '')), 20); g text; r sf_runs;
begin
  perform rl_check('sf_start', 10, 60);
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select dg.name into g from draw_guild dg where lower(dg.name) = lower(nm) limit 1;
  insert into sf_runs (player, item) values (coalesce(g, nm), left(coalesce(p_item, 'zakum_helmet'), 30)) returning * into r;
  return json_build_object('r', 'ok', 'token', r.token, 'player', r.player, 'item', r.item);
end $$;

-- the run as it is now
create or replace function sf_get(p_tok uuid) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'player', player, 'item', item, 'star', star, 'best', best, 'attempts', attempts,
    'scrolls', scrolls, 'mesos', mesos, 'booms', booms, 'reached', reached) from sf_runs where token = p_tok), json_build_object('r', 'gone'));
$$;

-- enhance up to p_n times (max 1000), stopping early on a boom (if p_boom_stop), at star p_stop, or at 30.
-- Returns what happened each try as one letter: S success, M maintain, D decrease, B destroyed (back to 12 stars).
create or replace function sf_roll(p_tok uuid, p_n int, p_stop int default 30, p_boom_stop boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare r sf_runs; rt sf_rates; x numeric; seq text := ''; o text; i int := 0;
begin
  perform rl_check('sf_roll', 300, 60);
  select * into r from sf_runs where token = p_tok for update;
  if r.id is null then return json_build_object('r', 'gone'); end if;
  while i < least(greatest(coalesce(p_n, 1), 1), 1000) and r.star < 30 loop
    select * into rt from sf_rates where star = r.star;
    x := random() * 100;
    r.attempts := r.attempts + 1; r.scrolls := r.scrolls + rt.scrolls; r.mesos := r.mesos + rt.mesos;
    if x < rt.success then o := 'S'; r.star := r.star + 1;
    elsif x < rt.success + rt.destroy then o := 'B'; r.star := 12; r.booms := r.booms + 1;
    elsif x < rt.success + rt.destroy + rt.decrease then o := 'D'; r.star := r.star - 1;
    else o := 'M'; end if;
    seq := seq || o; i := i + 1;
    if r.star > r.best then r.best := r.star; end if;
    if o = 'S' and not (r.reached ? r.star::text) then r.reached := r.reached || jsonb_build_object(r.star::text, jsonb_build_array(r.attempts, r.scrolls, r.booms)); end if;
    exit when (o = 'B' and coalesce(p_boom_stop, true)) or r.star >= coalesce(p_stop, 30);
  end loop;
  update sf_runs set star = r.star, best = r.best, attempts = r.attempts, scrolls = r.scrolls, mesos = r.mesos, booms = r.booms, reached = r.reached, updated_at = now()
    where id = r.id;
  return json_build_object('r', 'ok', 'seq', seq, 'star', r.star, 'best', r.best, 'attempts', r.attempts, 'scrolls', r.scrolls, 'mesos', r.mesos, 'booms', r.booms, 'reached', r.reached);
end $$;

-- leaderboards (guild members only): the highest star anyone reached (fewest scrolls to get there wins ties), and the most scrolls burned
create or replace function sf_board() returns json
language sql security definer set search_path = public as $$
  with best as (
    select distinct on (r.player) r.player, r.item, r.best, (r.reached -> r.best::text ->> 0)::bigint as att, (r.reached -> r.best::text ->> 1)::bigint as scr,
      (r.reached -> r.best::text ->> 2)::int as bm
    from sf_runs r join draw_guild dg on dg.name = r.player where r.best > 0
    order by r.player, r.best desc, (r.reached -> r.best::text ->> 1)::bigint asc
  ), burned as (
    select r.player, sum(r.scrolls) as scrolls, sum(r.booms) as booms from sf_runs r join draw_guild dg on dg.name = r.player group by r.player
  )
  select json_build_object(
    'top', coalesce((select json_agg(b order by b.best desc, b.scr asc) from (select * from best order by best desc, scr asc limit 15) b), '[]'::json),
    'burned', coalesce((select json_agg(u order by u.scrolls desc) from (select * from burned where scrolls > 0 order by scrolls desc limit 10) u), '[]'::json));
$$;

revoke all on function sf_start(text, text), sf_get(uuid), sf_roll(uuid, int, int, boolean), sf_board() from public, anon, authenticated;
grant execute on function sf_start(text, text), sf_get(uuid), sf_roll(uuid, int, int, boolean), sf_board() to anon;
select 'star force ready' as done;
