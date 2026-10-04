-- Bonk Duel 2v2. Four players, two teams (slots 1+3 vs 2+4). Everyone picks a move AND a target in secret.
--   attacks (bonk, heavy, arrow, steal, coin) pick an enemy · shield picks yourself or your teammate (blocks a bonk/steal/coin aimed at them)
--   combo: both teammates land an attack on the same enemy -> +1 each · revive (3 MP, once per team): a knocked-out teammate comes back with 5 HP
--   classes, maps (El Nath free dodge, Zakum arm slam on one player per team, Ludibrium clock, Sleepywood secret HP), crit taps and the
--   Professor's quick sum all work like 1v1. Winning team: every guild member on it gets +1 win and +1 point in bd_scores.
create table if not exists bt_games (
  id uuid primary key default gen_random_uuid(),
  room text not null check (char_length(room) <= 20),
  status text not null default 'wait',          -- wait | pick | over
  host text,
  turn int not null default 0, map text not null default 'henesys', secs int not null default 15,
  ends_at timestamptz, reveal_until timestamptz, last json,
  arm1 int not null default 0, arm2 int not null default 0,   -- slot Zakum's arm aims at, per team
  armn1 int not null default 0, armn2 int not null default 0, -- whose turn it is next within each team (alternates)
  revived1 boolean not null default false, revived2 boolean not null default false,
  winner int, why text,
  key1 text not null default replace(gen_random_uuid()::text, '-', ''), key2 text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(), seen_at timestamptz not null default now()
);
create table if not exists bt_players (
  game_id uuid not null references bt_games(id) on delete cascade,
  slot int not null check (slot between 1 and 4),
  name text not null check (char_length(name) between 2 and 20),
  token uuid not null default gen_random_uuid() unique,
  class text not null default 'warrior',
  hp int not null default 20, hpmax int not null default 20, en int not null default 3, enmax int not null default 5,
  rage boolean not null default false, afk int not null default 0, alive boolean not null default true,
  pick text, target int,
  seen timestamptz not null default now(), conn text,
  primary key (game_id, slot)
);
create index if not exists bt_games_room on bt_games (room, created_at desc);
alter table bt_games enable row level security; alter table bt_players enable row level security;
revoke all on bt_games, bt_players from anon, authenticated;

-- revive costs 3 MP (only used in 2v2)
create or replace function bd_cost(m text, cls text, mp text) returns int language sql immutable as $$
  select case m when 'bonk' then 1 when 'heavy' then 3
    when 'dodge' then case when mp = 'elnath' or cls = 'thief' then 0 else 1 end
    when 'rage' then 1 when 'teleport' then 2 when 'arrow' then 2 when 'steal' then 1 when 'coin' then 2 when 'revive' then 3 else 0 end
$$;

create or replace function bt_team(s int) returns int language sql immutable as $$ select case when s in (1, 3) then 1 else 2 end $$;
create or replace function bt_mate(s int) returns int language sql immutable as $$ select case s when 1 then 3 when 3 then 1 when 2 then 4 else 2 end $$;

