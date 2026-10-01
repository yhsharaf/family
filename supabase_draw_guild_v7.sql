-- only real guild names score on the Draw & Guess Hall of Fame (guests can play, but nothing is saved)
create table if not exists draw_guild (name text primary key);
insert into draw_guild values ('0xFox8'),('AgentRainz'),('Amorie'),('Anna'),('Anson'),('ApaIni'),('ArcaneZX'),('AshBvrn'),('Astrid'),('Atelia'),('BabyRainie'),('Belazhan'),('Benji'),('BiuBiiu'),('Bluebird'),('Bonney'),('Callaway'),('CallerID'),('CaoNiMaBii'),('Carrot'),('Chai'),('Cheat'),('Clarmizuki'),('CrtlAltDel'),('Dandadan888'),('DarDarDar'),('DigHate'),('Downfall'),('Dreiizy'),('ELaineMM'),('Ease'),('Elucion'),('Enavin'),('Error4x4'),('FARFARAWAYY'),('Fantasies'),('Fart'),('Fauna'),('Framed'),('GW2ndSHIOK'),('GanBishop'),('Glitchery'),('Goodnlght'),('Grayce'),('GreenCroco'),('Gunslingerz'),('HELLOISMESKY'),('Haste'),('Hayso'),('Hayyy'),('Henehoe'),('HolySkr'),('Hyolyn'),('ILoveRain'),('IOO7I'),('ImDubai'),('Intense'),('IvanLove'),('IvanPyw'),('IvanVirus'),('JLAM'),('JeezusCries'),('Jeffffner'),('Jefffner'),('Jeremu'),('Jojoesang'),('Joonie'),('Joonieee'),('Josu'),('Kaiseki'),('Kawaiine'),('Keith'),('Korben'),('Kuumorie'),('Kyde'),('Kyded'),('Kydo'),('LaoGojira'),('LeiLei'),('Linng'),('Mago'),('Mango'),('Manuel92'),('MikeAgain'),('Milim'),('Minng'),('Mluetac'),('MochiBun'),('Monkeywu'),('MrYaNdAu'),('Muchacho'),('Multiverze'),('NongPloy'),('Noobed'),('Nord'),('OhMyXy'),('OnceSurvive'),('Onnox'),('OrhPeeSai'),('PandanKaya'),('PhantomFist'),('PhantomShade'),('PoorBij'),('Porsche'),('Puffs'),('Quivy'),('RIPs'),('Rain'),('Rate'),('Rival'),('SA10'),('SERENA'),('SG#8E7V9F0R8T'),('SG#LXBX5FSO77'),('SG#QRTBI4MEXH'),('SalaryMan'),('Sefu'),('Sensuous'),('Sephry'),('Sera'),('ShinYuna'),('ShoooootDieU'),('Sian'),('Siera'),('Silo'),('Silvia'),('Simm'),('Simonlord'),('Smakden'),('Soga'),('Starrify'),('Starss'),('StormFox'),('Suikoden'),('SuperMarioX'),('Swordo'),('Symphony'),('Test'),('Tiera'),('TunaBB'),('Turritopsis'),('Valoric'),('Vesya'),('VesyaF2P'),('VirusIvan'),('Voze'),('Wahh'),('WhinyLanPor'),('WhyOWhy'),('Winter'),('WoShiDav'),('Wonkz'),('Xeonix'),('Xiaxue'),('XtraSugar'),('Xtreme'),('YashaNL'),('Yumeko'),('Zean'),('Zele'),('Zenin9th'),('Zien'),('ZintShad'),('affo'),('appleming'),('aubergine'),('avocuddle'),('azzr'),('bearbear00'),('bloopbloop'),('busyworks'),('cinnnamoroll'),('cutesleepie'),('daddychua'),('doki'),('eggplantboy'),('iLoveFatArse'),('jtym'),('llps'),('lron'),('noroimusha'),('oFUYUKOo'),('odbo'),('pawly'),('piggywiggy'),('pugr'),('romA'),('rothog'),('saffron'),('santouyuu'),('secretsword'),('seollem'),('smil3yX'),('soufflee'),('starBUCC'),('tMoney1'),('thailand1234'),('unaccount'),('xBluebell'),('xBobby'),('xForkz'),('xGenesis'),('xKyo'),('xNSS'),('xPanz'),('xPlatez'),('xSteve'),('xXPewpewXx'),('xeonneo'),('yours'),('yours2'),('zMsG'),('zVin'),('前男友'),('平行世界xT'),('梦Ace6'),('神魔') on conflict do nothing;
alter table draw_guild enable row level security;
revoke all on draw_guild from anon, authenticated;
delete from draw_scores where player not in (select name from draw_guild);

create or replace function draw_pick(rid uuid, w text) returns json
language plpgsql security definer set search_path = public as $$
declare r draw_rounds;
begin
  select * into r from draw_rounds where id = rid;
  if r.id is null then raise exception 'no round'; end if;
  if r.word is null then
    if not (w = any(r.choices)) then w := r.choices[1]; end if;
    update draw_rounds set word = w, started_at = now(), ends_at = now() + make_interval(secs => duration) where id = rid returning * into r;
    if exists (select 1 from draw_guild where name = r.drawer) then
      insert into draw_scores as ds (player, drew) values (r.drawer, 1) on conflict (player) do update set drew = ds.drew + 1;
    end if;
  end if;
  return json_build_object('mask', draw_mask(r.word, '{}'), 'ends_at', r.ends_at);
end $$;

create or replace function draw_guess(rid uuid, player text, g text) returns json
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r draw_rounds; t int; pts int; guess text := lower(trim(g)); p text := left(draw_guess.player, 40);
begin
  select * into r from draw_rounds where id = rid;
  if r.word is null or now() >= r.ends_at then return json_build_object('r', 'late'); end if;
  if p = r.drawer then return json_build_object('r', 'drawer'); end if;
  if exists (select 1 from draw_guessed dg where dg.round_id = rid and dg.player = p) then return json_build_object('r', 'done'); end if;
  insert into draw_tries as dt (round_id, player, n) values (rid, p, 1) on conflict (round_id, player) do update set n = dt.n + 1 returning dt.n into t;
  if t > 25 then return json_build_object('r', 'limit'); end if;
  if guess = r.word then
    insert into draw_guessed (round_id, player) values (rid, p);
    pts := 100 + round(400 * greatest(0, extract(epoch from r.ends_at - now())) / r.duration);
    if exists (select 1 from draw_guild where name = p) then
      insert into draw_scores as ds (player, points, guessed) values (p, pts, 1)
        on conflict (player) do update set points = ds.points + pts, guessed = ds.guessed + 1;
    end if;
    update draw_scores ds set points = ds.points + 50 where ds.player = r.drawer;
    return json_build_object('r', 'correct', 'pts', pts);
  elsif char_length(r.word) > 3 and extensions.levenshtein(guess, r.word) <= 1 then
    return json_build_object('r', 'close');
  end if;
  return json_build_object('r', 'wrong');
end $$;
select count(*) as guild_names from draw_guild;
