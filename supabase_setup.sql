-- Family guild site: shared features. Paste this whole file into Supabase -> SQL Editor -> Run (once).
-- Everything visitors can do is limited here: they can only read approved rows, add rows (never edit or delete),
-- bump the two counters by at most 50 per call, and upload images (max 5 MB) that stay hidden until you approve them.

-- ---------- guild-wide counters (whips, stews)
create table if not exists counters (name text primary key, value bigint not null default 0);
insert into counters (name) values ('whips'), ('stews') on conflict do nothing;
alter table counters enable row level security;
drop policy if exists "read counters" on counters;
create policy "read counters" on counters for select using (true);

create or replace function add_count(k text, n int) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if k not in ('whips', 'stews') then raise exception 'unknown counter'; end if;
  update counters set value = value + least(greatest(n, 0), 50) where name = k returning value into v;
  return v;
end $$;

-- ---------- guestbook (shows right away; see MODERATION below to require approval)
create table if not exists guestbook (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 40),
  message text not null check (char_length(message) between 1 and 280),
  created_at timestamptz not null default now(),
  approved boolean not null default true
);
alter table guestbook enable row level security;
drop policy if exists "read approved" on guestbook;
create policy "read approved" on guestbook for select using (approved);
drop policy if exists "post" on guestbook;
create policy "post" on guestbook for insert with check (true);

-- ---------- photo reactions: one per photo per device, either love (❤️) or hate (💀)
create table if not exists memory_votes (
  photo text not null check (char_length(photo) < 300),
  device text not null check (char_length(device) < 64),
  kind text not null default 'love' check (kind in ('love', 'hate')),
  created_at timestamptz not null default now(),
  primary key (photo, device)
);
alter table memory_votes enable row level security;
drop policy if exists "vote" on memory_votes;
create policy "vote" on memory_votes for insert with check (true);
create or replace view memory_vote_counts as
  select photo, count(*) filter (where kind = 'love')::int as love, count(*) filter (where kind = 'hate')::int as hate
  from memory_votes group by photo;

-- ---------- photo uploads: hidden until approved = true
create table if not exists memory_uploads (
  id bigint generated always as identity primary key,
  path text not null unique check (char_length(path) < 120),
  title text not null check (char_length(title) between 1 and 80),
  uploader text check (char_length(uploader) <= 40),
  created_at timestamptz not null default now(),
  approved boolean not null default false
);
alter table memory_uploads enable row level security;
drop policy if exists "read approved uploads" on memory_uploads;
create policy "read approved uploads" on memory_uploads for select using (approved);
drop policy if exists "submit upload" on memory_uploads;
create policy "submit upload" on memory_uploads for insert with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memories', 'memories', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
drop policy if exists "upload memories" on storage.objects;
create policy "upload memories" on storage.objects for insert to anon with check (bucket_id = 'memories');

-- ---------- lock visitors down to exactly what the site needs (Supabase grants a lot by default)
revoke all on counters, guestbook, memory_votes, memory_uploads, memory_vote_counts from anon, authenticated;
grant select on counters, memory_vote_counts to anon;
grant select (id, name, message, created_at) on guestbook to anon;
grant insert (name, message) on guestbook to anon;           -- visitors can't set "approved"
grant insert (photo, device, kind) on memory_votes to anon;
grant select (path, title, uploader, created_at) on memory_uploads to anon;
grant insert (path, title, uploader) on memory_uploads to anon;  -- new uploads always start unapproved
revoke all on function add_count(text, int) from public;
grant execute on function add_count(text, int) to anon;

-- ---------- MODERATION
-- Approve an uploaded photo: Table Editor -> memory_uploads -> tick "approved" (the file is in Storage -> memories).
-- Delete a bad guestbook message: Table Editor -> guestbook -> delete the row (or untick "approved").
-- Make every NEW guestbook message wait for your approval too, run:
--   alter table guestbook alter column approved set default false;
