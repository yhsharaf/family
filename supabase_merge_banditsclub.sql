-- BanditsClub merged into Family (2026-10-14): its members count as guild members in the games
-- (Family Kart times and points, Draw & Guess and Werewolf Hall of Fame, the founders' bonks...).
-- This only ADDS names to the guild list; nothing is deleted. Run it once in the Supabase SQL editor.
insert into draw_guild (name) values
  ('iThrowDarts'),
  ('JongUnOppa'),
  ('PasirRisMRT'),
  ('Shuriken'),
  ('ADCO'),
  ('mewmew'),
  ('Junpi'),
  ('ahpak'),
  ('Asemu'),
  ('Nike'),
  ('Kuso'),
  ('Ninnjub'),
  ('DiuNiMaBi'),
  ('随意'),
  ('Ally'),
  ('FearSkyKings'),
  ('xXHero'),
  ('冰夜'),
  ('Amazee'),
  ('ZhxxG'),
  ('戬灵'),
  ('阿毛'),
  ('DalSegno'),
  ('IUniverse'),
  ('Harux'),
  ('Hyro'),
  ('Killzard'),
  ('Rybear'),
  ('大伯公')
on conflict (name) do nothing;
select count(*) as guild_names from draw_guild;
