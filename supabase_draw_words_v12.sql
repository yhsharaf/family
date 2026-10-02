-- Draw & Guess word lists (v12): more easy words, more two-part words (like scarecrow), the hardest ones removed,
-- and a MapleStory Idle list for the 4th "special" choice (chosen with the guild, no bonus points).
insert into draw_words values ('pear'),('fries'),('candy'),('lollipop'),('milk'),('juice'),('coffee'),('tea'),('noodles'),('rice'),('sushi'),('chips'),('pancake'),('waffle'),('cupcake'),('pie'),('peach'),('chocolate'),('cereal'),('soup'),('salad'),('taco'),('sausage'),('bacon'),('shrimp'),('panda'),('puppy'),('kitten'),('chick'),('hamster'),('squirrel'),('hedgehog'),('koala'),('camel'),('hippo'),('rhino'),('crocodile'),('flamingo'),('swan'),('peacock'),('parrot'),('seal'),('jellyfish'),('starfish'),('bat'),('wolf'),('fox'),('deer'),('goat'),('donkey'),('lamb'),('ladybug'),('caterpillar'),('beetle'),('tv'),('box'),('bag'),('watch'),('bell'),('brush'),('money'),('fan'),('bone'),('web'),('nest'),('crayon'),('paint'),('glue'),('tape'),('notebook'),('letter'),('rope'),('nail'),('rake'),('flashlight'),('bulb'),('alarm'),('bubble'),('doll'),('mask'),('pants'),('jacket'),('boots'),('arm'),('leg'),('sea'),('sink'),('stairs'),('roof'),('gate'),('garden'),('shop'),('swing'),('slide'),('storm'),('wind'),('snowflake'),('bike'),('plane'),('taxi'),('ambulance'),('ship'),('sled'),('circle'),('square'),('triangle'),('baby'),('clown'),('chef'),('cowboy'),('music') on conflict do nothing;
insert into draw_words values ('goldfish'),('seahorse'),('firefly'),('dragonfly'),('grasshopper'),('bulldog'),('bookworm'),('bedroom'),('bathroom'),('armchair'),('cupboard'),('bookshelf'),('fireplace'),('keyhole'),('mousetrap'),('doghouse'),('birdhouse'),('treehouse'),('greenhouse'),('farmhouse'),('cheeseburger'),('meatball'),('eggplant'),('peanut'),('milkshake'),('teacup'),('drumstick'),('chopsticks'),('toothpick'),('fireman'),('postman'),('superhero'),('eyeball'),('eyebrow'),('footprint'),('fingerprint'),('ponytail'),('handshake'),('headband'),('earring'),('lipstick'),('raindrop'),('raincoat'),('sunglasses'),('sunset'),('sunrise'),('seashell'),('horseshoe'),('snowboard'),('firetruck'),('sailboat'),('rowboat'),('spaceship'),('wheelchair'),('paintbrush'),('blackboard'),('broomstick'),('matchbox'),('handbag') on conflict do nothing;
delete from draw_words where word in ('airplane','anchor','battery','bowling','calendar','camping','envelope','fishing','globe','golf','hammock','hospital','igloo','kettle','lightning','magnet','microphone','microwave','mustache','necklace','pyramid','skiing','stamp','submarine','surfing','swimming','television','tennis','toaster','tornado','tractor','wizard','mermaid');
create table if not exists draw_words_special (word text primary key);
alter table draw_words_special enable row level security;
revoke all on draw_words_special from anon, authenticated;
insert into draw_words_special values ('orange mushroom'),('zombie mushroom'),('snail'),('blue snail'),('red snail'),('stump'),('pig'),('ribbon pig'),('slime'),('lupin'),('mushmom'),('zakum'),('horntail'),('alishar'),('pink bean'),('balrog'),('wild boar'),('fire boar'),('yeti'),('pepe'),('golem'),('octopus'),('wraith'),('drake'),('henesys'),('kerning city'),('el nath'),('mushroom park'),('ellinia'),('perion'),('lith harbor'),('sleepywood'),('orbis'),('ludibrium'),('aqua road'),('leafre'),('hero'),('paladin'),('dark knight'),('bishop'),('night lord'),('shadower'),('bowmaster'),('marksman'),('buccaneer'),('corsair'),('wind archer'),('night walker'),('fire poison'),('ice lightning'),('megaphone'),('crown'),('guild'),('meso'),('red potion'),('blue potion'),('elixir'),('scroll'),('starforce'),('throwing star'),('maple leaf'),('pet'),('mount'),('world boss'),('guild boss'),('training ground'),('guild war'),('guild conquest') on conflict do nothing;

-- each round offers 3 normal words + 1 special (MapleStory Idle) word; the special one is returned separately so the
-- page can mark it. Custom words from the room settings join the normal pool ("only custom" = custom words, no special).
create or replace function draw_new_round(room text, drawer text, dur integer default 80, custom text[] default null, only_custom boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare rid uuid; ch text[]; sp text; cw text[];
begin
  perform rl_check('draw_new_round', 30, 60);
  delete from draw_rounds where created_at < now() - interval '1 day';
  select coalesce(array_agg(distinct w), '{}') into cw
    from (select lower(trim(x)) w from unnest(coalesce(custom, '{}')) x limit 200) c where w ~ '^[a-z0-9 ]{2,30}$';
  if only_custom and cardinality(cw) >= 3 then
    select array_agg(w) into ch from (select w from unnest(cw) w order by random() limit 3) s;
  else
    select array_agg(w) into ch from (select w from (select word w from draw_words union select unnest(cw)) p order by random() limit 3) s;
    select word into sp from draw_words_special where word <> all(ch) order by random() limit 1;
    if sp is not null then ch := ch || sp; end if;
  end if;
  insert into draw_rounds (room, drawer, choices, duration)
    values (left(room, 20), left(drawer, 40), ch, greatest(30, least(coalesce(dur, 80), 180))) returning id into rid;
  return json_build_object('id', rid, 'choices', ch, 'special', sp);
end $$;
revoke all on function draw_new_round(text, text, integer, text[], boolean) from public, anon, authenticated;
grant execute on function draw_new_round(text, text, integer, text[], boolean) to anon;
select (select count(*) from draw_words) as normal_words, (select count(*) from draw_words_special) as special_words;
