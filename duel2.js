// Bonk Duel 2v2: two teams of two. Everyone picks a move and a target in secret (attacks pick an enemy, Shield can cover
// yourself or your teammate); both teammates landing on the same enemy is a combo; Revive brings a knocked-out teammate
// back once per team. The database (bt_* functions in supabase_duel2v2_v23.sql) deals, resolves and keeps picks secret.
// Shares moves, classes, maps, effects, sounds and Professor CrtlAltDel's quiz with the 1v1 game (window.BD from duel.js).
(() => {
const B = window.BD; if (!B) return;
const { MOVES, CLASSES, MAPS, ATTACKS, M, esc, store, cost, realMove, spriteOf, guildOf, sound, fx, num, tomb } = B;
const $t = s => document.querySelector(s);
MOVES.revive = { name: "Revive", icon: "sk_resurrection.png", cost: 3, desc: "Bring your knocked-out teammate back with 5 HP (once per team)." };
const SIGNALS = ["🎯 Focus left", "🎯 Focus right", "🛡️ I'll shield you", "💥 Going Heavy", "🧪 I need MP", "❤️ Revive me!"];
const NEEDS_ENEMY = m => ATTACKS.includes(m);

let sb = null, ch = null, chTeam = null, teamKey = null, sess = null, st = null, leftAt = 0, polling = false, pollT = null;
let shownTurn = -1, animUntil = 0, disp = null, room = "public", sel = null, lastTombs = new Set();

function roomFromHash() { const m = location.hash.match(/^#duel2\/([A-Z0-9]{4,8})$/); return m ? m[1] : null; }
const tokKey = () => "bt_tok:" + (roomFromHash() || "public");
const err = t => { $t("#bdErr").textContent = t || ""; };
const team = s => s === 1 || s === 3 ? 1 : 2, mate = s => ({ 1: 3, 3: 1, 2: 4, 4: 2 })[s];
const P = s => st && st.players ? st.players.find(p => p.slot === s) : null;

// ------------------------------------------------------------------ lobby buttons + friend links
function updateLabel() {
  const r = roomFromHash();
  $t("#btFind").textContent = r ? "👥 Enter the 2v2!" : "👥 Find a 2v2";
  $t("#btPrivate").hidden = !!r; $t("#bdFind").hidden = !!r; if (r) $t("#bdPrivate").hidden = true;
  if (r) $t("#bdRoomLbl").innerHTML = `👥 2v2 room <b>${r}</b>: share the link, 4 players needed`;
}
addEventListener("hashchange", () => {
  if (location.hash.startsWith("#duel2/")) {
    document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === "duel"));
    document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#duel"));
    tryResume();
  }
  updateLabel();
});
if (location.hash.startsWith("#duel2/")) setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 50);
updateLabel();
$t("#btPrivate").onclick = () => {
  location.hash = "#duel2/" + Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  setTimeout(() => $t("#btFind").click(), 60);
};
async function join(name, tok, quiz) {
  sb = await B.client(); if (!sb) { err("2v2 needs the database connection."); return; }
  room = roomFromHash() || "public";
  const { data, error } = await sb.rpc("bt_join", { p_room: room, p_name: name || "", p_tok: tok || null, p_class: B.getClass(),
    p_quiz: quiz ? quiz.id : null, p_ans: quiz ? quiz.ans : null });
  if (error || !data) { err(/slow down/.test(error && error.message) ? "Too many tries, wait a minute 🙂" : "Couldn't connect, try again."); return; }
  if (data.r === "quiz") return "quiz";
  const why = { name: "Type a name first.", taken: "Someone in that room already has your name.", running: "A 2v2 is already being played in this room.",
    busy: "Lots of 2v2 games right now! Try again in a minute.", slow: "You've opened a lot of rooms. Wait a few minutes 🙂", gone: "" }[data.r];
  if (why != null) { if (!tok) err(why); return data.r; }
  sess = { game: data.game, token: data.token, name: data.name }; store.set(tokKey(), JSON.stringify(sess));
  enter(); return "ok";
}
async function joinQuiz(n) {
  let wrong = false;
  for (let i = 0; i < 5; i++) { const q = await B.askProf(wrong); if (!q) return; const r = await join(n, null, q); if (r !== "quiz") return r; wrong = true; }
}
$t("#btFind").onclick = async () => {
  const n = B.myName(); if (!n) return;
  let saved = null; try { saved = JSON.parse(store.get(tokKey())); } catch (e) {}
  if (saved && saved.name === n && (await join(n, saved.token)) === "ok") return;
  await joinQuiz(n);
};
async function tryResume() {
  if (sess) return;
  let saved = null; try { saved = JSON.parse(store.get(tokKey())); } catch (e) {}
  if (saved && saved.token) await join("", saved.token);
}
if (location.hash === "#duel") setTimeout(tryResume, 300);

// ------------------------------------------------------------------ entering / leaving
function enter() {
  $t("#bdLobby").hidden = true; $t("#bdGame").hidden = true; $t("#btGame").hidden = false;
  $t("#duel").classList.add("playing"); document.body.classList.add("bd-playing");
  $t("#btResult").hidden = true; $t("#btArena").querySelectorAll(".bd-fx, .bd-num, .bd-tomb, .bd-bubble, .bd-card, .bd-ring").forEach(x => x.remove());
  window.scrollTo(0, 0); st = null; shownTurn = -1; animUntil = 0; disp = null; sel = null; lastTombs = new Set();
  if (ch) sb.removeChannel(ch);
  ch = sb.channel("bt:" + sess.game, { config: { broadcast: { self: false } } });
  ch.on("broadcast", { event: "poke" }, () => setTimeout(poll, 120)); ch.subscribe();
  poll(); clearInterval(pollT); pollT = setInterval(poll, 1500);
}
function exit(msg) {
  clearInterval(pollT); pollT = null; [ch, chTeam].forEach(c => c && sb.removeChannel(c)); ch = chTeam = null; teamKey = null;
  sess = null; st = null; window.__btTurn = undefined; B.music(null);
  $t("#btGame").hidden = true; $t("#bdLobby").hidden = false; $t("#duel").classList.remove("playing"); document.body.classList.remove("bd-playing");
  err(msg); B.loadBoard();
}
$t("#btLeave").onclick = async () => {
  if (st && st.status === "pick" && P(st.me) && P(st.me).alive && !confirm("Leave the 2v2? Your character drops out and your teammate fights alone.")) return;
  if (sess) { sb.rpc("bt_leave", { p_game: sess.game, p_tok: sess.token }).then(poke); store.del(tokKey()); }
  exit();
};
$t("#btMusic").onclick = () => B.toggleMusic();
const poke = () => ch && ch.send({ type: "broadcast", event: "poke", payload: {} });
async function poll() {
  if (!sess || polling) return; polling = true;
  try {
    const { data } = await sb.rpc("bt_state", { p_game: sess.game, p_tok: sess.token });
    if (!data) return;
    if (data.r === "gone") { store.del(tokKey()); exit("You left that 2v2 room."); return; }
    const prev = st; st = data; leftAt = Date.now(); window.__btTurn = st.turn;
    if (!disp || Date.now() > animUntil) disp = snapshot(st);
    if (st.teamkey && st.teamkey !== teamKey) {   // private team channel for signals
      teamKey = st.teamkey; if (chTeam) sb.removeChannel(chTeam);
      chTeam = sb.channel("btt:" + teamKey, { config: { broadcast: { self: false } } });
      chTeam.on("broadcast", { event: "sig" }, ({ payload }) => payload && SIGNALS[payload.i] && bubble(payload.s, SIGNALS[payload.i], true));
      chTeam.subscribe();
    }
    if (st.last && st.last.turn !== shownTurn) {
      if (shownTurn < 0 && !prev && st.reveal <= 0) shownTurn = st.last.turn;
      else { shownTurn = st.last.turn; reveal(st.last, prev); }
    }
    if (prev && prev.status === "wait" && st.status === "pick") { sound("start"); banner(`🗺️ ${(MAPS[st.map] || MAPS.henesys).name}: ${(MAPS[st.map] || MAPS.henesys).rule}!<br><small>Team 🔵 vs Team 🔴</small>`, 3000); }
    if (st.status === "pick" && (st.arm1 || st.arm2) && (!prev || prev.turn !== st.turn)) {
      const mine = team(st.me) === 1 ? st.arm1 : st.arm2;
      setTimeout(() => banner(`🖐️ Zakum's arms are rising!<br><small>${mine === st.me ? "One is aiming at YOU" : "One is aiming at " + esc((P(mine) || {}).name || "your team")}: Shield, Dodge or Teleport!</small>`, 2600), (st.reveal || 0) * 1000);
    }
    render();
  } finally { polling = false; }
}
const snapshot = s => Object.fromEntries((s.players || []).map(p => [p.slot, { hp: p.hp, en: p.en, alive: p.alive }]));

// ------------------------------------------------------------------ drawing
// my team on the left (teammate outside, me inside), the other team on the right
function order() {
  const me = st.me, m = mate(me), en = (team(me) === 1 ? [2, 4] : [1, 3]);
  return [m, me, en[0], en[1]];
}
const POS = [12, 33, 67, 88];
function fighterEl(i) { return $t("#btF" + (i + 1)); }
function elOf(slot) { const i = order().indexOf(slot); return i < 0 ? null : fighterEl(i); }
const inReveal = () => st && (st.reveal - (Date.now() - leftAt) / 1000 > 0 || Date.now() < animUntil);
const pickLeft = () => st && st.left != null ? Math.max(0, st.left - (Date.now() - leftAt) / 1000) : null;
function render() {
  if (!st) return;
  const s = st.status, me = P(st.me) || {}, map = st.map || "henesys", ord = order();
  const ar = $t("#btArena"); ar.className = "bd-arena bt-arena m-" + map + (st.turn >= 10 && s === "pick" ? " sd" : "");
  placePlat(map);
  ord.forEach((slot, i) => {
    const el = fighterEl(i), p = P(slot); el.style.left = POS[i] + "%";
    el.classList.toggle("bd-l", i < 2); el.classList.toggle("bd-r", i >= 2);
    if (!p) { el.hidden = true; return; } el.hidden = false;
    const d = (disp && disp[slot]) || p, cls = CLASSES[p.class] || CLASSES.warrior;
    const img = el.querySelector(".bd-sp"); if (el.dataset.n !== p.name) { img.src = spriteOf(p.name); el.dataset.n = p.name; el.classList.remove("bd-ko"); el.querySelectorAll(".bd-tomb").forEach(x => x.remove()); }
    el.querySelector(".bd-tag").textContent = `${cls.e} ${p.name}${slot === st.me ? " (you)" : ""}`;
    el.classList.toggle("bt-me", slot === st.me); el.classList.toggle("bt-t1", team(slot) === 1); el.classList.toggle("bt-t2", team(slot) === 2);
    const hidden = d.hp == null;
    el.querySelector(".bd-hp").classList.toggle("secret", hidden);
    el.querySelector(".bd-hp i").style.width = hidden ? "100%" : (d.hp / p.hpmax * 100) + "%";
    el.querySelector(".bd-hp b").textContent = hidden ? "HP ???" : `HP ${d.hp}/${p.hpmax}`;
    el.querySelector(".bd-mp").innerHTML = Array.from({ length: p.enmax }, (_, k) => `<i class="${k < d.en ? "on" : ""}"></i>`).join("") + `<b>MP ${d.en}</b>`;
    el.querySelector(".bd-buffs").textContent = p.rage ? "🔥 Rage" : "";
    const think = el.querySelector(".bd-think"), picking = s === "pick" && !inReveal();
    think.hidden = !picking; think.textContent = !d.alive ? "💀" : p.picked || (slot === st.me && st.mine) ? "✅" : p.online === false ? "📵" : "🤔";
    const dead = !d.alive && s !== "wait";
    if (dead && !el.classList.contains("bd-ko")) { el.classList.add("bd-ko"); if (!el.querySelector(".bd-tomb")) tomb(el); }
    if (!dead && el.classList.contains("bd-ko")) { el.classList.remove("bd-ko"); el.querySelectorAll(".bd-tomb").forEach(x => x.remove()); }
    el.classList.toggle("bt-can", !!sel && canTarget(sel, slot));
    el.classList.toggle("bt-aim", st.mytarget === slot && !!st.mine && s === "pick");
  });
  // top bar
  const mp = MAPS[map] || MAPS.henesys, alive = t => (st.players || []).filter(p => team(p.slot) === t && p.alive).length;
  $t("#btPhase").innerHTML = s === "wait" ? `👥 Waiting room · ${(st.players || []).length}/4 players`
    : s === "over" ? "🏁 2v2 over" : `Turn ${Math.min(st.turn, 20)}/20 · <span class="bd-map">${esc(mp.name)}</span> · 🔵 ${alive(team(st.me))} vs 🔴 ${alive(3 - team(st.me))}`;
  // waiting room
  const wait = s === "wait";
  $t("#btLobby").hidden = !wait;
  if (wait) {
    const host = st.host === me.name, list = t => [1, 2].map(k => { const p = P(t === 1 ? (k === 1 ? 1 : 3) : (k === 1 ? 2 : 4));
      return p ? `<div class="bt-pl"><img src="${spriteOf(p.name)}" alt=""><b>${esc(p.name)}</b><small>${(CLASSES[p.class] || {}).e || ""} ${esc((CLASSES[p.class] || {}).name || "")}${st.host === p.name ? " 👑" : ""}</small></div>`
               : `<div class="bt-pl empty">waiting…</div>`; }).join("");
    $t("#btLobby").innerHTML = `<div class="bt-teams"><div class="bt-team t1"><h4>Team 🔵</h4>${list(1)}</div><div class="bt-vs">VS</div><div class="bt-team t2"><h4>Team 🔴</h4>${list(2)}</div></div>
      ${st.room !== "public" ? `<div class="bd-inv"><input id="btInvite" readonly value="${esc(location.href.split("#")[0] + "#duel2/" + st.room)}"><button class="sk-small" id="btCopy">Copy</button></div>` : ""}
      ${host && st.room !== "public" ? `<div class="bt-host"><button class="sk-btn sk-private" id="btShuffle">🔀 Shuffle teams</button><button class="sk-btn bd-play" id="btStart" ${(st.players || []).length < 4 ? "disabled" : ""}>Start!</button></div>` : ""}
      <p class="bt-note">${st.room === "public" ? "The match starts by itself when 4 players are in." : host ? "You're the host: start when 4 players are in." : "Waiting for the host to start…"}</p>`;
  }
  // moves + targets
  const canPick = s === "pick" && me.alive && !inReveal();
  const myCls = me.class || "warrior", mateP = P(mate(st.me)) || {};
  const moves = [...["bonk", "heavy", "shield", "dodge", "charge"], "skill"];
  if (mateP.name && !mateP.alive && !st.revived) moves.push("revive");
  $t("#btMoves").style.setProperty("--n", moves.length);
  $t("#btMoves").innerHTML = moves.map(k => { const real = realMove(k, myCls), m = MOVES[real], c = cost(real, myCls, map);
    const off = !canPick || c > (me.en || 0) || (real === "teleport" && st.last && st.last.p && (st.last.p[st.me - 1] || {}).m === "teleport");
    return `<button type="button" class="bd-move ${k === "skill" ? "skill" : ""} ${k === "revive" ? "revive" : ""} ${(st.mine === k || (sel && sel === k)) ? "sel" : ""}" data-m="${k}" ${off ? "disabled" : ""}>
      <span class="ic"><img src="${M + m.icon}" alt=""></span><b>${m.name}</b><i>${c ? c + " MP" : "Free"}</i></button>`; }).join("");
  $t("#btPanel").hidden = s !== "pick";
  const tg = $t("#btTargets");
  if (sel && canPick) {
    const opts = targetsFor(sel);
    tg.innerHTML = `<span>${NEEDS_ENEMY(realMove(sel, myCls)) ? "Who do you hit?" : "Shield who?"}</span>` + opts.map(t => `<button type="button" data-t="${t}">${t === st.me ? "🛡️ Me" : esc(P(t).name)}</button>`).join("");
    tg.hidden = false;
  } else tg.hidden = true;
  $t("#btSignals").innerHTML = SIGNALS.map((x, i) => `<button type="button" data-i="${i}">${x}</button>`).join("");
  // prompt
  let say = "";
  if (s === "pick" && !inReveal()) {
    if (!me.alive) say = mateP.alive ? "💀 You're down! Cheer your teammate on (or ask for a ❤️ Revive)." : "💀 You're down…";
    else if (sel) say = "Tap a target (on the arena or the buttons below).";
    else if (st.mine) say = `✅ You picked <b>${esc(MOVES[realMove(st.mine, myCls)].name)}</b>${st.mytarget && st.mytarget !== st.me ? ` → <b>${esc((P(st.mytarget) || {}).name || "")}</b>` : ""}. Waiting for the others…`;
    else say = "Pick a move, then a target. Use the team signals to plan with your teammate 🤫";
  }
  if (say && Date.now() > animUntil) $t("#btSay").innerHTML = `<span>${say}</span>`;
  if (s === "over") showResult();
  B.music(s === "pick" || s === "over" ? map : null);
}
function targetsFor(move) {
  const real = realMove(move, (P(st.me) || {}).class || "warrior");
  if (NEEDS_ENEMY(real)) return (st.players || []).filter(p => team(p.slot) !== team(st.me) && p.alive).map(p => p.slot);
  if (real === "shield") return [st.me, mate(st.me)].filter(s => P(s) && P(s).alive);
  return [];
}
const canTarget = (move, slot) => targetsFor(move).includes(slot);
function placePlat(map) {
  const ar = $t("#btArena"), img = $t("#btPlat"), p = (MAPS[map] || MAPS.henesys).plat, src = `${M}plat_${MAPS[map] ? map : "henesys"}.webp?v=4`;
  if (img.dataset.src !== src) { img.src = src; img.dataset.src = src; }
  const frac = Math.max(p.frac, .94), w = ar.clientWidth * frac, h = w * p.h / p.w, gl = parseFloat(getComputedStyle(ar).getPropertyValue("--gl")) || 96;
  img.style.width = w + "px"; img.style.bottom = (gl - (h - p.top * w / p.w)) + "px";
}
addEventListener("resize", () => st && !$t("#btGame").hidden && placePlat(st.map));
function showResult() {
  if (!$t("#btResult").hidden || Date.now() < animUntil) return;
  const mine = team(st.me), w = st.winner;
  const title = w === 0 ? "🤝 Draw!" : w === mine ? "🏆 Your team wins!" : "💀 Your team lost…";
  const why = { ko: "K.O.!", time: "Time's up: most total HP wins.", left: "The other team ran away 🏃", draw: "Everyone went down together!" }[st.why] || "";
  sound(w === mine ? "win" : w === 0 ? "blip" : "lose");
  (st.players || []).forEach(p => { if (team(p.slot) === w && p.alive) { const el = elOf(p.slot); if (el) fx(el, "levelup", 1); } });
  const pts = w === mine && guildOf((P(st.me) || {}).name || "") ? `<div class="pts">+1 point for the Hall of Fame</div>` : "";
  $t("#btResult").innerHTML = `<h3>${title}</h3><p>${why}</p>${pts}<div class="row"><button class="sk-btn bd-play" data-a="again">Rematch!</button><button class="sk-btn sk-private" data-a="back">Back</button></div>`;
  $t("#btResult").hidden = false;
}

// ------------------------------------------------------------------ input
async function pick(move, target) {
  sel = null; st.mine = move; st.mytarget = target; render();
  const { data } = await sb.rpc("bt_pick", { p_game: sess.game, p_tok: sess.token, p_move: move, p_target: target || null });
  if (data && data.r === "mp") banner("Not enough MP! 🧪", 1200);
  if (data && data.r === "target") banner("Pick an enemy to hit 🎯", 1200);
  sound("blip"); poke(); polling = false; poll();
}
$t("#btMoves").addEventListener("click", e => {
  const b = e.target.closest(".bd-move"); if (!b || b.disabled || !st) return;
  const m = b.dataset.m, opts = targetsFor(m);
  if (opts.length > 1) { sel = m; render(); sound("blip"); return; }
  pick(m, opts[0] || null);
});
$t("#btTargets").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (b && sel) pick(sel, +b.dataset.t); });
$t("#btArena").addEventListener("click", e => {
  const f = e.target.closest(".bd-f"); if (!f || !sel || !st) return;
  const slot = order()[["btF1", "btF2", "btF3", "btF4"].indexOf(f.id)];
  if (canTarget(sel, slot)) pick(sel, slot);
});
let sigAt = 0;
$t("#btSignals").addEventListener("click", e => {
  const b = e.target.closest("[data-i]"); if (!b || !st || Date.now() - sigAt < 1200) return;
  sigAt = Date.now(); const i = +b.dataset.i;
  bubble(st.me, SIGNALS[i], true);
  if (chTeam) chTeam.send({ type: "broadcast", event: "sig", payload: { s: st.me, i } });
});
$t("#btLobby").addEventListener("click", async e => {
  if (!sess) return;
  if (e.target.id === "btStart") { const { data } = await sb.rpc("bt_start", { p_game: sess.game, p_tok: sess.token }); if (data && data.r === "few") banner("Need 4 players 👥", 1500); poke(); polling = false; poll(); }
  if (e.target.id === "btShuffle") { await sb.rpc("bt_shuffle", { p_game: sess.game, p_tok: sess.token }); sound("flip"); poke(); polling = false; poll(); }
  if (e.target.id === "btCopy") { const i = $t("#btInvite"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (er) { document.execCommand("copy"); }
    e.target.textContent = "Copied!"; setTimeout(() => e.target.textContent = "Copy", 1200); }
});
$t("#btResult").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const n = sess && sess.name; store.del(tokKey()); exit();
  if (b.dataset.a === "again" && n) await joinQuiz(n);
});

// ------------------------------------------------------------------ the reveal
function reveal(l, prev) {
  animUntil = Date.now() + 3300;
  if (prev) disp = snapshot(prev);
  render();
  const info = l.p || [], by = s => info[s - 1] || {};
  info.forEach(x => {   // cards over everyone who acted
    const el = elOf(x.slot); if (!el || x.m === "none") return;
    const mv = MOVES[x.m], c = document.createElement("div"); c.className = "bd-card";
    const tn = x.t && x.t !== x.slot && P(x.t) ? ` → ${esc(P(x.t).name)}` : "";
    c.innerHTML = mv ? `<img src="${M + mv.icon}" alt=""><b>${mv.name}${tn}</b>` : "<span>💤</span><b>Zzz…</b>";
    el.appendChild(c); setTimeout(() => c.remove(), 3000);
  });
  sound("flip");
  setTimeout(() => {
    info.forEach(x => {
      const el = elOf(x.slot); if (!el) return;
      if (ATTACKS.includes(x.m)) { el.classList.add("bd-lunge"); setTimeout(() => el.classList.remove("bd-lunge"), 450); }
      if (x.m === "shield") { const te = elOf(x.t || x.slot); if (te) fx(te, "guard"); }
      if (x.m === "dodge") fx(el, "smoke");
      if (x.m === "rage") fx(el, "rage");
      if (x.m === "charge") fx(el, "buff");
      if (x.m === "teleport") fx(el, "smoke");
      if (x.m === "arrow") { const te = elOf(x.t); if (te) fx(te, "arrows"); }
      if (x.m === "coin") bubble(x.slot, x.h ? "🪙 Heads!" : "🪙 Tails…");
      if (x.m === "zzz") bubble(x.slot, "💤 Zzz…");
    });
    const anyHeavy = info.some(x => x.m === "heavy" || x.m === "coin");
    sound(anyHeavy ? "heavy" : info.some(x => ATTACKS.includes(x.m)) ? "bonk" : "clang");
  }, 800);
  setTimeout(() => {
    info.forEach(x => {
      const el = elOf(x.slot); if (!el) return;
      if (x.d > 0) { fx(el, x.d >= 4 ? "star" : "burst"); num(el, String(x.d), x.d >= 5 ? "cri" : x.slot === st.me ? "violet" : "red");
        el.classList.add("bd-ouch"); setTimeout(() => el.classList.remove("bd-ouch"), 500); }
      if (x.arm) setTimeout(() => bubble(x.slot, "🖐️ Zakum's arm! OUCH"), 250);
      if (x.rev) { const re = elOf(x.rev); if (re) { fx(re, "levelup", 1); setTimeout(() => num(re, "REVIVED!", "word"), 200); sound("win"); } }
    });
    const combos = info.filter(x => x.combo);
    if (combos.length) { const tgt = elOf(combos[0].t); if (tgt) setTimeout(() => num(tgt, "COMBO!", "word"), 300); sound("crit"); }
    disp = snapshot(st); render();
    critRing(l);
  }, 1150);
  $t("#btSay").innerHTML = "<span></span>";
  setTimeout(() => { $t("#btSay").innerHTML = `<span>${story(info)}</span>`; }, 1150);
  setTimeout(() => { animUntil = 0; render(); }, 3300);
}
function story(info) {
  const n = s => `<b>${esc((P(s) || {}).name || "?")}</b>`;
  const lines = [];
  const combo = info.find(x => x.combo); if (combo) { const m = info.find(x => x.combo && x.slot !== combo.slot); lines.push(`🔨🔨 COMBO! ${n(combo.slot)} & ${n(m ? m.slot : combo.slot)} both hit ${n(combo.t)}`); }
  info.filter(x => x.rev).forEach(x => lines.push(`❤️ ${n(x.slot)} revived ${n(x.rev)}!`));
  info.filter(x => x.m === "shield" && x.t && x.t !== x.slot).forEach(x => lines.push(`🛡️ ${n(x.slot)} shielded ${n(x.t)}`));
  info.filter(x => x.arm).forEach(x => lines.push(`🖐️ Zakum's arm slammed ${n(x.slot)}`));
  const big = info.filter(x => x.hit > 0 && !x.combo).sort((a, b) => b.hit - a.hit)[0]; if (big) lines.push(`${n(big.slot)} hit ${n(big.t)} for ${big.hit}`);
  const zz = info.filter(x => x.m === "zzz"); if (zz.length) lines.push(`💤 ${zz.map(x => n(x.slot)).join(", ")} dozed off`);
  return lines.slice(0, 2).join(" · ") || "Lots of blocking and dodging… nobody got hurt 😅";
}
function critRing(l) {
  const mine = (l.p || [])[st.me - 1]; if (!mine || !(mine.hit > 0) || st.status !== "pick") return;
  const el = elOf(mine.t); if (!el) return;
  const ring = document.createElement("div"); ring.className = "bd-ring"; ring.innerHTML = "<i></i><b></b>"; el.appendChild(ring);
  const t0 = performance.now(), wide = (P(st.me) || {}).class === "bowman", lo = wide ? .5 : .58, hi = wide ? .84 : .76;
  let done = false;
  const stop = () => { done = true; $t("#btArena").removeEventListener("pointerdown", tap); };
  const tap = e => {
    if (done || sel) return; stop(); e.preventDefault();
    const p = (performance.now() - t0) / 1000, good = p >= lo && p <= hi;
    ring.classList.add(good ? "hit" : "miss"); setTimeout(() => ring.remove(), 350);
    if (!good) { num(el, p < lo ? "Too early" : "Too late", "word"); return; }
    sound("crit"); setTimeout(() => num(el, "1", "cri"), 60);
    sb.rpc("bt_crit", { p_game: sess.game, p_tok: sess.token, p_turn: l.turn }).then(() => { poke(); polling = false; poll(); });
  };
  $t("#btArena").addEventListener("pointerdown", tap);
  setTimeout(() => { if (!done) { stop(); ring.remove(); } }, 1150);
}
function bubble(slot, text, signal) {
  const el = elOf(slot); if (!el) return;
  el.querySelectorAll(".bd-bubble").forEach(x => x.remove());
  const b = document.createElement("div"); b.className = "bd-bubble" + (signal ? " bt-sig" : ""); b.textContent = text;
  el.appendChild(b); setTimeout(() => b.remove(), 2600);
}
let bannerT = null;
function banner(html, ms) {
  const b = $t("#btBanner"); b.innerHTML = html; b.className = "bd-banner on";
  clearTimeout(bannerT); bannerT = setTimeout(() => b.className = "bd-banner", ms);
}
// clock
setInterval(() => {
  if (!st || $t("#btGame").hidden) return;
  const left = pickLeft(), rv = st.reveal - (Date.now() - leftAt) / 1000, c = $t("#btClock");
  if (st.status === "pick" && left != null && rv <= 0) { const s = Math.ceil(left); c.textContent = s; c.classList.toggle("hurry", s <= 5); }
  else { c.textContent = st.status === "pick" ? "⚔️" : ""; c.classList.remove("hurry"); }
  if (sess && left === 0 && !polling && st.status === "pick") poll();
  const want = st.status === "pick" && !inReveal() && P(st.me) && P(st.me).alive;
  if (want !== !!$t("#btMoves").dataset.on) { $t("#btMoves").dataset.on = want ? "1" : ""; render(); }
}, 250);
document.addEventListener("visibilitychange", () => { if (!document.hidden && sess) { polling = false; poll(); } });
})();
