-- Per-traitor whip counts. The current guild total is split evenly between the 4 traitors; from now on every whip
-- adds to one traitor AND the guild total, so the 4 always add up to "whips from the whole guild".
create table if not exists traitor_whips (traitor text primary key, value bigint not null default 0);
alter table traitor_whips enable row level security;
drop policy if exists "read whips" on traitor_whips;
create policy "read whips" on traitor_whips for select using (true);

do $$
declare total bigint; base bigint; extra int; i int := 0; t text;
begin
  if not exists (select 1 from traitor_whips) then
    select value into total from counters where name = 'whips';
    base := total / 4; extra := total % 4;
    foreach t in array array['Sensuous', 'VirusIvan', 'IOO7I', 'Dandadan888'] loop
      insert into traitor_whips values (t, base + case when i < extra then 1 else 0 end);
      i := i + 1;
    end loop;
  end if;
end $$;

create or replace function add_whip(t text, n int) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; m int := least(greatest(n, 0), 50);
begin
  update traitor_whips set value = value + m where traitor = t returning value into v;
  if v is null then raise exception 'unknown traitor'; end if;
  update counters set value = value + m where name = 'whips';
  return v;
end $$;

-- older open pages still call add_count('whips', n): give those whips to a random traitor so the sum stays right
create or replace function add_count(k text, n int) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if k = 'whips' then
    perform add_whip((select traitor from traitor_whips order by random() limit 1), n);
    select value into v from counters where name = 'whips';
    return v;
  end if;
  if k <> 'stews' then raise exception 'unknown counter'; end if;
  update counters set value = value + least(greatest(n, 0), 50) where name = k returning value into v;
  return v;
end $$;

revoke all on traitor_whips from anon, authenticated;
grant select on traitor_whips to anon;
revoke all on function add_whip(text, int) from public;
grant execute on function add_whip(text, int) to anon;
select traitor, value, (select value from counters where name = 'whips') as guild_total from traitor_whips;
