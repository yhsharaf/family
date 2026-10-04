// Bonk Duel: a 1v1 mind game. Both players secretly pick a move, then both are revealed at once (like Yomi or Pokémon).
// Online duels are run by the database (bd_* functions: secret picks, the clock, damage, Hall of Fame); practice duels
// against monsters run right here with the same rules. Art comes from MapleStory (maplestory.io): damage numbers,
// Power Guard, Dark Sight, the Level Up effect, the tombstone and the Henesys hunting ground.
(() => {
const CFG = window.FAMILY_CONFIG || {};
const $b = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
                del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const BAD = /\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|dick|pussy|kys)\w*/i;
const M = "media/duel/";
const MOVES = {
  bonk:   { name: "Bonk",       icon: "pico.png",        cost: 1, desc: "2 damage. A Shield blocks it." },
  heavy:  { name: "Heavy Bonk", icon: "square.png",      cost: 3, desc: "4 damage. Smashes Shields, but a Dodge counters it." },
  shield: { name: "Shield",     icon: "guard_i.png",     cost: 0, desc: "Blocks a Bonk and gives you +1 MP back." },
  dodge:  { name: "Dodge",      icon: "darksight_i.png", cost: 1, desc: "Dodges a Heavy Bonk and hits back for 3." },
  charge: { name: "Elixir",     icon: "elixir.png",      cost: 0, desc: "+2 MP, but you take +1 damage this turn." },
};
const ORDER = ["bonk", "heavy", "shield", "dodge", "charge"];
// class skills (the 6th move) and classes: each has a passive and a skill
Object.assign(MOVES, {
  rage:     { name: "Rage",       icon: "sk_rage.png",       cost: 1, desc: "Blocks a Bonk, and your next hit does +2." },
  teleport: { name: "Teleport",   icon: "sk_teleport.png",   cost: 2, desc: "Nothing can hit you, and you zap an attacker for 1. Not two turns in a row." },
  arrow:    { name: "Arrow Rain", icon: "sk_arrowrain.png",  cost: 2, desc: "3 damage that can't be blocked or dodged." },
  steal:    { name: "Steal",      icon: "sk_steal.png",      cost: 1, desc: "2 damage. If they drink an Elixir, you get their +2 MP." },
  coin:     { name: "Lucky Shot", icon: "sk_doubleshot.png", cost: 2, desc: "Coin flip: 4 damage, or nothing. A Shield blocks it." },
});
const CLASSES = {
  warrior:  { name: "Warrior",  e: "🗡️", skill: "rage",     passive: "22 HP instead of 20" },
  magician: { name: "Magician", e: "🔮", skill: "teleport", passive: "Starts with 4 MP, holds up to 6" },
  bowman:   { name: "Bowman",   e: "🏹", skill: "arrow",    passive: "Bigger critical-tap window" },
  thief:    { name: "Thief",    e: "🗝️", skill: "steal",    passive: "Dodge is free" },
  pirate:   { name: "Pirate",   e: "🏴‍☠️", skill: "coin",     passive: "21 HP instead of 20" },
};
const MAPS = {
  // plat: the platform picture (w×h), the row its walkable top is at, and how much of the arena width it spans
  henesys: { name: "Henesys",       rule: "Normal rules",      plat: { w: 900, h: 482, top: 140, frac: .86 } },
  elnath:  { name: "El Nath",       rule: "Dodge is free",     plat: { w: 900, h: 541, top: 2, frac: .7 } },
  zakum:   { name: "Zakum's Altar", rule: "Every 3rd turn Zakum's arm slams a player for 4: Shield, Dodge or Teleport!", plat: { w: 850, h: 400, top: 8, frac: .8 } },
  ludi:    { name: "Ludibrium",     rule: "The clock strikes every 4th turn: MP refills",    plat: { w: 900, h: 388, top: 0, frac: .74 } },
  sleepy:  { name: "Sleepywood",    rule: "Secret HP: same random 20–40 for both, nobody can see it", plat: { w: 900, h: 400, top: 6, frac: .78 } },
};
const ATTACKS = ["bonk", "heavy", "arrow", "steal", "coin"];
// no Teleport two turns in a row: side s just teleported?
const justTeleported = (s, side) => !!(s && s.last && s.last["m" + side] === "teleport");
const cost = (m, cls, map) => m === "dodge" ? (map === "elnath" || cls === "thief" ? 0 : 1) : (MOVES[m] || {}).cost || 0;
const realMove = (m, cls) => m === "skill" ? CLASSES[cls].skill : m;
let myClass = CLASSES[store.get("family_bd_class")] ? store.get("family_bd_class") : "warrior";
const BOTS = {
  orange_mushroom: { name: "Orange Mushroom", lvl: "Easy",   cls: "bowman",   say: ["*squish*", "Mush mush! 🍄", "Bonk me if you can 🍄", "*boing boing*"] },
  zombie_mushroom: { name: "Zombie Mushroom", lvl: "Medium", cls: "thief", say: ["Braaains… 🧟", "*groan*", "I'm already dead, you can't hurt me", "Mush… rot…"] },
  jr_balrog:       { name: "Jr. Balrog",      lvl: "Hard",   cls: "warrior",   say: ["Grrr! 🔥", "Puny Mapler…", "I can read you 😈", "🔥🔥🔥"] },
};
const TAUNTS = ["Bonk incoming! 🔨", "Is that all? 😏", "Ouch 😭", "I see you 👀", "Hehe 😈", "Nooo! 😱", "Mesos pls 💰", "GG 🤝"];
// effect strips (frames side by side, origin = where the effect is anchored)
const FX = {
  burst:    { src: "heavyhit.png", w: 71,  h: 69,  n: 2,  ox: 35,  oy: 34,  ms: 180 },
  star:     { src: "bonkfx.webp",  w: 164, h: 156, n: 6,  ox: 85,  oy: 100, ms: 300 },
  slash:    { src: "bonkhit.png",  w: 110, h: 118, n: 2,  ox: 75,  oy: 58,  ms: 200 },
  smoke:    { src: "darksight.png", w: 67, h: 96,  n: 4,  ox: 38,  oy: 108, ms: 360 },
  guard:    { src: "guard.webp",   w: 87,  h: 90,  n: 12, ox: 52,  oy: 87,  ms: 1000 },
  buff:     { src: "buff.webp",    w: 119, h: 113, n: 8,  ox: 68,  oy: 101, ms: 640 },
  levelup:  { src: "levelup.webp", w: 301, h: 362, n: 21, ox: 148, oy: 345, ms: 1890 },
  rage:     { src: "rage.webp",     w: 108, h: 123, n: 13, ox: 63,  oy: 123, ms: 1300 },
  arrows:   { src: "arrowrain.webp", w: 129, h: 197, n: 12, ox: 94, oy: 158, ms: 780 },
  arrowhit: { src: "arrowhit.png",  w: 101, h: 133, n: 3,  ox: 40,  oy: 110, ms: 360 },
  steal:    { src: "steal.png",     w: 95,  h: 64,  n: 4,  ox: 23,  oy: 65,  ms: 460 },
  shot:     { src: "shothit.png",   w: 100, h: 52,  n: 4,  ox: 57,  oy: 30,  ms: 240 },
};
const DIG = { red: ["nored1.png", 37, 39], cri: ["nocri1.png", 43, 48], blue: ["noblue1.png", 37, 39], violet: ["noviolet1.png", 37, 39] };
document.head.insertAdjacentHTML("beforeend", "<style>" + Object.entries(FX).map(([k, f]) =>
  `@keyframes bdfx-${k} { from { background-position: 0 0 } to { background-position: -${f.w * f.n}px 0 } }`).join("\n") + "</style>");

const roster = [...D.founders, ...D.members].filter((p, i, a) => a.findIndex(q => q.name === p.name) === i);
const guildOf = n => roster.find(p => p.name.toLowerCase() === n.trim().toLowerCase());
const spriteOf = n => (roster.find(p => p.name === n) || {}).sprite || M + "guest.png?v=2";

let sb = null, ch = null, sess = null, st = null, leftAt = 0, polling = false, pollT = null, tickT = null;
let shownTurn = -1, animUntil = 0, disp = null, bot = null, room = "public", liveT = null, lastBanner = "";

// ------------------------------------------------------------------ lobby
$b("#bdHelp").innerHTML = ORDER.map(k => { const m = MOVES[k];
  return `<div class="bdh"><img src="${M + m.icon}" alt=""><b>${m.name}</b><i>${m.cost ? m.cost + " MP" : "Free"}</i><small>${m.desc}</small></div>`; }).join("");
function drawClasses() {
  $b("#bdClasses").innerHTML = Object.entries(CLASSES).map(([k, c]) => { const sk = MOVES[c.skill];
    return `<button type="button" class="bd-class ${k === myClass ? "on" : ""}" data-c="${k}"><img src="${M + sk.icon}" alt="">
      <b>${c.e} ${c.name}</b><small><i>${sk.name}</i> (${sk.cost} MP): ${sk.desc}<br>✨ ${c.passive}</small></button>`; }).join("");
}
drawClasses();
$b("#bdClasses").addEventListener("click", e => {
  const b = e.target.closest(".bd-class"); if (!b) return;
  myClass = b.dataset.c; store.set("family_bd_class", myClass); drawClasses(); sound("blip");
});
$b("#bdMaps").innerHTML = Object.values(MAPS).map(m => `<span><b>${m.name}</b> ${m.rule}</span>`).join("");
$b("#bdBots").innerHTML = Object.entries(BOTS).map(([k, b]) =>
  `<button type="button" class="bd-bot" data-k="${k}"><img src="media/mobs/anim/${k}.gif?v=3" alt=""><b>${b.name}</b><small>${b.lvl}</small></button>`).join("");

function showFace() {
  const n = $b("#bdName").value.trim(), g = guildOf(n);
  $b("#bdFace").innerHTML = g && g.sprite ? `<img src="${g.sprite}" alt="">` : `<img src="${M}guest.png?v=2" alt="">`;
  $b("#bdWarn").hidden = !n || !!g;
}
let suggIdx = -1;
function suggest() {
  const q = $b("#bdName").value.trim().toLowerCase(), box = $b("#bdSugg");
  if (!q) { box.hidden = true; return; }
  const hits = roster.filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length).slice(0, 8);
  if (!hits.length || (hits.length === 1 && hits[0].name.toLowerCase() === q)) { box.hidden = true; return; }
  suggIdx = -1;
  box.innerHTML = hits.map(p => `<button type="button" data-n="${esc(p.name)}">${p.sprite ? `<img src="${p.sprite}" alt="">` : "<span style='width:34px'>👤</span>"}
    ${esc(p.name)}</button>`).join("");
  box.hidden = false;
}
$b("#bdSugg").addEventListener("pointerdown", e => {
  const b = e.target.closest("button"); if (!b) return; e.preventDefault();
  $b("#bdName").value = b.dataset.n; $b("#bdSugg").hidden = true; showFace();
});
$b("#bdName").addEventListener("input", () => { showFace(); suggest(); });
$b("#bdName").addEventListener("blur", () => setTimeout(() => $b("#bdSugg").hidden = true, 150));
$b("#bdName").addEventListener("keydown", e => {
  const items = [...$b("#bdSugg").querySelectorAll("button")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!items.length) return; e.preventDefault();
    suggIdx = (suggIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("on", i === suggIdx)); }
  if (e.key === "Enter") { e.preventDefault();
    if (suggIdx >= 0 && items[suggIdx]) { $b("#bdName").value = items[suggIdx].dataset.n; $b("#bdSugg").hidden = true; showFace(); }
    else $b("#bdFind").click(); }
});
$b("#bdName").value = store.get("family_me") || "";
showFace();

