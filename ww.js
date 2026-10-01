// Werewolf: the Telegram-style social deduction game for the guild. The database (ww_* functions) deals the secret roles,
// resolves nights/votes and runs the clock; this page polls ww_state with a private token and shows only what you may know.
// Chat goes over Supabase Realtime: the village channel, a wolves-only channel and a ghosts-only channel (their names are
// secret keys that the database only hands to wolves / dead players).
(() => {
const CFG = window.FAMILY_CONFIG || {};
const $w = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
                del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const BAD = /\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|dick|pussy|kys)\w*/i;
const ROLES = {
  villager: ["🧑‍🌾", "Villager", "Find the werewolves and vote them out."],
  wolf: ["🐺", "Werewolf", "Each night, pick a villager to eat with your pack. Don't get caught!"],
  seer: ["🔮", "Seer", "Each night, look at one player and learn their true role."],
  guardian: ["😇", "Guardian Angel", "Each night, protect one player (not yourself) from the wolves."],
  hunter: ["🏹", "Hunter", "If you die, you get one last shot to take someone down with you."],
  cursed: ["😈", "Cursed", "You're on the village side… until the wolves bite you. Then you become a werewolf."],
};
const roster = [...D.founders, ...D.members].filter((p, i, a) => a.findIndex(q => q.name === p.name) === i);
const guildOf = n => roster.find(p => p.name.toLowerCase() === n.trim().toLowerCase());
const spriteOf = n => (roster.find(p => p.name === n) || {}).sprite;

let sb = null, ch = null, chPack = null, chGhost = null, packKey = null, ghostKey = null;
let room = "public", sess = null, st = null, lastLog = 0, polling = false, pollT = null, leftAt = 0, tab = "village";
const msgs = { village: [], pack: [], ghost: [] }, unread = { village: 0, pack: 0, ghost: 0 };

$w("#wwRoles").innerHTML = Object.values(ROLES).map(([e, n, d]) => `<div class="wwr"><span>${e}</span><b>${n}</b><small>${d}</small></div>`).join("");

// ------------------------------------------------------------------ join screen (same name helper as Draw & Guess)
function showFace() {
  const n = $w("#wwName").value.trim(), g = guildOf(n);
  $w("#wwFace").innerHTML = g && g.sprite ? `<img src="${g.sprite}" alt="">` : `<span>${n ? "👤" : "🐺"}</span>`;
  $w("#wwWarn").hidden = !n || !!g;
}
let suggIdx = -1;
function suggest() {
  const q = $w("#wwName").value.trim().toLowerCase(), box = $w("#wwSugg");
  if (!q) { box.hidden = true; return; }
  const hits = roster.filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length).slice(0, 8);
  if (!hits.length || (hits.length === 1 && hits[0].name.toLowerCase() === q)) { box.hidden = true; return; }
  suggIdx = -1;
  box.innerHTML = hits.map(p => `<button type="button" data-n="${esc(p.name)}">${p.sprite ? `<img src="${p.sprite}" alt="">` : "<span style='width:34px'>👤</span>"}
    ${esc(p.name)}</button>`).join("");
  box.hidden = false;
}
$w("#wwSugg").addEventListener("pointerdown", e => {
  const b = e.target.closest("button"); if (!b) return; e.preventDefault();
  $w("#wwName").value = b.dataset.n; $w("#wwSugg").hidden = true; showFace();
});
$w("#wwName").addEventListener("input", () => { showFace(); suggest(); });
$w("#wwName").addEventListener("blur", () => setTimeout(() => $w("#wwSugg").hidden = true, 150));
$w("#wwName").addEventListener("keydown", e => {
  const items = [...$w("#wwSugg").querySelectorAll("button")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!items.length) return; e.preventDefault();
    suggIdx = (suggIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("on", i === suggIdx)); }
  if (e.key === "Enter") { e.preventDefault();
    if (suggIdx >= 0 && items[suggIdx]) { $w("#wwName").value = items[suggIdx].dataset.n; $w("#wwSugg").hidden = true; showFace(); }
    else $w("#wwJoin").click(); }
});
$w("#wwName").value = store.get("family_me") || "";
showFace();

