-- Family Kart: fresh start. Wipes every saved Time Trial time + ghost, every multiplayer point, and any open rooms.
-- Touches Family Kart tables only (nothing from Bonk Duel, Draw & Guess, Werewolf, members etc.). Can't be undone.
truncate table kart_times, kart_points, kart_room_players, kart_rooms;
select 'family kart is brand new' as done;
