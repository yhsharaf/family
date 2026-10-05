// Draw & Guess: a skribbl.io-style game for the guild. Live drawing/chat/players via Supabase Realtime (one channel per
// room); the secret word, guess checking, hints and the leaderboard live in the database (draw_* functions), so nobody
// can see the word or fake a correct guess. One player (the earliest to join) is the host and runs the turn clock.
(() => {
const CFG = window.FAMILY_CONFIG || {};
const $d = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const BAD = /\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|dick|pussy|kys)\w*/i;
const MAX_PLAYERS = 20, CHOOSE_SECS = 15, REVEAL_SECS = 6;
let settings = { rounds: 3, time: 80, words: "", onlyCustom: false };  // host-chosen room settings
const COLORS = ["#ffffff", "#c1c1c1", "#ef130b", "#ff7100", "#ffe400", "#00cc00", "#00ff91", "#00b2ff", "#231fd3", "#a300ba", "#df69a7", "#ffac8e", "#a0522d",
                "#000000", "#505050", "#740b07", "#c23800", "#e8a200", "#004619", "#00785d", "#00569e", "#0e0865", "#550069", "#873554", "#cc774d", "#63300d"];
const SIZES = [4, 10, 22, 40];

// everyone in the guild can play: Founders page people + all members, with their sprites
const roster = [...D.founders, ...D.members].filter((p, i, a) => a.findIndex(q => q.name === p.name) === i);
const spriteOf = n => (roster.find(p => p.name === n) || {}).sprite;

let sb = null, ch = null, me = null, room = "public", joinedAt = 0;
const myId = Math.random().toString(36).slice(2, 10);
let players = {};          // id -> {name, sprite, joined}
let S = { phase: "lobby" };  // shared game state (the host's copy is the truth)
let ops = [], curStroke = null, sendBuf = [];
let localHost = false, hostTimer = null, choiceShown = null, lastHintAt = 0;

// ------------------------------------------------------------------ join screen
const guildOf = n => roster.find(p => p.name.toLowerCase() === n.trim().toLowerCase());
function showPick() {
  const n = $d("#drawName").value.trim(), g = guildOf(n);
  $d("#drawPrev").innerHTML = g && g.sprite ? `<img src="${g.sprite}" alt="">` : `<span>${n ? "👤" : "🙂"}</span>`;
  $d("#drawWarn").hidden = !n || !!g;
}
// name suggestions while typing (iPhones don't show <datalist> well, so this is our own dropdown)
let suggIdx = -1;
function suggest() {
  const q = $d("#drawName").value.trim().toLowerCase(), box = $d("#drawSugg");
  if (!q) { box.hidden = true; return; }
  const hits = roster.filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length).slice(0, 8);
  if (!hits.length || (hits.length === 1 && hits[0].name.toLowerCase() === q)) { box.hidden = true; return; }
  suggIdx = -1;
  box.innerHTML = hits.map(p => `<button type="button" data-n="${esc(p.name)}">${p.sprite ? `<img src="${p.sprite}" alt="">` : "<span style='width:34px'>👤</span>"}
    ${esc(p.name)}<small>${p.founder ? "Founder" : p.n ? "Member" : "Core Family"}</small></button>`).join("");
  box.hidden = false;
}
$d("#drawSugg").addEventListener("pointerdown", e => {  // pointerdown so it fires before the input loses focus
  const b = e.target.closest("button"); if (!b) return; e.preventDefault();
  $d("#drawName").value = b.dataset.n; $d("#drawSugg").hidden = true; showPick();
});
$d("#drawName").addEventListener("input", () => { showPick(); suggest(); });
$d("#drawName").addEventListener("blur", () => setTimeout(() => $d("#drawSugg").hidden = true, 150));
$d("#drawName").addEventListener("keydown", e => {
  const items = [...$d("#drawSugg").querySelectorAll("button")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!items.length) return; e.preventDefault();
    suggIdx = (suggIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("on", i === suggIdx)); }
  if (e.key === "Enter") { e.preventDefault();
    if (suggIdx >= 0 && items[suggIdx]) { $d("#drawName").value = items[suggIdx].dataset.n; $d("#drawSugg").hidden = true; showPick(); }
    else $d("#drawJoin").click(); }
});
const withSprite = roster.filter(p => p.sprite);
function cycle(d) {  // ◀ ▶ arrows step through the guild like skribbl's avatar picker
  const i = withSprite.findIndex(p => p.name === $d("#drawName").value.trim());
  const p = withSprite[(i + d + withSprite.length) % withSprite.length]; $d("#drawName").value = p.name; showPick();
}
$d("#drawPrevChar").onclick = () => cycle(-1);
$d("#drawNextChar").onclick = () => cycle(1);
$d("#drawName").value = store.get("family_me") || "";
showPick();
function roomFromHash() { const m = location.hash.match(/^#draw\/([A-Z0-9]{4,8})$/); return m ? m[1] : null; }
$d("#drawPrivate").onclick = () => {
  const code = Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  location.hash = "#draw/" + code;
};
addEventListener("hashchange", () => {
  if (location.hash.startsWith("#draw/")) {  // the router only knows #draw; show the page for room links too
    document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === "draw"));
    updateRoomLabel();
  } else if (location.hash !== "#draw" && ch) leave();
  if (location.hash === "#draw" || location.hash.startsWith("#draw/")) loadBoard();
});
function updateRoomLabel() {
  const r = roomFromHash();
  $d("#drawRoomLbl").innerHTML = r ? `🔒 Private room <b>${r}</b>` : "";
  $d("#drawInvite").value = location.href.split("?")[0].replace(/#.*/, "") + (r ? "#draw/" + r : "#draw");
}
updateRoomLabel();
if (location.hash.startsWith("#draw/")) setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 0);