function roomFromHash() { const m = location.hash.match(/^#duel\/([A-Z0-9]{4,8})$/); return m ? m[1] : null; }
$b("#bdPrivate").onclick = () => {
  location.hash = "#duel/" + Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  setTimeout(() => $b("#bdFind").click(), 50);
};
function updateRoomLabel() {
  const r = roomFromHash();
  $b("#bdRoomLbl").innerHTML = r ? `🔒 Friend duel <b>${r}</b>: share the link, first one to join fights you` : "";
  $b("#bdFind").textContent = r ? "Enter the Duel!" : "Find a Duel!";
  $b("#bdPrivate").hidden = !!r;
}
const onPage = () => location.hash === "#duel" || location.hash.startsWith("#duel/");
addEventListener("hashchange", () => {
  if (location.hash.startsWith("#duel/")) {  // the router only knows #duel; show the page for friend links too
    document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === "duel"));
    document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#duel"));
  }
  updateRoomLabel();
  if (onPage()) { loadBoard(); tryResume(); loadLive(); }
});
updateRoomLabel();
if (location.hash.startsWith("#duel/")) setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 0);
else if (location.hash === "#duel") setTimeout(() => { loadBoard(); tryResume(); loadLive(); }, 0);

async function client() {
  if (!CFG.supabaseUrl) return null;
  if (!window.supabase) {
    await new Promise((res, rej) => { const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  return sb = sb || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
}
function myName() {
  const n = $b("#bdName").value.trim().slice(0, 20);
  if (n.length < 2) { $b("#bdErr").textContent = "Type a name first."; return null; }
  if (BAD.test(n)) { $b("#bdErr").textContent = "Pick a family friendly name 🙂"; return null; }
  $b("#bdErr").textContent = "";
  if (guildOf(n)) { store.set("family_me", guildOf(n).name); return guildOf(n).name; }
  return n;
}
const tokKey = () => "bd_tok:" + (roomFromHash() || "public");
async function join(name, tok) {
  if (!(await client())) { $b("#bdErr").textContent = "Online duels need the database connection. Try a practice monster!"; return; }
  room = roomFromHash() || "public";
  const { data, error } = await sb.rpc("bd_join", { p_room: room, p_name: name || "", p_tok: tok || null, p_class: myClass });
  if (error || !data) { $b("#bdErr").textContent = /slow down/.test(error && error.message) ? "Too many tries, wait a minute 🙂" : "Couldn't connect, try again."; return; }
  if (data.r === "running" && data.game) { if (name) watch(data.game); return data.r; }
  const why = { name: "Type a name first.", taken: "That name is already waiting for a duel. Pick another name!",
                busy: "20 duels are going on right now! Try again in a minute, or practice against a monster.",
                slow: "You've opened a lot of duels. Wait a few minutes 🙂", gone: "" }[data.r];
  if (why != null) { if (!tok) $b("#bdErr").textContent = why; return data.r; }
  sess = { game: data.game, token: data.token, name: data.name }; store.set(tokKey(), JSON.stringify(sess));
  enter(); return "ok";
}
$b("#bdFind").onclick = async () => {
  const n = myName(); if (!n) return;
  let saved = null; try { saved = JSON.parse(store.get(tokKey())); } catch (e) {}
  if (saved && saved.name === n && (await join(n, saved.token)) === "ok") return;
  await join(n, null);
};
async function tryResume() {  // came back after a refresh / closed tab: rejoin silently with the saved token
  if (sess || bot) return;
  let saved = null; try { saved = JSON.parse(store.get(tokKey())); } catch (e) {}
  if (saved && saved.token) await join("", saved.token);
}
$b("#bdBots").addEventListener("click", e => {
  const b = e.target.closest(".bd-bot"); if (!b) return;
  const n = $b("#bdName").value.trim() ? myName() : "You"; if (!n) return;
  startBot(b.dataset.k, n);
});
async function loadLive() {
  clearTimeout(liveT);
  if (!onPage() || sess || bot) return;
  liveT = setTimeout(loadLive, 10000);
  if (!(await client())) return;
  const { data } = await sb.rpc("bd_live");
  $b("#bdLive").innerHTML = (data || []).length ? data.map(d => `<button type="button" class="bd-live" data-g="${d.id}">
      <img src="${spriteOf(d.p1)}" alt=""><span><b>${esc(d.p1)}</b> ${d.map === "sleepy" ? "?" : d.hp1}❤️ <i>vs</i> <b>${esc(d.p2)}</b> ${d.map === "sleepy" ? "?" : d.hp2}❤️<small>turn ${d.turn} · ${esc((MAPS[d.map] || MAPS.henesys).name)}${d.stake > 1 ? ` · 🔥 ×${d.stake}` : ""}</small></span>
      <img class="r" src="${spriteOf(d.p2)}" alt="">👀</button>`).join("")
    : `<p class="bd-none">Nobody is dueling right now. Be the first!</p>`;
}
$b("#bdLive").addEventListener("click", e => { const b = e.target.closest(".bd-live"); if (b) watch(b.dataset.g); });

// ------------------------------------------------------------------ entering / leaving a duel
function showGame() {
  $b("#bdLobby").hidden = true; $b("#bdGame").hidden = false; $b("#duel").classList.add("playing"); document.body.classList.add("bd-playing");
  $b("#bdResult").hidden = true; $b("#bdArena").querySelectorAll(".bd-fx, .bd-num, .bd-tomb, .bd-bubble, .bd-card, .bd-arm").forEach(x => x.remove());
  ["#bdF1", "#bdF2"].forEach(k => { const f = $b(k); f.classList.remove("bd-ko", "bd-lunge", "bd-ouch"); f.dataset.n = ""; });
  window.scrollTo(0, 0); st = null; shownTurn = -1; animUntil = 0; disp = null; lastBanner = "";
  clearTimeout(liveT);
}
function enter() {
  showGame(); listen(sess.game);
  poll(); clearInterval(pollT); pollT = setInterval(poll, 1500);
}
function watch(game) {
  showGame(); sess = { game, token: null, name: null, watch: true }; listen(game);
  poll(); clearInterval(pollT); pollT = setInterval(poll, 2000);
}
function listen(game) {
  if (ch) sb.removeChannel(ch);
  ch = sb.channel("bd:" + game, { config: { broadcast: { self: false } } });
  ch.on("broadcast", { event: "poke" }, () => setTimeout(poll, 120));
  ch.on("broadcast", { event: "taunt" }, ({ payload }) => payload && TAUNTS[payload.t] && bubble(payload.s, TAUNTS[payload.t]));
  ch.subscribe();
}
function exit(msg) {
  clearInterval(pollT); pollT = null; if (ch && sb) sb.removeChannel(ch); ch = null;
  sess = null; st = null; bot = null;
  $b("#bdLobby").hidden = false; $b("#bdGame").hidden = true; $b("#duel").classList.remove("playing"); document.body.classList.remove("bd-playing");
  $b("#bdErr").textContent = msg || ""; loadBoard(); loadLive();
}
$b("#bdLeave").onclick = async () => {
  const live = st && ["pick", "double"].includes(st.status) && st.me;
  if (live && !confirm(bot ? "Run away from the monster?" : "Leave the duel? You'll lose it.")) return;
  if (sess && sess.token) { sb.rpc("bd_leave", { p_game: sess.game, p_tok: sess.token }).then(() => poke()); store.del(tokKey()); }
  exit();
};
const poke = () => ch && ch.send({ type: "broadcast", event: "poke", payload: {} });

async function poll() {
  if (!sess || polling || bot) return; polling = true;
  try {
    const { data } = await sb.rpc("bd_state", { p_game: sess.game, p_tok: sess.token });
    if (!data) return;
    if (data.r === "gone") { store.del(tokKey()); exit("That duel has ended."); return; }
    onState(data);
  } finally { polling = false; }
}
function onState(data) {
  const prev = st; st = data; leftAt = Date.now();
  if (!disp || !animating()) disp = { hp1: st.hp1, hp2: st.hp2, en1: st.en1, en2: st.en2 };
  if (st.last && st.last.turn !== shownTurn) {
    if (shownTurn < 0 && prev == null && st.reveal <= 0) shownTurn = st.last.turn;  // joined mid-duel: don't replay old turns
    else { shownTurn = st.last.turn; reveal(st.last, prev); }
  } else if (st.last == null) shownTurn = 0;
  if ((prev && prev.status === "wait" && st.status === "pick") || (!prev && st.status === "pick" && st.turn === 1 && st.reveal > 2)) { sound("start"); introBanner(); }
  if (st.map === "zakum" && st.arm && st.status === "pick" && (!prev || prev.turn !== st.turn)) armWarning();
  // the other player's critical tap shows up a moment later
  if (st.last && prev && prev.last && prev.last.turn === st.last.turn) [1, 2].forEach(s => {
    if (st.last["c" + s] && !prev.last["c" + s] && s !== st.me) critShow(3 - s);
  });
  if (prev && prev.status !== "double" && st.status === "double") { sound("double");
    banner(`🔥 ${esc(st["p" + st.dbl_by])} wants to DOUBLE BONK!`, 2500); }
  if (prev && prev.stake !== st.stake && st.stake > prev.stake) banner(`🔥 Stakes doubled: ${st.stake} points!`, 2000);
  render();
}
const animating = () => Date.now() < animUntil;

// ------------------------------------------------------------------ practice monsters (same rules, run locally)
// damage move a does to someone who picked b (heads = Lucky Shot coin) -- same as bd_hit in supabase_duel_v16.sql
const hit = (a, b, heads) => b === "teleport" ? 0 : a === "bonk" ? (b === "shield" || b === "rage" ? 0 : 2)
  : a === "heavy" ? (b === "dodge" ? 0 : 4) : a === "arrow" ? 3 : a === "coin" ? (b === "shield" ? 0 : heads ? 4 : 0)
  : a === "steal" ? (b === "shield" || b === "rage" ? 0 : 2) : 0;
// one turn of a duel: s holds hp/en/class/map/rage/lucky; returns the round result (doesn't change s)
function clash(s, m1, m2, h1, h2) {
  const sd = s.turn >= 10;
  let x1 = hit(m2, m1, h2), x2 = hit(m1, m2, h1), r1 = s.rage1, r2 = s.rage2, l1 = false, l2 = false;
  if (m1 === "teleport" && ATTACKS.includes(m2)) x2++;   // Teleport zaps back for 1
  if (m2 === "teleport" && ATTACKS.includes(m1)) x1++;
  if (m1 === "dodge" && m2 === "heavy") x2 += 3;
  if (m2 === "dodge" && m1 === "heavy") x1 += 3;
  if (x1 > 0 && (m1 === "charge" || m1 === "zzz")) x1++;
  if (x2 > 0 && (m2 === "charge" || m2 === "zzz")) x2++;
  if (x2 > 0 && r1) { x2 += 2; r1 = false; }
  if (x1 > 0 && r2) { x1 += 2; r2 = false; }
  if (m1 === "rage") r1 = true; if (m2 === "rage") r2 = true;
  if (sd && x1 > 0) x1++; if (sd && x2 > 0) x2++;
  // Zakum's Arm Slam: the aimed-at player takes 4 unless they Shield, Dodge or Teleport (same as bd_resolve)
  const safe = m => m === "shield" || m === "dodge" || m === "teleport";
  if (s.arm === 1 && !safe(m1)) x1 += 4; if (s.arm === 2 && !safe(m2)) x2 += 4;
  const regen = sd ? 2 : 1;
  const e1 = s.en1 - cost(m1, s.class1, s.map) + regen + (m1 === "charge" && m2 !== "steal" ? 2 : 0) + (m2 === "charge" && m1 === "steal" ? 2 : 0)
    + (m1 === "shield" && (m2 === "bonk" || m2 === "steal") ? 1 : 0);
  const e2 = s.en2 - cost(m2, s.class2, s.map) + regen + (m2 === "charge" && m1 !== "steal" ? 2 : 0) + (m1 === "charge" && m2 === "steal" ? 2 : 0)
    + (m2 === "shield" && (m1 === "bonk" || m1 === "steal") ? 1 : 0);
  return { x1, x2, r1, r2, l1, l2, sd, e1: Math.min(s.enmax1, Math.max(0, e1)), e2: Math.min(s.enmax2, Math.max(0, e2)) };
}
function resolveTurn(s) {
  const m1 = realMove(s.pick1 || "zzz", s.class1), m2 = realMove(s.pick2 || "zzz", s.class2);
  const h1 = m1 === "coin" && Math.random() < .5, h2 = m2 === "coin" && Math.random() < .5;
  const r = clash(s, m1, m2, h1, h2);
  s.last = { turn: s.turn, m1, m2, d1: r.x1, d2: r.x2, sd: r.sd, h1, h2, l1: r.l1, l2: r.l2, arm: s.arm || 0 };
  s.hp1 = Math.max(0, s.hp1 - r.x1); s.hp2 = Math.max(0, s.hp2 - r.x2); s.en1 = r.e1; s.en2 = r.e2;
  s.rage1 = r.r1; s.rage2 = r.r2; s.lucky1 = s.lucky1 || r.l1; s.lucky2 = s.lucky2 || r.l2;
  s.afk1 = m1 === "zzz" ? s.afk1 + 1 : 0; s.afk2 = m2 === "zzz" ? s.afk2 + 1 : 0;
  s.pick1 = s.pick2 = null; s.picked1 = s.picked2 = false; s.mine = null; s.turn++;
  if (s.map === "ludi" && s.turn % 4 === 0) { s.en1 = s.enmax1; s.en2 = s.enmax2; }   // the clock strikes (same as bd_resolve)
  s.arm = 0;
  if (s.map === "zakum" && s.turn % 3 === 0) { s.arm = s.armnext; s.armnext = 3 - s.armnext; }   // the arm takes turns: A B A B or B A B A
  checkEnd(s);
}
function checkEnd(s) {
  const end = (w, why) => { s.status = "over"; s.winner = w; s.why = why; };
  if (s.hp1 === 0 || s.hp2 === 0) end(s.hp1 === s.hp2 ? 0 : s.hp1 > s.hp2 ? 1 : 2, s.hp1 === s.hp2 ? "draw" : "ko");
  else if (s.afk1 >= 3) end(2, "afk");
  else if (s.turn > 20) end(s.hp1 === s.hp2 ? 0 : s.hp1 > s.hp2 ? 1 : 2, "time");
}
function startBot(kind, name) {
  showGame();
  bot = { kind, hist: [], timer: null };
  const c1 = myClass, c2 = BOTS[kind].cls, map = MAPS[new URLSearchParams(location.search).get("bdmap")] ? new URLSearchParams(location.search).get("bdmap") : Object.keys(MAPS)[Math.floor(Math.random() * 5)], secs = 15;
  const secret = 20 + Math.floor(Math.random() * 21);   // Sleepywood: same hidden HP for both
  const hp = c => map === "sleepy" ? secret : c === "warrior" ? 22 : c === "pirate" ? 21 : 20, en = c => c === "magician" ? 4 : 3, enmax = c => c === "magician" ? 6 : 5;
  st = { r: "ok", me: 1, status: "pick", turn: 1, p1: name, p2: BOTS[kind].name, class1: c1, class2: c2, map, secs,
         hp1: hp(c1), hp2: hp(c2), hpmax1: hp(c1), hpmax2: hp(c2), en1: en(c1), en2: en(c2), enmax1: enmax(c1), enmax2: enmax(c2),
         rage1: false, rage2: false, lucky1: false, lucky2: false, afk1: 0, afk2: 0, arm: 0, armnext: 1 + Math.floor(Math.random() * 2),
         picked1: false, picked2: false, mine: null, pick1: null, pick2: null, stake: 1, dbl1: true, dbl2: true, last: null,
         left: 5 + secs, reveal: 5, on1: true, on2: true, practice: true };
  leftAt = Date.now(); disp = { hp1: st.hp1, hp2: st.hp2, en1: st.en1, en2: st.en2 }; shownTurn = 0;
  sound("start"); introBanner(); render(); botThink();
  setTimeout(() => bot && bubble(2, BOTS[kind].say[0]), 1200);
}
function botThink() {
  clearTimeout(bot.timer);
  const wait = Math.max(0, st.reveal - (Date.now() - leftAt) / 1000) * 1000 + 700 + Math.random() * 2500;
  bot.timer = setTimeout(() => { if (!bot || st.status !== "pick") return; st.pick2 = botMove(); st.picked2 = true; render(); if (st.picked1) botResolve(); }, wait);
}
function botMove() {
  const all = [...ORDER, "skill"];
  const movesFor = (cls, en, side) => all.filter(m => cost(realMove(m, cls), cls, st.map) <= en && !(realMove(m, cls) === "teleport" && justTeleported(st, side)));
  const can = movesFor(st.class2, st.en2, 2);
  const pick = w => { const ks = Object.keys(w).filter(k => can.includes(k) && w[k] > 0); let r = Math.random() * ks.reduce((a, k) => a + w[k], 0);
    for (const k of ks) if ((r -= w[k]) <= 0) return k; return ks[0] || "shield"; };
  const h = bot.hist;
  if (bot.kind === "orange_mushroom") return pick({ bonk: 3, heavy: 2, shield: 2, dodge: 1, charge: 2, skill: 1 });
  if (bot.kind === "zombie_mushroom" && Math.random() < .45) return pick({ bonk: 3, heavy: 2, shield: 2, dodge: 1, charge: 2, skill: 2 });
  if (bot.kind === "jr_balrog" && Math.random() < .12) return pick({ bonk: 2, heavy: 2, shield: 1, dodge: 1, charge: 1, skill: 1 });
  // what will the player do? count their past moves (the Jr. Balrog also looks at what they did after their last move)
  const pc = movesFor(st.class1, st.en1, 1), freq = {};
  pc.forEach(m => freq[m] = 1);
  h.forEach((m, i) => { if (freq[m] != null) freq[m] += bot.kind === "jr_balrog" && i > 0 && h[i - 1] === h[h.length - 1] ? 3 : 1; });
  const tot = Object.values(freq).reduce((a, b) => a + b, 0);
  const val = b => pc.reduce((acc, p) => {   // expected (damage dealt − damage taken) + a little for MP, coin flips averaged
    const m1 = realMove(p, st.class1), m2 = realMove(b, st.class2);
    const flips = [[false, false], [false, true], [true, false], [true, true]].filter(([a1, a2]) => (m1 === "coin" || !a1) && (m2 === "coin" || !a2));
    const v = flips.reduce((t, [a1, a2]) => { const r = clash(st, m1, m2, a1, a2);
      return t + r.x1 - r.x2 * (st.hp2 <= 6 ? 1.4 : 1) + (r.e2 - st.en2) * .35 + (r.x1 >= st.hp1 ? 6 : 0) + (r.r2 && !st.rage2 ? .8 : 0); }, 0) / flips.length;
    return acc + freq[p] / tot * v;
  }, 0);
  const scored = can.map(b => [b, val(b)]).sort((a, b) => b[1] - a[1]);
  return Math.random() < .8 || scored.length < 2 ? scored[0][0] : scored[1][0];
}
function botResolve() {
  bot.hist.push(st.pick1 || "zzz");
  const before = { ...st };
  resolveTurn(st);
  st.left = 4 + st.secs; st.reveal = 4; leftAt = Date.now();
  shownTurn = st.last.turn; reveal(st.last, before);
  if (st.status === "pick" && st.arm) armWarning();
  if (st.status === "pick") { botThink(); if (Math.random() < .3) setTimeout(() => bot && bubble(2, BOTS[bot.kind].say[Math.floor(Math.random() * 4)]), 2600); }
  render();
}

// ------------------------------------------------------------------ picking
$b("#bdMoves").addEventListener("click", async e => {
  const b = e.target.closest(".bd-move"); if (!b || b.disabled || !st) return;
  const m = b.dataset.m;
  sound("blip");
  if (bot) { st.mine = m; st.pick1 = m; st.picked1 = true; render(); if (st.picked2) botResolve(); return; }
  st.mine = m; render();   // feels instant; the database confirms
  const { data } = await sb.rpc("bd_pick", { p_game: sess.game, p_tok: sess.token, p_move: m });
  if (data && data.r === "mp") banner("Not enough MP! 🧪", 1200);
  if (data && data.r === "cd") banner("Teleport needs a turn to recharge ✨", 1400);
  poke(); polling = false; poll();
});
$b("#bdDouble").onclick = async () => {
  if (!st || bot || !sess.token) return;
  if (!confirm(`Double the stakes to ${st.stake * 2} points? Your opponent can accept, or run away and lose ${st.stake}.`)) return;
  await sb.rpc("bd_double", { p_game: sess.game, p_tok: sess.token }); poke(); polling = false; poll();
};
$b("#bdBanner").addEventListener("click", async e => {
  const b = e.target.closest("[data-a]"); if (!b || !sess || !sess.token) return;
  await sb.rpc("bd_answer", { p_game: sess.game, p_tok: sess.token, p_accept: b.dataset.a === "yes" }); poke(); polling = false; poll();
});
let tauntAt = 0;
$b("#bdTaunts").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || !st || !st.me || Date.now() - tauntAt < 1500) return;
  tauntAt = Date.now(); const t = +b.dataset.t;
  bubble(st.me, TAUNTS[t]);
  if (ch && !bot) ch.send({ type: "broadcast", event: "taunt", payload: { s: st.me, t } });
  if (bot && Math.random() < .6) setTimeout(() => bot && bubble(2, BOTS[bot.kind].say[Math.floor(Math.random() * 4)]), 900);
});
$b("#bdResult").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.a === "back") { store.del(tokKey()); exit(); return; }
  if (b.dataset.a === "again") {
    if (bot) { const k = bot.kind, n = st.p1; startBot(k, n); return; }
    const n = sess && sess.name; store.del(tokKey()); exit();
    if (n) await join(n, null);
  }
});

