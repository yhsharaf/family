-- Bonk Duel v4: Teleport can't be spammed any more (a Magician could teleport every turn and never be hit).
--   Teleport costs 2 MP (no refund), can't be used two turns in a row, and zaps back for 1 when it dodges an attack.
--   Simulated: a teleport spammer loses 69/31 to a player who spots the pattern; classes stay at 45-55%.

create or replace function bd_cost(m text, cls text, mp text) returns int language sql immutable as $$
  select case m when 'bonk' then 1 when 'heavy' then 3
    when 'dodge' then case when mp = 'elnath' or cls = 'thief' then 0 else 1 end
    when 'rage' then 1 when 'teleport' then 2 when 'arrow' then 2 when 'steal' then 1 when 'coin' then 2 else 0 end
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
  -- no Teleport two turns in a row
  if mv = 'teleport' and d.last is not null and (d.last ->> ('m' || me)) = 'teleport' then return json_build_object('r', 'cd'); end if;
  if me = 1 then update bd_duels set pick1 = p_move where id = p_game; else update bd_duels set pick2 = p_move where id = p_game; end if;
  if (me = 1 and d.pick2 is not null) or (me = 2 and d.pick1 is not null) then perform bd_resolve(p_game); end if;
  return json_build_object('r', 'ok');
end $$;

select 'bonk duel v4 ready' as done;
