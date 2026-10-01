-- Guestbook v2: monster avatars, megaphones and Fame (+/-). Run once in Supabase -> SQL Editor (after supabase_setup.sql).
alter table guestbook add column if not exists mob text not null default 'orange_mushroom' check (mob ~ '^[a-z_]{2,30}$');
alter table guestbook add column if not exists megaphone boolean not null default false;

-- one megaphone at a time: refuse a new one if somebody shouted in the last 3 minutes
create or replace function megaphone_cooldown() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.megaphone and exists (select 1 from guestbook where megaphone and created_at > now() - interval '3 minutes') then
    raise exception 'megaphone cooling down';
  end if;
  return new;
end $$;
drop trigger if exists megaphone_cooldown on guestbook;
create trigger megaphone_cooldown before insert on guestbook for each row execute function megaphone_cooldown();

-- Fame: one +1 or -1 per note per device
create table if not exists guestbook_fame (
  note_id bigint not null references guestbook(id) on delete cascade,
  device text not null check (char_length(device) < 64),
  delta smallint not null check (delta in (-1, 1)),
  primary key (note_id, device)
);
alter table guestbook_fame enable row level security;
drop policy if exists "fame" on guestbook_fame;
create policy "fame" on guestbook_fame for insert with check (true);

create or replace view guestbook_board as
  select g.id, g.name, g.message, g.created_at, g.mob, g.megaphone, coalesce(sum(f.delta), 0)::int as fame
  from guestbook g left join guestbook_fame f on f.note_id = g.id
  where g.approved
  group by g.id;

revoke all on guestbook_fame, guestbook_board from anon, authenticated;
grant select on guestbook_board to anon;
grant insert (note_id, device, delta) on guestbook_fame to anon;
grant insert (name, message, mob, megaphone) on guestbook to anon;
