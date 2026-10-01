-- Werewolf (like the Telegram game). Everything secret lives here: roles are dealt by the database, each player gets a
-- private token when they join, and only ww_state(game, token) tells you YOUR role. Night actions, votes, timers and
-- deaths are all resolved here (any player's poll advances an expired phase), so the host can't cheat or stall the game.
create table if not exists ww_games (
  id uuid primary key default gen_random_uuid(),
  room text not null check (char_length(room) <= 20),
  host text,
  status text not null default 'lobby',          -- lobby | night | day | vote | hunter | over
  day int not null default 0,
  ends_at timestamptz,
  hunter text,                                   -- the dying Hunter who gets a last shot
  after_hunter text,                             -- phase to continue with after the Hunter's shot
  winner text,                                   -- village | wolves
  kicked text[] not null default '{}',
  wolf_key text not null default replace(gen_random_uuid()::text, '-', ''),   -- secret chat channels
  ghost_key text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create table if not exists ww_players (
  game_id uuid not null references ww_games(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 20),
  token uuid not null default gen_random_uuid() unique,
  role text,
  alive boolean not null default true,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (game_id, name)
);
create table if not exists ww_actions (
  game_id uuid not null references ww_games(id) on delete cascade,
  day int not null, phase text not null, actor text not null, target text,
  primary key (game_id, day, phase, actor)
);
create table if not exists ww_log (
  id bigint generated always as identity primary key,
  game_id uuid not null references ww_games(id) on delete cascade,
  day int not null default 0, txt text not null, at timestamptz not null default now()
);
create table if not exists ww_checks (
  game_id uuid not null references ww_games(id) on delete cascade,
  seer text not null, day int not null, target text not null, role text not null
);
create table if not exists ww_scores (
  player text primary key check (char_length(player) <= 40),
  games int not null default 0, wins int not null default 0, wolf_wins int not null default 0
);
create index if not exists ww_games_room on ww_games (room, created_at desc);
create index if not exists ww_log_game on ww_log (game_id, id);
alter table ww_games enable row level security; alter table ww_players enable row level security;
alter table ww_actions enable row level security; alter table ww_log enable row level security;
alter table ww_checks enable row level security; alter table ww_scores enable row level security;
drop policy if exists "read ww scores" on ww_scores;
create policy "read ww scores" on ww_scores for select using (true);
revoke all on ww_games, ww_players, ww_actions, ww_log, ww_checks, ww_scores from anon, authenticated;
grant select on ww_scores to anon;

create or replace function ww_role_name(r text) returns text language sql immutable as $$
  select case r when 'wolf' then 'Werewolf' when 'seer' then 'Seer' when 'guardian' then 'Guardian Angel'
    when 'hunter' then 'Hunter' when 'cursed' then 'Cursed' else 'Villager' end
$$;

create or replace function ww_say(g uuid, d int, t text) returns void language sql security definer set search_path = public as $$
  insert into ww_log (game_id, day, txt) values (g, d, t);
$$;

-- game over? (no wolves left, or wolves at least as many as everyone else) -> reveal, record Hall of Fame
create or replace function ww_check_win(g uuid) returns boolean
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare w int; o int; win text; gd int;
begin
  select count(*) filter (where role = 'wolf'), count(*) filter (where role <> 'wolf') into w, o from ww_players where game_id = g and alive;
  if w = 0 then win := 'village'; elsif w >= o then win := 'wolves'; else return false; end if;
  select day into gd from ww_games where id = g;
  update ww_games set status = 'over', winner = win, ends_at = null where id = g;
  perform ww_say(g, gd, case when win = 'village' then '🏆 The Villagers win! Every werewolf is gone.'
                            else '🐺 The Werewolves win! They now rule the village.' end);
  insert into ww_scores as s (player, games, wins, wolf_wins)
    select p.name, 1, (case when (p.role = 'wolf') = (win = 'wolves') then 1 else 0 end),
           (case when p.role = 'wolf' and win = 'wolves' then 1 else 0 end)
    from ww_players p where p.game_id = g and exists (select 1 from draw_guild dg where dg.name = p.name)
  on conflict (player) do update set games = s.games + 1, wins = s.wins + excluded.wins, wolf_wins = s.wolf_wins + excluded.wolf_wins;
  return true;
end $$;

-- kill someone; if it was the Hunter, they get a last shot before the game moves on
create or replace function ww_kill(g uuid, who text, nxt text) returns text
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  update ww_players set alive = false where game_id = g and name = who and alive returning role into r;
  if r = 'hunter' then update ww_games set hunter = who, after_hunter = nxt where id = g; end if;
  return r;
end $$;

-- move to the next phase (used by the clock and when a phase ends early)
create or replace function ww_goto(g uuid, nxt text) returns void
language plpgsql security definer set search_path = public as $$
declare gm ww_games;
begin
  if ww_check_win(g) then return; end if;
  select * into gm from ww_games where id = g;
  if gm.hunter is not null and gm.status <> 'hunter' then
    update ww_games set status = 'hunter', ends_at = now() + interval '20 seconds' where id = g;
    perform ww_say(g, gm.day, '🏹 ' || gm.hunter || ' was the Hunter! With their last breath they can take someone down with them (20s)…');
    return;
  end if;
  if nxt = 'night' then
    update ww_games set status = 'night', day = day + 1, ends_at = now() + interval '45 seconds', hunter = null where id = g;
    perform ww_say(g, gm.day + 1, '🌙 Night ' || (gm.day + 1) || '. The village sleeps… Werewolves, choose your prey. Seer, Guardian Angel, do your thing.');
  elsif nxt = 'day' then
    update ww_games set status = 'day', ends_at = now() + interval '90 seconds', hunter = null where id = g;
  end if;
end $$;

create or replace function ww_tick(g uuid) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare gm ww_games; kt text; gt text; st text; sr text; r text; n int; top int; tied int; tgt text;
begin
  select * into gm from ww_games where id = g for update;
  if gm.id is null or gm.status in ('lobby', 'over') or gm.ends_at > now() then return; end if;

  if gm.status = 'night' then
    -- Seer looks first (the Cursed look like a Villager until bitten)
    select a.target into st from ww_actions a join ww_players p on p.game_id = a.game_id and p.name = a.actor
      where a.game_id = g and a.day = gm.day and a.phase = 'night' and p.role = 'seer' and p.alive limit 1;
    if st is not null then
      select case when role = 'cursed' then 'villager' else role end into sr from ww_players where game_id = g and name = st;
      insert into ww_checks (game_id, seer, day, target, role)
        select g, p.name, gm.day, st, sr from ww_players p where p.game_id = g and p.role = 'seer' and p.alive;
    end if;
    select a.target into gt from ww_actions a join ww_players p on p.game_id = a.game_id and p.name = a.actor
      where a.game_id = g and a.day = gm.day and a.phase = 'night' and p.role = 'guardian' and p.alive limit 1;
    -- the wolves' choice: most votes, ties broken at random
    select a.target into kt from ww_actions a join ww_players p on p.game_id = a.game_id and p.name = a.actor
      where a.game_id = g and a.day = gm.day and a.phase = 'night' and p.role = 'wolf' and p.alive and a.target is not null
      group by a.target order by count(*) desc, random() limit 1;
    if kt is null then
      perform ww_say(g, gm.day, '☀️ Morning! Nobody died last night.');
    elsif kt = gt then
      perform ww_say(g, gm.day, '☀️ Morning! The werewolves attacked, but the Guardian Angel saved their target! 😇');
    elsif (select role from ww_players where game_id = g and name = kt) = 'cursed' then
      update ww_players set role = 'wolf' where game_id = g and name = kt;   -- the Cursed quietly becomes a wolf
      perform ww_say(g, gm.day, '☀️ Morning! Nobody died last night… 🤔');
    else
      r := ww_kill(g, kt, 'day');
      perform ww_say(g, gm.day, '☀️ Morning! ' || kt || ' was found dead 💀 They were the ' || ww_role_name(r) || '.');
    end if;
    perform ww_goto(g, 'day');

  elsif gm.status = 'day' then
    update ww_games set status = 'vote', ends_at = now() + interval '30 seconds' where id = g;
    perform ww_say(g, gm.day, '🗳️ Time to vote! Who is the werewolf?');

  elsif gm.status = 'vote' then
    select max(c) into top from (select count(*) c from ww_actions where game_id = g and day = gm.day and phase = 'vote' and target is not null group by target) v;
    select count(*) into tied from (select count(*) c from ww_actions where game_id = g and day = gm.day and phase = 'vote' and target is not null group by target) v where c = top;
    if top is null then
      perform ww_say(g, gm.day, '🤷 Nobody voted. Nobody was lynched.');
    elsif tied > 1 then
      perform ww_say(g, gm.day, '🤷 The vote was a tie. Nobody was lynched.');
    else
      select target into tgt from ww_actions where game_id = g and day = gm.day and phase = 'vote' and target is not null
        group by target order by count(*) desc limit 1;
      r := ww_kill(g, tgt, 'night');
      perform ww_say(g, gm.day, '🪢 The village lynched ' || tgt || ' (' || top || ' votes). They were the ' || ww_role_name(r) || '.'
        || case when r = 'wolf' then ' 🐺' else ' 😬' end);
    end if;
    perform ww_goto(g, 'night');

  elsif gm.status = 'hunter' then
    select target into tgt from ww_actions where game_id = g and day = gm.day and phase = 'hunter' and actor = gm.hunter;
    update ww_games set hunter = null where id = g;
    if tgt is null then
      perform ww_say(g, gm.day, '🏹 The Hunter''s arrow never flew.');
    else
      r := ww_kill(g, tgt, gm.after_hunter);
      update ww_games set hunter = null where id = g;  -- a shot Hunter can't chain-shoot
      perform ww_say(g, gm.day, '🏹 ' || gm.hunter || ' shot ' || tgt || '! They were the ' || ww_role_name(r) || '.');
    end if;
    perform ww_goto(g, gm.after_hunter);
  end if;
end $$;

-- join (or rejoin with your saved token) the room's lobby; creates a lobby when there isn't one
create or replace function ww_join(p_room text, p_name text, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20); nm text := left(trim(coalesce(p_name, '')), 20);
        gm ww_games; pl ww_players; n int;
begin
  delete from ww_games where created_at < now() - interval '6 hours';
  if p_tok is not null then
    select p.* into pl from ww_players p join ww_games g on g.id = p.game_id
      where p.token = p_tok and g.room = rm and g.status <> 'over' and g.seen_at > now() - interval '3 minutes';
    if pl.name is not null then
      update ww_players set seen_at = now() where token = p_tok;
      return json_build_object('r', 'ok', 'game', pl.game_id, 'token', pl.token, 'name', pl.name);
    end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select * into gm from ww_games where room = rm and status <> 'over' order by created_at desc limit 1;
  if gm.id is not null and gm.status <> 'lobby' and gm.seen_at > now() - interval '1 minute' then
    return json_build_object('r', 'running');
  end if;
  if gm.id is null or gm.status <> 'lobby' or gm.seen_at < now() - interval '10 minutes' then
    if gm.id is not null then update ww_games set status = 'over' where id = gm.id and status <> 'over'; end if;  -- abandoned
    insert into ww_games (room, host) values (rm, nm) returning * into gm;
  end if;
  delete from ww_players where game_id = gm.id and seen_at < now() - interval '30 seconds';  -- left without saying bye
  select count(*) into n from ww_players where game_id = gm.id;
  if n >= 20 then return json_build_object('r', 'full'); end if;
  if lower(nm) = any (select lower(k) from unnest(gm.kicked) k) then return json_build_object('r', 'kicked'); end if;
  if exists (select 1 from ww_players where game_id = gm.id and lower(name) = lower(nm)) then return json_build_object('r', 'taken'); end if;
  insert into ww_players (game_id, name) values (gm.id, nm) returning * into pl;
  if n = 0 or not exists (select 1 from ww_players where game_id = gm.id and name = gm.host) then
    update ww_games set host = nm where id = gm.id;
  end if;
  update ww_games set seen_at = now() where id = gm.id;
  return json_build_object('r', 'ok', 'game', gm.id, 'token', pl.token, 'name', pl.name);
end $$;

create or replace function ww_state(p_game uuid, p_tok uuid, p_after bigint) returns json
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare me ww_players; gm ww_games; res json;
begin
  select * into me from ww_players where game_id = p_game and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  if me.seen_at < now() - interval '4 seconds' then update ww_players set seen_at = now() where game_id = p_game and name = me.name; end if;
  perform ww_tick(p_game);
  select * into gm from ww_games where id = p_game;
  if gm.seen_at < now() - interval '4 seconds' then update ww_games set seen_at = now() where id = p_game; end if;
  if gm.status = 'lobby' then
    delete from ww_players where game_id = p_game and seen_at < now() - interval '30 seconds';
    if not exists (select 1 from ww_players where game_id = p_game and name = gm.host) then
      update ww_games set host = (select name from ww_players where game_id = p_game order by joined_at limit 1) where id = p_game returning * into gm;
    end if;
  end if;
  select * into me from ww_players where game_id = p_game and token = p_tok;
  select json_build_object('r', 'ok', 'status', gm.status, 'day', gm.day, 'host', gm.host, 'winner', gm.winner, 'hunter', gm.hunter,
    'left', case when gm.ends_at is null then null else greatest(0, extract(epoch from gm.ends_at - now())) end,
    'players', (select json_agg(json_build_object('name', p.name, 'alive', p.alive, 'online', p.seen_at > now() - interval '20 seconds',
                  'role', case when gm.status = 'over' or not p.alive or p.name = me.name then p.role
                               when me.role = 'wolf' and p.role = 'wolf' then 'wolf' end,
                  'vote', case when gm.status in ('day', 'vote') then (select a.target from ww_actions a where a.game_id = p_game and a.day = gm.day
                               and a.phase = 'vote' and a.actor = p.name) end) order by p.joined_at)
                from ww_players p where p.game_id = p_game),
    'log', (select coalesce(json_agg(json_build_object('id', l.id, 'txt', l.txt) order by l.id), '[]') from ww_log l where l.game_id = p_game and l.id > coalesce(p_after, 0)),
    'me', json_build_object('name', me.name, 'role', me.role, 'alive', me.alive,
      'act', (select a.target from ww_actions a where a.game_id = p_game and a.day = gm.day and a.phase = case when gm.status in ('day', 'vote') then 'vote' else gm.status end and a.actor = me.name),
      'pack', case when me.role = 'wolf' and gm.status = 'night' then (select json_object_agg(a.actor, a.target) from ww_actions a
                join ww_players p on p.game_id = a.game_id and p.name = a.actor where a.game_id = p_game and a.day = gm.day and a.phase = 'night' and p.role = 'wolf') end,
      'checks', case when me.role = 'seer' then (select json_agg(json_build_object('day', c.day, 'name', c.target, 'role', c.role) order by c.day)
                from ww_checks c where c.game_id = p_game and c.seer = me.name) end,
      'wolf_key', case when me.role = 'wolf' then gm.wolf_key end,
      'ghost_key', case when not me.alive or gm.status = 'over' then gm.ghost_key end)
  ) into res;
  return res;
end $$;

create or replace function ww_start(p_game uuid, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare me ww_players; gm ww_games; n int; w int; roles text[] := '{}';
begin
  select * into me from ww_players where game_id = p_game and token = p_tok;
  select * into gm from ww_games where id = p_game for update;
  if me.name is null or gm.host <> me.name then return json_build_object('r', 'host'); end if;
  if gm.status <> 'lobby' then return json_build_object('r', 'started'); end if;
  delete from ww_players where game_id = p_game and seen_at < now() - interval '30 seconds';
  select count(*) into n from ww_players where game_id = p_game;
  if n < 5 then return json_build_object('r', 'few', 'n', n); end if;
  w := case when n <= 6 then 1 when n <= 10 then 2 when n <= 15 then 3 else 4 end;
  roles := array_fill('wolf'::text, array[w]) || array['seer'];
  if n >= 6 then roles := roles || array['guardian']; end if;
  if n >= 7 then roles := roles || array['hunter']; end if;
  if n >= 8 then roles := roles || array['cursed']; end if;
  roles := roles || array_fill('villager'::text, array[n - cardinality(roles)]);
  update ww_players p set role = x.role from (
    select q.name, roles[(row_number() over (order by random()))::int] as role from ww_players q where q.game_id = p_game) x
  where p.game_id = p_game and p.name = x.name;
  update ww_games set status = 'night', day = 1, ends_at = now() + interval '45 seconds' where id = p_game;
  perform ww_say(p_game, 1, '🎲 Roles are dealt! ' || n || ' players, ' || w || ' werewol' || case when w = 1 then 'f' else 'ves' end || ' among you.');
  perform ww_say(p_game, 1, '🌙 Night 1. The village sleeps… Werewolves, choose your prey. Seer, Guardian Angel, do your thing.');
  return json_build_object('r', 'ok');
end $$;

create or replace function ww_act(p_game uuid, p_tok uuid, p_target text) returns json
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare me ww_players; gm ww_games; t ww_players; ph text; need int; done int;
begin
  perform ww_tick(p_game);   -- an expired phase moves on first, so a late tap counts for the new phase
  select * into me from ww_players where game_id = p_game and token = p_tok;
  select * into gm from ww_games where id = p_game for update;
  if me.name is null or gm.id is null then return json_build_object('r', 'gone'); end if;
  if gm.ends_at <= now() then return json_build_object('r', 'late'); end if;
  if p_target is not null then
    select * into t from ww_players where game_id = p_game and name = p_target and alive;
    if t.name is null then return json_build_object('r', 'target'); end if;
  end if;
  if gm.status = 'hunter' then
    if me.name <> gm.hunter or t.name is null or t.name = me.name then return json_build_object('r', 'no'); end if;
    insert into ww_actions (game_id, day, phase, actor, target) values (p_game, gm.day, 'hunter', me.name, t.name)
      on conflict (game_id, day, phase, actor) do update set target = excluded.target;
    update ww_games set ends_at = least(ends_at, now() + interval '1 second') where id = p_game;
    return json_build_object('r', 'ok');
  end if;
  if not me.alive then return json_build_object('r', 'dead'); end if;
  if gm.status = 'night' then
    if me.role not in ('wolf', 'seer', 'guardian') or t.name is null or t.name = me.name then return json_build_object('r', 'no'); end if;
    if me.role = 'wolf' and t.role = 'wolf' then return json_build_object('r', 'no'); end if;
    ph := 'night';
  elsif gm.status in ('day', 'vote') then
    if t.name = me.name then return json_build_object('r', 'no'); end if;
    ph := 'vote';     -- you can lock in a vote while still discussing
  else return json_build_object('r', 'no'); end if;
  insert into ww_actions (game_id, day, phase, actor, target) values (p_game, gm.day, ph, me.name, t.name)
    on conflict (game_id, day, phase, actor) do update set target = excluded.target;
  -- everyone who needs to act has acted -> don't make them wait for the clock
  if ph = 'night' then
    select count(*) into need from ww_players where game_id = p_game and alive and role in ('wolf', 'seer', 'guardian');
    select count(*) into done from ww_actions a join ww_players p on p.game_id = a.game_id and p.name = a.actor
      where a.game_id = p_game and a.day = gm.day and a.phase = 'night' and p.alive and p.role in ('wolf', 'seer', 'guardian') and a.target is not null;
    if done >= need then update ww_games set ends_at = least(ends_at, now() + interval '3 seconds') where id = p_game; end if;
  else
    select count(*) into need from ww_players where game_id = p_game and alive;
    select count(*) into done from ww_actions a join ww_players p on p.game_id = a.game_id and p.name = a.actor
      where a.game_id = p_game and a.day = gm.day and a.phase = 'vote' and p.alive;
    if done >= need then
      if gm.status = 'day' then  -- everyone already voted during the discussion: skip straight to the result
        update ww_games set status = 'vote', ends_at = now() + interval '3 seconds' where id = p_game;
        perform ww_say(p_game, gm.day, '🗳️ Everyone has voted!');
      else update ww_games set ends_at = least(ends_at, now() + interval '3 seconds') where id = p_game; end if;
    end if;
  end if;
  return json_build_object('r', 'ok');
end $$;

create or replace function ww_leave(p_game uuid, p_tok uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me ww_players; gm ww_games; r text;
begin
  select * into me from ww_players where game_id = p_game and token = p_tok;
  select * into gm from ww_games where id = p_game for update;
  if me.name is null then return; end if;
  if gm.status = 'lobby' then
    delete from ww_players where game_id = p_game and name = me.name;
    if gm.host = me.name then update ww_games set host = (select name from ww_players where game_id = p_game order by joined_at limit 1) where id = p_game; end if;
  elsif gm.status <> 'over' and me.alive then
    update ww_players set alive = false where game_id = p_game and name = me.name returning role into r;
    perform ww_say(p_game, gm.day, '🏃 ' || me.name || ' ran away from the village. They were the ' || ww_role_name(r) || '.');
    if gm.hunter = me.name then update ww_games set ends_at = now() where id = p_game; end if;
    perform ww_check_win(p_game);
  end if;
end $$;

create or replace function ww_kick(p_game uuid, p_tok uuid, p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare me ww_players; gm ww_games;
begin
  select * into me from ww_players where game_id = p_game and token = p_tok;
  select * into gm from ww_games where id = p_game;
  if me.name is null or gm.host <> me.name or gm.status <> 'lobby' or p_name = me.name then return json_build_object('r', 'no'); end if;
  delete from ww_players where game_id = p_game and name = p_name;
  update ww_games set kicked = array_append(kicked, p_name) where id = p_game;
  return json_build_object('r', 'ok');
end $$;

revoke all on function ww_role_name(text), ww_say(uuid, int, text), ww_check_win(uuid), ww_kill(uuid, text, text), ww_goto(uuid, text),
  ww_tick(uuid), ww_join(text, text, uuid), ww_state(uuid, uuid, bigint), ww_start(uuid, uuid), ww_act(uuid, uuid, text),
  ww_leave(uuid, uuid), ww_kick(uuid, uuid, text) from public;
grant execute on function ww_join(text, text, uuid), ww_state(uuid, uuid, bigint), ww_start(uuid, uuid), ww_act(uuid, uuid, text),
  ww_leave(uuid, uuid), ww_kick(uuid, uuid, text) to anon;
select 'werewolf ready' as done;
