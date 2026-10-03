-- Bonk Duel: a 1v1 mind game (simultaneous secret picks, like Yomi / Pokémon). The database keeps both picks secret
-- until both are in (or the 15s clock runs out), resolves the turn, and runs the clock; each player has a private token.
-- Moves: bonk (1 MP, 2 dmg, blocked by shield) · heavy (3 MP, 4 dmg, breaks shield, dodged by dodge)
--        shield (free, blocks bonk and gets +1 MP back) · dodge (1 MP, avoids heavy and counters for 3)
--        charge (free, +2 MP, but take +1 damage that turn). No pick in time = 💤 (like charge without the MP).
-- Everyone gets +1 MP a turn (max 5). Sudden death from turn 9: hits do +1 and MP comes back twice as fast.
-- Turn 15 ends it: most HP wins. "Double Bonk!": once per player per duel, double the stake (1 → 2 → 4 points);
-- the other player accepts or runs away (and loses at the old stake).
create table if not exists bd_duels (
  id uuid primary key default gen_random_uuid(),
  room text not null check (char_length(room) <= 20),
  status text not null default 'wait',        -- wait | pick | double | over
  p1 text not null, p2 text,
  t1 uuid not null default gen_random_uuid(), t2 uuid default gen_random_uuid(),
  h1 text, h2 text,                            -- hashed connection (same connection on both sides = practice, no points)
  hp1 int not null default 10, hp2 int not null default 10,
  en1 int not null default 3, en2 int not null default 3,
  pick1 text, pick2 text, afk1 int not null default 0, afk2 int not null default 0,
  turn int not null default 0,
  ends_at timestamptz, reveal_until timestamptz, paused interval,
  stake int not null default 1, dbl1 boolean not null default false, dbl2 boolean not null default false, dbl_by int,
  winner int,                                  -- 1 | 2 | 0 = draw
  why text,                                    -- ko | time | flee | afk | left | draw
  last json,
  created_at timestamptz not null default now(),
  seen1 timestamptz not null default now(), seen2 timestamptz
);
create table if not exists bd_rounds (
  duel_id uuid not null references bd_duels(id) on delete cascade,
  turn int not null, m1 text, m2 text, d1 int, d2 int, hp1 int, hp2 int,
  primary key (duel_id, turn)
);
create table if not exists bd_scores (
  player text primary key check (char_length(player) <= 40),
  duels int not null default 0, wins int not null default 0, points int not null default 0
);
create index if not exists bd_duels_room on bd_duels (room, created_at desc);
alter table bd_duels enable row level security; alter table bd_rounds enable row level security; alter table bd_scores enable row level security;
drop policy if exists "read bd scores" on bd_scores;
create policy "read bd scores" on bd_scores for select using (true);
revoke all on bd_duels, bd_rounds, bd_scores from anon, authenticated;
grant select on bd_scores to anon;

create or replace function bd_conn() returns text language sql stable security definer set search_path = public as $$
  select md5(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1) || ':family-bd')
$$;

create or replace function bd_cost(m text) returns int language sql immutable as $$
  select case m when 'bonk' then 1 when 'heavy' then 3 when 'dodge' then 1 else 0 end
$$;

-- damage that move `a` does to someone who picked `b`
create or replace function bd_hit(a text, b text) returns int language sql immutable as $$
  select case when a = 'bonk' and b <> 'shield' then 2 when a = 'heavy' and b <> 'dodge' then 4 else 0 end
$$;

