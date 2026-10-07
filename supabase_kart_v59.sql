-- Family Kart v59: count the mesos everyone collects in all races. Each finished race adds the racer's mesos to their own running total
-- (guild members by name; guests all count together as '~guest'), and the menu shows the Family's all-time total.
create table if not exists kart_mesos (
  player text primary key,
  total bigint not null default 0,
  races int not null default 0,
  updated_at timestamptz not null default now()
);
alter table kart_mesos enable row level security;
drop policy if exists kart_mesos_read on kart_mesos;
create policy kart_mesos_read on kart_mesos for select using (true);
grant select on kart_mesos to anon;
create or replace function kart_add_mesos(p_name text, p_n int) returns json
language plpgsql security definer set search_path = public as $$
declare nm text; r kart_mesos;
begin
  perform rl_check('kartmeso', 12, 60);
  if p_n is null or p_n < 0 or p_n > 300 then return json_build_object('r', 'n'); end if;
  select dg.name into nm from draw_guild dg where lower(dg.name) = lower(trim(coalesce(p_name, ''))) limit 1;
  nm := coalesce(nm, '~guest');
  insert into kart_mesos as m (player, total, races) values (nm, p_n, 1)
  on conflict (player) do update set total = m.total + excluded.total, races = m.races + 1, updated_at = now()
  returning * into r;
  return json_build_object('r', 'ok', 'mine', case when nm = '~guest' then null else r.total end, 'all', (select coalesce(sum(total), 0) from kart_mesos));
end $$;
revoke all on function kart_add_mesos(text, int) from public, anon, authenticated;
grant execute on function kart_add_mesos(text, int) to anon;
create or replace function kart_meso_stats(p_name text default null) returns json
language sql security definer set search_path = public stable as $$
  select json_build_object(
    'all', coalesce((select sum(total) from kart_mesos), 0),
    'mine', (select total from kart_mesos where lower(player) = lower(trim(coalesce(p_name, ''))) and player <> '~guest'),
    'top', coalesce((select json_agg(t) from (select player, total from kart_mesos where player <> '~guest' order by total desc limit 5) t), '[]'::json));
$$;
revoke all on function kart_meso_stats(text) from public, anon, authenticated;
grant execute on function kart_meso_stats(text) to anon;
select 'family kart v59 ready' as done;
