-- Bonk Duel v7: the same-Wi-Fi anti-cheat is paused, so duels between two people on the same connection count for the
-- Hall of Fame. Connections (h1/h2) are still recorded, so it can be switched back on later.

create or replace function bd_finish(g uuid, win int, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d bd_duels;
begin
  update bd_duels set status = 'over', winner = win, why = reason, ends_at = null, dbl_by = null where id = g and status <> 'over' returning * into d;
  if d.id is null or d.p2 is null or d.turn < 1 then return; end if;
  -- Hall of Fame: only guild names. The same-Wi-Fi anti-cheat is PAUSED (to turn it back on, restore this line:
  --   if d.h1 is not distinct from d.h2 and d.h1 is not null then return; end if;  )
  insert into bd_scores as s (player, duels, wins, points)
    select x.n, 1, (x.side = win)::int, case when x.side = win then d.stake else 0 end
    from (values (d.p1, 1), (d.p2, 2)) x(n, side) where exists (select 1 from draw_guild dg where dg.name = x.n)
  on conflict (player) do update set duels = s.duels + 1, wins = s.wins + excluded.wins, points = s.points + excluded.points;
end $$;

create or replace function bd_state(p_game uuid, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare d bd_duels; me int := 0;
begin
  perform rl_check('bd_state', 150, 60);
  select * into d from bd_duels where id = p_game;
  if d.id is null then return json_build_object('r', 'gone'); end if;
  if p_tok is not null then me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end; end if;
  if me = 1 and d.seen1 < now() - interval '3 seconds' then update bd_duels set seen1 = now() where id = p_game; end if;
  if me = 2 and d.seen2 < now() - interval '3 seconds' then update bd_duels set seen2 = now() where id = p_game; end if;
  perform bd_tick(p_game);
  select * into d from bd_duels where id = p_game;
  return json_build_object('r', 'ok', 'me', me, 'status', d.status, 'room', d.room, 'turn', d.turn,
    'p1', d.p1, 'p2', d.p2, 'hp1', d.hp1, 'hp2', d.hp2, 'en1', d.en1, 'en2', d.en2,
    'class1', d.class1, 'class2', d.class2, 'map', d.map, 'secs', d.secs,
    'hpmax1', d.hpmax1, 'hpmax2', d.hpmax2, 'enmax1', d.enmax1, 'enmax2', d.enmax2,
    'rage1', d.rage1, 'rage2', d.rage2, 'lucky1', d.lucky1, 'lucky2', d.lucky2,
    'arm', d.arm,
    'picked1', d.pick1 is not null, 'picked2', d.pick2 is not null,
    'mine', case me when 1 then d.pick1 when 2 then d.pick2 end,
    'stake', d.stake, 'dbl1', d.dbl1, 'dbl2', d.dbl2, 'dbl_by', d.dbl_by, 'winner', d.winner, 'why', d.why, 'last', d.last,
    'left', case when d.ends_at is null then null else greatest(0, extract(epoch from d.ends_at - now())) end,
    'reveal', case when d.reveal_until is null then 0 else greatest(0, extract(epoch from d.reveal_until - now())) end,
    'on1', d.seen1 > now() - interval '15 seconds', 'on2', d.seen2 > now() - interval '15 seconds',
    'practice', false);   -- same-Wi-Fi anti-cheat paused
end $$;

select 'anti-cheat paused' as done;
