-- Star Force v3: the real Enhancement Points (pity) from the game. Each stage from 12 stars has its own gauge:
-- a failed try (maintained) +1, a stage decrease +2, destroyed +4, all added to the stage you were TRYING; success resets that stage.
-- Points stay on their stage even after dropping or booming. A full gauge means the next try at that stage is guaranteed.
update sf_rates set pity_max = v.p from (values
  (12, 8), (13, 8), (14, 8), (15, 9), (16, 9), (17, 10), (18, 11), (19, 12), (20, 20), (21, 22), (22, 23), (23, 28), (24, 34),
  (25, 36), (26, 56), (27, 63), (28, 125), (29, 125)
) as v(s, p) where sf_rates.star = v.s;
alter table sf_runs add column if not exists pity_st jsonb not null default '{}'::jsonb;   -- stage -> points

create or replace function sf_get(p_tok uuid) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'player', player, 'item', item, 'star', star, 'best', best, 'attempts', attempts,
    'scrolls', scrolls, 'mesos', mesos, 'booms', booms, 'reached', reached, 'pity', pity_st, 'red', red, 'broken', broken, 'restores', restores)
    from sf_runs where token = p_tok), json_build_object('r', 'gone'));
$$;

create or replace function sf_roll(p_tok uuid, p_n int, p_stop int default 30, p_boom_stop boolean default true, p_restore int default null) returns json
language plpgsql security definer set search_path = public as $$
declare r sf_runs; rt sf_rates; c sf_restore; x numeric; seq text := ''; o text; i int := 0; at int; pts int; add int;
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
    at := r.star; pts := coalesce((r.pity_st ->> at::text)::int, 0); add := 0;
    r.attempts := r.attempts + 1; r.scrolls := r.scrolls + rt.scrolls; r.mesos := r.mesos + rt.mesos;
    if rt.pity_max is not null and pts >= rt.pity_max then o := 'G'; r.star := r.star + 1;
    else
      x := random() * 100;
      if x < rt.success then o := 'S'; r.star := r.star + 1;
      elsif x < rt.success + rt.destroy then o := 'B'; r.star := 0; r.broken := true; r.booms := r.booms + 1; add := 4;
      elsif x < rt.success + rt.destroy + rt.decrease then o := 'D'; r.star := r.star - 1; add := 2;
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
  return json_build_object('r', 'ok', 'seq', seq, 'star', r.star, 'best', r.best, 'attempts', r.attempts, 'scrolls', r.scrolls, 'mesos', r.mesos, 'booms', r.booms,
    'reached', r.reached, 'pity', r.pity_st, 'red', r.red, 'broken', r.broken, 'restores', r.restores);
end $$;
select 'star force v3 ready' as done;
