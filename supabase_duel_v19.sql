-- Bonk Duel v5: Ludibrium's rule is now "The Clock Strikes": on turns 4, 8, 12, 16 and 20 both players' MP refills
-- to full (simulated: classes 47-55% there, spam still loses). Turns are 15 seconds on every map again.

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
  -- Teleport zaps back for 1 when it dodged an attack
  if m1 = 'teleport' and m2 in ('bonk', 'heavy', 'arrow', 'steal', 'coin') then x2 := x2 + 1; end if;
  if m2 = 'teleport' and m1 in ('bonk', 'heavy', 'arrow', 'steal', 'coin') then x1 := x1 + 1; end if;
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
  regen := case when sd then 2 else 1 end;
  e1 := d.en1 - bd_cost(m1, d.class1, d.map) + regen
        + case when m1 = 'charge' and m2 <> 'steal' then 2 else 0 end + case when m2 = 'charge' and m1 = 'steal' then 2 else 0 end
        + case when m1 = 'shield' and m2 in ('bonk', 'steal') then 1 else 0 end;
  e2 := d.en2 - bd_cost(m2, d.class2, d.map) + regen
        + case when m2 = 'charge' and m1 <> 'steal' then 2 else 0 end + case when m1 = 'charge' and m2 = 'steal' then 2 else 0 end
        + case when m2 = 'shield' and m1 in ('bonk', 'steal') then 1 else 0 end;
  -- Ludibrium: the clock tower strikes every 4th turn and both players' MP refills
  if d.map = 'ludi' and (d.turn + 1) % 4 = 0 then e1 := d.enmax1; e2 := d.enmax2; end if;
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

create or replace function bd_join(p_room text, p_name text, p_tok uuid, p_class text) returns json
language plpgsql security definer set search_path = public as $$
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20); nm text := left(trim(coalesce(p_name, '')), 20);
        cls text := case when p_class in ('warrior', 'magician', 'bowman', 'thief', 'pirate') then p_class else 'warrior' end;
        d bd_duels; why text; mp text; secret int := 20 + floor(random() * 21)::int;   -- Sleepywood: same hidden HP for both (20-40)
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
      secs = 15,
      hp1 = case when mp = 'sleepy' then secret when class1 = 'warrior' then 22 when class1 = 'pirate' then 21 else 20 end,
      hpmax1 = case when mp = 'sleepy' then secret when class1 = 'warrior' then 22 when class1 = 'pirate' then 21 else 20 end,
      hp2 = case when mp = 'sleepy' then secret when cls = 'warrior' then 22 when cls = 'pirate' then 21 else 20 end,
      hpmax2 = case when mp = 'sleepy' then secret when cls = 'warrior' then 22 when cls = 'pirate' then 21 else 20 end,
      en1 = case when class1 = 'magician' then 4 else 3 end, enmax1 = case when class1 = 'magician' then 6 else 5 end,
      en2 = case when cls = 'magician' then 4 else 3 end, enmax2 = case when cls = 'magician' then 6 else 5 end,
      reveal_until = now() + interval '5 seconds',
      ends_at = now() + interval '5 seconds' + make_interval(secs => 15)
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

select 'bonk duel v5 ready' as done;