function roomFromHash() { const m = location.hash.match(/^#ww\/([A-Z0-9]{4,8})$/); return m ? m[1] : null; }
$w("#wwPrivate").onclick = () => {
  location.hash = "#ww/" + Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
};
function updateRoomLabel() {
  const r = roomFromHash();
  $w("#wwRoomLbl").innerHTML = r ? `🔒 Private room <b>${r}</b>` : "";
  $w("#wwInvite").value = location.href.split("?")[0].replace(/#.*/, "") + (r ? "#ww/" + r : "#ww");
}
addEventListener("hashchange", () => {
  if (location.hash.startsWith("#ww/")) {  // the router only knows #ww; show the page for room links too
    document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === "ww"));
    document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#ww"));
  }
  updateRoomLabel();
  if (location.hash === "#ww" || location.hash.startsWith("#ww/")) { loadBoard(); tryResume(); }
});
updateRoomLabel();
if (location.hash.startsWith("#ww/")) setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 0);
else if (location.hash === "#ww") setTimeout(() => { loadBoard(); tryResume(); }, 0);

async function client() {
  if (!CFG.supabaseUrl) return null;
  if (!window.supabase) {
    await new Promise((res, rej) => { const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  return sb = sb || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
}
const tokKey = () => "ww_tok:" + (roomFromHash() || "public");
async function join(name, tok) {
  if (!(await client())) { $w("#wwErr").textContent = "The game needs the database connection."; return; }
  room = roomFromHash() || "public";
  const { data, error } = await sb.rpc("ww_join", { p_room: room, p_name: name || "", p_tok: tok || null });
  if (error || !data) { $w("#wwErr").textContent = "Couldn't connect, try again."; return; }
  const why = { name: "Type a name first.", taken: "Someone in this room already has that name.", full: "This room is full (20 players). Try a private room!",
                running: "A game is already running in this room. Wait for it to end, or create a private room!",
                kicked: "The host kicked you from this room." }[data.r];
  if (why) { if (!tok) $w("#wwErr").textContent = why; return data.r; }
  sess = { game: data.game, token: data.token, name: data.name }; store.set(tokKey(), JSON.stringify(sess));
  enter(); return "ok";
}
$w("#wwJoin").onclick = async () => {
  const n = $w("#wwName").value.trim().slice(0, 20);
  if (n.length < 2) { $w("#wwErr").textContent = "Type a name first."; return; }
  if (BAD.test(n)) { $w("#wwErr").textContent = "Pick a family friendly name 🙂"; return; }
  $w("#wwErr").textContent = "";
  if (guildOf(n)) store.set("family_me", guildOf(n).name);
  let saved = null; try { saved = JSON.parse(store.get(tokKey())); } catch (e) {}
  if (saved && saved.name === n && (await join(n, saved.token)) === "ok") return;
  await join(n, null);
};
async function tryResume() {  // came back after a refresh / closed tab: rejoin silently with the saved token
  if (sess) return;
  let saved = null; try { saved = JSON.parse(store.get(tokKey())); } catch (e) {}
  if (saved && saved.token) await join("", saved.token);  // no name: an expired token must not drop you into a new lobby
}

// ------------------------------------------------------------------ in the game
function enter() {
  $w("#wwLobby").hidden = true; $w("#wwGame").hidden = false; $w("#ww").classList.add("playing"); document.body.classList.add("ww-playing");
  window.scrollTo(0, 0);
  msgs.village = []; msgs.pack = []; msgs.ghost = []; lastLog = 0; st = null; tab = "village"; prevRole = null; prevStatus = null;
  sys(`You joined as <b>${esc(sess.name)}</b>.`);
  if (!guildOf(sess.name)) sys("You're playing as a guest: your wins won't be saved to the Hall of Fame.", "close");
  ch = sb.channel("ww:" + room, { config: { broadcast: { self: false } } });
  ch.on("broadcast", { event: "chat" }, ({ payload }) => onChat("village", payload));
  ch.on("broadcast", { event: "poke" }, () => setTimeout(poll, 150));
  ch.subscribe();
  poll(); clearInterval(pollT); pollT = setInterval(poll, 2000);
}
function exit(msg) {
  clearInterval(pollT); pollT = null;
  [ch, chPack, chGhost].forEach(c => c && sb.removeChannel(c)); ch = chPack = chGhost = null; packKey = ghostKey = null;
  sess = null; st = null;
  $w("#wwLobby").hidden = false; $w("#wwGame").hidden = true; $w("#ww").classList.remove("playing", "night"); document.body.classList.remove("ww-playing");
  $w("#wwErr").textContent = msg || ""; loadBoard();
}
$w("#wwLeave").onclick = async () => {
  if (st && !["lobby", "over"].includes(st.status) && st.me.alive && !confirm("Leave the game? You'll run away from the village (and die).")) return;
  if (sess) sb.rpc("ww_leave", { p_game: sess.game, p_tok: sess.token }).then(() => ch && poke());
  store.del(tokKey()); exit();
};
const poke = () => ch && ch.send({ type: "broadcast", event: "poke", payload: {} });

let prevRole = null, prevStatus = null;
async function poll() {
  if (!sess || polling) return; polling = true;
  try {
    const { data } = await sb.rpc("ww_state", { p_game: sess.game, p_tok: sess.token, p_after: lastLog });
    if (!data) return;
    if (data.r === "gone") {
      if (st && st.status === "lobby") {  // dropped from the lobby (phone slept / kicked): try to get back in
        const name = sess.name; exit(); store.del(tokKey());
        const r = await join(name, null); if (r !== "ok") $w("#wwErr").textContent = r === "kicked" ? "The host kicked you from this room." : "You left the room.";
      } else { store.del(tokKey()); exit("That game has ended."); }
      return;
    }
    for (const l of data.log) { lastLog = Math.max(lastLog, l.id); story(l.txt); }
    const was = st; st = data; leftAt = Date.now();
    if (data.me.role && prevRole && prevRole !== data.me.role && data.me.role === "wolf") {
      sys("🐺 You were bitten in the night… You are now a <b>Werewolf</b>! Your pack is waiting in the 🐺 chat.", "bad"); sound("howl");
    }
    if (data.me.role && !prevRole && data.status !== "lobby") {
      const [e, n] = ROLES[data.me.role]; sys(`${e} Your role: <b>${n}</b>. ${ROLES[data.me.role][2]}`, "info");
    }
    prevRole = data.me.role;
    if (prevStatus && prevStatus !== data.status) {
      if (data.status === "night") sound("night"); else if (data.status === "day") sound("day");
      else if (data.status === "over") sound(data.winner === "wolves" ? "howl" : "win"); else sound("blip");
      if (data.status === "lobby" || (was && was.status === "over")) {}
    }
    prevStatus = data.status;
    // secret chats: wolves get the pack channel, the dead get the ghost channel
    if (data.me.wolf_key && data.me.wolf_key !== packKey) {
      packKey = data.me.wolf_key; chPack = sb.channel("wwp:" + packKey, { config: { broadcast: { self: false } } });
      chPack.on("broadcast", { event: "chat" }, ({ payload }) => onChat("pack", payload)); chPack.subscribe();
    }
    if (data.me.ghost_key && data.me.ghost_key !== ghostKey) {
      ghostKey = data.me.ghost_key; chGhost = sb.channel("wwg:" + ghostKey, { config: { broadcast: { self: false } } });
      chGhost.on("broadcast", { event: "chat" }, ({ payload }) => onChat("ghost", payload)); chGhost.subscribe();
      if (!data.me.alive) { sys("👻 You died. You can chat with the other ghosts in the 👻 tab.", "close"); }
    }
    render();
  } finally { polling = false; }
}

const pl = n => (st.players || []).find(p => p.name === n) || {};
function canTarget(p) {
  if (!st || !p.alive || p.name === st.me.name) return false;
  const r = st.me.role;
  if (st.status === "night") return st.me.alive && (r === "seer" || r === "guardian" || (r === "wolf" && p.role !== "wolf"));
  if (st.status === "day" || st.status === "vote") return st.me.alive;
  if (st.status === "hunter") return st.hunter === st.me.name;
  return false;
}
function render() {
  if (!st) return;
  const s = st.status, me = st.me, host = st.host === me.name;
  $w("#ww").classList.toggle("night", s === "night");
  $w("#wwPhase").innerHTML = { lobby: "⏳ Waiting room", night: `🌙 Night ${st.day}`, day: `☀️ Day ${st.day}`, vote: `🗳️ Vote · Day ${st.day}`,
                              hunter: "🏹 The Hunter's last shot", over: st.winner === "wolves" ? "🐺 Werewolves win!" : "🏆 Villagers win!" }[s] || s;
  // my role card
  if (me.role) {
    const [e, n, d] = ROLES[me.role];
    let extra = "";
    if (me.role === "wolf") {
      const pack = st.players.filter(p => p.role === "wolf" && p.name !== me.name).map(p => esc(p.name) + (p.alive ? "" : " 💀"));
      extra = `<div class="x">Your pack: ${pack.join(", ") || "just you, lone wolf"}</div>`;
    }
    if (me.role === "seer" && me.checks) extra = `<div class="x">${me.checks.map(c => `Night ${c.day}: <b>${esc(c.name)}</b> is ${c.role === "wolf" ? "a 🐺 <b>Werewolf</b>!" : "a " + ROLES[c.role][1]}`).join("<br>")}</div>`;
    $w("#wwMe").innerHTML = `<span class="e">${e}</span><div><b>You are the ${n}${me.alive ? "" : " (dead 👻)"}</b><small>${d}</small>${extra}</div>`;
    $w("#wwMe").hidden = false;
  } else $w("#wwMe").hidden = true;
  // what to do now
  const n = st.players.length;
  let pr = "";
  if (s === "lobby") pr = host ? (n < 5 ? `👑 You're the host. ${n}/20 players: invite at least ${5 - n} more!` : `👑 You're the host. ${n} players ready: press Start!`)
                               : `Waiting for the host (${esc(st.host || "")}) to start… ${n}/20 players${n < 5 ? `, need ${5 - n} more` : ""}.`;
  else if (s === "over") pr = `<button class="sk-btn ww-play" id="wwAgain">Play again</button>`;
  else if (!me.alive && !(s === "hunter" && st.hunter === me.name)) pr = "👻 You're dead. Watch the village, and chat with the other ghosts.";
  else if (s === "night") {
    const who = me.act ? ` ✅ You picked <b>${esc(me.act)}</b> (tap someone else to change).` : "";
    pr = me.role === "wolf" ? "🐺 Tap a villager to eat tonight." + who : me.role === "seer" ? "🔮 Tap someone to see their true role." + who
       : me.role === "guardian" ? "😇 Tap someone to protect tonight." + who : "💤 You're asleep… hope you wake up tomorrow.";
  } else if (s === "day") pr = `☀️ Talk it out! Who's acting suspicious? Voting starts soon, or tap a player to vote now.${me.act ? ` ✅ Your vote: <b>${esc(me.act)}</b>` : ""}`;
  else if (s === "vote") pr = `🗳️ Tap who to lynch.${me.act ? ` ✅ Your vote: <b>${esc(me.act)}</b>` : ""} <button class="sk-small" id="wwSkip">🤐 Skip</button>`;
  else if (s === "hunter") pr = st.hunter === me.name ? "🏹 You're dying! Tap someone to shoot with your last arrow." : `🏹 ${esc(st.hunter)} is aiming…`;
  $w("#wwPrompt").innerHTML = pr;
  // players
  const votes = {}; st.players.forEach(p => { if (p.vote) votes[p.vote] = (votes[p.vote] || 0) + 1; });
  const packPick = {}; if (me.pack) Object.values(me.pack).forEach(t => { if (t) packPick[t] = (packPick[t] || 0) + 1; });
  $w("#wwPlayers").innerHTML = st.players.map(p => {
    const sp = spriteOf(p.name), role = p.role && (p.name !== me.name || !p.alive || s === "over") ? ROLES[p.role] : null;
    const cls = ["wwp", p.alive ? "" : "dead", p.name === me.name ? "me" : "", me.act === p.name ? "sel" : "", canTarget(p) ? "can" : "",
                 p.role === "wolf" && me.role === "wolf" ? "mate" : "", p.online ? "" : "off"].join(" ");
    return `<button class="${cls}" data-n="${esc(p.name)}" type="button">
      <div class="av">${sp ? `<img src="${sp}" alt="">` : "<span class='np'>👤</span>"}${p.alive ? "" : "<span class='rip'>💀</span>"}
        ${st.host === p.name && s === "lobby" ? "<span class='crown'>👑</span>" : ""}
        ${votes[p.name] ? `<span class="cnt">${votes[p.name]}</span>` : ""}${packPick[p.name] ? `<span class="cnt bite">🍖${packPick[p.name]}</span>` : ""}</div>
      <b>${esc(p.name)}${p.name === me.name ? " (You)" : ""}</b>
      <small>${role ? role[0] + " " + role[1] : p.role === "wolf" && p.name !== me.name ? "🐺 Pack" : p.vote ? "→ " + esc(p.vote) : p.online ? "" : "offline"}</small>
      ${host && s === "lobby" && p.name !== me.name ? `<span class="kick" data-k="${esc(p.name)}">✖</span>` : ""}</button>`;
  }).join("");
  $w("#wwLobbyBar").hidden = s !== "lobby";
  $w("#wwStart").hidden = !host; $w("#wwStart").disabled = n < 5;
  // chat tabs
  const tabs = [["village", "🏘️ Village"]];
  if (me.role === "wolf") tabs.push(["pack", "🐺 Pack"]);
  if (me.ghost_key) tabs.push(["ghost", "👻 Ghosts"]);
  if (!tabs.find(t => t[0] === tab)) tab = "village";
  $w("#wwTabs").innerHTML = tabs.length > 1 ? tabs.map(([k, l]) => `<button type="button" data-t="${k}" class="${k === tab ? "on" : ""}">${l}${unread[k] && k !== tab ? ` <i>${unread[k]}</i>` : ""}</button>`).join("") : "";
  const closed = chatClosed();
  $w("#wwMsg").disabled = !!closed; $w("#wwMsg").placeholder = closed || "Type a message…";
}
function chatClosed() {
  if (!st) return "";
  if (tab === "pack" || tab === "ghost") return "";
  if (!st.me.alive && !["lobby", "over"].includes(st.status)) return "Dead players can't talk to the village 👻";
  if (st.status === "night") return "🌙 Shh… the village is asleep";
  return "";
}
$w("#wwPlayers").addEventListener("click", async e => {
  if (!st || !sess) return;
  const k = e.target.closest(".kick");
  if (k) { if (!confirm(`Kick ${k.dataset.k}?`)) return; await sb.rpc("ww_kick", { p_game: sess.game, p_tok: sess.token, p_name: k.dataset.k }); poke(); poll(); return; }
  const b = e.target.closest(".wwp"); if (!b) return;
  const p = pl(b.dataset.n); if (!canTarget(p)) return;
  act(p.name);
});
async function act(target) {
  const { data } = await sb.rpc("ww_act", { p_game: sess.game, p_tok: sess.token, p_target: target });
  if (data && data.r === "late") { await poll(); return; }
  sound("blip"); poke(); polling = false; poll();
}
$w("#wwPrompt").addEventListener("click", async e => {
  if (e.target.id === "wwSkip") act(null);
  if (e.target.id === "wwAgain") { const n = sess.name; store.del(tokKey()); exit(); await join(n, null); }
});
$w("#wwStart").onclick = async () => {
  const { data } = await sb.rpc("ww_start", { p_game: sess.game, p_tok: sess.token });
  if (data && data.r === "few") sys(`Need at least 5 players to start (now ${data.n}).`);
  poke(); poll();
};
$w("#wwCopy").onclick = () => {
  const i = $w("#wwInvite"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand("copy"); }
  $w("#wwCopy").textContent = "Copied!"; setTimeout(() => $w("#wwCopy").textContent = "Copy", 1200);
};
$w("#wwTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.t; unread[tab] = 0; drawLog(); render(); });

// ------------------------------------------------------------------ chat + story
function addTo(k, html, cls) {
  msgs[k].unshift({ html, cls }); if (msgs[k].length > 150) msgs[k].pop();
  if (k === tab) drawLog(); else { unread[k]++; render(); }
}
function drawLog() { $w("#wwLog").innerHTML = msgs[tab].map(m => `<div class="msg ${m.cls || ""}">${m.html}</div>`).join(""); $w("#wwLog").scrollTop = 0; }
function sys(html, cls = "") { addTo("village", html, "sys " + cls); }
function story(t) {
  const cls = /win|lynched|found dead|shot|ran away/.test(t) ? "bad" : /Morning|saved/.test(t) ? "ok" : "info";
  addTo("village", esc(t), "sys story " + cls);
  if (/found dead|lynched|shot/.test(t)) sound("thud");
}
function onChat(k, m) {
  if (!m || typeof m.t !== "string") return;
  if (k === "village" && st && !["lobby", "over"].includes(st.status)) {
    const p = pl(m.n); if (!p.alive || st.status === "night") return;   // the dead and the sleeping can't talk to the village
  }
  addTo(k, `<b>${esc(m.n)}:</b> ${esc(m.t.slice(0, 160))}`, k === "pack" ? "pack" : k === "ghost" ? "ghost" : "");
}
let sending = false;
function sendChat() {
  if (sending || !sess) return;
  const inp = $w("#wwMsg"), t = inp.value.trim().slice(0, 160); if (!t || chatClosed()) return;
  sending = true; setTimeout(() => sending = false, 300); inp.value = "";
  if (BAD.test(t)) { sys("Keep it family friendly 🙂"); return; }
  const c = tab === "pack" ? chPack : tab === "ghost" ? chGhost : ch; if (!c) return;
  const m = { n: sess.name, t }; c.send({ type: "broadcast", event: "chat", payload: m }); onChat(tab, m);
}
$w("#wwChat").addEventListener("submit", e => { e.preventDefault(); sendChat(); });
$w("#wwMsg").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendChat(); } });

// ------------------------------------------------------------------ clock + sounds
setInterval(() => {
  if (!st || st.left == null) { $w("#wwClock").textContent = ""; return; }
  const left = Math.max(0, Math.ceil(st.left - (Date.now() - leftAt) / 1000));
  $w("#wwClock").textContent = left; $w("#wwClock").classList.toggle("hurry", left <= 10);
  if (left === 0 && sess && !polling) poll();
}, 250);
function sound(kind) {
  try {
    const ac = window.getAC && window.getAC(); if (!ac) return;
    const tone = (f, at, dur, type = "sine", vol = .2, f2) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at; o.type = type;
      o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
    };
    if (kind === "howl") { tone(300, 0, 1.1, "sawtooth", .08, 620); tone(620, 1, .6, "sawtooth", .06, 380); }
    else if (kind === "night") { tone(392, 0, .35); tone(330, .3, .35); tone(262, .6, .6); }
    else if (kind === "day") { tone(523, 0, .15, "triangle"); tone(659, .12, .15, "triangle"); tone(784, .24, .3, "triangle"); }
    else if (kind === "thud") tone(120, 0, .4, "square", .15, 50);
    else if (kind === "win") [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .12, .25, "triangle"));
    else tone(660, 0, .12, "sine", .15, 990);
  } catch (e) {}
}

async function loadBoard() {
  if (!(await client())) return;
  const { data } = await sb.from("ww_scores").select("player,games,wins,wolf_wins").order("wins", { ascending: false }).order("games").limit(15);
  $w("#wwBoard").innerHTML = (data || []).filter(r => r.games > 0).map(r => {
    const s = spriteOf(r.player);
    return `<li>${s ? `<img src="${s}" alt="">` : ""}<b>${esc(r.player)}</b><span>${r.wins} win${r.wins === 1 ? "" : "s"} · ${r.games} games${r.wolf_wins ? ` · 🐺 ${r.wolf_wins}` : ""}</span></li>`;
  }).join("") || "<li>No games yet. Be the first to survive the night!</li>";
}
})();