// ------------------------------------------------------------------ drawing
const side = () => (st && st.me) || 1;            // you are always on the left (spectators see player 1 on the left)
function fighter(el, s) {
  const name = st["p" + s], isBot = bot && s === 2;
  const hp = disp ? disp["hp" + s] : st["hp" + s], en = disp ? disp["en" + s] : st["en" + s];
  if (!name) { el.hidden = true; return; } el.hidden = false;
  const src = isBot ? `media/mobs/anim/${bot.kind}.gif?v=3` : spriteOf(name);
  const img = el.querySelector(".bd-sp");
  if (!el.dataset.n || el.dataset.n !== name) { img.src = src; el.dataset.n = name; el.dataset.src = src; el.classList.remove("bd-ko"); }
  el.classList.toggle("bd-mob", !!isBot); el.classList.toggle("bd-boss", !!isBot && bot.kind === "jr_balrog");
  const cls = CLASSES[st["class" + s]] || CLASSES.warrior, hpmax = st["hpmax" + s] || 20, enmax = st["enmax" + s] || 5;
  el.querySelector(".bd-tag").textContent = `${cls.e} ${name}`;
  const hidden = st.map === "sleepy" && st.status !== "over";   // Sleepywood: nobody knows anybody's HP
  el.querySelector(".bd-hp").classList.toggle("secret", !!hidden);
  el.querySelector(".bd-hp i").style.width = hidden ? "100%" : (hp / hpmax * 100) + "%";
  el.querySelector(".bd-hp b").textContent = hidden ? "HP ???" : `HP ${hp}/${hpmax}`;
  el.querySelector(".bd-mp").innerHTML = Array.from({ length: enmax }, (_, i) => `<i class="${i < en ? "on" : ""}"></i>`).join("") + `<b>MP ${en}</b>`;
  el.querySelector(".bd-buffs").textContent = st["rage" + s] ? "🔥 Rage" : "";
  if (s === side()) placeArm();
  const think = el.querySelector(".bd-think");
  const picking = st.status === "pick" && !inReveal();
  const ready = st["picked" + s] || (st.me === s && st.mine);
  think.textContent = picking ? (ready ? "✅" : st["on" + s] === false ? "📵" : "🤔") : "";
  think.hidden = !picking;
}
const pickLeft = () => st && st.left != null ? Math.max(0, st.left - (Date.now() - leftAt) / 1000) : null;
const inReveal = () => st && (st.reveal - (Date.now() - leftAt) / 1000 > 0 || animating());
function render() {
  if (!st) return;
  const L = side(), R = 3 - L, s = st.status, me = st.me;
  fighter($b("#bdF1"), L); fighter($b("#bdF2"), R);
  const sd = st.turn >= 10 && s !== "wait";
  $b("#bdArena").className = "bd-arena m-" + (st.map || "henesys") + (sd ? " sd" : "");
  placePlat();
  $b("#bdPhase").innerHTML = s === "wait" ? (room === "public" ? "🔍 Looking for an opponent…" : "⏳ Waiting for your friend…")
    : s === "over" ? "🏁 Duel over" : `Turn ${Math.min(st.turn, 20)}/20 · <span class="bd-map" title="${esc((MAPS[st.map] || MAPS.henesys).rule)}">${esc((MAPS[st.map] || MAPS.henesys).name)}</span>${
      st.map === "ludi" ? (st.turn % 4 === 0 ? " · <b class='clk'>⏰ MP FULL!</b>" : ` · ⏰ in ${4 - st.turn % 4}`)
      : st.map === "zakum" ? (st.arm ? " · <b class='sdt'>🖐️ ARM!</b>" : ` · 🖐️ in ${3 - st.turn % 3}`) : ""}${sd ? " · <b class='sdt'>⚡ SUDDEN DEATH</b>" : ""}`;
  $b("#bdStake").innerHTML = s === "wait" ? "" : st.practice ? "🎯 Practice" : `${st.stake > 1 ? "🔥" : "🏆"} ${st.stake} pt${st.stake > 1 ? "s" : ""}`;
  // moves
  const myEn = me ? st["en" + me] : 0, canPick = me && s === "pick" && !inReveal();
  const myCls = me ? st["class" + me] : "warrior";
  $b("#bdMoves").innerHTML = [...ORDER, "skill"].map(k => { const real = realMove(k, myCls), m = MOVES[real], c = cost(real, myCls, st.map);
    const cd = real === "teleport" && justTeleported(st, me);
    return `<button type="button" class="bd-move ${k === "skill" ? "skill" : ""} ${st.mine === k ? "sel" : ""}" data-m="${k}" ${canPick && c <= myEn && !cd ? "" : "disabled"} ${cd ? 'title="Not two turns in a row"' : ""}>
      <span class="ic"><img src="${M + m.icon}" alt=""></span><b>${m.name}</b><i>${c ? c + " MP" : "Free"}</i></button>`; }).join("");
  $b("#bdPanel").hidden = !me || s === "over" || s === "wait";
  const dblUsed = me ? st["dbl" + me] : true;
  $b("#bdDouble").hidden = !!bot || !me || dblUsed || s !== "pick" || st.stake >= 4 || st.practice;
  $b("#bdDouble").disabled = !canPick;
  $b("#bdDouble").innerHTML = `🔥 Double Bonk! <small>${st.stake}→${st.stake * 2} pts</small>`;
  // prompt line under the arena
  let say = "";
  if (s === "wait") say = room === "public" ? "Waiting for someone to press <b>Find a Duel</b>… Tell the guild! 📣"
    : `Send this link to your friend: <span class="bd-inv"><input id="bdInvite" readonly value="${esc(location.href.split("#")[0] + "#duel/" + room)}"><button class="sk-small" id="bdCopy">Copy</button></span>`;
  else if (s === "pick" && !inReveal()) {
    if (!me) say = "👀 You're watching. Both players are choosing in secret…";
    else if (st.mine) say = `✅ You picked <b>${MOVES[realMove(st.mine, st["class" + me])].name}</b>. ${st["picked" + (3 - me)] ? "Revealing…" : "Waiting for your opponent… (tap another to change)"}`;
    else say = "Pick your move! Your opponent can't see it until you both reveal 🤫";
  } else if (s === "double") {
    say = me && st.dbl_by !== me ? "🔥 Accept the Double Bonk, or run away? (no answer = accepted)"
        : me ? "⏳ Waiting for their answer… will they chicken out? 🐔" : "🔥 Double Bonk offered…";
  }
  $b("#bdSay").classList.toggle("free", s === "wait");   // the invite link needs more room; otherwise the line keeps one fixed size
  if (say && !animating()) $b("#bdSay").innerHTML = `<span>${say}</span>`;
  // double bonk question
  if (s === "double" && me && st.dbl_by !== me) {
    const html = `🔥 <b>${esc(st["p" + st.dbl_by])}</b> wants to DOUBLE the stakes to <b>${st.stake * 2} points</b>!
      <span class="bd-ans"><button data-a="yes" class="sk-btn bd-play">Bring it on!</button><button data-a="no" class="sk-btn sk-private">Run away 🐔</button></span>`;
    if (lastBanner !== html) { lastBanner = html; banner(html, 0, true); }
  } else if (lastBanner && lastBanner.includes("data-a")) { lastBanner = ""; $b("#bdBanner").className = "bd-banner"; }
  if (s === "over") showResult();
}
// stand the map's platform under the fighters: its walkable top lines up with the feet line (--gl)
function placePlat() {
  const ar = $b("#bdArena"), img = $b("#bdPlat"), mp = MAPS[(st && st.map) || "henesys"] || MAPS.henesys, p = mp.plat;
  const src = `${M}plat_${(st && MAPS[st.map]) ? st.map : "henesys"}.webp?v=5`;
  if (img.dataset.src !== src) { img.src = src; img.dataset.src = src; }
  const w = ar.clientWidth * p.frac, h = w * p.h / p.w, gl = parseFloat(getComputedStyle(ar).getPropertyValue("--gl")) || 96;
  img.style.width = w + "px"; img.style.bottom = (gl - (h - p.top * w / p.w)) + "px";
}
addEventListener("resize", () => st && placePlat());
function showResult() {
  if (!$b("#bdResult").hidden || animating()) return;   // the reveal calls render again when it's done
  const me = st.me, w = st.winner, L = side();
  const fW = w === L ? $b("#bdF1") : w === 3 - L ? $b("#bdF2") : null, fLo = w === L ? $b("#bdF2") : w === 3 - L ? $b("#bdF1") : null;
  if (fW) { fx(fW, "levelup", 1); sound("win"); }
  if (fLo && (st.why === "ko" || st.why === "time")) tomb(fLo);
  if (st.why === "draw") { tomb($b("#bdF1")); tomb($b("#bdF2")); }
  const loser = w ? esc(st["p" + (3 - w)]) : "Somebody";
  const why = { ko: "K.O.!", time: "Time's up: most HP wins.", flee: `${loser} chickened out of the Double Bonk 🐔`,
                afk: w ? `${loser} fell asleep for 3 turns 💤` : "Both fell asleep 💤", left: `${loser} ran away 🏃`, draw: "Double K.O.!" }[st.why] || "";
  let title;
  if (w === 0) title = "🤝 It's a draw!";
  else if (!me) title = `🏆 ${esc(st["p" + w])} wins!`;
  else if (w === me) title = bot ? `🏆 You beat the ${esc(st.p2)}!` : "🏆 You win!";
  else { title = bot ? `💀 The ${esc(st.p2)} got you!` : "💀 You lost…"; sound("lose"); }
  const pts = !bot && me && w === me && !st.practice && guildOf(st["p" + me]) ? `<div class="pts">+${st.stake} point${st.stake > 1 ? "s" : ""} for the Hall of Fame</div>` : "";
  $b("#bdResult").innerHTML = `<h3>${title}</h3><p>${why}</p>${pts}
    <div class="row">${me ? `<button class="sk-btn bd-play" data-a="again">${bot ? "Again!" : "Rematch!"}</button>` : ""}<button class="sk-btn sk-private" data-a="back">Back</button></div>`;
  $b("#bdResult").hidden = false;
}
$b("#bdSay").addEventListener("click", e => {
  if (e.target.id !== "bdCopy") return;
  const i = $b("#bdInvite"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (er) { document.execCommand("copy"); }
  e.target.textContent = "Copied!"; setTimeout(() => e.target.textContent = "Copy", 1200);
});

// ------------------------------------------------------------------ the reveal show
function reveal(l, prev) {
  const L = side(), F = { [L]: $b("#bdF1"), [3 - L]: $b("#bdF2") };
  const names = { 1: st.p1, 2: st.p2 }, m = { 1: l.m1, 2: l.m2 }, d = { 1: l.d1, 2: l.d2 }, heads = { 1: l.h1, 2: l.h2 };
  animUntil = Date.now() + 3300;
  if (prev) disp = { hp1: prev.hp1, hp2: prev.hp2, en1: prev.en1, en2: prev.en2 };
  render();
  // 1. the cards flip up over both heads
  [1, 2].forEach(s => {
    const mv = MOVES[m[s]], c = document.createElement("div");
    c.className = "bd-card" + (CLASSES[st["class" + s]] && CLASSES[st["class" + s]].skill === m[s] ? " sk" : "");
    c.innerHTML = mv ? `<img src="${M + mv.icon}" alt=""><b>${mv.name}</b>` : "<span>💤</span><b>Zzz…</b>";
    F[s].appendChild(c); setTimeout(() => c.remove(), 3000);
  });
  sound("flip");
  if (l.sd && l.turn === 10) banner("⚡ SUDDEN DEATH! Every hit +1, MP ×2", 2200);
  if (st.map === "ludi" && (l.turn + 1) % 4 === 0) setTimeout(() => { banner("⏰ DONG! The clock strikes: MP refilled!", 2200); sound("clock"); }, 2400);
  // 2. the action
  setTimeout(() => {
    [1, 2].forEach(s => {
      const o = 3 - s, me = F[s], them = F[o];
      if (m[s] === "bonk" || m[s] === "heavy" || m[s] === "steal") me.classList.add("bd-lunge");
      if (m[s] === "charge") { fx(me, "buff"); if (m[o] !== "steal") num(me, "+2", "blue", "MP"); }
      if (m[s] === "shield") fx(me, "guard");
      if (m[s] === "dodge") fx(me, "smoke");
      if (m[s] === "rage") fx(me, "rage");
      if (m[s] === "teleport") { fx(me, "smoke"); me.classList.add("bd-tele"); setTimeout(() => me.classList.remove("bd-tele"), 1300); }
      if (m[s] === "arrow") fx(them, "arrows");
      if (m[s] === "coin") { me.classList.add("bd-lunge"); bubble(s, heads[s] ? "🪙 Heads!" : "🪙 Tails…"); }
      if (m[s] === "steal" && m[o] === "charge") num(me, "+2", "blue", "MP");
      if (m[s] === "zzz") bubble(s, "💤 Zzz…");
      setTimeout(() => me.classList.remove("bd-lunge"), 450);
    });
    sound(l.m1 === "heavy" || l.m2 === "heavy" || l.m1 === "coin" || l.m2 === "coin" ? "heavy" : ATTACKS.includes(l.m1) || ATTACKS.includes(l.m2) ? "bonk"
      : l.m1 === "shield" || l.m2 === "shield" ? "clang" : "whoosh");
  }, 800);
  // 3. impacts
  setTimeout(() => {
    [1, 2].forEach(s => {
      const o = 3 - s, me = F[s];
      const big = (m[o] === "heavy" && m[s] !== "dodge") || m[o] === "coin";
      if (d[s] > 0) {
        fx(me, m[o] === "teleport" ? "burst" : m[o] === "arrow" ? "arrowhit" : m[o] === "coin" ? "shot" : m[o] === "steal" ? "steal" : big ? "star" : m[s] === "dodge" ? "slash" : "burst");
        num(me, String(d[s]), big ? "cri" : (st.me && s === st.me ? "violet" : "red"));
        me.classList.add("bd-ouch"); setTimeout(() => me.classList.remove("bd-ouch"), 500);
        if (bot && s === 2) { const img = me.querySelector(".bd-sp"); img.src = `${M + bot.kind}_hit1.gif`; setTimeout(() => { if (bot && st.status !== "over") img.src = me.dataset.src; }, 600); }
      } else if (((m[o] === "bonk" || m[o] === "steal") && (m[s] === "shield" || m[s] === "rage")) || (m[o] === "coin" && m[s] === "shield")) num(me, "Guard", "word");
      else if ((m[o] === "heavy" && m[s] === "dodge") || (ATTACKS.includes(m[o]) && m[s] === "teleport") || (m[o] === "coin" && !heads[o])) num(me, "MISS", "miss");
      if (l["l" + s]) setTimeout(() => bubble(s, "🍀 Lucky! Hanging on with 1 HP"), 300);
    });
    disp = { hp1: st.hp1, hp2: st.hp2, en1: st.en1, en2: st.en2 };
    render();
    critRing(l, F);
  }, 1150);
  if (l.arm) {   // the arm slams down on its target
    const tgt = F[l.arm], arm = $b("#bdArena .bd-arm");
    if (arm) { arm.classList.add("slam"); setTimeout(() => arm.remove(), 1500); }
    const safe = ["shield", "dodge", "teleport"].includes(m[l.arm]);
    setTimeout(() => { sound(safe ? "clang" : "heavy"); bubble(l.arm, safe ? "Phew! Missed me 😅" : "OUCH! 🖐️💥"); }, 1250);
  }
  $b("#bdSay").innerHTML = "<span></span>";
  setTimeout(() => { $b("#bdSay").innerHTML = `<span>${story(l, names)}</span>`; }, 1150);
  setTimeout(() => { animUntil = 0; if (st.status === "over" && bot && st.winner === 1) { const img = F[2].querySelector(".bd-sp"); img.src = `${M + bot.kind}_die1.gif`; }
    render(); }, 3300);
}
// critical tap: after your hit lands, a ring shrinks over the enemy; tap when it lines up for +1 damage
function critRing(l, F) {
  const me = st.me; if (!me) return;
  const o = 3 - me, mine = l["m" + me];
  const landed = l["d" + o] > 0 && (ATTACKS.includes(mine) || (mine === "dodge" && l["m" + o] === "heavy"));
  if (bot) botCrit(l);   // (a Teleport zap is too small to crit)
  if (!landed || st.status === "over") return;
  const el = F[o], ring = document.createElement("div"); ring.className = "bd-ring"; ring.innerHTML = "<i></i><b></b>";
  el.appendChild(ring);
  const t0 = performance.now(), dur = 1000, wide = st["class" + me] === "bowman";
  const lo = wide ? .5 : .58, hi = wide ? .84 : .76;          // the part of the shrink that counts as "on target" (lines up at .67)
  let done = false;
  const stop = () => { done = true; $b("#bdArena").removeEventListener("pointerdown", tap); };
  const tap = e => {
    if (done) return; stop(); e.preventDefault();
    const p = (performance.now() - t0) / dur, good = p >= lo && p <= hi;
    ring.classList.add(good ? "hit" : "miss"); setTimeout(() => ring.remove(), 350);
    if (!good) { num(el, p < lo ? "Too early" : "Too late", "word"); return; }
    sound("crit");
    if (bot) { st["hp" + o] = Math.max(0, st["hp" + o] - 1); st.last["c" + me] = true; critShow(o); checkEndAfterCrit(); }
    else { critShow(o); sb.rpc("bd_crit", { p_game: sess.game, p_tok: sess.token, p_turn: l.turn }).then(() => { poke(); polling = false; poll(); }); }
  };
  $b("#bdArena").addEventListener("pointerdown", tap);
  setTimeout(() => { if (!done) { stop(); ring.remove(); } }, dur + 150);
}
function critShow(victim) {   // the +1 critical number on whoever got crit
  const L = side(), el = victim === L ? $b("#bdF1") : $b("#bdF2");
  setTimeout(() => num(el, "1", "cri"), 60);
  if (disp) disp["hp" + victim] = bot ? st["hp" + victim] : Math.max(0, disp["hp" + victim] - 1);
  render();
}
function botCrit(l) {   // monsters sometimes nail the timing too
  const landed = l.d1 > 0 && (ATTACKS.includes(l.m2) || (l.m2 === "dodge" && l.m1 === "heavy"));
  const chance = { orange_mushroom: .25, zombie_mushroom: .4, jr_balrog: .6 }[bot.kind];
  if (!landed || st.status === "over" || Math.random() > chance) return;
  setTimeout(() => { if (!bot || st.status === "over") return; st.hp1 = Math.max(0, st.hp1 - 1); st.last.c2 = true; sound("crit"); critShow(1); checkEndAfterCrit(); }, 800);
}
function checkEndAfterCrit() {
  if (st.hp1 === 0 || st.hp2 === 0) { st.status = "over"; st.winner = st.hp1 === st.hp2 ? 0 : st.hp1 > st.hp2 ? 1 : 2; st.why = "ko"; clearTimeout(bot.timer); render(); }
}
function story(l, N) {
  const { m1, m2 } = l;
  const pair = (a, b) => m1 === a && m2 === b ? [1, 2] : m1 === b && m2 === a ? [2, 1] : null;
  const n = s => `<b>${esc(N[s])}</b>`;
  let p;
  if (l.arm && !["shield", "dodge", "teleport"].includes(l["m" + l.arm])) return `🖐️ Zakum's arm SLAMMED ${n(l.arm)}! (+4) ${l["m" + (3 - l.arm)] === "charge" ? "Their opponent sipped an Elixir and watched 🧪" : ""}`;
  if (l.arm) return `🖐️ ${n(l.arm)} saw the arm coming and got out of the way!`;
  if ((p = pair("arrow", "teleport") || pair("bonk", "teleport") || pair("heavy", "teleport") || pair("steal", "teleport") || pair("coin", "teleport")))
    return `${n(p[1])} teleported behind ${n(p[0])} ✨ and zapped them!`;
  if (m1 === m2 && m1 === "coin") return `Pirate standoff! 🪙 ${n(1)} ${l.h1 ? "hit" : "missed"}, ${n(2)} ${l.h2 ? "hit" : "missed"}`;
  if (m1 === m2 && m1 === "arrow") return "Arrows everywhere! 🏹🏹 Both got turned into pincushions";
  if (m1 === m2 && m1 === "rage") return "Both are FURIOUS 🔥🔥 The next hits are going to hurt";
  if (m1 === m2 && m1 === "teleport") return "Both teleported… and landed in each other's spot ✨";
  if (m1 === m2 && m1 === "steal") return "Two thieves robbing each other 🗝️";
  if ((p = pair("steal", "charge"))) return `${n(p[0])} STOLE the Elixir right out of ${n(p[1])}'s hands 🗝️🧪`;
  if ((p = pair("coin", "shield"))) return `🪙 ${n(p[1])}'s shield blocked the Lucky Shot 🛡️`;
  if (m1 === "coin" || m2 === "coin") { const c = m1 === "coin" ? 1 : 2;
    return l["h" + c] ? `🪙 Heads! ${n(c)}'s Lucky Shot blasted ${n(3 - c)} 💥` : `🪙 Tails… ${n(c)}'s Lucky Shot went wide 🙈`; }
  if ((p = pair("arrow", "shield") || pair("arrow", "dodge") || pair("arrow", "rage"))) return `${n(p[1])} can't block arrows! 🏹 They rain down anyway`;
  if ((p = pair("bonk", "rage"))) return `${n(p[1])} shrugged off the bonk and got ANGRY 🔥 (next hit +2)`;
  if (m1 === m2) return { bonk: "Double bonk! Both heads are ringing 🔔", heavy: "HEAVY vs HEAVY! The whole map shook 🌋",
    shield: "Two shields. Riveting stuff. 😴", dodge: "Both dodged… nothing. Lovely dance though 💃",
    charge: "Both chugged an Elixir and stared at each other ☕", zzz: "Both fell asleep… 💤" }[m1];
  if ((p = pair("heavy", "dodge"))) return `${n(p[1])} vanished in a puff of smoke 💨 and bonked ${n(p[0])} from behind!`;
  if ((p = pair("heavy", "shield"))) return `${n(p[0])}'s Heavy Bonk SMASHED right through the shield 💥`;
  if ((p = pair("bonk", "shield"))) return `CLANG! ${n(p[1])} blocked the bonk 🛡️ (+1 MP)`;
  if ((p = pair("bonk", "dodge"))) return `${n(p[1])} tried to dodge… straight into the hammer 🤦`;
  if ((p = pair("heavy", "bonk"))) return `Trade! ${n(p[0])} landed a Heavy, ${n(p[1])} a cheeky bonk 🔨`;
  if ((p = pair("bonk", "charge") || pair("heavy", "charge"))) return `${n(p[1])} was busy drinking an Elixir and got bonked extra hard 🧪`;
  if ((p = pair("bonk", "zzz") || pair("heavy", "zzz"))) return `${n(p[1])} fell asleep 💤 and woke up with a bump on the head`;
  const verb = { shield: "hid behind a shield 🛡️", dodge: "dodged at nothing 💨", charge: "drank an Elixir 🧪", zzz: "fell asleep 💤",
    rage: "powered up with Rage 🔥", teleport: "teleported around ✨", arrow: "fired Arrow Rain 🏹", steal: "tried to Steal 🗝️", bonk: "bonked 🔨", heavy: "swung a Heavy Bonk 🔨" };
  return `${n(1)} ${verb[m1] || "swung"} · ${n(2)} ${verb[m2] || "swung"}`;
}
function fx(el, k, unscaled) {
  const f = FX[k], d = document.createElement("div");
  d.className = "bd-fx" + (unscaled ? " bd-big" : "") + (["guard", "buff", "smoke", "rage", "arrows", "steal"].includes(k) ? " bd-feet" : "");
  d.style.cssText = `width:${f.w}px;height:${f.h}px;margin-left:${-f.ox}px;margin-top:${-f.oy}px;background-image:url(${M + f.src});
    animation:bdfx-${k} ${f.ms}ms steps(${f.n}) forwards`;
  (unscaled ? el : el.querySelector(".bd-body")).appendChild(d);
  setTimeout(() => d.remove(), f.ms + 30);
}
function num(el, t, kind, tail) {
  const d = document.createElement("div"); d.className = "bd-num bd-n-" + kind;
  if (kind === "miss") d.innerHTML = `<img src="${M}miss.png" alt="MISS">`;
  else if (kind === "word") d.innerHTML = `<span class="w">${t}</span>`;
  else {
    const [src, w, h] = DIG[kind];
    d.innerHTML = (kind === "cri" ? `<img class="cri" src="${M}cri.png" alt="">` : "") +
      [...t].filter(c => /\d/.test(c)).map(c => `<i style="width:${w}px;height:${h}px;background:url(${M + src}) ${-c * w}px 0"></i>`).join("") +
      (tail ? `<small>${tail}</small>` : "");
  }
  el.appendChild(d); setTimeout(() => d.remove(), 1500);
}
function tomb(el) {
  const t = document.createElement("img"); t.className = "bd-tomb"; t.src = M + "tombland.png"; t.alt = "";
  el.appendChild(t); el.classList.add("bd-ko"); sound("thud");
}
function bubble(s, text) {
  const L = side(), el = s === L ? $b("#bdF1") : $b("#bdF2");
  el.querySelectorAll(".bd-bubble").forEach(x => x.remove());
  const b = document.createElement("div"); b.className = "bd-bubble"; b.textContent = text;
  el.appendChild(b); setTimeout(() => b.remove(), 2600);
}
// Zakum's arm: sits at the far edge of the arena on the side of the player it aims at
function placeArm() {
  const ar = $b("#bdArena"); let arm = ar.querySelector(".bd-arm");
  const aimed = st && st.map === "zakum" && st.arm && st.status === "pick";
  if (!aimed) { if (arm && !arm.classList.contains("slam")) arm.remove(); return; }
  const onRight = st.arm !== side();
  if (!arm) { arm = document.createElement("img"); arm.className = "bd-arm"; arm.src = M + "zarm_stand.gif"; arm.alt = ""; ar.appendChild(arm); }
  arm.classList.toggle("r", onRight); arm.classList.toggle("l", !onRight);
}
function armWarning() {
  const who = st.me === st.arm ? "YOU" : esc(st["p" + st.arm]);
  setTimeout(() => st && st.arm && banner(`🖐️ Zakum's arm is aiming at ${who}!<br><small>Shield, Dodge or Teleport, or take 4 damage</small>`, 2600), (st.reveal || 0) * 1000);
}
function introBanner() {
  const mp = MAPS[st.map] || MAPS.henesys, c1 = CLASSES[st.class1], c2 = CLASSES[st.class2];
  banner(`🗺️ ${mp.name}: ${mp.rule}!<br><small>${c1 ? c1.e + " " + esc(st.p1) : ""} vs ${c2 ? c2.e + " " + esc(st.p2) : ""}</small>`, 3200);
  setTimeout(() => st && st.turn === 1 && st.status === "pick" && banner("Ready… FIGHT! 🔨", 1500), 3300);
}
let bannerT = null;
function banner(html, ms, sticky) {
  const b = $b("#bdBanner"); b.innerHTML = html; b.className = "bd-banner on" + (sticky ? " ask" : "");
  clearTimeout(bannerT); if (!sticky) bannerT = setTimeout(() => b.className = "bd-banner", ms);
}

// ------------------------------------------------------------------ clock
setInterval(() => {
  if (!st || $b("#bdGame").hidden) return;
  const left = pickLeft(), rv = st.reveal - (Date.now() - leftAt) / 1000;
  const clk = $b("#bdClock");
  if (st.status === "pick" && left != null && rv <= 0) {
    const s = Math.ceil(left); clk.textContent = s; clk.classList.toggle("hurry", s <= 5);
  } else if (st.status === "double" && left != null) { clk.textContent = Math.ceil(left); clk.classList.add("hurry"); }
  else { clk.textContent = st.status === "pick" ? "⚔️" : ""; clk.classList.remove("hurry"); }
  if (bot && st.status === "pick" && left === 0) botResolve();
  else if (!bot && sess && left === 0 && !polling && ["pick", "double"].includes(st.status)) poll();
  // re-enable the move buttons the moment the reveal is over
  const want = st.me && st.status === "pick" && !inReveal();
  if (want !== !!$b("#bdMoves").dataset.on) { $b("#bdMoves").dataset.on = want ? "1" : ""; render(); }
}, 250);
document.addEventListener("visibilitychange", () => { if (!document.hidden && sess && !bot) { polling = false; poll(); } });

function sound(kind) {
  try {
    const ac = window.getAC && window.getAC(); if (!ac) return;
    const tone = (f, at, dur, type = "sine", vol = .2, f2) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at; o.type = type;
      o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
    };
    const noise = (at, dur, freq, vol = .25) => {
      const sr = ac.sampleRate, buf = ac.createBuffer(1, sr * dur, sr), c = buf.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * (1 - i / c.length);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = buf; f.type = "bandpass"; f.frequency.value = freq;
      g.gain.value = vol; s.connect(f).connect(g).connect(ac.destination); s.start(ac.currentTime + at);
    };
    if (kind === "bonk") { tone(520, 0, .18, "square", .12, 140); tone(900, .02, .25, "sine", .12, 300); }
    else if (kind === "heavy") { tone(160, 0, .45, "square", .18, 40); noise(0, .35, 300, .4); }
    else if (kind === "clang") { tone(1400, 0, .3, "square", .07); tone(2100, 0, .25, "triangle", .07); }
    else if (kind === "whoosh") noise(0, .35, 1200, .3);
    else if (kind === "flip") { tone(700, 0, .06, "triangle", .12); tone(1000, .07, .08, "triangle", .12); }
    else if (kind === "start") [392, 523, 659, 784].forEach((f, i) => tone(f, i * .09, .18, "square", .07));
    else if (kind === "double") { tone(220, 0, .2, "sawtooth", .1); tone(330, .2, .2, "sawtooth", .1); tone(440, .4, .4, "sawtooth", .12); }
    else if (kind === "win") [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * .11, .22, "triangle", .15));
    else if (kind === "lose") [392, 370, 349, 262].forEach((f, i) => tone(f, i * .28, .35, "sawtooth", .07));
    else if (kind === "thud") tone(120, 0, .4, "square", .15, 50);
    else if (kind === "clock") [0, .45, .9].forEach(t => { tone(523, t, .4, "triangle", .15); tone(784, t, .4, "sine", .08); });
    else if (kind === "crit") { tone(880, 0, .08, "square", .12); tone(1320, .06, .18, "square", .12); noise(0, .15, 2500, .25); }
    else tone(660, 0, .1, "sine", .12, 990);
  } catch (e) {}
}

async function loadBoard() {
  if (!(await client())) return;
  const { data } = await sb.from("bd_scores").select("player,duels,wins,points").order("points", { ascending: false }).order("wins", { ascending: false }).limit(15);
  $b("#bdBoard").innerHTML = (data || []).filter(r => r.duels > 0).map(r =>
    `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b><span>${r.points} pt${r.points === 1 ? "" : "s"} · ${r.wins} win${r.wins === 1 ? "" : "s"} · ${r.duels} duels</span></li>`
  ).join("") || "<li>No duels yet. Grab a hammer! 🔨</li>";
}
$b("#bdTaunts").innerHTML = TAUNTS.map((t, i) => `<button type="button" data-t="${i}">${t}</button>`).join("");
})();
