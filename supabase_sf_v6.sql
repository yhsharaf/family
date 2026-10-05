-- Star Force v6: same as the game. Each player has ONE Star Force slot (no starting over), so sf_start hands back the existing one;
-- a destroyed slot can only be restored at 12-20 stars (no free reset to 0).
create or replace function sf_start(p_name text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare nm text := left(trim(coalesce(p_name, '')), 20); g text; r sf_runs;
begin
  perform rl_check('sf_start', 10, 60);
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  select dg.name into g from draw_guild dg where lower(dg.name) = lower(nm) limit 1;
  select * into r from sf_runs where lower(player) = lower(coalesce(g, nm)) order by best desc, id limit 1;
  if r.id is null then insert into sf_runs (player, item) values (coalesce(g, nm), left(coalesce(p_item, 'zakum_helmet'), 30)) returning * into r; end if;
  return json_build_object('r', 'ok', 'token', r.token, 'player', r.player, 'item', r.item);
end $$;

create or replace function sf_fix(p_tok uuid, p_star int) returns json
language plpgsql security definer set search_path = public as $$
declare r sf_runs; c sf_restore;
begin
  perform rl_check('sf_roll', 300, 60);
  select * into r from sf_runs where token = p_tok for update;
  if r.id is null then return json_build_object('r', 'gone'); end if;
  if not r.broken then return json_build_object('r', 'notbroken'); end if;
  select * into c from sf_restore where star = p_star; if c.star is null then return json_build_object('r', 'star'); end if;
  update sf_runs set red = red + c.red, mesos = mesos + c.mesos, scrolls = scrolls + c.scrolls, restores = restores + 1,
    star = p_star, broken = false, updated_at = now() where id = r.id;
  return sf_get(p_tok);
end $$;
select 'star force v6 ready' as done;

-- look up a player's existing slot by name (so their stars show as soon as they type their name); creates nothing
create or replace function sf_find(p_name text) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('r', 'ok', 'token', r.token) from sf_runs r
    where lower(r.player) = lower(coalesce((select dg.name from draw_guild dg where lower(dg.name) = lower(trim(p_name)) limit 1), trim(p_name)))
    order by r.best desc, r.id limit 1), json_build_object('r', 'none'));
$$;
revoke all on function sf_find(text) from public, anon, authenticated;
grant execute on function sf_find(text) to anon;
