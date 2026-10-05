-- Boom Roulette: Liar's Edition. A Kerning City table for 3-6 players, using MapleStory Idle's real Star Force odds from 20 stars.
-- Every round: everyone enhances in secret (rolled here, on the server), then CLAIMS a result (true or a lie), then may call "Liar!".
-- Rules (picked by simulation): 2 lives, 2 Liar calls each (a correct call is refunded, a wrong one just spends the call),
-- an admitted boom costs a life, a caught lie costs a life, and claiming 23 stars triggers a check of the REAL star:
-- real 23+ wins, a fake one is knocked out. Otherwise the last player standing wins.
create table if not exists br_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{4,8}$'), host text not null, is_public boolean not null default false,
  status text not null default 'lobby', round int not null default 0, phase text, phase_end timestamptz,
  winner text, game_no int not null default 0, created_at timestamptz not null default now()
);
create table if not exists br_players (
  code text not null references br_rooms(code) on delete cascade, name text not null check (char_length(name) between 2 and 20),
  token uuid not null default gen_random_uuid(), joined_at timestamptz not null default now(), seen timestamptz not null default now(),
  in_game boolean not null default false, alive boolean not null default false, lives int not null default 2, calls int not null default 2,
  real int not null default 20, shown int not null default 20, roll text, claim text, target text, acted boolean not null default false,
  exposed boolean not null default false, busted boolean not null default false, out_round int, caught int not null default 0,
  catches int not null default 0, history jsonb not null default '[]'::jsonb,
  primary key (code, name)
);
create table if not exists br_stats (
  player text primary key, games int not null default 0, wins int not null default 0, lies int not null default 0,
  lies_caught int not null default 0, catches int not null default 0, updated_at timestamptz not null default now()
);
alter table br_rooms enable row level security; alter table br_players enable row level security; alter table br_stats enable row level security;
revoke all on br_rooms, br_players, br_stats from anon, authenticated;
drop policy if exists "read br stats" on br_stats;
create policy "read br stats" on br_stats for select using (true);
grant select on br_stats to anon;