create or replace function bd_finish(g uuid, win int, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d bd_duels;
begin
  update bd_duels set status = 'over', winner = win, why = reason, ends_at = null, dbl_by = null where id = g and status <> 'over' returning * into d;
  if d.id is null or d.p2 is null or d.turn < 1 then return; end if;
  -- Hall of Fame: only guild names, and not one person playing both sides
  if d.h1 is not distinct from d.h2 and d.h1 is not null then return; end if;
  insert into bd_scores as s (player, duels, wins, points)
    select x.n, 1, (x.side = win)::int, case when x.side = win then d.stake else 0 end
    from (values (d.p1, 1), (d.p2, 2)) x(n, side) where exists (select 1 from draw_guild dg where dg.name = x.n)
  on conflict (player) do update set duels = s.duels + 1, wins = s.wins + excluded.wins, points = s.points + excluded.points;
end $$;

create or replace function bd_resolve(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d bd_duels; m1 text; m2 text; x1 int; x2 int; sd boolean; e1 int; e2 int; regen int; w int;
begin
  select * into d from bd_duels where id = g for update;
  -- only once per turn: the clock ran out, or both picked (two polls arriving together must not resolve twice)
  if d.status <> 'pick' or (d.ends_at > now() and (d.pick1 is null or d.pick2 is null)) then return; end if;
  m1 := coalesce(d.pick1, 'zzz'); m2 := coalesce(d.pick2, 'zzz');
  sd := d.turn >= 9;
  x1 := bd_hit(m2, m1); x2 := bd_hit(m1, m2);
  if m1 = 'dodge' and m2 = 'heavy' then x2 := x2 + 3; end if;
  if m2 = 'dodge' and m1 = 'heavy' then x1 := x1 + 3; end if;
  if x1 > 0 and m1 in ('charge', 'zzz') then x1 := x1 + 1; end if;
  if x2 > 0 and m2 in ('charge', 'zzz') then x2 := x2 + 1; end if;
  if sd and x1 > 0 then x1 := x1 + 1; end if;
  if sd and x2 > 0 then x2 := x2 + 1; end if;
  regen := case when sd then 2 else 1 end;
  e1 := d.en1 - bd_cost(m1) + case when m1 = 'charge' then 2 else 0 end + case when m1 = 'shield' and m2 = 'bonk' then 1 else 0 end + regen;
  e2 := d.en2 - bd_cost(m2) + case when m2 = 'charge' then 2 else 0 end + case when m2 = 'shield' and m1 = 'bonk' then 1 else 0 end + regen;
  update bd_duels set hp1 = greatest(0, hp1 - x1), hp2 = greatest(0, hp2 - x2), en1 = least(5, greatest(0, e1)), en2 = least(5, greatest(0, e2)),
    afk1 = case when m1 = 'zzz' then afk1 + 1 else 0 end, afk2 = case when m2 = 'zzz' then afk2 + 1 else 0 end,
    pick1 = null, pick2 = null, turn = turn + 1,
    last = json_build_object('turn', d.turn, 'm1', m1, 'm2', m2, 'd1', x1, 'd2', x2, 'sd', sd),
    reveal_until = now() + interval '4 seconds', ends_at = now() + interval '19 seconds'
  where id = g returning * into d;
  insert into bd_rounds values (g, d.turn - 1, m1, m2, x1, x2, d.hp1, d.hp2) on conflict do nothing;
  if d.hp1 = 0 or d.hp2 = 0 then
    perform bd_finish(g, case when d.hp1 = d.hp2 then 0 when d.hp1 > d.hp2 then 1 else 2 end, case when d.hp1 = d.hp2 then 'draw' else 'ko' end);
  elsif d.afk1 >= 3 and d.afk2 >= 3 then perform bd_finish(g, 0, 'afk');
  elsif d.afk1 >= 3 then perform bd_finish(g, 2, 'afk');
  elsif d.afk2 >= 3 then perform bd_finish(g, 1, 'afk');
  elsif d.turn > 15 then
    perform bd_finish(g, case when d.hp1 = d.hp2 then 0 when d.hp1 > d.hp2 then 1 else 2 end, 'time');
  end if;
end $$;

create or replace function bd_tick(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d bd_duels;
begin
  select * into d from bd_duels where id = g;
  if d.id is null or d.status = 'over' then return; end if;
  if d.status = 'wait' then
    if d.seen1 < now() - interval '2 minutes' then update bd_duels set status = 'over', why = 'left' where id = g; end if;
    return;
  end if;
  if d.ends_at > now() then return; end if;
  select * into d from bd_duels where id = g for update;   -- re-check under the lock
  if d.ends_at > now() then return; end if;
  if d.status = 'pick' then perform bd_resolve(g);
  elsif d.status = 'double' then   -- no answer = accepted
    update bd_duels set status = 'pick', stake = stake * 2, dbl_by = null, ends_at = now() + coalesce(paused, interval '15 seconds') where id = g;
  end if;
end $$;

-- at most 20 duels at once, and one connection opens at most 6 new duels per 10 minutes
create or replace function bd_room_ok() returns text
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from bd_duels where status <> 'over' and greatest(seen1, coalesce(seen2, seen1)) > now() - interval '1 minute') >= 20 then return 'busy'; end if;
  begin perform rl_check('bd_new', 6, 600); exception when sqlstate 'P0429' then return 'slow'; end;
  return null;
end $$;

-- join a duel: the public queue pairs you with whoever is waiting; a private room is you + one friend
create or replace function bd_join(p_room text, p_name text, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20); nm text := left(trim(coalesce(p_name, '')), 20);
        d bd_duels; why text;
begin
  perform rl_check('bd_join', 30, 60);
  delete from bd_duels where created_at < now() - interval '3 hours';
  if p_tok is not null then
    select * into d from bd_duels where (t1 = p_tok or t2 = p_tok) and status <> 'over' and created_at > now() - interval '1 hour';
    if d.id is not null then
      return json_build_object('r', 'ok', 'game', d.id, 'token', p_tok, 'name', case when d.t1 = p_tok then d.p1 else d.p2 end);
    end if;
    if nm = '' then return json_build_object('r', 'gone'); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  -- someone waiting? (lock it so two people can't grab the same opponent)
  select * into d from bd_duels where room = rm and status = 'wait' and p2 is null and seen1 > now() - interval '20 seconds'
    order by created_at limit 1 for update skip locked;
  if d.id is not null and lower(d.p1) = lower(nm) then return json_build_object('r', 'taken'); end if;
  if d.id is not null then
    update bd_duels set p2 = nm, h2 = bd_conn(), seen2 = now(), status = 'pick', turn = 1,
      reveal_until = now() + interval '4 seconds', ends_at = now() + interval '19 seconds' where id = d.id returning * into d;
    return json_build_object('r', 'ok', 'game', d.id, 'token', d.t2, 'name', nm);
  end if;
  if rm <> 'public' and exists (select 1 from bd_duels where room = rm and status in ('pick', 'double') and created_at > now() - interval '1 hour') then
    return json_build_object('r', 'running', 'game', (select id from bd_duels where room = rm and status in ('pick', 'double') order by created_at desc limit 1));
  end if;
  why := bd_room_ok(); if why is not null then return json_build_object('r', why); end if;
  update bd_duels set status = 'over', why = 'left' where room = rm and status = 'wait';
  insert into bd_duels (room, p1, h1) values (rm, nm, bd_conn()) returning * into d;
  return json_build_object('r', 'ok', 'game', d.id, 'token', d.t1, 'name', nm);
end $$;

-- what you can see: your own pick, only whether the other one has picked. No token = spectator.
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
    'picked1', d.pick1 is not null, 'picked2', d.pick2 is not null,
    'mine', case me when 1 then d.pick1 when 2 then d.pick2 end,
    'stake', d.stake, 'dbl1', d.dbl1, 'dbl2', d.dbl2, 'dbl_by', d.dbl_by, 'winner', d.winner, 'why', d.why, 'last', d.last,
    'left', case when d.ends_at is null then null else greatest(0, extract(epoch from d.ends_at - now())) end,
    'reveal', case when d.reveal_until is null then 0 else greatest(0, extract(epoch from d.reveal_until - now())) end,
    'on1', d.seen1 > now() - interval '15 seconds', 'on2', d.seen2 > now() - interval '15 seconds',
    'practice', d.h1 is not distinct from d.h2 and d.h1 is not null);
end $$;

create or replace function bd_pick(p_game uuid, p_tok uuid, p_move text) returns json
language plpgsql security definer set search_path = public as $$
declare d bd_duels; me int; mp int;
begin
  perform rl_check('bd_pick', 60, 60);
  perform bd_tick(p_game);
  select * into d from bd_duels where id = p_game for update;
  if d.id is null then return json_build_object('r', 'gone'); end if;
  me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end;
  if me = 0 then return json_build_object('r', 'gone'); end if;
  if d.status <> 'pick' or d.reveal_until > now() then return json_build_object('r', 'late'); end if;
  if p_move not in ('bonk', 'heavy', 'shield', 'dodge', 'charge') then return json_build_object('r', 'move'); end if;
  mp := case me when 1 then d.en1 else d.en2 end;
  if bd_cost(p_move) > mp then return json_build_object('r', 'mp'); end if;
  if me = 1 then update bd_duels set pick1 = p_move where id = p_game; else update bd_duels set pick2 = p_move where id = p_game; end if;
  if (me = 1 and d.pick2 is not null) or (me = 2 and d.pick1 is not null) then perform bd_resolve(p_game); end if;
  return json_build_object('r', 'ok');
end $$;

create or replace function bd_double(p_game uuid, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare d bd_duels; me int;
begin
  perform rl_check('bd_double', 20, 60);
  perform bd_tick(p_game);
  select * into d from bd_duels where id = p_game for update;
  me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end;
  if me = 0 or d.status <> 'pick' or d.reveal_until > now() or d.ends_at < now() + interval '2 seconds' then return json_build_object('r', 'no'); end if;
  if (me = 1 and d.dbl1) or (me = 2 and d.dbl2) then return json_build_object('r', 'used'); end if;
  update bd_duels set status = 'double', dbl_by = me, paused = greatest(ends_at - now(), interval '5 seconds'),
    ends_at = now() + interval '10 seconds', dbl1 = dbl1 or me = 1, dbl2 = dbl2 or me = 2 where id = p_game;
  return json_build_object('r', 'ok');
end $$;

create or replace function bd_answer(p_game uuid, p_tok uuid, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare d bd_duels; me int;
begin
  perform rl_check('bd_answer', 20, 60);
  select * into d from bd_duels where id = p_game for update;
  me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end;
  if me = 0 or d.status <> 'double' or d.dbl_by = me then return json_build_object('r', 'no'); end if;
  if p_accept then
    update bd_duels set status = 'pick', stake = stake * 2, dbl_by = null, ends_at = now() + coalesce(paused, interval '15 seconds') where id = p_game;
  else
    perform bd_finish(p_game, d.dbl_by, 'flee');
  end if;
  return json_build_object('r', 'ok');
end $$;

create or replace function bd_leave(p_game uuid, p_tok uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d bd_duels; me int;
begin
  perform rl_check('bd_leave', 20, 60);
  select * into d from bd_duels where id = p_game for update;
  me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end;
  if me = 0 or d.status = 'over' then return; end if;
  if d.status = 'wait' then update bd_duels set status = 'over', why = 'left' where id = p_game; return; end if;
  perform bd_finish(p_game, 3 - me, 'left');
end $$;

-- duels happening right now in the public queue, for spectators
create or replace function bd_live() returns json
language sql security definer set search_path = public as $$
  select rl_check('bd_live', 30, 60);
  select coalesce(json_agg(json_build_object('id', id, 'p1', p1, 'p2', p2, 'hp1', hp1, 'hp2', hp2, 'turn', turn, 'stake', stake) order by created_at desc), '[]')
  from bd_duels where status in ('pick', 'double') and room = 'public' and greatest(seen1, seen2) > now() - interval '30 seconds';
$$;

revoke all on function bd_conn(), bd_cost(text), bd_hit(text, text), bd_finish(uuid, int, text), bd_resolve(uuid), bd_tick(uuid), bd_room_ok(),
  bd_join(text, text, uuid), bd_state(uuid, uuid), bd_pick(uuid, uuid, text), bd_double(uuid, uuid), bd_answer(uuid, uuid, boolean),
  bd_leave(uuid, uuid), bd_live() from public, anon, authenticated;
grant execute on function bd_join(text, text, uuid), bd_state(uuid, uuid), bd_pick(uuid, uuid, text), bd_double(uuid, uuid),
  bd_answer(uuid, uuid, boolean), bd_leave(uuid, uuid), bd_live() to anon;
select 'bonk duel ready' as done;
