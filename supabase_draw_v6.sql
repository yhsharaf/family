-- Draw & Guess (skribbl-style). The secret word lives only in the database: drawers get 3 choices, guesses are checked
-- here, hints/reveals come from here, and points go to draw_scores (separate from bonks).
create extension if not exists fuzzystrmatch with schema extensions;

create table if not exists draw_words (word text primary key);
insert into draw_words values ('airplane'),('alien'),('anchor'),('angel'),('ant'),('apple'),('arrow'),('axe'),('backpack'),('ball'),('balloon'),('banana'),('basketball'),('bathtub'),('battery'),('beach'),('bear'),('beard'),('bed'),('bee'),('belt'),('bicycle'),('bird'),('blanket'),('boat'),('book'),('bottle'),('bow'),('bowl'),('bowling'),('bread'),('bridge'),('broccoli'),('broom'),('bucket'),('bunkbed'),('burger'),('bus'),('bush'),('butterfly'),('cactus'),('cake'),('calendar'),('camera'),('campfire'),('camping'),('candle'),('cap'),('car'),('carrot'),('castle'),('cat'),('cave'),('chair'),('cheese'),('cherry'),('chicken'),('church'),('clock'),('cloud'),('coconut'),('coin'),('comb'),('computer'),('cookie'),('corn'),('cow'),('crab'),('crown'),('cup'),('desert'),('diamond'),('dice'),('dinosaur'),('dog'),('dolphin'),('donut'),('door'),('doorbell'),('dragon'),('dress'),('drum'),('duck'),('ear'),('egg'),('elephant'),('envelope'),('eraser'),('eye'),('fence'),('finger'),('fire'),('fireworks'),('fish'),('fishing'),('flag'),('flower'),('foot'),('football'),('forest'),('fork'),('fridge'),('frog'),('ghost'),('gift'),('giraffe'),('glass'),('glasses'),('globe'),('glove'),('golf'),('grapes'),('grass'),('guitar'),('hair'),('hairbrush'),('hammer'),('hammock'),('hand'),('hat'),('headphones'),('heart'),('helicopter'),('horse'),('hospital'),('hotdog'),('house'),('ice'),('icecream'),('igloo'),('island'),('kangaroo'),('kettle'),('key'),('keyboard'),('king'),('kite'),('knife'),('knight'),('ladder'),('lamp'),('laptop'),('leaf'),('lemon'),('lightbulb'),('lighthouse'),('lightning'),('lion'),('lock'),('magnet'),('mailbox'),('map'),('medal'),('mermaid'),('microphone'),('microwave'),('mirror'),('monkey'),('moon'),('motorcycle'),('mountain'),('mouse'),('mouth'),('mushroom'),('mustache'),('necklace'),('ninja'),('nose'),('octopus'),('onion'),('orange'),('oven'),('owl'),('palm'),('pan'),('pen'),('pencil'),('penguin'),('pepper'),('phone'),('piano'),('pig'),('pillow'),('pineapple'),('pirate'),('pizza'),('plate'),('popcorn'),('potato'),('present'),('princess'),('pumpkin'),('puzzle'),('pyramid'),('queen'),('rabbit'),('rain'),('rainbow'),('ring'),('river'),('robot'),('rocket'),('rose'),('ruler'),('sandcastle'),('sandwich'),('saw'),('scarecrow'),('scarf'),('school'),('scissors'),('scooter'),('shark'),('sheep'),('shield'),('shirt'),('shoe'),('shovel'),('skateboard'),('skeleton'),('skiing'),('smile'),('smoke'),('snail'),('snake'),('snow'),('snowball'),('snowman'),('soap'),('sock'),('sofa'),('spider'),('spoon'),('stamp'),('star'),('strawberry'),('submarine'),('sun'),('sunflower'),('surfing'),('swimming'),('sword'),('table'),('teapot'),('television'),('tennis'),('tent'),('ticket'),('tie'),('tiger'),('toaster'),('toilet'),('tomato'),('tooth'),('toothbrush'),('toothpaste'),('tornado'),('towel'),('tower'),('tractor'),('train'),('treasure'),('tree'),('trophy'),('truck'),('trumpet'),('turtle'),('umbrella'),('unicorn'),('vampire'),('violin'),('volcano'),('wallet'),('water'),('waterfall'),('watermelon'),('whale'),('wheel'),('windmill'),('window'),('witch'),('wizard'),('worm'),('yoyo'),('zebra'),('zombie') on conflict do nothing;

