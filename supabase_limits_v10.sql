-- Anti-spam: a per-connection (hashed IP) request limit on everything visitors can call, at most 5 Werewolf games open
-- at once, and the internal Werewolf helpers locked away from visitors (Supabase grants anon every new function by default).

-- 1. internal helpers: only the game functions themselves may call these
revoke execute on function ww_role_name(text), ww_say(uuid, int, text), ww_check_win(uuid), ww_kill(uuid, text, text), ww_goto(uuid, text),
  ww_tick(uuid), draw_mask(text, int[]) from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;  -- new functions start locked

-- 2. the limiter: one counter row per (connection + bucket, time window)
create table if not exists rl_hits (k text not null, win timestamptz not null, n int not null default 0, primary key (k, win));
alter table rl_hits enable row level security;
revoke all on rl_hits from anon, authenticated;

create or replace function rl_check(bucket text, lim int, secs int) returns void
language plpgsql security definer set search_path = public as $$
declare ip text; w timestamptz; c int;
begin
  ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  if ip = '' then return; end if;   -- not a website visitor (SQL editor, internal calls)
  w := to_timestamp(floor(extract(epoch from now()) / secs) * secs);
  insert into rl_hits as h (k, win, n) values (md5(ip || ':family-rl') || ':' || bucket, w, 1)
    on conflict (k, win) do update set n = h.n + 1 returning h.n into c;
  if random() < 0.01 then delete from rl_hits where win < now() - interval '1 hour'; end if;
  if c > lim then raise exception 'slow down' using errcode = 'P0429'; end if;
end $$;
revoke all on function rl_check(text, int, int) from public, anon, authenticated;

-- 5. Werewolf: at most 5 games open at once (games nobody has looked at for 2 minutes don't count, they're abandoned),
--    and one connection can open at most 2 new rooms per 10 minutes
create or replace function ww_room_ok() returns text
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from ww_games where status <> 'over' and seen_at > now() - interval '2 minutes') >= 5 then return 'busy'; end if;
  begin perform rl_check('ww_new', 2, 600); exception when sqlstate 'P0429' then return 'slow'; end;
  return null;
end $$;
revoke all on function ww_room_ok() from public, anon, authenticated;

-- (ww_join in supabase_werewolf_v9.sql calls ww_room_ok before opening a new game; re-create it before step 3)

-- 3. put a limit at the top of every visitor-callable function (generous for real play, several people can share one Wi-Fi)
do $$
declare f record; def text; lims jsonb := '{
  "add_count": [40, 60], "add_whip": [40, 60], "bonk_pass_use": [60, 60], "get_quiz": [20, 60], "quiz_pass": [20, 60],
  "megaphone_cooldown": [30, 60], "post_guestbook": [10, 60],
  "draw_new_round": [30, 60], "draw_pick": [30, 60], "draw_guess": [150, 60], "draw_hint": [150, 60], "draw_finish": [30, 60],
  "upload_ticket": [10, 60], "submit_upload": [10, 60],
  "ww_join": [20, 60], "ww_state": [150, 60], "ww_act": [60, 60], "ww_start": [10, 60], "ww_kick": [20, 60], "ww_leave": [20, 60]
}';
begin
  for f in select p.oid, p.proname, l.lanname from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
           where n.nspname = 'public' and lims ? p.proname loop
    def := pg_get_functiondef(f.oid);
    if position('rl_check(' in def) > 0 then continue; end if;   -- already limited
    if f.lanname = 'plpgsql' then
      def := regexp_replace(def, '\mbegin\M', format('begin%s  perform rl_check(%L, %s, %s);', chr(10), f.proname,
        lims -> f.proname ->> 0, lims -> f.proname ->> 1), 'i');
    else  -- a plain SQL function: run the check as an extra first statement
      def := regexp_replace(def, '(AS \$function\$)', format('\1%s  select rl_check(%L, %s, %s);', chr(10), f.proname,
        lims -> f.proname ->> 0, lims -> f.proname ->> 1));
    end if;
    execute def;
    raise notice 'limited %', f.proname;
  end loop;
end $$;

-- 4. the tables visitors insert into directly
create or replace function rl_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform rl_check(tg_table_name, tg_argv[0]::int, 60);
  return new;
end $$;
drop trigger if exists rl on memory_votes;   create trigger rl before insert on memory_votes   for each row execute function rl_row('60');
drop trigger if exists rl on guestbook_fame; create trigger rl before insert on guestbook_fame for each row execute function rl_row('60');
drop trigger if exists rl on arcade_scores;  create trigger rl before insert on arcade_scores  for each row execute function rl_row('10');

select string_agg(p.proname, ', ' order by p.proname) as visitor_callable from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.prokind = 'f';
