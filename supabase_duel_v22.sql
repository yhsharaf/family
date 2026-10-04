-- Bonk Duel v8: Professor CrtlAltDel's quick sum before Find a Duel / Enter / Rematch (a tiny anti-bot check).
-- bd_quiz_new() hands out "a + b" with an answer from 1 to 9; bd_join only opens or joins a duel with the right answer.
-- (Coming back to a running duel with your saved token doesn't ask again.)
create table if not exists bd_quiz (id uuid primary key default gen_random_uuid(), ans int not null, created_at timestamptz not null default now());
alter table bd_quiz enable row level security;
revoke all on bd_quiz from anon, authenticated;

create or replace function bd_quiz_new() returns json
language plpgsql security definer set search_path = public as $$
declare s int := 1 + floor(random() * 9)::int; a int; q uuid;
begin
  perform rl_check('bd_quiz', 40, 60);
  a := floor(random() * (s + 1))::int;                 -- a + b = s, both 0..s
  insert into bd_quiz (ans) values (s) returning id into q;
  return json_build_object('id', q, 'a', a, 'b', s - a);
end $$;

drop function if exists bd_join(text, text, uuid, text);
create or replace function bd_join(p_room text, p_name text, p_tok uuid, p_class text, p_quiz uuid, p_ans int) returns json
language plpgsql security definer set search_path = public as $$
declare rm text := left(coalesce(nullif(p_room, ''), 'public'), 20); nm text := left(trim(coalesce(p_name, '')), 20);
        cls text := case when p_class in ('warrior', 'magician', 'bowman', 'thief', 'pirate') then p_class else 'warrior' end;
        d bd_duels; why text; mp text; qid uuid; secret int := 20 + floor(random() * 21)::int;   -- Sleepywood: same hidden HP for both (20-40)
begin
  perform rl_check('bd_join', 30, 60);
  delete from bd_duels where created_at < now() - interval '3 hours';
  if p_tok is not null then
    select * into d from bd_duels where (t1 = p_tok or t2 = p_tok) and status <> 'over' and created_at > now() - interval '1 hour';
    if d.id is not null then
      return json_build_object('r', 'ok', 'game', d.id, 'token', p_tok, 'name', case when d.t1 = p_tok then d.p1 else d.p2 end);
    end if;
    if nm = '' then return json_build_object('r', 'gone'); end if;
  end if;
  if char_length(nm) < 2 then return json_build_object('r', 'name'); end if;
  -- Professor CrtlAltDel's quick sum: a new duel (or rematch) needs the right answer to a question from bd_quiz_new()
  delete from bd_quiz where created_at < now() - interval '10 minutes';
  delete from bd_quiz q where q.id = p_quiz and q.ans = p_ans and q.created_at > now() - interval '5 minutes' returning q.id into qid;
  if qid is null then return json_build_object('r', 'quiz'); end if;
  -- someone waiting? (lock it so two people can't grab the same opponent)
  select * into d from bd_duels where room = rm and status = 'wait' and p2 is null and seen1 > now() - interval '20 seconds'
    order by created_at limit 1 for update skip locked;
  if d.id is not null and lower(d.p1) = lower(nm) then return json_build_object('r', 'taken'); end if;
  if d.id is not null then
    mp := (array['henesys', 'elnath', 'zakum', 'ludi', 'sleepy'])[1 + floor(random() * 5)::int];
    update bd_duels set p2 = nm, h2 = bd_conn(), seen2 = now(), status = 'pick', turn = 1, class2 = cls, map = mp,
      secs = 15, arm = 0, armnext = 1 + floor(random() * 2)::int,
      hp1 = case when mp = 'sleepy' then secret when class1 = 'warrior' then 22 when class1 = 'pirate' then 21 else 20 end,
      hpmax1 = case when mp = 'sleepy' then secret when class1 = 'warrior' then 22 when class1 = 'pirate' then 21 else 20 end,
      hp2 = case when mp = 'sleepy' then secret when cls = 'warrior' then 22 when cls = 'pirate' then 21 else 20 end,
      hpmax2 = case when mp = 'sleepy' then secret when cls = 'warrior' then 22 when cls = 'pirate' then 21 else 20 end,
      en1 = case when class1 = 'magician' then 4 else 3 end, enmax1 = case when class1 = 'magician' then 6 else 5 end,
      en2 = case when cls = 'magician' then 4 else 3 end, enmax2 = case when cls = 'magician' then 6 else 5 end,
      reveal_until = now() + interval '5 seconds',
      ends_at = now() + interval '5 seconds' + make_interval(secs => 15)
    where id = d.id returning * into d;
    return json_build_object('r', 'ok', 'game', d.id, 'token', d.t2, 'name', nm);
  end if;
  if rm <> 'public' and exists (select 1 from bd_duels where room = rm and status in ('pick', 'double') and created_at > now() - interval '1 hour') then
    return json_build_object('r', 'running', 'game', (select id from bd_duels where room = rm and status in ('pick', 'double') order by created_at desc limit 1));
  end if;
  why := bd_room_ok(); if why is not null then return json_build_object('r', why); end if;
  update bd_duels set status = 'over', why = 'left' where room = rm and status = 'wait';
  insert into bd_duels (room, p1, h1, class1) values (rm, nm, bd_conn(), cls) returning * into d;
  return json_build_object('r', 'ok', 'game', d.id, 'token', d.t1, 'name', nm);
end $$;

revoke all on function bd_quiz_new(), bd_join(text, text, uuid, text, uuid, int) from public, anon, authenticated;
grant execute on function bd_quiz_new(), bd_join(text, text, uuid, text, uuid, int) to anon;
select 'bonk duel v8 ready' as done;
