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
const BOTS = {
  orange_mushroom: { name: "Orange Mushroom", lvl: "Easy",   say: ["*squish*", "Mush mush! 🍄", "Bonk me if you can 🍄", "*boing boing*"] },
  zombie_mushroom: { name: "Zombie Mushroom", lvl: "Medium", say: ["Braaains… 🧟", "*groan*", "I'm already dead, you can't hurt me", "Mush… rot…"] },
  jr_balrog:       { name: "Jr. Balrog",      lvl: "Hard",   say: ["Grrr! 🔥", "Puny Mapler…", "I can read you 😈", "🔥🔥🔥"] },
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
};
const DIG = { red: ["nored1.png", 37, 39], cri: ["nocri1.png", 43, 48], blue: ["noblue1.png", 37, 39], violet: ["noviolet1.png", 37, 39] };
document.head.insertAdjacentHTML("beforeend", "<style>" + Object.entries(FX).map(([k, f]) =>
  `@keyframes bdfx-${k} { from { background-position: 0 0 } to { background-position: -${f.w * f.n}px 0 } }`).join("\n") + "</style>");

const roster = [...D.founders, ...D.members].filter((p, i, a) => a.findIndex(q => q.name === p.name) === i);
const guildOf = n => roster.find(p => p.name.toLowerCase() === n.trim().toLowerCase());
// pictures that are turned the other way from everyone else's: the arena mirrors them the opposite way
const TURNED = new Set(["CrtlAltDel"]);
const spriteOf = n => (roster.find(p => p.name === n) || {}).sprite || M + "guest.png?v=2";

let sb = null, ch = null, sess = null, st = null, leftAt = 0, polling = false, pollT = null, tickT = null;
let shownTurn = -1, animUntil = 0, disp = null, bot = null, room = "public", liveT = null, lastBanner = "";

