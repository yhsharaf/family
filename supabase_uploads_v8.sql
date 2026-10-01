-- Memory uploads: at most 2 per person per day (counted per device and per IP).
-- The site first asks for a ticket (upload_ticket), the storage bucket only accepts files named after an
-- unused ticket, and the memory row is created by submit_upload, so the limit can't be skipped by calling storage directly.
create table if not exists upload_tickets (
  path text primary key,
  kd text not null,
  ki text not null,
  at timestamptz not null default now()
);
alter table upload_tickets enable row level security;
revoke all on upload_tickets from anon, authenticated;

create or replace function upload_ticket(device text, ext text) returns json
language plpgsql security definer set search_path = public as $$
declare ip text; vkd text; vki text; nxt timestamptz; p text; done int;
begin
  ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  vkd := 'd:' || left(coalesce(device, ''), 64);
  vki := 'i:' || md5(ip || ':family-uploads');
  delete from upload_tickets where at < now() - interval '1 day';
  -- real uploads = tickets whose file actually landed in storage
  select count(*), min(t.at) + interval '1 day' into done, nxt from upload_tickets t
    where (t.kd = vkd or t.ki = vki)
      and exists (select 1 from storage.objects o where o.bucket_id = 'memories' and o.name = t.path);
  if done >= 2 then return json_build_object('r', 'wait', 'until', nxt); end if;
  -- also cap tickets that were asked for but never used
  if (select count(*) from upload_tickets t where t.kd = vkd or t.ki = vki) >= 6 then
    select min(t.at) + interval '1 day' into nxt from upload_tickets t where t.kd = vkd or t.ki = vki;
    return json_build_object('r', 'wait', 'until', nxt);
  end if;
  p := left(md5(vkd), 8) || '-' || replace(gen_random_uuid()::text, '-', '') || case when ext = 'webp' then '.webp' else '.jpg' end;
  insert into upload_tickets (path, kd, ki) values (p, vkd, vki);
  return json_build_object('r', 'ok', 'path', p, 'left', 1 - done);
end $$;

-- storage only accepts a file whose name is a fresh ticket (names are unique, so each ticket is one file)
create or replace function upload_ok(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from upload_tickets where path = p and at > now() - interval '15 minutes')
$$;
drop policy if exists "upload memories" on storage.objects;
create policy "upload memories" on storage.objects for insert to anon with check (bucket_id = 'memories' and public.upload_ok(name));

create or replace function submit_upload(p text, title text, uploader text) returns json
language plpgsql security definer set search_path = public as $$
declare t text := trim(title); u text := nullif(trim(coalesce(uploader, '')), '');
begin
  if char_length(t) < 1 or char_length(t) > 80 or char_length(coalesce(u, '')) > 40 then return json_build_object('r', 'length'); end if;
  if (t || ' ' || coalesce(u, '')) ~* '(p+\W*e+\W*n+\W*[i1!]+\W*[s5$]+|peen|dick|d1ck|cock|fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|pussy|\mkys\M|porn|sex)' then
    return json_build_object('r', 'bad'); end if;
  if not exists (select 1 from upload_tickets where path = p)
     or not exists (select 1 from storage.objects where bucket_id = 'memories' and name = p) then
    return json_build_object('r', 'noticket'); end if;
  insert into memory_uploads (path, title, uploader) values (p, t, u) on conflict (path) do nothing;
  return json_build_object('r', 'ok');
end $$;

revoke insert on memory_uploads from anon;
revoke all on function upload_ticket(text, text), upload_ok(text), submit_upload(text, text, text) from public;
grant execute on function upload_ticket(text, text), upload_ok(text), submit_upload(text, text, text) to anon;
select 'uploads limited' as done;
