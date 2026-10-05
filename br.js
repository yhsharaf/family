// Boom Roulette: Liar's Edition. A Kerning City table for 3-6 players with MapleStory Idle's real Star Force odds from 20 stars.
// The server rolls everything (br_* functions); this page polls the table once a second and shows only what you're allowed to see.
(() => {
const $b = q => document.querySelector(q);
const B = window.BD; if (!B || !$b("#br")) return;
const { esc, store, spriteOf, guildOf } = B;
const CL = { S: ["⭐", "Success"], M: ["😐", "No change"], D: ["⬇️", "Drop"], B: ["💥", "Boom"] };
const ROOM = { code: null, token: null, me: null, st: null, poll: null, pick: null, busy: false, lastPhase: null, lastRound: 0 };
const rooms = { list: null, t: 0 };
const wait = ms => new Promise(r => setTimeout(r, ms));
const newCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
function tone(f, dur, type = "square", vol = .06, f2) {
  const ac = window.getAC && window.getAC(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const sfx = { tick: () => tone(1200, .04, "square", .03), liar: () => { tone(300, .2, "sawtooth", .08, 600); setTimeout(() => tone(600, .25, "sawtooth", .08, 200), 150); },
  caught: () => { tone(160, .5, "sawtooth", .1, 50); }, truth: () => [660, 880].forEach((f, i) => setTimeout(() => tone(f, .15, "triangle", .07), i * 90)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .2, "triangle", .08), i * 120)) };

// ------------------------------------------------------------------ server calls
async function rpc(fn, args) { const c = await B.client(); if (!c) return null; const { data } = await c.rpc(fn, args); return data; }
async function join(code, pub) {
  const n = ($b("#brName").value || "").trim(); if (n.length < 2) { $b("#brErr").textContent = "Type your character name first."; return; }
  code = code.toUpperCase(); let tok = null; try { tok = store.get("br_tok:" + code); } catch (e) {}
  const d = await rpc("br_join", { p_code: code, p_name: n, p_tok: tok, p_public: !!pub });
  const why = d && { name: "Type your name first.", taken: "Someone at that table already has your name.", full: "That table is full (6 players).",
    running: "That table is in the middle of a game. Try again when it ends.", busy: "Too many tables right now, try again soon.", code: "That table code doesn't look right." }[d.r];
  if (!d || why) { $b("#brErr").textContent = why || "Couldn't reach the table, try again."; return; }
  $b("#brErr").textContent = ""; store.set("br_tok:" + code, d.token); if (guildOf(n)) store.set("family_me", guildOf(n).name);
  Object.assign(ROOM, { code, token: d.token, me: d.name, st: null, pick: null, lastPhase: null });
  if (location.hash !== "#br/" + code) history.replaceState(null, "", "#br/" + code);
  clearInterval(ROOM.poll); ROOM.poll = setInterval(poll, 1000); await poll(); show();
}
async function leave() {
  if (ROOM.code) { rpc("br_leave", { p_code: ROOM.code, p_tok: ROOM.token }); try { store.del && store.del("br_tok:" + ROOM.code); } catch (e) {} }
  clearInterval(ROOM.poll); Object.assign(ROOM, { code: null, token: null, st: null });
  if (location.hash.startsWith("#br/")) history.replaceState(null, "", "#br");
  show(); loadBoard();
}
async function act(kind, arg) {
  if (ROOM.busy) return; ROOM.busy = true;
  try { const d = await rpc("br_act", { p_code: ROOM.code, p_tok: ROOM.token, p_kind: kind, p_arg: arg || null }); if (kind === "roll" && d && d.roll) tone(d.roll === "B" ? 120 : d.roll === "S" ? 880 : 440, .2, "triangle", .07); await poll(); }
  finally { ROOM.busy = false; }
}
async function poll() {
  if (!ROOM.code || ROOM.polling) return; ROOM.polling = true;
  try {
    const d = await rpc("br_state", { p_code: ROOM.code, p_tok: ROOM.token });
    if (!d) return;
    if (d.r === "gone") { leave(); $b("#brErr").textContent = "You left that table."; return; }
    const prev = ROOM.st; ROOM.st = d; ROOM.at = performance.now();
    if (prev && (prev.phase !== d.phase || prev.round !== d.round)) { ROOM.pick = null; cue(prev, d); }
    if (prev && prev.status !== "over" && d.status === "over") { if (d.winner === ROOM.me) sfx.win(); loadBoard(); }
    draw();
  } finally { ROOM.polling = false; }
}
function cue(prev, d) {   // a little sound when the table moves on
  if (d.phase === "call") sfx.tick();
  if (d.phase === "reveal") { const any = d.players.some(p => p.target); if (any) { sfx.liar(); setTimeout(() => d.players.some(p => p.exposed || p.busted) ? sfx.caught() : sfx.truth(), 700); } }
}

// ------------------------------------------------------------------ drawing
function show() {
  const inRoom = !!ROOM.code;
  $b("#brLobby").hidden = inRoom; $b("#brGame").hidden = !inRoom;
  if (!inRoom) drawLobby();
}
function drawLobby() {
  const l = rooms.list;
  $b("#brRooms").innerHTML = !l ? `<p class="bd-none">Looking for tables…</p>` : !l.length ? `<p class="bd-none">No open tables right now. Open a public one and others can sit down!</p>`
    : l.map(r => `<button type="button" class="kt-oroom" data-room="${esc(r.code)}" ${r.status === "playing" || r.n >= 6 ? "disabled" : ""}>
      <img src="${spriteOf(r.host)}" alt=""><span><b>${esc(r.host)}'s table</b><small>${r.n}/6 · ${r.status === "playing" ? "🃏 game on" : "👥 waiting"}</small></span>
      <em>${r.status === "playing" ? "playing" : r.n >= 6 ? "full" : "Sit down ▶"}</em></button>`).join("");
}
async function loadRooms() {
  if (performance.now() - rooms.t < 2500) return; rooms.t = performance.now();
  rooms.list = (await rpc("br_list")) || []; if (!ROOM.code) drawLobby();
}
setInterval(() => { if (location.hash.startsWith("#br") && !ROOM.code && !document.hidden) loadRooms(); }, 4000);

function seatPos(i, n) {   // around an oval, you at the bottom
  const a = Math.PI / 2 + i / n * Math.PI * 2;
  return { x: 50 + Math.cos(a) * 44, y: 50 + Math.sin(a) * 40 };
}
const left = () => { const s = ROOM.st; return s && s.left != null ? Math.max(0, Math.ceil(s.left - (performance.now() - ROOM.at) / 1000)) : null; };
function draw() {
  const s = ROOM.st; if (!s) return;
  const me = s.mine, myP = s.players.find(p => p.name === s.me) || {}, playing = s.status === "playing", over = s.status === "over";
  const seated = s.players.filter(p => playing || over ? p.in : p.here);
  const order = [...seated]; const mi = order.findIndex(p => p.name === s.me); if (mi > 0) order.push(...order.splice(0, mi));   // you first = bottom seat
  $b("#brTable").className = "br-table n" + order.length;
  $b("#brSeats").innerHTML = order.map((p, i) => {
    const pos = seatPos(i, order.length), isMe = p.name === s.me, canPick = s.phase === "call" && playing && myP.alive && !me.acted && myP.calls > 0 && !isMe && p.alive;
    let bubble = "";
    if (playing && s.phase === "play") bubble = p.alive ? (p.done ? `<i class="br-b ok">✅ claimed</i>` : `<i class="br-b">🤔 …</i>`) : "";
    if ((s.phase === "call" || s.phase === "reveal" || over) && p.claim && (p.alive || p.out === s.round)) bubble = `<i class="br-b claim c${p.claim}">${CL[p.claim][0]} ${CL[p.claim][1]}!</i>`;
    let stamp = "";
    if (s.phase === "reveal" || over) {
      const accused = s.players.filter(a => a.target === p.name).map(a => a.name);
      if (p.busted) stamp = `<b class="br-stamp bad">💀 FAKE 23★<small>real ${p.real}★</small></b>`;
      else if (accused.length && p.exposed) stamp = `<b class="br-stamp bad">🤥 CAUGHT!<small>really ${CL[p.roll][0]} ${CL[p.roll][1]}</small></b>`;
      else if (accused.length && s.phase === "reveal") stamp = `<b class="br-stamp good">✅ TRUTH<small>${accused.map(esc).join(", ")} −🤥</small></b>`;
    }
    const callLine = (s.phase === "reveal" || over) && p.target ? `<i class="br-arrow">🤥 → ${esc(p.target)}</i>` : "";
    return `<div class="br-seat${isMe ? " me" : ""}${!p.alive && (playing || over) ? " out" : ""}${canPick ? " pick" : ""}${ROOM.pick === p.name ? " sel" : ""}${s.winner === p.name ? " win" : ""}" data-seat="${esc(p.name)}" style="left:${pos.x}%;top:${pos.y}%">
      ${bubble}${stamp}<img src="${spriteOf(p.name)}" alt=""><b>${esc(p.name)}${p.name === s.host ? " 👑" : ""}</b>
      ${playing || over ? `<span class="br-stats"><em class="st">${p.shown}★</em><em>${"❤️".repeat(Math.max(0, p.lives))}${p.alive ? "" : "💀"}</em><em>🤥${p.calls}</em></span>` : ""}${callLine}</div>`;
  }).join("");
  // the middle of the table: the dealer and what's happening
  const t = left();
  const phaseTxt = !playing && !over ? `${seated.length} seated · ${seated.length < 3 ? "need at least 3 to play" : s.host === s.me ? "start when ready" : `waiting for ${esc(s.host)} 👑`}`
    : over ? (s.winner ? `🏆 ${esc(s.winner)} wins!` : "Nobody survived 💀")
    : { play: "🎲 Enhance in secret, then claim", call: "🤥 Anyone lying? Call it!", reveal: "🔍 The truth comes out…" }[s.phase] || "";
  $b("#brCenter").innerHTML = `<img src="media/br/dealer.png" alt=""><b>${phaseTxt}</b>${playing ? `<small>Round ${s.round}${t != null ? ` · ⏱️ ${t}s` : ""}</small>` : ""}`;
  drawControls(s, me, myP, playing, over);
}
function drawControls(s, me, myP, playing, over) {
  const c = $b("#brCtl"), host = s.host === s.me;
  const link = location.href.split("#")[0] + "#br/" + ROOM.code;
  if (!playing && !over) {
    c.innerHTML = `<p class="br-hint">${s.public ? "🌍 Public table: anyone can sit down from the list." : "🔒 Private table: share the link."} 3–6 players.</p>
      <div class="bd-inv"><input readonly value="${esc(link)}" id="brLink"><button class="sk-small" data-a="copy">Copy</button></div>
      ${host ? `<button class="sk-btn bd-play" data-a="start" ${s.players.filter(p => p.here).length < 3 ? "disabled" : ""}>🃏 Deal the cards!</button>` : ""}
      <button class="sk-small" data-a="leave">🚪 Leave the table</button>`;
    return;
  }
  if (over) {
    const rows = s.players.filter(p => p.in).map(p => {
      const h = p.history || [], lies = h.filter(x => x[1] !== x[2]);
      return `<tr class="${p.name === s.winner ? "you" : ""}"><td><img src="${spriteOf(p.name)}" alt=""></td><td><b>${esc(p.name)}</b>${p.name === s.winner ? " 🏆" : ""}</td>
        <td class="br-hist">${h.map(x => `<i class="${x[1] !== x[2] ? (x[5] ? "lie caught" : "lie") : ""}" title="Round ${x[0]}: really ${CL[x[1]][1]}, said ${CL[x[2]][1]}">${CL[x[2]][0]}${x[1] !== x[2] ? `<small>${CL[x[1]][0]}</small>` : ""}</i>`).join("")}</td>
        <td>${lies.length} lie${lies.length === 1 ? "" : "s"}${lies.filter(x => !x[5]).length ? ` · ${lies.filter(x => !x[5]).length} got away 😏` : ""}</td></tr>`; }).join("");
    c.innerHTML = `<h3 class="br-over">${s.winner ? `🏆 ${esc(s.winner)} wins the table!` : "💀 Nobody made it"}</h3>
      <p class="br-hint">Every claim, with the real result under the lies (red = got away with it, orange = caught):</p>
      <table class="k-table br-res">${rows}</table>
      ${host ? `<button class="sk-btn bd-play" data-a="start" ${s.players.filter(p => p.here).length < 3 ? "disabled" : ""}>🔁 Deal again</button>` : `<p class="br-hint">Waiting for ${esc(s.host)} 👑 to deal again…</p>`}
      <button class="sk-small" data-a="leave">🚪 Leave the table</button>`;
    return;
  }
  if (!myP.alive) { c.innerHTML = `<p class="br-hint">💀 You're out. Watch the liars fight it out…</p><button class="sk-small" data-a="leave">🚪 Leave the table</button>`; return; }
  if (s.phase === "play") {
    if (me.claim) { c.innerHTML = `<p class="br-hint">✅ You claimed <b>${CL[me.claim][0]} ${CL[me.claim][1]}</b>${me.claim !== me.roll ? " 🤫 (a lie…)" : ""}. Waiting for the others…</p>`; return; }
    if (!me.roll) { c.innerHTML = `<p class="br-hint">Your item is at <b>${me.real}★</b> (for real). Nobody else will see what you get.</p><button class="sk-btn bd-play br-big" data-a="roll">⭐ Enhance in secret</button>`; return; }
    const opts = ["S", "M", "D", "B"].filter(k => k !== "D" || myP.shown >= 21);
    c.innerHTML = `<div class="br-secret">🤫 Only you can see this: <b>${CL[me.roll][0]} ${CL[me.roll][1]}</b> → real star <b>${me.real}★</b></div>
      <p class="br-hint">What do you tell the table? (${me.roll === "B" ? "telling the truth costs a ❤️ … lying might not" : "you can lie"})</p>
      <div class="br-claims">${opts.map(k => `<button type="button" data-claim="${k}" class="${k === me.roll ? "truth" : ""}">${CL[k][0]} ${CL[k][1]}${k === me.roll ? "<small>the truth</small>" : "<small>a lie</small>"}</button>`).join("")}</div>`;
    return;
  }
  if (s.phase === "call") {
    if (me.acted) { c.innerHTML = `<p class="br-hint">${me.target ? `🤥 You called <b>${esc(me.target)}</b> a liar…` : "🙅 You let it go this round."} Waiting…</p>`; return; }
    if (myP.calls <= 0) { c.innerHTML = `<p class="br-hint">You have no Liar calls left. Catch nobody, trust nobody…</p>`; return; }
    c.innerHTML = `<p class="br-hint">Tap a player you think is lying (${myP.calls} call${myP.calls > 1 ? "s" : ""} left; a correct call gives it back).</p>
      ${ROOM.pick ? `<button class="sk-btn bd-play" data-a="call">🤥 ${esc(ROOM.pick)} is lying!</button>` : ""}<button class="sk-small" data-a="pass">🙅 Nobody, pass</button>`;
    return;
  }
  c.innerHTML = `<p class="br-hint">🔍 Revealing…</p>`;
}
setInterval(() => { if (ROOM.st && ROOM.st.status === "playing") { const t = left(), c = $b("#brCenter small"); if (c && t != null) c.textContent = `Round ${ROOM.st.round} · ⏱️ ${t}s`; } }, 250);

// ------------------------------------------------------------------ board (guild members only)
async function loadBoard() {
  const c = await B.client(); if (!c) return;
  const { data } = await c.from("br_stats").select("player,games,wins,lies,lies_caught,catches").order("wins", { ascending: false }).order("games").limit(10);
  $b("#brBoard").innerHTML = (data || []).length ? data.map(r => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b><span>${r.wins} 🏆</span>
    <small>${r.games} games · ${r.lies - r.lies_caught} lies got away · ${r.catches} liars caught</small></li>`).join("") : `<p class="bd-none">No games yet. Sit down at a table!</p>`;
}

// ------------------------------------------------------------------ buttons
$b("#br").addEventListener("click", async e => {
  const a = e.target.closest("[data-a]"), room = e.target.closest("[data-room]"), claim = e.target.closest("[data-claim]"), seat = e.target.closest(".br-seat.pick");
  if (room && !room.disabled) return join(room.dataset.room);
  if (claim) return act("claim", claim.dataset.claim);
  if (seat) { ROOM.pick = seat.dataset.seat; draw(); return; }
  if (!a) return;
  const k = a.dataset.a;
  if (k === "pub") join(newCode(), true);
  if (k === "priv") join(newCode(), false);
  if (k === "code") { const v = ($b("#brCode").value || "").trim(); if (v) join(v); }
  if (k === "leave") leave();
  if (k === "roll") act("roll");
  if (k === "pass") act("pass");
  if (k === "call" && ROOM.pick) act("call", ROOM.pick);
  if (k === "start") { a.disabled = true; const d = await rpc("br_start", { p_code: ROOM.code, p_tok: ROOM.token }); if (!d || d.r !== "ok") $b("#brErr").textContent = { few: "You need at least 3 players.", host: "Only the host can deal." }[d && d.r] || "Couldn't start, try again."; poll(); }
  if (k === "copy") { const i = $b("#brLink"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (er) { document.execCommand("copy"); } a.textContent = "Copied!"; setTimeout(() => a.textContent = "Copy", 1200); }
});
$b("#brName").value = store.get("family_me") || "";
function hashRoom() {
  const m = location.hash.match(/^#br\/([A-Z0-9]{4,8})$/); if (!m) return;
  document.querySelectorAll("section").forEach(sec => sec.classList.toggle("on", sec.id === "br"));
  if (ROOM.code !== m[1]) { if (($b("#brName").value || "").trim().length >= 2) join(m[1]); else $b("#brErr").textContent = `Type your name, then press Join to sit at table ${m[1]}.`, $b("#brCode").value = m[1]; }
}
addEventListener("hashchange", () => { hashRoom(); if (location.hash === "#br") { loadRooms(); loadBoard(); } });
setTimeout(hashRoom, 80);
if (location.hash.startsWith("#br")) { loadRooms(); loadBoard(); }
show();
window.__br = location.hostname === "localhost" ? ROOM : undefined;
})();
