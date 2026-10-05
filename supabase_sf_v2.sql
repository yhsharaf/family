-- Star Force v2: the pity gauge ("enhancement points") and choosing where a destroyed item is restored.
-- From 12 stars every failed try gives 1 point, a decrease 2, a destruction 4; when the gauge is full the next try is a guaranteed success.
-- A destroyed item's slot drops to 0 stars; you pick where to restore it (12-20 stars, each with its own price) or start again from 0 for free.
-- NOTE: the gauge sizes and restore prices below are PLACEHOLDERS until we have the real in-game numbers (update the rows, no code change).
alter table sf_rates add column if not exists pity_max int;
update sf_rates set pity_max = v.p from (values
  (12, 5),
  (13, 5),
  (14, 5),
  (15, 5),
  (16, 6),
  (17, 6),
  (18, 7),
  (19, 8),
  (20, 12),
  (21, 14),
  (22, 14),
  (23, 17),
  (24, 20),
  (25, 22),
  (26, 34),
  (27, 38),
  (28, 75),
  (29, 75)
) as v(s, p) where sf_rates.star = v.s;
create table if not exists sf_restore (star int primary key, red int not null, mesos bigint not null, scrolls int not null);
insert into sf_restore (star, red, mesos, scrolls) values
  (12, 3000, 1000000, 10),
  (13, 3500, 1500000, 20),
  (14, 4000, 2000000, 30),
  (15, 4500, 2500000, 40),
  (16, 5000, 3000000, 50),
  (17, 5500, 3500000, 60),
  (18, 6000, 4000000, 70),
  (19, 6500, 4500000, 80),
  (20, 7000, 5000000, 90)
on conflict (star) do update set red = excluded.red, mesos = excluded.mesos, scrolls = excluded.scrolls;
alter table sf_restore enable row level security;
revoke all on sf_restore from anon, authenticated;
drop policy if exists "read sf restore" on sf_restore;
create policy "read sf restore" on sf_restore for select using (true);
grant select on sf_restore to anon;
alter table sf_runs add column if not exists pity int not null default 0;
alter table sf_runs add column if not exists red bigint not null default 0;
alter table sf_runs add column if not exists broken boolean not null default false;
alter table sf_runs add column if not exists restores int not null default 0;

create or replace function sf_get(p_tok uuid) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'player', player, 'item', item, 'star', star, 'best', best, 'attempts', attempts,
    'scrolls', scrolls, 'mesos', mesos, 'booms', booms, 'reached', reached, 'pity', pity, 'red', red, 'broken', broken, 'restores', restores)
    from sf_runs where token = p_tok), json_build_object('r', 'gone'));
$$;

-- restore a destroyed item: 0 (free, start again) or 12-20 stars for that row's price
create or replace function sf_fix(p_tok uuid, p_star int) returns json
language plpgsql security definer set search_path = public as $$
declare r sf_runs; c sf_restore;
begin
  perform rl_check('sf_roll', 300, 60);
  select * into r from sf_runs where token = p_tok for update;
  if r.id is null then return json_build_object('r', 'gone'); end if;
  if not r.broken then return json_build_object('r', 'notbroken'); end if;
  if p_star <> 0 then
    select * into c from sf_restore where star = p_star; if c.star is null then return json_build_object('r', 'star'); end if;
    update sf_runs set red = red + c.red, mesos = mesos + c.mesos, scrolls = scrolls + c.scrolls, restores = restores + 1 where id = r.id;
  end if;
  update sf_runs set star = p_star, broken = false, updated_at = now() where id = r.id;
  return sf_get(p_tok);
end $$;

-- enhance up to p_n times (max 1000). Letters: S success, G guaranteed success (gauge full), M no change, D decrease, B destroyed,
-- and a..i = restored to 12..20 stars (when p_restore is given, a destroyed item is restored there automatically and enhancing goes on)
create or replace function sf_roll(p_tok uuid, p_n int, p_stop int default 30, p_boom_stop boolean default true, p_restore int default null) returns json
language plpgsql security definer set search_path = public as $$
declare r sf_runs; rt sf_rates; c sf_restore; x numeric; seq text := ''; o text; i int := 0;
begin
  perform rl_check('sf_roll', 300, 60);
  select * into r from sf_runs where token = p_tok for update;
  if r.id is null then return json_build_object('r', 'gone'); end if;
  while i < least(greatest(coalesce(p_n, 1), 1), 1000) and r.star < 30 loop
    if r.broken then
      select * into c from sf_restore where star = p_restore;
      exit when c.star is null;
      r.red := r.red + c.red; r.mesos := r.mesos + c.mesos; r.scrolls := r.scrolls + c.scrolls; r.restores := r.restores + 1;
      r.star := c.star; r.broken := false; seq := seq || chr(97 + c.star - 12);
    end if;
    select * into rt from sf_rates where star = r.star;
    r.attempts := r.attempts + 1; r.scrolls := r.scrolls + rt.scrolls; r.mesos := r.mesos + rt.mesos;
    if r.star >= 12 and rt.pity_max is not null and r.pity >= rt.pity_max then o := 'G'; r.star := r.star + 1; r.pity := 0;
    else
      x := random() * 100;
      if x < rt.success then o := 'S'; r.star := r.star + 1; r.pity := 0;
      elsif x < rt.success + rt.destroy then o := 'B'; r.star := 0; r.broken := true; r.booms := r.booms + 1; r.pity := r.pity + 4;
      elsif x < rt.success + rt.destroy + rt.decrease then o := 'D'; r.star := r.star - 1; r.pity := r.pity + 2;
      else o := 'M'; if r.star >= 12 then r.pity := r.pity + 1; end if; end if;
    end if;
    seq := seq || o; i := i + 1;
    if r.star > r.best then r.best := r.star; end if;
    if o in ('S', 'G') and not (r.reached ? r.star::text) then r.reached := r.reached || jsonb_build_object(r.star::text, jsonb_build_array(r.attempts, r.scrolls, r.booms)); end if;
    exit when (o = 'B' and (coalesce(p_boom_stop, true) or p_restore is null)) or r.star >= coalesce(p_stop, 30);
  end loop;
  update sf_runs set star = r.star, best = r.best, attempts = r.attempts, scrolls = r.scrolls, mesos = r.mesos, booms = r.booms, reached = r.reached,
    pity = r.pity, red = r.red, broken = r.broken, restores = r.restores, updated_at = now() where id = r.id;
  return json_build_object('r', 'ok', 'seq', seq, 'star', r.star, 'best', r.best, 'attempts', r.attempts, 'scrolls', r.scrolls, 'mesos', r.mesos, 'booms', r.booms,
    'reached', r.reached, 'pity', r.pity, 'red', r.red, 'broken', r.broken, 'restores', r.restores);
end $$;
drop function if exists sf_roll(uuid, int, int, boolean);

revoke all on function sf_get(uuid), sf_fix(uuid, int), sf_roll(uuid, int, int, boolean, int) from public, anon, authenticated;
grant execute on function sf_get(uuid), sf_fix(uuid, int), sf_roll(uuid, int, int, boolean, int) to anon;
select 'star force v2 ready' as done;
