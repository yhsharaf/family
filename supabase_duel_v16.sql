-- Bonk Duel v2: classes, map rules, critical taps and longer duels (20 HP, sudden death from turn 10, 20 turns max).
-- Classes (picked before the duel; each has a passive and a skill = the 6th move):
--   warrior  24 HP                       · Rage (1 MP): blocks a Bonk, and your next hit does +2
--   magician starts with 4 MP, max 6     · Teleport (2 MP): nothing can hit you this turn
--   bowman   bigger critical-tap window  · Arrow Rain (2 MP): 2 damage that can't be blocked or dodged
--   thief    Dodge is free               · Steal (1 MP): 1 damage; if they drink an Elixir, you get their +2 MP
--   pirate   survives one K.O. with 1 HP · Lucky Shot (2 MP): coin flip, 5 damage or nothing
-- Maps (random each duel): henesys (normal) · elnath (Dodge is free) · zakum (every hit +1)
--   · ludi (8 second turns) · sleepy (both get the same random 25-40 HP and nobody can see it; the page hides it)
alter table bd_duels add column if not exists class1 text not null default 'warrior';
alter table bd_duels add column if not exists class2 text not null default 'warrior';
alter table bd_duels add column if not exists map text not null default 'henesys';
alter table bd_duels add column if not exists secs int not null default 15;
alter table bd_duels add column if not exists hpmax1 int not null default 20;
alter table bd_duels add column if not exists hpmax2 int not null default 20;
alter table bd_duels add column if not exists enmax1 int not null default 5;
alter table bd_duels add column if not exists enmax2 int not null default 5;
alter table bd_duels add column if not exists rage1 boolean not null default false;
alter table bd_duels add column if not exists rage2 boolean not null default false;
alter table bd_duels add column if not exists lucky1 boolean not null default false;
alter table bd_duels add column if not exists lucky2 boolean not null default false;
alter table bd_duels alter column hp1 set default 20;
alter table bd_duels alter column hp2 set default 20;

create or replace function bd_skill(cls text) returns text language sql immutable as $$
  select case cls when 'warrior' then 'rage' when 'magician' then 'teleport' when 'bowman' then 'arrow'
    when 'thief' then 'steal' when 'pirate' then 'coin' end
$$;

drop function if exists bd_cost(text);
create or replace function bd_cost(m text, cls text, mp text) returns int language sql immutable as $$
  select case m when 'bonk' then 1 when 'heavy' then 3
    when 'dodge' then case when mp = 'elnath' or cls = 'thief' then 0 else 1 end
    when 'rage' then 1 when 'teleport' then 2 when 'arrow' then 2 when 'steal' then 1 when 'coin' then 2 else 0 end
$$;

-- damage that move `a` does to someone who picked `b` (heads = the Lucky Shot coin)
drop function if exists bd_hit(text, text);
create or replace function bd_hit(a text, b text, heads boolean) returns int language sql immutable as $$
  select case
    when b = 'teleport' then 0
    when a = 'bonk' then case when b in ('shield', 'rage') then 0 else 2 end
    when a = 'heavy' then case when b = 'dodge' then 0 else 4 end
    when a = 'arrow' then 2
    when a = 'coin' then case when heads then 5 else 0 end
    when a = 'steal' then case when b in ('shield', 'rage') then 0 else 1 end
    else 0 end
$$;