// ------------------------------------------------------------------ lobby
$b("#bdHelp").innerHTML = ORDER.map(k => { const m = MOVES[k];
  return `<div class="bdh"><img src="${M + m.icon}" alt=""><b>${m.name}</b><i>${m.cost ? m.cost + " MP" : "Free"}</i><small>${m.desc}</small></div>`; }).join("");
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
  const { data, error } = await sb.rpc("bd_join", { p_room: room, p_name: name || "", p_tok: tok || null });
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
      <img src="${spriteOf(d.p1)}" alt=""><span><b>${esc(d.p1)}</b> ${d.hp1}❤️ <i>vs</i> <b>${esc(d.p2)}</b> ${d.hp2}❤️<small>turn ${d.turn}${d.stake > 1 ? ` · 🔥 ×${d.stake}` : ""}</small></span>
      <img class="r" src="${spriteOf(d.p2)}" alt="">👀</button>`).join("")
    : `<p class="bd-none">Nobody is dueling right now. Be the first!</p>`;
}
$b("#bdLive").addEventListener("click", e => { const b = e.target.closest(".bd-live"); if (b) watch(b.dataset.g); });

// ------------------------------------------------------------------ entering / leaving a duel
function showGame() {
  $b("#bdLobby").hidden = true; $b("#bdGame").hidden = false; $b("#duel").classList.add("playing"); document.body.classList.add("bd-playing");
  $b("#bdResult").hidden = true; $b("#bdArena").querySelectorAll(".bd-fx, .bd-num, .bd-tomb, .bd-bubble, .bd-card").forEach(x => x.remove());
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
  if (prev && prev.status === "wait" && st.status === "pick") { sound("start"); banner("Ready… FIGHT! 🔨", 2000); }
  if (prev && prev.status !== "double" && st.status === "double") { sound("double");
    banner(`🔥 ${esc(st["p" + st.dbl_by])} wants to DOUBLE BONK!`, 2500); }
  if (prev && prev.stake !== st.stake && st.stake > prev.stake) banner(`🔥 Stakes doubled: ${st.stake} points!`, 2000);
  render();
}
const animating = () => Date.now() < animUntil;

// ------------------------------------------------------------------ practice monsters (same rules, run locally)
const hit = (a, b) => a === "bonk" && b !== "shield" ? 2 : a === "heavy" && b !== "dodge" ? 4 : 0;
function resolveTurn(s) {
  const m1 = s.pick1 || "zzz", m2 = s.pick2 || "zzz", sd = s.turn >= 9;
  let x1 = hit(m2, m1), x2 = hit(m1, m2);
  if (m1 === "dodge" && m2 === "heavy") x2 += 3;
  if (m2 === "dodge" && m1 === "heavy") x1 += 3;
  if (x1 > 0 && (m1 === "charge" || m1 === "zzz")) x1++;
  if (x2 > 0 && (m2 === "charge" || m2 === "zzz")) x2++;
  if (sd && x1 > 0) x1++; if (sd && x2 > 0) x2++;
  const cost = m => (MOVES[m] || {}).cost || 0, regen = sd ? 2 : 1;
  const e1 = s.en1 - cost(m1) + (m1 === "charge" ? 2 : 0) + (m1 === "shield" && m2 === "bonk" ? 1 : 0) + regen;
  const e2 = s.en2 - cost(m2) + (m2 === "charge" ? 2 : 0) + (m2 === "shield" && m1 === "bonk" ? 1 : 0) + regen;
  s.last = { turn: s.turn, m1, m2, d1: x1, d2: x2, sd };
  s.hp1 = Math.max(0, s.hp1 - x1); s.hp2 = Math.max(0, s.hp2 - x2);
  s.en1 = Math.min(5, Math.max(0, e1)); s.en2 = Math.min(5, Math.max(0, e2));
  s.afk1 = m1 === "zzz" ? s.afk1 + 1 : 0; s.afk2 = m2 === "zzz" ? s.afk2 + 1 : 0;
  s.pick1 = s.pick2 = null; s.picked1 = s.picked2 = false; s.mine = null; s.turn++;
  const end = (w, why) => { s.status = "over"; s.winner = w; s.why = why; };
  if (s.hp1 === 0 || s.hp2 === 0) end(s.hp1 === s.hp2 ? 0 : s.hp1 > s.hp2 ? 1 : 2, s.hp1 === s.hp2 ? "draw" : "ko");
  else if (s.afk1 >= 3) end(2, "afk");
  else if (s.turn > 15) end(s.hp1 === s.hp2 ? 0 : s.hp1 > s.hp2 ? 1 : 2, "time");
}
function startBot(kind, name) {
  showGame();
  bot = { kind, hist: [], timer: null };
  st = { r: "ok", me: 1, status: "pick", turn: 1, p1: name, p2: BOTS[kind].name, hp1: 10, hp2: 10, en1: 3, en2: 3, afk1: 0, afk2: 0,
         picked1: false, picked2: false, mine: null, pick1: null, pick2: null, stake: 1, dbl1: true, dbl2: true, last: null,
         left: 19, reveal: 4, on1: true, on2: true, practice: true };
  leftAt = Date.now(); disp = { hp1: 10, hp2: 10, en1: 3, en2: 3 }; shownTurn = 0;
  sound("start"); banner("Ready… FIGHT! 🔨", 2000); render(); botThink();
  setTimeout(() => bot && bubble(2, BOTS[kind].say[0]), 1200);
}
function botThink() {
  clearTimeout(bot.timer);
  const wait = Math.max(0, st.reveal - (Date.now() - leftAt) / 1000) * 1000 + 700 + Math.random() * 2500;
  bot.timer = setTimeout(() => { if (!bot || st.status !== "pick") return; st.pick2 = botMove(); st.picked2 = true; render(); if (st.picked1) botResolve(); }, wait);
}
function botMove() {
  const can = ORDER.filter(m => MOVES[m].cost <= st.en2);
  const pick = w => { const ks = Object.keys(w).filter(k => can.includes(k) && w[k] > 0); let r = Math.random() * ks.reduce((a, k) => a + w[k], 0);
    for (const k of ks) if ((r -= w[k]) <= 0) return k; return ks[0] || "shield"; };
  const h = bot.hist;
  if (bot.kind === "orange_mushroom") return pick({ bonk: 3, heavy: 2, shield: 2, dodge: 1, charge: 2 });
  // what will the player do? count their past moves (the Jr. Balrog also looks at what they did after their last move)
  const pc = ORDER.filter(m => MOVES[m].cost <= st.en1), freq = {};
  pc.forEach(m => freq[m] = 1);
  h.forEach((m, i) => { if (freq[m] != null) freq[m] += bot.kind === "jr_balrog" && i > 0 && h[i - 1] === h[h.length - 1] ? 3 : 1; });
  if (bot.kind === "zombie_mushroom" && Math.random() < .45) return pick({ bonk: 3, heavy: 2, shield: 2, dodge: 1, charge: 2 });
  if (bot.kind === "jr_balrog" && Math.random() < .12) return pick({ bonk: 2, heavy: 2, shield: 1, dodge: 1, charge: 1 });
  const tot = Object.values(freq).reduce((a, b) => a + b, 0), sd = st.turn >= 9;
  const val = b => pc.reduce((a, p) => {   // expected (damage dealt − damage taken) + a little for MP
    let dealt = hit(b, p) + (p === "dodge" && b === "heavy" ? 0 : 0), taken = hit(p, b);
    if (b === "dodge" && p === "heavy") dealt += 3; if (p === "dodge" && b === "heavy") taken += 3;
    if (taken > 0 && b === "charge") taken++; if (dealt > 0 && p === "charge") dealt++;
    if (sd) { if (dealt) dealt++; if (taken) taken++; }
    const mp = (b === "charge" ? 2 : 0) + (b === "shield" && p === "bonk" ? 1 : 0) - MOVES[b].cost;
    return a + freq[p] / tot * (dealt - taken * (st.hp2 <= 4 ? 1.4 : 1) + mp * .35 + (dealt >= st.hp1 ? 5 : 0));
  }, 0);
  const scored = can.map(b => [b, val(b)]).sort((a, b) => b[1] - a[1]);
  return Math.random() < .8 || scored.length < 2 ? scored[0][0] : scored[1][0];
}
function botResolve() {
  bot.hist.push(st.pick1 || "zzz");
  const before = { ...st };
  resolveTurn(st);
  st.left = 19; st.reveal = 4; leftAt = Date.now();
  shownTurn = st.last.turn; reveal(st.last, before);
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
  el.classList.toggle("bd-turned", !isBot && TURNED.has(name)); el.classList.toggle("bd-mob", !!isBot); el.classList.toggle("bd-boss", !!isBot && bot.kind === "jr_balrog");
  el.querySelector(".bd-tag").textContent = name;
  el.querySelector(".bd-hp i").style.width = (hp * 10) + "%";
  el.querySelector(".bd-hp b").textContent = `HP ${hp}/10`;
  el.querySelector(".bd-mp").innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < en ? "on" : ""}"></i>`).join("") + `<b>MP ${en}</b>`;
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
  const sd = st.turn >= 9 && s !== "wait";
  $b("#bdArena").classList.toggle("sd", sd);
  $b("#bdPhase").innerHTML = s === "wait" ? (room === "public" ? "🔍 Looking for an opponent…" : "⏳ Waiting for your friend…")
    : s === "over" ? "🏁 Duel over" : `Turn ${Math.min(st.turn, 15)}/15${sd ? " · <b class='sdt'>⚡ SUDDEN DEATH</b>" : ""}`;
  $b("#bdStake").innerHTML = s === "wait" ? "" : st.practice ? "🎯 Practice" : `${st.stake > 1 ? "🔥" : "🏆"} ${st.stake} pt${st.stake > 1 ? "s" : ""}`;
  // moves
  const myEn = me ? st["en" + me] : 0, canPick = me && s === "pick" && !inReveal();
  $b("#bdMoves").innerHTML = ORDER.map(k => { const m = MOVES[k];
    return `<button type="button" class="bd-move ${st.mine === k ? "sel" : ""}" data-m="${k}" ${canPick && m.cost <= myEn ? "" : "disabled"}>
      <span class="ic"><img src="${M + m.icon}" alt=""></span><b>${m.name}</b><i>${m.cost ? m.cost + " MP" : "Free"}</i></button>`; }).join("");
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
    else if (st.mine) say = `✅ You picked <b>${MOVES[st.mine].name}</b>. ${st["picked" + (3 - me)] ? "Revealing…" : "Waiting for your opponent… (tap another to change)"}`;
    else say = "Pick your move! Your opponent can't see it until you both reveal 🤫";
  } else if (s === "double") {
    say = me && st.dbl_by !== me ? "🔥 Accept the Double Bonk, or run away? (no answer = accepted)"
        : me ? "⏳ Waiting for their answer… will they chicken out? 🐔" : "🔥 Double Bonk offered…";
  }
  if (say && !animating()) $b("#bdSay").innerHTML = say;
  // double bonk question
  if (s === "double" && me && st.dbl_by !== me) {
    const html = `🔥 <b>${esc(st["p" + st.dbl_by])}</b> wants to DOUBLE the stakes to <b>${st.stake * 2} points</b>!
      <span class="bd-ans"><button data-a="yes" class="sk-btn bd-play">Bring it on!</button><button data-a="no" class="sk-btn sk-private">Run away 🐔</button></span>`;
    if (lastBanner !== html) { lastBanner = html; banner(html, 0, true); }
  } else if (lastBanner && lastBanner.includes("data-a")) { lastBanner = ""; $b("#bdBanner").className = "bd-banner"; }
  if (s === "over") showResult();
}
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
  const names = { 1: st.p1, 2: st.p2 }, m = { 1: l.m1, 2: l.m2 }, d = { 1: l.d1, 2: l.d2 };
  animUntil = Date.now() + 3300;
  if (prev) disp = { hp1: prev.hp1, hp2: prev.hp2, en1: prev.en1, en2: prev.en2 };
  render();
  // 1. the cards flip up over both heads
  [1, 2].forEach(s => {
    const mv = MOVES[m[s]], c = document.createElement("div");
    c.className = "bd-card"; c.innerHTML = mv ? `<img src="${M + mv.icon}" alt=""><b>${mv.name}</b>` : "<span>💤</span><b>Zzz…</b>";
    F[s].appendChild(c); setTimeout(() => c.remove(), 3000);
  });
  sound("flip");
  if (l.sd && l.turn === 9) banner("⚡ SUDDEN DEATH! Every hit +1, MP ×2", 2200);
  // 2. the action
  setTimeout(() => {
    [1, 2].forEach(s => {
      const o = 3 - s, me = F[s], them = F[o];
      if (m[s] === "bonk" || m[s] === "heavy") me.classList.add("bd-lunge");
      if (m[s] === "charge") { fx(me, "buff"); num(me, "+2", "blue", "MP"); }
      if (m[s] === "shield") fx(me, "guard");
      if (m[s] === "dodge") fx(me, "smoke");
      if (m[s] === "zzz") bubble(s, "💤 Zzz…");
      setTimeout(() => me.classList.remove("bd-lunge"), 450);
      void them;
    });
    sound(l.m1 === "heavy" || l.m2 === "heavy" ? "heavy" : l.m1 === "bonk" || l.m2 === "bonk" ? "bonk" : l.m1 === "shield" || l.m2 === "shield" ? "clang" : "whoosh");
  }, 800);
  // 3. impacts
  setTimeout(() => {
    [1, 2].forEach(s => {
      const o = 3 - s, me = F[s];
      const big = m[o] === "heavy" && d[s] > 0 && !(m[s] === "dodge");
      if (d[s] > 0) {
        fx(me, big ? "star" : m[s] === "dodge" ? "slash" : "burst");
        num(me, String(d[s]), big ? "cri" : (st.me && s === st.me ? "violet" : "red"));
        me.classList.add("bd-ouch"); setTimeout(() => me.classList.remove("bd-ouch"), 500);
        if (bot && s === 2) { const img = me.querySelector(".bd-sp"); img.src = `${M + bot.kind}_hit1.gif`; setTimeout(() => { if (bot && st.status !== "over") img.src = me.dataset.src; }, 600); }
      } else if ((m[o] === "bonk" && m[s] === "shield")) { num(me, "Guard", "word"); }
      else if (m[o] === "heavy" && m[s] === "dodge") num(me, "MISS", "miss");
    });
    disp = { hp1: st.hp1, hp2: st.hp2, en1: st.en1, en2: st.en2 };
    if (st.status === "over") disp = { hp1: st.hp1, hp2: st.hp2, en1: st.en1, en2: st.en2 };
    render();
  }, 1150);
  $b("#bdSay").innerHTML = "";
  setTimeout(() => { $b("#bdSay").innerHTML = story(l, names); }, 1150);
  setTimeout(() => { animUntil = 0; if (st.status === "over" && bot && st.winner === 1) { const img = F[2].querySelector(".bd-sp"); img.src = `${M + bot.kind}_die1.gif`; }
    render(); }, 3300);
}
function story(l, N) {
  const { m1, m2 } = l;
  const pair = (a, b) => m1 === a && m2 === b ? [1, 2] : m1 === b && m2 === a ? [2, 1] : null;
  const n = s => `<b>${esc(N[s])}</b>`;
  let p;
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
  const verb = { shield: "hid behind a shield 🛡️", dodge: "dodged at nothing 💨", charge: "drank an Elixir 🧪", zzz: "fell asleep 💤" };
  return `${n(1)} ${verb[m1] || "swung"} · ${n(2)} ${verb[m2] || "swung"}`;
}
function fx(el, k, unscaled) {
  const f = FX[k], d = document.createElement("div");
  d.className = "bd-fx" + (unscaled ? " bd-big" : "") + (["guard", "buff", "smoke"].includes(k) ? " bd-feet" : "");
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
