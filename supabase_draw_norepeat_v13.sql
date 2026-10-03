-- Draw & Guess: fewer repeated words. A room is not offered any word it was offered in its last 40 rounds
-- (about 160 words), and no MapleStory "special" word from its last 20 rounds. If a pool runs dry, repeats are allowed again.
create or replace function draw_new_round(room text, drawer text, dur integer default 80, custom text[] default null, only_custom boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare rid uuid; ch text[]; sp text; cw text[]; recent text[]; recent_sp text[]; rm text := left(room, 20);
begin
  perform rl_check('draw_new_round', 30, 60);
  delete from draw_rounds where created_at < now() - interval '1 day';
  select coalesce(array_agg(w), '{}') into recent from (
    select unnest(r.choices) w from (select choices from draw_rounds where draw_rounds.room = rm order by created_at desc limit 40) r) z;
  select coalesce(array_agg(w), '{}') into recent_sp from (
    select unnest(r.choices) w from (select choices from draw_rounds where draw_rounds.room = rm order by created_at desc limit 20) r) z;
  select coalesce(array_agg(distinct w), '{}') into cw
    from (select lower(trim(x)) w from unnest(coalesce(custom, '{}')) x limit 200) c where w ~ '^[a-z0-9 ]{2,30}$';
  if only_custom and cardinality(cw) >= 3 then
    select array_agg(w) into ch from (select w from unnest(cw) w order by (w = any(recent)), random() limit 3) s;
  else
    -- fresh words first; recently offered ones only if nothing fresh is left
    select array_agg(w) into ch from (select w from (select word w from draw_words union select unnest(cw)) p
      order by (w = any(recent)), random() limit 3) s;
    select word into sp from draw_words_special where word <> all(ch) order by (word = any(recent_sp)), random() limit 1;
    if sp is not null then ch := ch || sp; end if;
  end if;
  insert into draw_rounds (room, drawer, choices, duration)
    values (rm, left(drawer, 40), ch, greatest(30, least(coalesce(dur, 80), 180))) returning id into rid;
  return json_build_object('id', rid, 'choices', ch, 'special', sp);
end $$;
revoke all on function draw_new_round(text, text, integer, text[], boolean) from public, anon, authenticated;
grant execute on function draw_new_round(text, text, integer, text[], boolean) to anon;
select 'ok' as done;