create or replace function bd_resolve(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d bd_duels; m1 text; m2 text; hd1 boolean := false; hd2 boolean := false; x1 int; x2 int; sd boolean;
        e1 int; e2 int; regen int; r1 boolean; r2 boolean; l1 boolean := false; l2 boolean := false;
begin
  select * into d from bd_duels where id = g for update;
  -- only once per turn: the clock ran out, or both picked (two polls arriving together must not resolve twice)
  if d.status <> 'pick' or (d.ends_at > now() and (d.pick1 is null or d.pick2 is null)) then return; end if;
  m1 := coalesce(d.pick1, 'zzz'); m2 := coalesce(d.pick2, 'zzz');
  if m1 = 'skill' then m1 := bd_skill(d.class1); end if;
  if m2 = 'skill' then m2 := bd_skill(d.class2); end if;
  if m1 = 'coin' then hd1 := random() < 0.5; end if;
  if m2 = 'coin' then hd2 := random() < 0.5; end if;
  sd := d.turn >= 10;
  x1 := bd_hit(m2, m1, hd2); x2 := bd_hit(m1, m2, hd1);          -- x1 = damage TO player 1
  if m1 = 'dodge' and m2 = 'heavy' then x2 := x2 + 3; end if;    -- dodge counters a heavy
  if m2 = 'dodge' and m1 = 'heavy' then x1 := x1 + 3; end if;
  if x1 > 0 and m1 in ('charge', 'zzz') then x1 := x1 + 1; end if;
  if x2 > 0 and m2 in ('charge', 'zzz') then x2 := x2 + 1; end if;
  r1 := d.rage1; r2 := d.rage2;                                   -- a stored Rage powers up the next hit
  if x2 > 0 and r1 then x2 := x2 + 2; r1 := false; end if;
  if x1 > 0 and r2 then x1 := x1 + 2; r2 := false; end if;
  if m1 = 'rage' then r1 := true; end if;
  if m2 = 'rage' then r2 := true; end if;
  if sd and x1 > 0 then x1 := x1 + 1; end if;
  if sd and x2 > 0 then x2 := x2 + 1; end if;
  if d.map = 'zakum' and x1 > 0 then x1 := x1 + 1; end if;
  if d.map = 'zakum' and x2 > 0 then x2 := x2 + 1; end if;
  -- Pirate: survives the first K.O. with 1 HP
  if d.class1 = 'pirate' and not d.lucky1 and x1 > 0 and d.hp1 - x1 <= 0 then x1 := d.hp1 - 1; l1 := true; end if;
  if d.class2 = 'pirate' and not d.lucky2 and x2 > 0 and d.hp2 - x2 <= 0 then x2 := d.hp2 - 1; l2 := true; end if;
  regen := case when sd then 2 else 1 end;
  e1 := d.en1 - bd_cost(m1, d.class1, d.map) + regen
        + case when m1 = 'charge' and m2 <> 'steal' then 2 else 0 end + case when m2 = 'charge' and m1 = 'steal' then 2 else 0 end
        + case when m1 = 'shield' and m2 in ('bonk', 'steal') then 1 else 0 end;
  e2 := d.en2 - bd_cost(m2, d.class2, d.map) + regen
        + case when m2 = 'charge' and m1 <> 'steal' then 2 else 0 end + case when m1 = 'charge' and m2 = 'steal' then 2 else 0 end
        + case when m2 = 'shield' and m1 in ('bonk', 'steal') then 1 else 0 end;
  update bd_duels set hp1 = greatest(0, hp1 - x1), hp2 = greatest(0, hp2 - x2),
    en1 = least(enmax1, greatest(0, e1)), en2 = least(enmax2, greatest(0, e2)),
    rage1 = r1, rage2 = r2, lucky1 = lucky1 or l1, lucky2 = lucky2 or l2,
    afk1 = case when m1 = 'zzz' then afk1 + 1 else 0 end, afk2 = case when m2 = 'zzz' then afk2 + 1 else 0 end,
    pick1 = null, pick2 = null, turn = turn + 1,
    last = json_build_object('turn', d.turn, 'm1', m1, 'm2', m2, 'd1', x1, 'd2', x2, 'sd', sd,
                             'h1', hd1, 'h2', hd2, 'l1', l1, 'l2', l2),
    reveal_until = now() + interval '4 seconds', ends_at = now() + interval '4 seconds' + make_interval(secs => d.secs)
  where id = g returning * into d;
  insert into bd_rounds values (g, d.turn - 1, m1, m2, x1, x2, d.hp1, d.hp2) on conflict do nothing;
  if d.hp1 = 0 or d.hp2 = 0 then
    perform bd_finish(g, case when d.hp1 = d.hp2 then 0 when d.hp1 > d.hp2 then 1 else 2 end, case when d.hp1 = d.hp2 then 'draw' else 'ko' end);
  elsif d.afk1 >= 3 and d.afk2 >= 3 then perform bd_finish(g, 0, 'afk');
  elsif d.afk1 >= 3 then perform bd_finish(g, 2, 'afk');
  elsif d.afk2 >= 3 then perform bd_finish(g, 1, 'afk');
  elsif d.turn > 20 then
    perform bd_finish(g, case when d.hp1 = d.hp2 then 0 when d.hp1 > d.hp2 then 1 else 2 end, 'time');
  end if;
end $$;

-- critical tap: tapped the shrinking ring in time after your hit landed -> +1 damage (once per turn, only during the reveal)
create or replace function bd_crit(p_game uuid, p_tok uuid, p_turn int) returns json
language plpgsql security definer set search_path = public as $$
declare d bd_duels; me int; o int; mine text; theirs text; dealt int; hp int;
begin
  perform rl_check('bd_crit', 30, 60);
  select * into d from bd_duels where id = p_game for update;
  me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end;
  if me = 0 or d.status <> 'pick' or d.last is null or (d.last ->> 'turn')::int <> p_turn
     or now() > d.reveal_until + interval '1 second' or coalesce((d.last ->> ('c' || me))::boolean, false) then
    return json_build_object('r', 'no');
  end if;
  o := 3 - me;
  mine := d.last ->> ('m' || me); theirs := d.last ->> ('m' || o); dealt := (d.last ->> ('d' || o))::int;
  if dealt <= 0 or not (mine in ('bonk', 'heavy', 'arrow', 'steal', 'coin') or (mine = 'dodge' and theirs = 'heavy')) then
    return json_build_object('r', 'no');
  end if;
  if o = 1 then update bd_duels set hp1 = greatest(0, hp1 - 1) where id = p_game returning hp1 into hp;
  else update bd_duels set hp2 = greatest(0, hp2 - 1) where id = p_game returning hp2 into hp; end if;
  update bd_duels set last = (last::jsonb || jsonb_build_object('c' || me, true))::json where id = p_game;
  if hp = 0 then perform bd_finish(p_game, me, 'ko'); end if;
  return json_build_object('r', 'ok');
end $$;

drop function if exists bd_join(text, text, uuid);
create or replace function bd_join(p_room text, p_name text, p_tok uuid, p_class text) returns json
language plpgsql security definer set search_path = public as $$
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20); nm text := left(trim(coalesce(p_name, '')), 20);
        cls text := case when p_class in ('warrior', 'magician', 'bowman', 'thief', 'pirate') then p_class else 'warrior' end;
        d bd_duels; why text; mp text; secret int := 25 + floor(random() * 16)::int;   -- Sleepywood: same hidden HP for both
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
    mp := (array['henesys', 'elnath', 'zakum', 'ludi', 'sleepy'])[1 + floor(random() * 5)::int];
    update bd_duels set p2 = nm, h2 = bd_conn(), seen2 = now(), status = 'pick', turn = 1, class2 = cls, map = mp,
      secs = case when mp = 'ludi' then 8 else 15 end,
      hp1 = case when mp = 'sleepy' then secret when class1 = 'warrior' then 24 else 20 end,
      hpmax1 = case when mp = 'sleepy' then secret when class1 = 'warrior' then 24 else 20 end,
      hp2 = case when mp = 'sleepy' then secret when cls = 'warrior' then 24 else 20 end,
      hpmax2 = case when mp = 'sleepy' then secret when cls = 'warrior' then 24 else 20 end,
      en1 = case when class1 = 'magician' then 4 else 3 end, enmax1 = case when class1 = 'magician' then 6 else 5 end,
      en2 = case when cls = 'magician' then 4 else 3 end, enmax2 = case when cls = 'magician' then 6 else 5 end,
      reveal_until = now() + interval '5 seconds',
      ends_at = now() + interval '5 seconds' + make_interval(secs => case when mp = 'ludi' then 8 else 15 end)
    where id = d.id returning * into d;
    return json_build_object('r', 'ok', 'game', d.id, 'token', d.t2, 'name', nm);
  end if;
  if rm <> 'public' and exists (select 1 from bd_duels where room = rm and status in ('pick', 'double') and created_at > now() - interval '1 hour') then
    return json_build_object('r', 'running', 'game', (select id from bd_duels where room = rm and status in ('pick', 'double') order by created_at desc limit 1));
  end if;
  why := bd_room_ok(); if why is not null then return json_build_object('r', why); end if;
  update bd_duels set status = 'over', why = 'left' where room = rm and status = 'wait';
  insert into bd_duels (room, p1, h1, class1) values (rm, nm, bd_conn(), cls) returning * into d;
  return json_build_object('r', 'ok', 'game', d.id, 'token', d.t1, 'name', nm);
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
declare d bd_duels; me int; mp int; mv text; cls text;
begin
  perform rl_check('bd_pick', 60, 60);
  perform bd_tick(p_game);
  select * into d from bd_duels where id = p_game for update;
  if d.id is null then return json_build_object('r', 'gone'); end if;
  me := case when d.t1 = p_tok then 1 when d.t2 = p_tok then 2 else 0 end;
  if me = 0 then return json_build_object('r', 'gone'); end if;
  if d.status <> 'pick' or d.reveal_until > now() then return json_build_object('r', 'late'); end if;
  if p_move not in ('bonk', 'heavy', 'shield', 'dodge', 'charge', 'skill') then return json_build_object('r', 'move'); end if;
  cls := case me when 1 then d.class1 else d.class2 end;
  mv := case when p_move = 'skill' then bd_skill(cls) else p_move end;
  mp := case me when 1 then d.en1 else d.en2 end;
  if bd_cost(mv, cls, d.map) > mp then return json_build_object('r', 'mp'); end if;
  if me = 1 then update bd_duels set pick1 = p_move where id = p_game; else update bd_duels set pick2 = p_move where id = p_game; end if;
  if (me = 1 and d.pick2 is not null) or (me = 2 and d.pick1 is not null) then perform bd_resolve(p_game); end if;
  return json_build_object('r', 'ok');
end $$;

create or replace function bd_live() returns json
language sql security definer set search_path = public as $$
  select rl_check('bd_live', 30, 60);
  select coalesce(json_agg(json_build_object('id', id, 'p1', p1, 'p2', p2, 'hp1', hp1, 'hp2', hp2, 'turn', turn, 'stake', stake,
    'map', map, 'class1', class1, 'class2', class2) order by created_at desc), '[]')
  from bd_duels where status in ('pick', 'double') and room = 'public' and greatest(seen1, seen2) > now() - interval '30 seconds';
$$;

revoke all on function bd_skill(text), bd_cost(text, text, text), bd_hit(text, text, boolean), bd_resolve(uuid), bd_crit(uuid, uuid, int),
  bd_join(text, text, uuid, text), bd_state(uuid, uuid), bd_pick(uuid, uuid, text), bd_live() from public, anon, authenticated;
grant execute on function bd_crit(uuid, uuid, int), bd_join(text, text, uuid, text), bd_state(uuid, uuid), bd_pick(uuid, uuid, text), bd_live() to anon;
select 'bonk duel v2 ready' as done;