$d("#drawJoin").onclick = async () => {
  const n = $d("#drawName").value.trim().slice(0, 20);
  if (n.length < 2) { $d("#drawJoinMsg").textContent = "Type a name first."; return; }
  if (BAD.test(n)) { $d("#drawJoinMsg").textContent = "Pick a family friendly name 🙂"; return; }
  $d("#drawJoinMsg").textContent = "";
  const p = guildOf(n) || { name: n, sprite: null, guest: true };
  if (!CFG.supabaseUrl) { $d("#drawJoinMsg").textContent = "The game needs the database connection."; return; }
  if (!window.supabase) {
    await new Promise((res, rej) => { const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  sb = sb || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  me = { name: p.name, sprite: p.sprite || null, guest: !!p.guest }; if (!p.guest) store.set("family_me", p.name);
  room = roomFromHash() || "public"; joinedAt = Date.now();
  // at most 5 rooms at once (public + 4 private): check in with the database first
  const { data: rr, error: re } = await sb.rpc("draw_room", { p_room: room });
  const why = re ? (/slow down/.test(re.message) ? "Too many tries, wait a minute 🙂" : "Couldn't connect, try again.")
    : { busy: "All private rooms are taken right now (max 5 games at once). Play in the public room, or try again in a few minutes!",
        slow: "You've opened a lot of rooms. Wait a few minutes before making another one." }[rr && rr.r];
  if (why) { $d("#drawJoinMsg").textContent = why; return; }
  connect();
};
let roomPing = null;  // keep checking in while inside, so the room stays counted as in use

// ------------------------------------------------------------------ realtime
function connect() {
  clearInterval(roomPing); roomPing = setInterval(() => sb.rpc("draw_room", { p_room: room }).then(() => {}), 30000);   // .then: the request only goes out once something listens
  ch = sb.channel("draw:" + room, { config: { broadcast: { self: false }, presence: { key: myId } } });
  ch.on("presence", { event: "sync" }, () => {
    players = {};
    for (const [id, metas] of Object.entries(ch.presenceState())) players[id] = metas[0];
    const order = Object.entries(players).sort((a, b) => a[1].joined - b[1].joined).map(x => x[0]);
    if (order.indexOf(myId) >= MAX_PLAYERS) { leave(); $d("#drawJoinMsg").textContent = `This room is full (${MAX_PLAYERS} players). Try a private room!`; return; }
    pickHost(); renderPlayers();
  });
  ch.on("broadcast", { event: "state" }, ({ payload }) => { if (payload.from === hostId()) adopt(payload.s); });
  ch.on("broadcast", { event: "op" }, ({ payload }) => onOp(payload));
  ch.on("broadcast", { event: "chat" }, ({ payload }) => onChat(payload));
  ch.on("broadcast", { event: "guessed" }, ({ payload }) => onGuessed(payload));
  ch.on("broadcast", { event: "picked" }, ({ payload }) => { if (localHost) hostPicked(payload); });
  ch.on("broadcast", { event: "start" }, () => { if (localHost) hostStart(); });
  ch.on("broadcast", { event: "kick" }, ({ payload }) => {
    if (payload.from !== hostId()) return;
    if (payload.id === myId) { leave(); $d("#drawJoinMsg").textContent = "You were kicked from the room by the host."; }
  });
  ch.on("broadcast", { event: "sync?" }, () => { if (S.drawer === myId) ch.send({ type: "broadcast", event: "op", payload: { t: "all", ops } }); });
  ch.subscribe(async st => {
    if (st !== "SUBSCRIBED") return;
    await ch.track({ name: me.name, sprite: me.sprite, joined: joinedAt });
    $d("#drawLobby").hidden = true; $d("#drawGame").hidden = false; $d("#draw").classList.add("playing"); document.body.classList.add("sk-playing");
    window.scrollTo(0, 0);
    sys(`You joined as ${esc(me.name)}.`);
    if (me.guest) sys("You're playing as a guest: your points won't be saved to the Hall of Fame.", "close");
    setTimeout(() => ch.send({ type: "broadcast", event: "sync?", payload: {} }), 800);
  });
}
function leave() {
  clearInterval(roomPing); roomPing = null;
  if (hostTimer) clearInterval(hostTimer); hostTimer = null; localHost = false;
  if (ch) { ch.untrack(); sb.removeChannel(ch); ch = null; }
  $d("#drawLobby").hidden = false; $d("#drawGame").hidden = true; $d("#draw").classList.remove("playing"); document.body.classList.remove("sk-playing"); S = { phase: "lobby" }; ops = []; redraw();
}
$d("#drawLeave").onclick = () => { leave(); };
function hostId() {
  return Object.entries(players).sort((a, b) => a[1].joined - b[1].joined || (a[0] < b[0] ? -1 : 1)).map(x => x[0])[0];
}
function pickHost() {
  const h = hostId() === myId;
  if (h && !localHost) { localHost = true; hostTimer = setInterval(hostTick, 500); if (S.phase === "lobby") push(); }
  if (!h && localHost) { localHost = false; clearInterval(hostTimer); hostTimer = null; }
  $d("#drawStart").hidden = !(localHost && (S.phase === "lobby" || S.phase === "end"));
}
const send = (event, payload) => ch && ch.send({ type: "broadcast", event, payload });

// ------------------------------------------------------------------ host: the turn clock
function push() { S.v = (S.v || 0) + 1; send("state", { from: myId, s: S }); adopt(S, true); }
function present() { return Object.keys(players); }
function hostStart() {
  if (present().length < 2) { sys("Need at least 2 players to start."); return; }
  readSettings();
  S = { phase: "turn", round: 1, turn: -1, order: present().sort((a, b) => players[a].joined - players[b].joined),
        scores: {}, names: {}, guessed: [], kicked: S.kicked || [], settings: { ...settings },
        game: Math.random().toString(36).slice(2, 8) };  // unique per game, so turns from different games never clash
  for (const id of S.order) S.names[id] = players[id].name;
  nextTurn();
}
$d("#drawStart").onclick = () => { if (localHost) hostStart(); else send("start", {}); };
function nextTurn() {
  S.turn++;
  if (S.turn >= S.order.length) { S.turn = 0; S.round++; }
  if (S.round > S.settings.rounds) { S.phase = "end"; S.until = Date.now() + 15000; push(); return; }
  const drawer = S.order[S.turn];
  if (!players[drawer]) { nextTurn(); return; }  // left the room: skip their turn
  Object.assign(S, { phase: "choosing", drawer, roundId: null, mask: "", word: null, guessed: [], until: Date.now() + CHOOSE_SECS * 1000 + 2000 });
  send("op", { t: "clear", hard: true }); ops = []; redraw();
  push();
}
function hostPicked(p) {
  if (S.phase !== "choosing" || p.drawer !== S.drawer) return;
  Object.assign(S, { phase: "drawing", roundId: p.roundId, mask: p.mask, endsAt: Date.parse(p.ends_at), until: Date.parse(p.ends_at) });
  lastHintAt = Date.now(); push();
}
async function endTurn() {
  S.phase = "reveal"; const rid = S.roundId;
  if (rid) {
    await sb.rpc("draw_finish", { rid });
    const { data } = await sb.rpc("draw_hint", { rid });
    S.word = data && data.word;
  }
  S.until = Date.now() + REVEAL_SECS * 1000; push();
}
let hostBusy = false;
async function hostTick() {
  if (hostBusy) return; hostBusy = true;
  try {
    const now = Date.now();
    if (S.phase === "choosing" && (now > S.until || !players[S.drawer])) nextTurn();
    else if (S.phase === "drawing") {
      const guessers = present().filter(id => id !== S.drawer && S.order.includes(id));
      const all = guessers.length > 0 && guessers.every(id => S.guessed.includes(id));
      if (now >= S.endsAt || all || !players[S.drawer]) await endTurn();
      else if (now - lastHintAt > 5000) {  // refresh the hint mask every few seconds
        lastHintAt = now; const { data } = await sb.rpc("draw_hint", { rid: S.roundId });
        if (data && data.mask !== S.mask) { S.mask = data.mask; push(); }
      }
    } else if (S.phase === "reveal" && now > S.until) nextTurn();
    else if (S.phase === "end" && now > S.until) { S = { phase: "lobby" }; push(); }
    if (now % 3000 < 500) push();  // periodic full state for late joiners
  } finally { hostBusy = false; }
}

// ------------------------------------------------------------------ everyone: show the state
let seen = "";
function adopt(s, mine) {
  S = mine ? S : s;
  const key = [S.phase, S.drawer, S.round, S.turn].join("|"), prevPhase = seen.split("|")[0];
  if (key !== seen) {
    seen = key;
    if (S.phase === "choosing" && S.drawer === myId) offerWords();
    // the turn's points are saved on the server: refresh the Hall of Fame so everyone sees the new totals
    if ((S.phase === "reveal" || S.phase === "end") && prevPhase !== S.phase) setTimeout(loadBoard, 1200);
    if (S.phase === "drawing" && prevPhase !== "drawing") sys(`${esc(S.names[S.drawer] || "?")} is drawing now!`, "info");
    if (S.phase === "reveal" && S.word) sys(`The word was <b>${esc(S.word)}</b>`, "info");
    if (S.phase === "choosing" || S.phase === "lobby") { ops = []; redraw(); }
  }
  pickHost(); render();
}
let picking = false, offeredAt = 0;
async function offerWords() {
  const key = S.game + ":" + S.round + ":" + S.turn; if (choiceShown === key) return; choiceShown = key; offeredAt = Date.now();
  const st = S.settings || settings;
  const custom = st.words.split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(w => /^[a-z0-9 ]{2,30}$/.test(w));
  const { data, error } = await sb.rpc("draw_new_round", { room, drawer: me.name, dur: st.time, custom, only_custom: st.onlyCustom });
  if (error || !data) { choiceShown = null; setTimeout(() => { if (S.phase === "choosing" && S.drawer === myId) offerWords(); }, 1500); return; }
  const pick = async w => {
    if (picking) return; picking = true;
    $d("#drawChoose").innerHTML = "";
    const r = await sb.rpc("draw_pick", { rid: data.id, w });
    if (r.data) { myWord = w; send("picked", { drawer: myId, roundId: data.id, mask: r.data.mask, ends_at: r.data.ends_at });
      if (localHost) hostPicked({ drawer: myId, roundId: data.id, mask: r.data.mask, ends_at: r.data.ends_at }); }
    picking = false;
  };
  // 3 normal words + 1 MapleStory Idle word (data.special), shown so the drawer knows what it is; same points as the others
  $d("#drawChoose").innerHTML = `<div class="dc-title">Choose a word</div>` +
    data.choices.map(w => w === data.special
      ? `<button class="btn special" data-w="${esc(w)}">${esc(w)}</button>`
      : `<button class="btn" data-w="${esc(w)}">${esc(w)}</button>`).join("");
  $d("#drawChoose").querySelectorAll("button").forEach(b => b.onclick = () => pick(b.dataset.w));
  setTimeout(() => { if ($d("#drawChoose").innerHTML && S.phase === "choosing" && S.drawer === myId) pick(data.choices[0]); }, CHOOSE_SECS * 1000);
}
let myWord = null;
function render() {
  $d("#drawGame").classList.toggle("inlobby", S.phase === "lobby" || S.phase === "end");
  const drawing = S.phase === "drawing", iDraw = S.drawer === myId && (drawing || S.phase === "choosing");
  $d("#drawTools").hidden = !(drawing && S.drawer === myId);
  const R = (S.settings || settings).rounds;
  $d("#drawRound").textContent = S.round ? `Round ${Math.min(S.round, R)} of ${R}` : "";
  $d("#drawSettings").hidden = !(localHost && (S.phase === "lobby" || S.phase === "end"));
  if (S.kicked && S.kicked.includes(me.name) && ch) { leave(); $d("#drawJoinMsg").textContent = "You were kicked from the room by the host."; return; }
  const letters = m => (m || "").split(" ").filter(c => c === "_" || /[a-z0-9]/.test(c)).length;
  $d("#drawWordLbl").textContent = drawing ? (S.drawer === myId ? "DRAW THIS" : "GUESS THIS") : S.phase === "reveal" ? "THE WORD WAS" : "WAITING";
  const tiles = m => { const parts = (m || "").split(" "); let out = "", prevSpace = false;
    // the mask is "_ _ x _" with single spaces between letters; a real space in the word shows up as an empty part
    for (const c of parts) { if (c === "") { out += '<span class="sp"></span>'; continue; } out += `<span class="ltr">${c === "_" ? "" : esc(c)}</span>`; }
    return out + `<span class="cnt">${letters(m)}</span>`; };
  $d("#drawWord").innerHTML = drawing ? (S.drawer === myId ? `<span class="plain">${esc(myWord || "")}</span>` : tiles(S.mask)) :
    S.phase === "reveal" ? `<span class="plain">${esc(S.word || "")}</span>` : "";
  const ov = $d("#drawOverlay");
  let html = "";
  if (S.phase === "lobby") html = localHost ? "" : `<p>Waiting for the host to start the game…</p>`;
  else if (S.phase === "choosing") html = S.drawer === myId ? "" : `<p>${esc(S.names[S.drawer] || "?")} is choosing a word…</p>`;
  else if (S.phase === "reveal") html = `<p>The word was</p><div class="dw-big">${esc(S.word || "?")}</div>`;
  else if (S.phase === "end") {
    const top = Object.entries(S.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    html = `<div class="dw-big">🏆 Game over</div>` + top.map(([id, sc], i) =>
      `<div class="pod p${i}">${["🥇", "🥈", "🥉"][i]} ${esc(S.names[id] || "?")} · ${sc}</div>`).join("");
  }
  ov.innerHTML = html; ov.hidden = !html;
  if (!iDraw) $d("#drawChoose").innerHTML = "";
  if (S.phase !== "choosing" || S.drawer !== myId) $d("#drawChoose").hidden = true; else $d("#drawChoose").hidden = false;
  $d("#drawSettings").hidden = !(localHost && (S.phase === "lobby" || S.phase === "end"));
  renderPlayers();
}
function renderPlayers() {
  const ids = Object.keys(players).sort((a, b) => ((S.scores || {})[b] || 0) - ((S.scores || {})[a] || 0) || players[a].joined - players[b].joined);
  const host = hostId();
  $d("#drawPlayers").innerHTML = ids.map((id, i) => {
    const p = players[id], sc = (S.scores || {})[id] || 0, g = (S.guessed || []).includes(id);
    return `<div class="dp ${g ? "got" : ""} ${id === myId ? "me" : ""}"><span class="rk">#${i + 1}</span>
      <div class="dn"><b>${esc(p.name)}${id === myId ? " (You)" : ""}</b><span>${sc} points</span></div>
      <div class="av">${p.sprite ? `<img src="${p.sprite}" alt="">` : "<span class='np'>👤</span>"}
        ${S.drawer === id && S.phase !== "lobby" ? "<span class='pen'>✏️</span>" : ""}${id === host ? "<span class='crown' title='host'>👑</span>" : ""}</div>
      ${localHost && id !== myId ? `<button class="kick" data-id="${id}" title="kick">✖</button>` : ""}</div>`;
  }).join("");
  $d("#drawStart").hidden = !(localHost && (S.phase === "lobby" || S.phase === "end"));
}
setInterval(() => {  // safety net: my turn to choose but no words on screen -> show them again
  if (!ch || S.phase !== "choosing" || S.drawer !== myId || picking) return;
  if (!$d("#drawChoose").querySelector("button") && Date.now() - offeredAt > 3000) { choiceShown = null; offerWords(); }
}, 1000);
setInterval(() => {
  if (!ch) return;
  const left = S.until ? Math.max(0, Math.ceil((S.until - Date.now()) / 1000)) : "";
  $d("#drawTimer").textContent = (S.phase === "drawing" || S.phase === "choosing") ? `${left}` : "";
}, 250);

$d("#drawCopy").onclick = () => {
  const i = $d("#drawInvite"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand("copy"); }
  $d("#drawCopy").textContent = "Copied!"; setTimeout(() => $d("#drawCopy").textContent = "Copy", 1200);
};
$d("#drawPlayers").addEventListener("click", e => {
  const b = e.target.closest(".kick"); if (!b || !localHost) return;
  const p = players[b.dataset.id]; if (!p || !confirm(`Kick ${p.name} from the room?`)) return;
  S.kicked = [...(S.kicked || []), p.name]; send("kick", { from: myId, id: b.dataset.id });
  sys(`${esc(p.name)} was kicked.`); push();
});
function readSettings() {
  settings = { rounds: +$d("#dsRounds").value, time: +$d("#dsTime").value, words: $d("#dsWords").value.slice(0, 3000),
               onlyCustom: $d("#dsOnly").checked };
}
["#dsRounds", "#dsTime", "#dsWords", "#dsOnly"].forEach(sel => $d(sel).addEventListener("change", () => {
  readSettings(); if (localHost) { S.settings = { ...settings }; push(); }
}));

// ------------------------------------------------------------------ chat + guessing
function sys(html, cls = "") { const d = document.createElement("div"); d.className = "msg sys " + cls; d.innerHTML = html; addMsg(d); }
// newest message on top, older ones move down
function addMsg(d) { const log = $d("#drawLog"); log.prepend(d); while (log.children.length > 150) log.lastChild.remove(); log.scrollTop = 0; }
function canSeeSecret() { return S.drawer === myId || (S.guessed || []).includes(myId); }
function onChat(m) {
  if (m.secret && !canSeeSecret()) return;  // after guessing, your chat is only for others who also know the word
  const d = document.createElement("div"); d.className = "msg" + (m.secret ? " secret" : "");
  d.innerHTML = `<b>${esc(m.name)}:</b> ${esc(m.text)}`; addMsg(d);
}
function onGuessed(m) {
  if (localHost && S.phase === "drawing" && !S.guessed.includes(m.id)) {
    S.guessed.push(m.id); S.scores[m.id] = (S.scores[m.id] || 0) + m.pts; S.scores[S.drawer] = (S.scores[S.drawer] || 0) + 50; push();
  }
  sys(`✅ <b>${esc(m.name)}</b> guessed the word! (+${m.pts})`, "ok");
}
$d("#drawMsg").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendChat(); } });
$d("#drawChat").addEventListener("submit", e => { e.preventDefault(); sendChat(); });
let sending = false;
async function sendChat() {
  if (sending) return;
  const inp = $d("#drawMsg"), text = inp.value.trim().slice(0, 100); if (!text || !ch) return;
  sending = true; setTimeout(() => sending = false, 250);
  inp.value = "";
  if (BAD.test(text)) { sys("Keep it family friendly 🙂"); return; }
  if (S.phase === "drawing" && S.drawer !== myId && !(S.guessed || []).includes(myId) && S.roundId) {
    const { data } = await sb.rpc("draw_guess", { rid: S.roundId, player: me.name, g: text });
    const r = data && data.r;
    if (r === "correct") {
      const msg = { id: myId, name: me.name, pts: data.pts };
      send("guessed", msg); onGuessed(msg); if (!localHost) { S.guessed = [...(S.guessed || []), myId]; }
      blipD(880); return;
    }
    if (r === "close") sys(`'${esc(text)}' is close!`, "close");
    if (r === "limit") { sys("Too many guesses this round."); return; }
  }
  const m = { name: me.name, text, secret: S.phase === "drawing" && canSeeSecret() };
  send("chat", m); onChat(m);
}
function blipD(f) {
  try { const ac = window.getAC && window.getAC(); if (!ac) return; const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + .12); g.gain.setValueAtTime(.25, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .2); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .22); } catch (e) {}
}