create table if not exists draw_rounds (
  id uuid primary key default gen_random_uuid(),
  room text not null check (char_length(room) <= 20),
  drawer text not null check (char_length(drawer) <= 40),
  choices text[] not null,
  word text,
  duration int not null default 80,
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists draw_guessed (round_id uuid not null, player text not null, primary key (round_id, player));
create table if not exists draw_tries (round_id uuid not null, player text not null, n int not null default 0, primary key (round_id, player));
create table if not exists draw_scores (player text primary key check (char_length(player) <= 40), points bigint not null default 0,
  guessed int not null default 0, drew int not null default 0);
alter table draw_words enable row level security; alter table draw_rounds enable row level security;
alter table draw_guessed enable row level security; alter table draw_tries enable row level security;
alter table draw_scores enable row level security;
drop policy if exists "read draw scores" on draw_scores;
create policy "read draw scores" on draw_scores for select using (true);
revoke all on draw_words, draw_rounds, draw_guessed, draw_tries, draw_scores from anon, authenticated;
grant select on draw_scores to anon;

create or replace function draw_mask(w text, keep int[]) returns text language sql immutable as $$
  select string_agg(case when c ~ '[a-z0-9]' and not (i = any(keep)) then '_' else c end, ' ' order by i)
  from unnest(string_to_array(w, null)) with ordinality as t(c, i)
$$;

create or replace function draw_new_round(room text, drawer text) returns json
language plpgsql security definer set search_path = public as $$
declare rid uuid; ch text[];
begin
  delete from draw_rounds where created_at < now() - interval '1 day';
  select array_agg(word) into ch from (select word from draw_words order by random() limit 3) s;
  insert into draw_rounds (room, drawer, choices) values (left(room, 20), left(drawer, 40), ch) returning id into rid;
  return json_build_object('id', rid, 'choices', ch);
end $$;

create or replace function draw_pick(rid uuid, w text) returns json
language plpgsql security definer set search_path = public as $$
declare r draw_rounds;
begin
  select * into r from draw_rounds where id = rid;
  if r.id is null then raise exception 'no round'; end if;
  if r.word is null then
    if not (w = any(r.choices)) then w := r.choices[1]; end if;
    update draw_rounds set word = w, started_at = now(), ends_at = now() + make_interval(secs => duration) where id = rid returning * into r;
    insert into draw_scores (player, drew) values (r.drawer, 1) on conflict (player) do update set drew = draw_scores.drew + 1;
  end if;
  return json_build_object('mask', draw_mask(r.word, '{}'), 'ends_at', r.ends_at);
end $$;

create or replace function draw_guess(rid uuid, player text, g text) returns json
language plpgsql security definer set search_path = public as $$
declare r draw_rounds; t int; pts int; guess text := lower(trim(g));
begin
  select * into r from draw_rounds where id = rid;
  if r.word is null or now() >= r.ends_at then return json_build_object('r', 'late'); end if;
  if player = r.drawer then return json_build_object('r', 'drawer'); end if;
  if exists (select 1 from draw_guessed where round_id = rid and draw_guessed.player = draw_guess.player) then return json_build_object('r', 'done'); end if;
  insert into draw_tries values (rid, left(player, 40), 1) on conflict (round_id, player) do update set n = draw_tries.n + 1 returning n into t;
  if t > 25 then return json_build_object('r', 'limit'); end if;
  if guess = r.word then
    insert into draw_guessed values (rid, left(player, 40));
    pts := 100 + round(400 * greatest(0, extract(epoch from r.ends_at - now())) / r.duration);
    insert into draw_scores (player, points, guessed) values (left(player, 40), pts, 1)
      on conflict (player) do update set points = draw_scores.points + pts, guessed = draw_scores.guessed + 1;
    update draw_scores set points = points + 50 where draw_scores.player = r.drawer;
    return json_build_object('r', 'correct', 'pts', pts);
  elsif char_length(r.word) > 3 and extensions.levenshtein(guess, r.word) <= 1 then
    return json_build_object('r', 'close');
  end if;
  return json_build_object('r', 'wrong');
end $$;

-- hint: letters revealed as time passes (none before 35% of the time, up to ~40% of letters); the full word once the round is over
create or replace function draw_hint(rid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r draw_rounds; f float; n int; letters int; keep int[];
begin
  select * into r from draw_rounds where id = rid;
  if r.word is null then return null; end if;
  if now() >= r.ends_at then return json_build_object('done', true, 'word', r.word, 'mask', r.word); end if;
  f := extract(epoch from now() - r.started_at) / r.duration;
  letters := char_length(regexp_replace(r.word, '[^a-z0-9]', '', 'g'));
  n := case when f < .35 then 0 when f < .6 then 1 else greatest(1, floor(letters * .4))::int end;
  select coalesce(array_agg(i), '{}') into keep from (select i from generate_series(1, char_length(r.word)) i
    where substr(r.word, i, 1) ~ '[a-z0-9]' order by md5(rid::text || i) limit n) s;
  return json_build_object('done', false, 'mask', draw_mask(r.word, keep));
end $$;

create or replace function draw_finish(rid uuid) returns void
language sql security definer set search_path = public as $$
  update draw_rounds set ends_at = least(ends_at, now()) where id = rid and word is not null;
$$;

revoke all on function draw_new_round(text, text), draw_pick(uuid, text), draw_guess(uuid, text, text), draw_hint(uuid), draw_finish(uuid), draw_mask(text, int[]) from public;
grant execute on function draw_new_round(text, text), draw_pick(uuid, text), draw_guess(uuid, text, text), draw_hint(uuid), draw_finish(uuid) to anon;
select count(*) as words from draw_words;