create or replace function bt_finish(g uuid, win int, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare gm bt_games;
begin
  update bt_games set status = 'over', winner = win, why = reason, ends_at = null where id = g and status <> 'over' returning * into gm;
  if gm.id is null or gm.turn < 1 then return; end if;
  insert into bd_scores as s (player, duels, wins, points)
    select p.name, 1, (bt_team(p.slot) = win)::int, (bt_team(p.slot) = win)::int
    from bt_players p where p.game_id = g and exists (select 1 from draw_guild dg where dg.name = p.name)
  on conflict (player) do update set duels = s.duels + 1, wins = s.wins + excluded.wins, points = s.points + excluded.points;
end $$;

-- start: 4 players, deal map / HP / MP, first turn
create or replace function bt_begin(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mp text := (array['henesys', 'elnath', 'zakum', 'ludi', 'sleepy'])[1 + floor(random() * 5)::int];
        secret int := 20 + floor(random() * 21)::int;
begin
  update bt_players set
    hp = case when mp = 'sleepy' then secret when class = 'warrior' then 22 when class = 'pirate' then 21 else 20 end,
    hpmax = case when mp = 'sleepy' then secret when class = 'warrior' then 22 when class = 'pirate' then 21 else 20 end,
    en = case when class = 'magician' then 4 else 3 end, enmax = case when class = 'magician' then 6 else 5 end,
    rage = false, afk = 0, alive = true, pick = null, target = null
  where game_id = g;
  update bt_games set status = 'pick', turn = 1, map = mp, secs = 15, last = null, winner = null, why = null,
    arm1 = 0, arm2 = 0, armn1 = case when random() < .5 then 1 else 3 end, armn2 = case when random() < .5 then 2 else 4 end,
    revived1 = false, revived2 = false, reveal_until = now() + interval '5 seconds', ends_at = now() + interval '20 seconds', seen_at = now()
  where id = g;
end $$;

create or replace function bt_resolve(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare gm bt_games; p bt_players;
  al boolean[] := array[false,false,false,false]; cl text[] := array['','','','']; hpa int[] := array[0,0,0,0]; ena int[] := array[0,0,0,0];
  em int[] := array[5,5,5,5]; rg boolean[] := array[false,false,false,false]; af int[] := array[0,0,0,0];
  mv text[] := array['none','none','none','none']; tg int[] := array[0,0,0,0]; hd boolean[] := array[false,false,false,false];
  dmg int[] := array[0,0,0,0]; hit int[] := array[0,0,0,0]; stolen int[] := array[0,0,0,0]; blocked boolean[] := array[false,false,false,false];
  combo boolean[] := array[false,false,false,false]; armhit boolean[] := array[false,false,false,false]; rev int[] := array[0,0,0,0];
  s int; t int; a int; m text; tm text; base int; prot boolean; sd boolean; regen int; e int; alive1 int; alive2 int; hp1 int; hp2 int;
  info json[] := array[]::json[]; nxt int; rv1 boolean; rv2 boolean;
begin
  select * into gm from bt_games where id = g for update;
  if gm.status <> 'pick' then return; end if;
  if gm.ends_at > now() and exists (select 1 from bt_players where game_id = g and alive and pick is null) then return; end if;
  for p in select * from bt_players where game_id = g order by slot loop
    s := p.slot; al[s] := p.alive; cl[s] := p.class; hpa[s] := p.hp; ena[s] := p.en; em[s] := p.enmax; rg[s] := p.rage; af[s] := p.afk;
    if p.alive then
      mv[s] := coalesce(p.pick, 'zzz'); tg[s] := coalesce(p.target, 0);
      if mv[s] = 'skill' then mv[s] := bd_skill(p.class); end if;
      if mv[s] = 'coin' then hd[s] := random() < 0.5; end if;
    end if;
  end loop;
  sd := gm.turn >= 10;
  -- attacks: if the chosen enemy is already down, swing at the other one
  for a in 1..4 loop
    m := mv[a];
    if not al[a] or m not in ('bonk', 'heavy', 'arrow', 'steal', 'coin') then continue; end if;
    t := tg[a];
    if t not in (1, 2, 3, 4) or bt_team(t) = bt_team(a) or not al[t] then
      t := case when bt_team(a) = 1 then (case when al[2] then 2 else 4 end) else (case when al[1] then 1 else 3 end) end;
      tg[a] := t;
    end if;
    tm := mv[t];
    -- protected by their own Shield, or their teammate's Shield aimed at them
    prot := (tm = 'shield' and tg[t] = t) or (al[bt_mate(t)] and mv[bt_mate(t)] = 'shield' and tg[bt_mate(t)] = t);
    base := case
      when tm = 'teleport' then 0
      when m = 'bonk' then case when prot or tm = 'rage' then 0 else 2 end
      when m = 'heavy' then case when tm = 'dodge' then 0 else 4 end
      when m = 'arrow' then 3
      when m = 'coin' then case when prot then 0 when hd[a] then 4 else 0 end
      when m = 'steal' then case when prot or tm = 'rage' then 0 else 2 end
      else 0 end;
    if prot and m in ('bonk', 'steal', 'coin') then blocked[t] := true; end if;
    if base > 0 and tm in ('charge', 'zzz') then base := base + 1; end if;
    if base > 0 and rg[a] then base := base + 2; rg[a] := false; end if;
    if base > 0 and sd then base := base + 1; end if;
    hit[a] := base; dmg[t] := dmg[t] + base;
    if tm = 'dodge' and m = 'heavy' then dmg[a] := dmg[a] + 3; end if;      -- dodge counters a heavy
    if tm = 'teleport' then dmg[a] := dmg[a] + 1; end if;                     -- teleport zaps the attacker
    if m = 'steal' and tm = 'charge' then stolen[t] := a; end if;
  end loop;
  -- combo: both teammates landed an attack on the same enemy
  for a in 1..2 loop
    s := bt_mate(a);
    if hit[a] > 0 and hit[s] > 0 and tg[a] = tg[s] then dmg[tg[a]] := dmg[tg[a]] + 2; combo[a] := true; combo[s] := true; end if;
  end loop;
  -- Zakum's arm
  if gm.arm1 > 0 and al[gm.arm1] and mv[gm.arm1] not in ('shield', 'dodge', 'teleport') then dmg[gm.arm1] := dmg[gm.arm1] + 4; armhit[gm.arm1] := true; end if;
  if gm.arm2 > 0 and al[gm.arm2] and mv[gm.arm2] not in ('shield', 'dodge', 'teleport') then dmg[gm.arm2] := dmg[gm.arm2] + 4; armhit[gm.arm2] := true; end if;
  -- MP, rage, AFK
  regen := case when sd then 2 else 1 end;
  for s in 1..4 loop
    if not al[s] then continue; end if;
    e := ena[s] - bd_cost(mv[s], cl[s], gm.map) + regen
         + case when mv[s] = 'charge' and stolen[s] = 0 then 2 else 0 end
         + (select count(*)::int * 2 from generate_series(1, 4) x where stolen[x] = s)
         + case when mv[s] = 'shield' and (blocked[s] or (tg[s] = bt_mate(s) and blocked[bt_mate(s)])) then 1 else 0 end;
    if gm.map = 'ludi' and (gm.turn + 1) % 4 = 0 then e := em[s]; end if;
    ena[s] := least(em[s], greatest(0, e));
    if mv[s] = 'rage' then rg[s] := true; end if;
    af[s] := case when mv[s] = 'zzz' then af[s] + 1 else 0 end;
  end loop;
  -- apply damage
  for s in 1..4 loop
    if not al[s] then continue; end if;
    hpa[s] := greatest(0, hpa[s] - dmg[s]);
    if hpa[s] = 0 or af[s] >= 3 then al[s] := false; hpa[s] := 0; end if;
  end loop;
  -- revive (after damage: the reviver must still be standing)
  rv1 := gm.revived1; rv2 := gm.revived2;
  for s in 1..4 loop
    t := bt_mate(s);
    if mv[s] = 'revive' and al[s] and not al[t] and hpa[t] = 0 and not (case when bt_team(s) = 1 then rv1 else rv2 end) then
      al[t] := true; hpa[t] := 5; af[t] := 0; rev[s] := t;
      if bt_team(s) = 1 then rv1 := true; else rv2 := true; end if;
    end if;
  end loop;
  for s in 1..4 loop
    update bt_players set hp = hpa[s], en = ena[s], rage = rg[s], afk = af[s], alive = al[s], pick = null, target = null where game_id = g and slot = s;
    info := info || json_build_object('slot', s, 'm', mv[s], 't', tg[s], 'd', dmg[s], 'hit', hit[s], 'h', hd[s], 'combo', combo[s], 'arm', armhit[s], 'rev', rev[s]);
  end loop;
  -- next turn's arm on Zakum: one player per team, taking turns
  update bt_games set turn = turn + 1, revived1 = rv1, revived2 = rv2,
    last = json_build_object('turn', gm.turn, 'sd', sd, 'p', array_to_json(info), 'arm1', gm.arm1, 'arm2', gm.arm2),
    arm1 = 0, arm2 = 0, reveal_until = now() + interval '4 seconds', ends_at = now() + interval '4 seconds' + make_interval(secs => gm.secs)
  where id = g returning * into gm;
  if gm.map = 'zakum' and gm.turn % 3 = 0 then
    nxt := case when al[gm.armn1] then gm.armn1 else bt_mate(gm.armn1) end;
    if al[nxt] then update bt_games set arm1 = nxt, armn1 = bt_mate(nxt) where id = g; end if;
    nxt := case when al[gm.armn2] then gm.armn2 else bt_mate(gm.armn2) end;
    if al[nxt] then update bt_games set arm2 = nxt, armn2 = bt_mate(nxt) where id = g; end if;
  end if;
  alive1 := (al[1])::int + (al[3])::int; alive2 := (al[2])::int + (al[4])::int;
  hp1 := hpa[1] + hpa[3]; hp2 := hpa[2] + hpa[4];
  if alive1 = 0 and alive2 = 0 then perform bt_finish(g, 0, 'draw');
  elsif alive1 = 0 then perform bt_finish(g, 2, 'ko');
  elsif alive2 = 0 then perform bt_finish(g, 1, 'ko');
  elsif gm.turn > 20 then perform bt_finish(g, case when hp1 = hp2 then 0 when hp1 > hp2 then 1 else 2 end, 'time');
  end if;
end $$;

create or replace function bt_tick(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare gm bt_games;
begin
  select * into gm from bt_games where id = g;
  if gm.id is null or gm.status = 'over' then return; end if;
  if gm.status = 'wait' then
    delete from bt_players where game_id = g and seen < now() - interval '40 seconds';
    if not exists (select 1 from bt_players where game_id = g) then update bt_games set status = 'over', why = 'left' where id = g; return; end if;
    if not exists (select 1 from bt_players where game_id = g and name = gm.host) then
      update bt_games set host = (select name from bt_players where game_id = g order by slot limit 1) where id = g;
    end if;
    return;
  end if;
  if gm.ends_at > now() then return; end if;
  select * into gm from bt_games where id = g for update;
  if gm.ends_at > now() then return; end if;
  perform bt_resolve(g);
end $$;

create or replace function bt_join(p_room text, p_name text, p_tok uuid, p_class text, p_quiz uuid, p_ans int) returns json
language plpgsql security definer set search_path = public as $$
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20); nm text := left(trim(coalesce(p_name, '')), 20);
        cls text := case when p_class in ('warrior', 'magician', 'bowman', 'thief', 'pirate') then p_class else 'warrior' end;
        gm bt_games; pl bt_players; n int; s int; qid uuid;
begin
  perform rl_check('bt_join', 30, 60);
  delete from bt_games where created_at < now() - interval '3 hours';
  if p_tok is not null then
    select p.* into pl from bt_players p join bt_games g on g.id = p.game_id where p.token = p_tok and g.status <> 'over';
    if pl.name is not null then
      update bt_players set seen = now() where token = p_tok;
      return json_build_object('r', 'ok', 'game', pl.game_id, 'token', pl.token, 'name', pl.name);
    end if;
    if nm = '' then return json_build_object('r', 'gone'); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  delete from bd_quiz where created_at < now() - interval '10 minutes';
  delete from bd_quiz q where q.id = p_quiz and q.ans = p_ans and q.created_at > now() - interval '5 minutes' returning q.id into qid;
  if qid is null then return json_build_object('r', 'quiz'); end if;
  -- a waiting room with a free slot (lock it so two joiners can't take the same slot)
  select * into gm from bt_games where room = rm and status = 'wait' and seen_at > now() - interval '60 seconds'
    order by created_at limit 1 for update skip locked;
  if gm.id is not null then
    delete from bt_players where game_id = gm.id and seen < now() - interval '40 seconds';
    if exists (select 1 from bt_players where game_id = gm.id and lower(name) = lower(nm)) then return json_build_object('r', 'taken'); end if;
    select count(*) into n from bt_players where game_id = gm.id;
    if n >= 4 then gm.id := null; end if;
  end if;
  if gm.id is null then
    if rm <> 'public' and exists (select 1 from bt_games where room = rm and status = 'pick' and created_at > now() - interval '1 hour') then
      return json_build_object('r', 'running');
    end if;
    if (select count(*) from bt_games where status <> 'over' and seen_at > now() - interval '1 minute') >= 10 then return json_build_object('r', 'busy'); end if;
    begin perform rl_check('bt_new', 6, 600); exception when sqlstate 'P0429' then return json_build_object('r', 'slow'); end;
    insert into bt_games (room, host) values (rm, nm) returning * into gm;
  end if;
  select min(x) into s from generate_series(1, 4) x where x not in (select slot from bt_players where game_id = gm.id);
  insert into bt_players (game_id, slot, name, class, conn) values (gm.id, s, nm, cls, bd_conn()) returning * into pl;
  update bt_games set seen_at = now(), host = coalesce((select name from bt_players where game_id = gm.id and name = gm.host), nm) where id = gm.id;
  -- the public queue starts by itself once 4 are in
  if rm = 'public' and (select count(*) from bt_players where game_id = gm.id) = 4 then perform bt_begin(gm.id); end if;
  return json_build_object('r', 'ok', 'game', gm.id, 'token', pl.token, 'name', nm);
end $$;

create or replace function bt_start(p_game uuid, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare gm bt_games; me bt_players;
begin
  perform rl_check('bt_start', 20, 60);
  select * into gm from bt_games where id = p_game for update;
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null or gm.status <> 'wait' or gm.host <> me.name then return json_build_object('r', 'no'); end if;
  if (select count(*) from bt_players where game_id = p_game) < 4 then return json_build_object('r', 'few'); end if;
  perform bt_begin(p_game);
  return json_build_object('r', 'ok');
end $$;

-- host: mix the teams up before starting
create or replace function bt_shuffle(p_game uuid, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare gm bt_games; me bt_players;
begin
  perform rl_check('bt_shuffle', 20, 60);
  select * into gm from bt_games where id = p_game for update;
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null or gm.status <> 'wait' or gm.host <> me.name then return json_build_object('r', 'no'); end if;
  with old as (delete from bt_players where game_id = p_game returning *)
  insert into bt_players (game_id, slot, name, token, class, hp, hpmax, en, enmax, rage, afk, alive, pick, target, seen, conn)
    select game_id, row_number() over (order by random()), name, token, class, hp, hpmax, en, enmax, rage, afk, alive, pick, target, seen, conn from old;
  return json_build_object('r', 'ok');
end $$;

create or replace function bt_state(p_game uuid, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare gm bt_games; me bt_players;
begin
  perform rl_check('bt_state', 150, 60);
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  if me.seen < now() - interval '3 seconds' then update bt_players set seen = now() where game_id = p_game and slot = me.slot; end if;
  perform bt_tick(p_game);
  select * into gm from bt_games where id = p_game;
  if gm.seen_at < now() - interval '3 seconds' then update bt_games set seen_at = now() where id = p_game; end if;
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  return json_build_object('r', 'ok', 'me', me.slot, 'status', gm.status, 'room', gm.room, 'host', gm.host, 'turn', gm.turn, 'map', gm.map,
    'left', case when gm.ends_at is null then null else greatest(0, extract(epoch from gm.ends_at - now())) end,
    'reveal', case when gm.reveal_until is null then 0 else greatest(0, extract(epoch from gm.reveal_until - now())) end,
    'last', gm.last, 'winner', gm.winner, 'why', gm.why, 'arm1', gm.arm1, 'arm2', gm.arm2,
    'revived', case when bt_team(me.slot) = 1 then gm.revived1 else gm.revived2 end,
    'teamkey', case when bt_team(me.slot) = 1 then gm.key1 else gm.key2 end,
    'mine', me.pick, 'mytarget', me.target,
    'players', (select json_agg(json_build_object('slot', p.slot, 'name', p.name, 'class', p.class, 'team', bt_team(p.slot),
        'hp', case when gm.map = 'sleepy' and gm.status = 'pick' then null else p.hp end, 'hpmax', p.hpmax, 'en', p.en, 'enmax', p.enmax,
        'rage', p.rage, 'alive', p.alive, 'picked', p.pick is not null, 'online', p.seen > now() - interval '15 seconds') order by p.slot)
      from bt_players p where p.game_id = p_game));
end $$;

create or replace function bt_pick(p_game uuid, p_tok uuid, p_move text, p_target int) returns json
language plpgsql security definer set search_path = public as $$
declare gm bt_games; me bt_players; mv text; tgt int := p_target; mate bt_players;
begin
  perform rl_check('bt_pick', 60, 60);
  perform bt_tick(p_game);
  select * into gm from bt_games where id = p_game for update;
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  if gm.status <> 'pick' or gm.reveal_until > now() then return json_build_object('r', 'late'); end if;
  if not me.alive then return json_build_object('r', 'dead'); end if;
  if p_move not in ('bonk', 'heavy', 'shield', 'dodge', 'charge', 'skill', 'revive') then return json_build_object('r', 'move'); end if;
  mv := case when p_move = 'skill' then bd_skill(me.class) else p_move end;
  if bd_cost(mv, me.class, gm.map) > me.en then return json_build_object('r', 'mp'); end if;
  select * into mate from bt_players where game_id = p_game and slot = bt_mate(me.slot);
  if mv in ('bonk', 'heavy', 'arrow', 'steal', 'coin') then
    if tgt not in (1, 2, 3, 4) or bt_team(tgt) = bt_team(me.slot) then return json_build_object('r', 'target'); end if;
  elsif mv = 'shield' then
    if tgt is distinct from me.slot and tgt is distinct from mate.slot then tgt := me.slot; end if;
  elsif mv = 'revive' then
    if mate.alive or (case when bt_team(me.slot) = 1 then gm.revived1 else gm.revived2 end) then return json_build_object('r', 'revive'); end if;
    tgt := mate.slot;
  else tgt := null; end if;
  update bt_players set pick = p_move, target = tgt where game_id = p_game and slot = me.slot;
  if not exists (select 1 from bt_players where game_id = p_game and alive and pick is null) then perform bt_resolve(p_game); end if;
  return json_build_object('r', 'ok');
end $$;

-- critical tap: your attack landed on someone last turn -> +1 to them (once per turn, during the reveal)
create or replace function bt_crit(p_game uuid, p_tok uuid, p_turn int) returns json
language plpgsql security definer set search_path = public as $$
declare gm bt_games; me bt_players; info json; t int; nhp int;
begin
  perform rl_check('bt_crit', 40, 60);
  select * into gm from bt_games where id = p_game for update;
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null or gm.status <> 'pick' or gm.last is null or (gm.last ->> 'turn')::int <> p_turn or now() > gm.reveal_until + interval '1 second' then
    return json_build_object('r', 'no'); end if;
  info := (gm.last -> 'p') -> (me.slot - 1);
  if coalesce((info ->> 'crit')::boolean, false) or (info ->> 'hit')::int <= 0 then return json_build_object('r', 'no'); end if;
  t := (info ->> 't')::int;
  update bt_players set hp = greatest(0, hp - 1), alive = alive and hp - 1 > 0 where game_id = p_game and slot = t and alive returning bt_players.hp into nhp;
  if nhp is null then return json_build_object('r', 'no'); end if;
  update bt_games set last = jsonb_set(last::jsonb, array['p', (me.slot - 1)::text, 'crit'], 'true'::jsonb)::json where id = p_game;
  if not exists (select 1 from bt_players where game_id = p_game and alive and bt_team(slot) = bt_team(t)) then
    perform bt_finish(p_game, bt_team(me.slot), 'ko');
  end if;
  return json_build_object('r', 'ok');
end $$;

create or replace function bt_leave(p_game uuid, p_tok uuid) returns void
language plpgsql security definer set search_path = public as $$
declare gm bt_games; me bt_players;
begin
  perform rl_check('bt_leave', 20, 60);
  select * into gm from bt_games where id = p_game for update;
  select * into me from bt_players where game_id = p_game and token = p_tok;
  if me.name is null then return; end if;
  if gm.status = 'wait' then
    delete from bt_players where game_id = p_game and slot = me.slot;
    if gm.host = me.name then update bt_games set host = (select name from bt_players where game_id = p_game order by slot limit 1) where id = p_game; end if;
    return;
  end if;
  if gm.status = 'pick' and me.alive then
    update bt_players set alive = false, hp = 0 where game_id = p_game and slot = me.slot;
    if not exists (select 1 from bt_players where game_id = p_game and alive and bt_team(slot) = bt_team(me.slot)) then
      perform bt_finish(p_game, 3 - bt_team(me.slot), 'left');
    end if;
  end if;
end $$;

revoke all on function bt_team(int), bt_mate(int), bt_finish(uuid, int, text), bt_begin(uuid), bt_resolve(uuid), bt_tick(uuid),
  bt_join(text, text, uuid, text, uuid, int), bt_start(uuid, uuid), bt_shuffle(uuid, uuid), bt_state(uuid, uuid), bt_pick(uuid, uuid, text, int),
  bt_crit(uuid, uuid, int), bt_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function bt_join(text, text, uuid, text, uuid, int), bt_start(uuid, uuid), bt_shuffle(uuid, uuid), bt_state(uuid, uuid),
  bt_pick(uuid, uuid, text, int), bt_crit(uuid, uuid, int), bt_leave(uuid, uuid) to anon;
select 'bonk duel 2v2 ready' as done;
