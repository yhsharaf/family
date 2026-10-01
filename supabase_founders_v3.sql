-- Founders page: guild-wide bonk counts per Founder + Whack-a-Founder arcade leaderboard. Run once in the SQL Editor.
create table if not exists founder_bonks (founder text primary key check (char_length(founder) <= 40), value bigint not null default 0);
alter table founder_bonks enable row level security;
drop policy if exists "read bonks" on founder_bonks;
create policy "read bonks" on founder_bonks for select using (true);

create or replace function add_bonk(f text, n int) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if char_length(f) > 40 then raise exception 'bad founder'; end if;
  insert into founder_bonks (founder, value) values (f, least(greatest(n, 0), 30))
  on conflict (founder) do update set value = founder_bonks.value + least(greatest(n, 0), 30)
  returning value into v;
  return v;
end $$;

create table if not exists arcade_scores (
  id bigint generated always as identity primary key,
  initials text not null check (initials ~ '^[A-Z0-9]{3}$'),
  score int not null check (score between 0 and 400),
  created_at timestamptz not null default now()
);
alter table arcade_scores enable row level security;
drop policy if exists "read scores" on arcade_scores;
create policy "read scores" on arcade_scores for select using (true);
drop policy if exists "post score" on arcade_scores;
create policy "post score" on arcade_scores for insert with check (true);

revoke all on founder_bonks, arcade_scores from anon, authenticated;
grant select on founder_bonks to anon;
grant select (initials, score, created_at) on arcade_scores to anon;
grant insert (initials, score) on arcade_scores to anon;
revoke all on function add_bonk(text, int) from public;
grant execute on function add_bonk(text, int) to anon;
