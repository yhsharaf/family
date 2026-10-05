-- Boom Roulette v2: its own odds (not MapleStory's) so stars move faster, and the goal is 24 stars.
-- Picked by bot simulation (6,000 games): games ~4 min, about half are won by reaching the goal, the rest by being the last one standing.
-- No drops at 20 stars; a boom sends the real star back to 20.
create table if not exists br_odds (star int primary key, success numeric not null, maintain numeric not null, decrease numeric not null, destroy numeric not null);
insert into br_odds values (20, 40, 50, 0, 10), (21, 35, 40, 12, 13), (22, 30, 42, 13, 15), (23, 27, 43, 13, 17), (24, 25, 43, 13, 19)
on conflict (star) do update set success = excluded.success, maintain = excluded.maintain, decrease = excluded.decrease, destroy = excluded.destroy;
alter table br_odds enable row level security;
revoke all on br_odds from anon, authenticated;
drop policy if exists "read br odds" on br_odds;
create policy "read br odds" on br_odds for select using (true);
grant select on br_odds to anon;

create or replace function br_do_roll(p_code text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare p br_players; rt br_odds; x numeric; o text;
begin
  select * into p from br_players where code = p_code and name = p_name for update;
  if p.roll is not null then return p.roll; end if;
  select * into rt from br_odds where star = least(greatest(p.real, 20), 24);
  x := random() * 100;
  if x < rt.success then o := 'S'; elsif x < rt.success + rt.destroy then o := 'B'; elsif x < rt.success + rt.destroy + rt.decrease then o := 'D'; else o := 'M'; end if;
  update br_players set roll = o, real = case o when 'S' then real + 1 when 'D' then real - 1 when 'B' then 20 else real end
    where code = p_code and name = p_name;
  return o;
end $$;
revoke all on function br_do_roll(text, text) from public, anon, authenticated;

create or replace function br_advance(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rm br_rooms; p br_players; acc record; n_need int; n_alive int; win text;
begin
  select * into rm from br_rooms where code = p_code for update;
  if rm.status is distinct from 'playing' then return; end if;
  -- players who closed the page drop out
  update br_players set alive = false, lives = 0, out_round = coalesce(out_round, rm.round)
    where code = p_code and alive and seen < now() - interval '25 seconds';
  if rm.phase = 'play' then
    select count(*) into n_need from br_players where code = p_code and alive and claim is null;
    if n_need > 0 and now() < rm.phase_end then return; end if;
    for p in select * from br_players where code = p_code and alive and roll is null loop perform br_do_roll(p_code, p.name); end loop;
    update br_players set claim = roll where code = p_code and alive and claim is null;   -- out of time: the truth is told for you
    update br_players set shown = case claim when 'S' then shown + 1 when 'D' then shown - 1 when 'B' then 20 else shown end,
      lives = lives - (claim = 'B')::int where code = p_code and alive;
    update br_players set acted = (calls <= 0 or lives <= 0) where code = p_code and alive;
    update br_rooms set phase = 'call', phase_end = now() + interval '12 seconds' where code = p_code;
    return;
  end if;
  if rm.phase = 'call' then
    select count(*) into n_need from br_players where code = p_code and alive and not acted;
    if n_need > 0 and now() < rm.phase_end then return; end if;
    for acc in select target, array_agg(name) as who from br_players where code = p_code and alive and target is not null group by target loop
      select * into p from br_players where code = p_code and name = acc.target;
      if p.claim is distinct from p.roll then   -- caught lying: a life, the true star is shown, the callers get their call back
        update br_players set lives = lives - 1, caught = caught + 1, shown = real, exposed = true where code = p_code and name = acc.target;
        update br_players set calls = calls + 1, catches = catches + 1 where code = p_code and name = any(acc.who);
      end if;
    end loop;
    -- claiming 24 stars: the real star is checked
    for p in select * from br_players where code = p_code and alive and lives > 0 and shown >= 24 order by real desc loop
      if p.real >= 24 then win := coalesce(win, p.name);
      else update br_players set lives = 0, busted = true, shown = real where code = p_code and name = p.name; end if;
    end loop;
    update br_players set history = history || jsonb_build_array(jsonb_build_array(rm.round, roll, claim, real, target, exposed))
      where code = p_code and alive and roll is not null;
    update br_players set alive = false, out_round = coalesce(out_round, rm.round) where code = p_code and alive and lives <= 0;
    select count(*) into n_alive from br_players where code = p_code and alive;
    if win is null and n_alive = 1 then select name into win from br_players where code = p_code and alive; end if;
    update br_rooms set phase = 'reveal', phase_end = now() + interval '6 seconds' where code = p_code;
    if win is not null or n_alive = 0 or rm.round >= 40 then perform br_finish(p_code, win); end if;
    return;
  end if;
  if rm.phase = 'reveal' then
    if now() < rm.phase_end then return; end if;
    update br_players set roll = null, claim = null, target = null, acted = false, exposed = false where code = p_code;
    update br_rooms set phase = 'play', round = round + 1, phase_end = now() + interval '20 seconds' where code = p_code;
  end if;
end $$;
revoke all on function br_advance(text) from public, anon, authenticated;
select 'boom roulette v2 ready' as done;