// ------------------------------------------------------------------ canvas
const cv = $d("#drawCanvas"), cx = cv.getContext("2d"), CW = cv.width, CH = cv.height;
let tool = "brush", color = "#000000", size = SIZES[1];
$d("#drawColors").innerHTML = COLORS.map(c => `<button class="col" style="background:${c}" data-c="${c}"></button>`).join("");
$d("#drawSizes").innerHTML = SIZES.map(s => `<button class="sz" data-s="${s}"><i style="width:${Math.min(30, s * .7 + 4)}px;height:${Math.min(30, s * .7 + 4)}px"></i></button>`).join("");
$d("#drawColors").onclick = e => { const b = e.target.closest(".col"); if (!b) return; color = b.dataset.c; if (tool === "eraser") tool = "brush"; markTools(); };
$d("#drawSizes").onclick = e => { const b = e.target.closest(".sz"); if (!b) return; size = +b.dataset.s; markTools(); };
document.querySelectorAll("#drawTools [data-tool]").forEach(b => b.onclick = () => { tool = b.dataset.tool; markTools(); });
$d("#drawUndo").onclick = () => { if (!myTurn()) return; ops.pop(); redraw(); send("op", { t: "undo" }); };
$d("#drawClear").onclick = () => { if (!myTurn()) return; ops = []; redraw(); send("op", { t: "clear" }); };
function markTools() {
  document.querySelectorAll("#drawColors .col").forEach(b => b.classList.toggle("on", b.dataset.c === color && tool !== "eraser"));
  document.querySelectorAll("#drawSizes .sz").forEach(b => b.classList.toggle("on", +b.dataset.s === size));
  document.querySelectorAll("#drawTools [data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === tool));
  document.querySelectorAll("#drawSizes .sz i").forEach(i => i.style.background = tool === "eraser" ? "#999" : color === "#ffffff" ? "#ddd" : color);
  $d("#drawCur").style.background = tool === "eraser" ? "repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/12px 12px" : color;
}
markTools();
const myTurn = () => ch && S.phase === "drawing" && S.drawer === myId;
function pos(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
cv.addEventListener("pointerdown", e => {
  if (!myTurn()) return; e.preventDefault(); cv.setPointerCapture(e.pointerId);
  const [x, y] = pos(e);
  if (tool === "fill") { const op = { k: "f", x, y, c: color }; ops.push(op); applyOp(op); send("op", { t: "add", op }); return; }
  curStroke = { k: "s", c: tool === "eraser" ? "#ffffff" : color, w: size, p: [x, y], id: myId + Date.now() };
  ops.push(curStroke); drawSeg(curStroke, 0); sendBuf = [x, y];
  send("op", { t: "begin", op: { ...curStroke, p: [x, y] } });
});
cv.addEventListener("pointermove", e => {
  if (!curStroke) return; const [x, y] = pos(e);
  curStroke.p.push(x, y); drawSeg(curStroke, curStroke.p.length - 4); sendBuf.push(x, y);
});
["pointerup", "pointercancel", "pointerleave"].forEach(t => cv.addEventListener(t, () => { if (curStroke) { flushStroke(); curStroke = null; } }));
function flushStroke() { if (curStroke && sendBuf.length > 2) send("op", { t: "more", id: curStroke.id, p: sendBuf.slice(2) }); if (curStroke) sendBuf = sendBuf.slice(-2); }
setInterval(() => { if (curStroke) flushStroke(); }, 60);
function onOp(m) {
  if (m.t === "begin") { ops.push(m.op); drawSeg(m.op, 0); }
  else if (m.t === "more") { const s = ops.find(o => o.id === m.id); if (s) { const from = s.p.length - 2; s.p.push(...m.p); for (let i = Math.max(0, from); i < s.p.length - 2; i += 2) drawSeg(s, i); } }
  else if (m.t === "add") { ops.push(m.op); applyOp(m.op); }
  else if (m.t === "undo") { ops.pop(); redraw(); }
  else if (m.t === "clear") { ops = []; redraw(); }
  else if (m.t === "all" && S.drawer !== myId) { ops = m.ops; redraw(); }
}
function drawSeg(s, i) {
  const p = s.p; cx.strokeStyle = s.c; cx.fillStyle = s.c; cx.lineWidth = s.w; cx.lineCap = cx.lineJoin = "round";
  if (p.length <= 2 || i < 0) { cx.beginPath(); cx.arc(p[0] * CW, p[1] * CH, s.w / 2, 0, 7); cx.fill(); return; }
  cx.beginPath(); cx.moveTo(p[i] * CW, p[i + 1] * CH); cx.lineTo(p[i + 2] * CW, p[i + 3] * CH); cx.stroke();
}
function applyOp(o) {
  if (o.k === "s") { drawSeg(o, -1); for (let i = 0; i + 3 < o.p.length; i += 2) drawSeg(o, i); }
  else if (o.k === "f") flood(Math.floor(o.x * CW), Math.floor(o.y * CH), o.c);
}
function redraw() { cx.fillStyle = "#fff"; cx.fillRect(0, 0, CW, CH); ops.forEach(applyOp); }
function flood(x0, y0, hex) {
  const img = cx.getImageData(0, 0, CW, CH), d = img.data, i0 = (y0 * CW + x0) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  const nr = parseInt(hex.slice(1, 3), 16), ng = parseInt(hex.slice(3, 5), 16), nb = parseInt(hex.slice(5, 7), 16);
  if (Math.abs(tr - nr) + Math.abs(tg - ng) + Math.abs(tb - nb) < 10) return;
  const same = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) < 60;
  const stack = [x0, y0], seen = new Uint8Array(CW * CH);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(); if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
    const k = y * CW + x; if (seen[k]) continue; const i = k * 4; if (!same(i)) continue;
    seen[k] = 1; d[i] = nr; d[i + 1] = ng; d[i + 2] = nb; d[i + 3] = 255;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  cx.putImageData(img, 0, 0);
}
redraw();

// ------------------------------------------------------------------ all-time leaderboard
async function loadBoard() {
  if (!CFG.supabaseUrl) return;
  if (!window.supabase) return setTimeout(loadBoard, 1500);
  sb = sb || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const { data } = await sb.from("draw_scores").select("player,points,guessed,drew").order("points", { ascending: false }).limit(30);
  $d("#drawBoard").innerHTML = (data || []).filter(r => r.points > 0).map((r, i) => {
    const s = spriteOf(r.player);
    return `<li>${s ? `<img src="${s}" alt="">` : ""}<b>${esc(r.player)}</b><span>${r.points.toLocaleString()} pts · ${r.guessed} guessed · ${r.drew} drawn</span></li>`;
  }).join("") || "<li>No scores yet. Be the first artist!</li>";
}
if (location.hash.startsWith("#draw")) loadBoard();
// and keep it fresh for people just watching the page (other rooms' games count too)
setInterval(() => { if (location.hash.startsWith("#draw") && !document.hidden) loadBoard(); }, 60000);
})();