-- one secret enhancement for a player (real odds from sf_rates; a boom sends the REAL star back to 20 in this game)
create or replace function br_do_roll(p_code text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare p br_players; rt sf_rates; x numeric; o text;
begin
  select * into p from br_players where code = p_code and name = p_name for update;
  if p.roll is not null then return p.roll; end if;
  select * into rt from sf_rates where star = least(p.real, 29);
  x := random() * 100;
  if x < rt.success then o := 'S'; elsif x < rt.success + rt.destroy then o := 'B'; elsif x < rt.success + rt.destroy + rt.decrease then o := 'D'; else o := 'M'; end if;
  update br_players set roll = o, real = case o when 'S' then real + 1 when 'D' then real - 1 when 'B' then 20 else real end
    where code = p_code and name = p_name;
  return o;
end $$;

-- the game is over: record the winner and the guild stats (guild members only)
create or replace function br_finish(p_code text, p_win text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update br_rooms set status = 'over', winner = p_win, phase = null, phase_end = null where code = p_code;
  insert into br_stats as s (player, games, wins, lies, lies_caught, catches)
    select p.name, 1, (p.name = p_win)::int,
      (select count(*) from jsonb_array_elements(p.history) h where h ->> 1 <> h ->> 2), p.caught, p.catches
    from br_players p join draw_guild dg on dg.name = p.name where p.code = p_code and p.in_game
  on conflict (player) do update set games = s.games + 1, wins = s.wins + excluded.wins, lies = s.lies + excluded.lies,
    lies_caught = s.lies_caught + excluded.lies_caught, catches = s.catches + excluded.catches, updated_at = now();
end $$;

-- move the game along when a phase's time is up (or everyone is done). Called by every poll, so no timers are needed.
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
    -- claiming 23 stars: the real star is checked
    for p in select * from br_players where code = p_code and alive and lives > 0 and shown >= 23 order by real desc loop
      if p.real >= 23 then win := coalesce(win, p.name);
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

-- the table as one player sees it: other players' real rolls stay secret until they're called out or the game ends
create or replace function br_state(p_code text, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare rm br_rooms; me br_players; nh text; over boolean;
begin
  perform rl_check('br_state', 150, 60);
  select * into me from br_players where code = p_code and token = p_tok;
  if me.name is null then return json_build_object('r', 'gone'); end if;
  update br_players set seen = now() where code = p_code and name = me.name;
  perform br_advance(p_code);
  select * into rm from br_rooms where code = p_code;
  if not exists (select 1 from br_players where code = p_code and name = rm.host and seen > now() - interval '20 seconds') then
    select name into nh from br_players where code = p_code and seen > now() - interval '20 seconds' order by joined_at limit 1;
    if nh is not null then update br_rooms set host = nh where code = p_code returning * into rm; end if;
  end if;
  select * into me from br_players where code = p_code and name = me.name;
  over := rm.status = 'over';
  return json_build_object('r', 'ok', 'me', me.name, 'host', rm.host, 'public', rm.is_public, 'status', rm.status, 'round', rm.round, 'phase', rm.phase,
    'left', case when rm.phase_end is null then null else extract(epoch from rm.phase_end - now()) end, 'winner', rm.winner, 'game', rm.game_no,
    'mine', json_build_object('real', me.real, 'roll', me.roll, 'claim', me.claim, 'target', me.target, 'acted', me.acted),
    'players', (select coalesce(json_agg(json_build_object(
        'name', p.name, 'in', p.in_game, 'alive', p.alive, 'lives', p.lives, 'calls', p.calls, 'shown', p.shown, 'out', p.out_round,
        'here', p.seen > now() - interval '20 seconds',
        'done', case when rm.phase = 'play' then p.claim is not null when rm.phase = 'call' then p.acted else null end,
        'claim', case when rm.phase in ('call', 'reveal') or over then p.claim end,
        'target', case when rm.phase = 'reveal' or over then p.target end,
        'exposed', p.exposed, 'busted', p.busted,
        'roll', case when over or (rm.phase = 'reveal' and exists (select 1 from br_players a where a.code = p_code and a.target = p.name)) or p.busted then p.roll end,
        'real', case when over or p.busted then p.real end,
        'history', case when over then p.history end) order by p.joined_at), '[]'::json)
      from br_players p where p.code = p_code and (p.in_game or p.seen > now() - interval '20 seconds')));
end $$;

-- your move: roll, claim (S/M/D/B), call a liar on someone, or pass
create or replace function br_act(p_code text, p_tok uuid, p_kind text, p_arg text default null) returns json
language plpgsql security definer set search_path = public as $$
declare rm br_rooms; me br_players; o text;
begin
  perform rl_check('br_act', 120, 60);
  select * into me from br_players where code = p_code and token = p_tok;
  select * into rm from br_rooms where code = p_code;
  if me.name is null or rm.status <> 'playing' or not me.alive then return json_build_object('r', 'no'); end if;
  if rm.phase = 'play' and p_kind = 'roll' then o := br_do_roll(p_code, me.name); return json_build_object('r', 'ok', 'roll', o); end if;
  if rm.phase = 'play' and p_kind = 'claim' and p_arg in ('S', 'M', 'D', 'B') then
    if me.roll is null then perform br_do_roll(p_code, me.name); end if;
    update br_players set claim = p_arg where code = p_code and name = me.name and claim is null;
  elsif rm.phase = 'call' and p_kind = 'call' and not me.acted and me.calls > 0 and p_arg <> me.name
      and exists (select 1 from br_players where code = p_code and name = p_arg and alive) then
    update br_players set calls = calls - 1, target = p_arg, acted = true where code = p_code and name = me.name;
  elsif rm.phase = 'call' and p_kind = 'pass' then
    update br_players set acted = true where code = p_code and name = me.name;
  else return json_build_object('r', 'no'); end if;
  perform br_advance(p_code);
  return json_build_object('r', 'ok');
end $$;

-- rooms: join (the first one in is the host, max 6), list the open public ones, start, leave
create or replace function br_join(p_code text, p_name text, p_tok uuid, p_public boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare cd text := upper(left(coalesce(p_code, ''), 8)); nm text := left(trim(coalesce(p_name, '')), 20); g text; rm br_rooms; pl br_players;
begin
  perform rl_check('br_room', 30, 60);
  delete from br_rooms where created_at < now() - interval '6 hours';
  if cd !~ '^[A-Z0-9]{4,8}$' then return json_build_object('r', 'code'); end if;
  if p_tok is not null then
    select * into pl from br_players where code = cd and token = p_tok;
    if pl.name is not null then update br_players set seen = now() where code = cd and name = pl.name; return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select dg.name into g from draw_guild dg where lower(dg.name) = lower(nm) limit 1; nm := coalesce(g, nm);
  select * into rm from br_rooms where code = cd for update;
  if rm.code is null then
    if (select count(*) from br_rooms where created_at > now() - interval '1 hour') >= 40 then return json_build_object('r', 'busy'); end if;
    insert into br_rooms (code, host, is_public) values (cd, nm, coalesce(p_public, false)) returning * into rm;
  end if;
  if rm.status = 'playing' then return json_build_object('r', 'running'); end if;
  delete from br_players where code = cd and seen < now() - interval '30 seconds';
  if exists (select 1 from br_players where code = cd and lower(name) = lower(nm)) then return json_build_object('r', 'taken'); end if;
  if (select count(*) from br_players where code = cd) >= 6 then return json_build_object('r', 'full'); end if;
  insert into br_players (code, name) values (cd, nm) returning * into pl;
  if not exists (select 1 from br_players where code = cd and name = rm.host and seen > now() - interval '20 seconds') then update br_rooms set host = nm where code = cd; end if;
  return json_build_object('r', 'ok', 'token', pl.token, 'name', pl.name);
end $$;

create or replace function br_list() returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created desc), '[]'::json) from (
    select r.code, r.host, r.status, r.created_at as created,
      (select count(*) from br_players p where p.code = r.code and p.seen > now() - interval '20 seconds') as n
    from br_rooms r where r.is_public and r.created_at > now() - interval '6 hours'
  ) x where x.n > 0 limit 20;
$$;

create or replace function br_start(p_code text, p_tok uuid) returns json
language plpgsql security definer set search_path = public as $$
declare rm br_rooms; me br_players;
begin
  perform rl_check('br_start', 10, 60);
  select * into me from br_players where code = p_code and token = p_tok;
  select * into rm from br_rooms where code = p_code for update;
  if me.name is null or rm.host <> me.name then return json_build_object('r', 'host'); end if;
  if rm.status = 'playing' then return json_build_object('r', 'running'); end if;
  if (select count(*) from br_players where code = p_code and seen > now() - interval '20 seconds') < 3 then return json_build_object('r', 'few'); end if;
  delete from br_players where code = p_code and seen < now() - interval '20 seconds';
  update br_players set in_game = true, alive = true, lives = 2, calls = 2, real = 20, shown = 20, roll = null, claim = null, target = null,
    acted = false, exposed = false, busted = false, out_round = null, caught = 0, catches = 0, history = '[]'::jsonb where code = p_code;
  update br_rooms set status = 'playing', round = 1, phase = 'play', phase_end = now() + interval '23 seconds', winner = null, game_no = game_no + 1
    where code = p_code;
  return json_build_object('r', 'ok');
end $$;

create or replace function br_leave(p_code text, p_tok uuid) returns void
language sql security definer set search_path = public as $$
  delete from br_players where code = p_code and token = p_tok;
$$;

revoke all on function br_do_roll(text, text), br_finish(text, text), br_advance(text) from public, anon, authenticated;
revoke all on function br_state(text, uuid), br_act(text, uuid, text, text), br_join(text, text, uuid, boolean), br_list(), br_start(text, uuid), br_leave(text, uuid) from public, anon, authenticated;
grant execute on function br_state(text, uuid), br_act(text, uuid, text, text), br_join(text, text, uuid, boolean), br_list(), br_start(text, uuid), br_leave(text, uuid) to anon;
select 'boom roulette ready' as done;
