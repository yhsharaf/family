// Interactive extras for the Family site: traitor stew, find-me / shake on the tree,
// and the shared features (guestbook, guild-wide counters, photo votes, moderated photo uploads) backed by Supabase.
// Uses the globals from index.html's main script: D, $, esc, fmt, gcol, rot, crack, AC.
(() => {
const CFG = window.FAMILY_CONFIG || {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const people = [...D.founders.map(f => ({ ...f, founder: true })), ...D.members];
const byName = Object.fromEntries(people.map(p => [p.name.toLowerCase(), p]));
const BAD = /\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|dick|pussy|kys)\w*/i;  // simple filter; the DB is the real gate
$("#names").innerHTML = people.map(p => `<option value="${esc(p.name)}">`).join("");

// ======================================================== shared backend (optional)
let sb = null;
const ready = (async () => {
  if (!CFG.supabaseUrl || !CFG.supabaseKey) return null;
  await new Promise((res, rej) => { const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  return sb;
})().catch(() => null);
let device = store.get("family_device");
if (!device) { device = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); store.set("family_device", device); }

// ---------- guild-wide counters: whips per traitor (they always add up to the guild total) + stews
const pending = { stews: 0 }, pendingWhips = {}, whipCounts = {};
function showWhips() {
  let total = 0;
  document.querySelectorAll(".poster[data-name]").forEach(p => {
    const n = whipCounts[p.dataset.name] || 0; total += n; p.querySelector(".tw b").textContent = n.toLocaleString();
  });
  $("#gwhips").textContent = total.toLocaleString();
}
async function loadCounters() {
  if (!(await ready)) { $("#gwhips").textContent = "soon"; $("#gstews").textContent = "soon"; return; }
  const [w, c] = await Promise.all([sb.from("traitor_whips").select("traitor,value"), sb.from("counters").select("name,value")]);
  (w.data || []).forEach(r => { whipCounts[r.traitor] = Number(r.value) + (pendingWhips[r.traitor] || 0); });
  showWhips();
  (c.data || []).forEach(r => { if (r.name === "stews") $("#gstews").textContent = (Number(r.value) + pending.stews).toLocaleString(); });
}
async function flush() {
  if (!(await ready)) return;
  for (const t of Object.keys(pendingWhips)) {
    const n = Math.min(50, pendingWhips[t]); if (!n) continue; pendingWhips[t] -= n;
    const { error } = await sb.rpc("add_whip", { t, n }); if (error) { pendingWhips[t] += n; return; }
  }
  while (pending.stews > 0) {
    const n = Math.min(50, pending.stews); pending.stews -= n;
    const { data, error } = await sb.rpc("add_count", { k: "stews", n });
    if (error) { pending.stews += n; return; }
    if (data != null) $("#gstews").textContent = Number(data).toLocaleString();
  }
}
setInterval(flush, 2500);
setInterval(loadCounters, 30000);
loadCounters();
$("#dungeon").addEventListener("pointerdown", e => {
  const p = e.target.closest(".poster[data-name]"); if (!p) return;
  const t = p.dataset.name; pendingWhips[t] = (pendingWhips[t] || 0) + 1; whipCounts[t] = (whipCounts[t] || 0) + 1; showWhips();
});

function route() { if (location.hash === "#guestbook") loadGuestbook(); }
addEventListener("hashchange", route);

// ======================================================== 4. traitor stew (the whip stays above it)
const kitchen = $("#kitchen"), pot = $("#potwrap");
let heat = 0, served = false;
const LABELS = [[0, "raw 🥩"], [20, "rare"], [45, "medium"], [70, "well done"], [90, "almost charred 🔥"], [100, "COOKED 💀"]];
function setHeat(h) {
  heat = Math.max(0, Math.min(100, h));
  $("#heatbar").style.width = heat + "%";
  $("#heatlabel").textContent = LABELS.filter(l => heat >= l[0]).pop()[1];
  $("#fire").style.setProperty("--heat", heat);
  if (heat >= 100 && !served) serve();
}
function placeShelf() {
  kitchen.querySelectorAll(".tr").forEach(t => t.remove());
  traitors.forEach((t, i) => {
    const d = document.createElement("div"); d.className = "tr";
    d.innerHTML = `<img src="${t.sprite}" alt=""><br><span class="nm">${esc(t.name)}</span>`;
    const narrow = kitchen.clientWidth < 500;  // phones: one column on the shelf; wider screens: 2 x 2
    d.style.left = (narrow ? 0 : (i % 2) * 72) + "px"; d.style.top = (narrow ? i * 80 : (i >> 1) * 125) + "px"; d.dataset.home = i;
    kitchen.appendChild(d); dragify(d);
  });
}
function inPot() { return kitchen.querySelectorAll(".tr.inpot").length; }
function dragify(el) {
  let ox = 0, oy = 0;
  el.addEventListener("pointerdown", e => {
    if (el.classList.contains("inpot")) return;
    e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (err) {} el.classList.add("dragging");
    const r = el.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
  });
  el.addEventListener("pointermove", e => {
    if (!el.classList.contains("dragging")) return;
    const k = kitchen.getBoundingClientRect();
    el.style.left = (e.clientX - k.left - ox) + "px"; el.style.top = (e.clientY - k.top - oy) + "px";
  });
  el.addEventListener("pointerup", e => {
    if (!el.classList.contains("dragging")) return;
    el.classList.remove("dragging");
    const p = pot.getBoundingClientRect(), r = el.getBoundingClientRect(), k = kitchen.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx > p.left && cx < p.right && cy > p.top - 80 && cy < p.bottom) {  // dropped on the pot: in it goes
      el.classList.add("inpot");
      const slot = inPot() - 1, step = p.width / 4.6;  // up to 4 side by side in the pot
      el.style.left = (p.left - k.left + p.width / 2 - 1.5 * step - el.offsetWidth / 2 + slot * step) + "px";
      el.style.top = (p.top - k.top + 76 - .78 * el.querySelector("img").offsetHeight) + "px";  // head and shoulders above the stew
      splash(); $("#stewHint").textContent = inPot() === traitors.length ? "All four in! Now stir: drag in circles over the pot, or tap 🥄 Stir."
        : "In it goes! Stir now, or throw in more traitors first.";
    }
  });
}
function blip(f = 300 + Math.random() * 500, len = .08, vol = .25) {
  try {
    const ac = getAC(); if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.8, t + len);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + len);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + len + .02);
  } catch (e) {}
}
function splash() { for (let i = 0; i < 6; i++) setTimeout(() => blip(200 + i * 60, .1, .3), i * 40); bubbles(5); }
function bubbles(n) {
  const p = pot.getBoundingClientRect(), k = kitchen.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const b = document.createElement("div"); b.className = "bubble";
    b.style.left = (p.left - k.left + 30 + Math.random() * (p.width - 60)) + "px"; b.style.top = (p.top - k.top + 40) + "px";
    kitchen.appendChild(b); setTimeout(() => b.remove(), 1000);
  }
}
function stir(amount) {
  if (served) return;
  if (!inPot()) { $("#stewHint").textContent = "Throw at least one traitor in the pot first!"; return; }
  setHeat(heat + amount); bubbles(2); blip();
}
let stirring = false, lastAng = null, acc = 0;
pot.addEventListener("pointerdown", e => { stirring = true; lastAng = null; try { pot.setPointerCapture(e.pointerId); } catch (err) {} });
pot.addEventListener("pointermove", e => {
  if (!stirring) return;
  const r = pot.getBoundingClientRect(), a = Math.atan2(e.clientY - (r.top + 60), e.clientX - (r.left + r.width / 2));
  $("#ladle").style.setProperty("--a", (a * 180 / Math.PI + 90) + "deg");
  if (lastAng != null) { let d = a - lastAng; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; acc += Math.abs(d); }
  lastAng = a;
  if (acc > 1.2) { acc = 0; stir(3); }
});
["pointerup", "pointercancel"].forEach(t => pot.addEventListener(t, () => { stirring = false; }));
$("#stirBtn").onclick = () => { $("#ladle").style.setProperty("--a", (Math.random() * 80 - 40) + "deg"); stir(4); };
function serve() {
  served = true;
  for (let i = 0; i < 10; i++) setTimeout(() => blip(500 + i * 90, .12, .3), i * 60);
  const s = document.createElement("div"); s.className = "served"; s.textContent = "🍲 Traitor stew is served! gg"; kitchen.appendChild(s);
  pending.stews++;
  let mine = +store.get("family_stews") || 0; store.set("family_stews", ++mine); $("#mystews").textContent = mine;
  setTimeout(resetStew, 4000);
}
function resetStew() {
  served = false; kitchen.querySelectorAll(".served").forEach(s => s.remove()); setHeat(0); placeShelf();
  $("#stewHint").textContent = "Drag any traitor into the pot, one or all four.";
}
$("#resetStew").onclick = resetStew;
$("#mystews").textContent = +store.get("family_stews") || 0;
placeShelf(); setHeat(0);

// ======================================================== 5. family tree: find me + shake
function findMe() {
  const q = $("#findme").value.trim().toLowerCase(); if (!q) return;
  const leaf = [...document.querySelectorAll("#tree .leaf")].find(l => (l.title || "").toLowerCase() === q)
    || [...document.querySelectorAll("#tree .leaf")].find(l => (l.title || "").toLowerCase().includes(q));
  if (!leaf) { $("#findme").value = ""; $("#findme").placeholder = "Not found, try another name"; return; }
  leaf.classList.add("in"); leaf.scrollIntoView({ behavior: "smooth", block: "center" });
  leaf.classList.remove("glow"); void leaf.offsetWidth; leaf.classList.add("glow");
  setTimeout(() => leaf.classList.remove("glow"), 4200);
}
$("#findBtn").onclick = findMe;
$("#findme").addEventListener("keydown", e => { if (e.key === "Enter") findMe(); });
let lastShake = 0;
function shakeTree() {
  if (Date.now() - lastShake < 1500) return; lastShake = Date.now();
  const t = $("#tree"); t.classList.remove("shake"); void t.offsetWidth; t.classList.add("shake");
  for (let i = 0; i < 40; i++) {
    const f = document.createElement("div"); f.className = "falling";
    f.style.left = Math.random() * 100 + "vw"; f.style.setProperty("--dx", (Math.random() * 200 - 100) + "px");
    f.style.animationDuration = (2.5 + Math.random() * 2.5) + "s"; f.style.animationDelay = Math.random() * .8 + "s";
    f.style.background = ["#78af5f", "#9ccc7c", "#5f9a4c", "#c8a040"][i % 4];
    document.body.appendChild(f); setTimeout(() => f.remove(), 6000);
  }
  if (navigator.vibrate) navigator.vibrate(120);
}
let motionOn = false;
function listenShake() {
  if (motionOn) return; motionOn = true;
  let lx = 0, ly = 0, lz = 0;
  addEventListener("devicemotion", e => {
    const a = e.accelerationIncludingGravity; if (!a || location.hash !== "#timeline") return;
    const d = Math.abs(a.x - lx) + Math.abs(a.y - ly) + Math.abs(a.z - lz); lx = a.x; ly = a.y; lz = a.z;
    if (d > 28) shakeTree();
  });
}
$("#shakeBtn").onclick = async () => {
  shakeTree();
  try {  // iPhones ask for permission once; after that you can shake the phone itself
    if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
      if (await DeviceMotionEvent.requestPermission() === "granted") listenShake();
    } else listenShake();
  } catch (e) {}
};

// ======================================================== 7. guestbook: monster avatars, Fame, megaphone
const MOBS = [["orange_mushroom", "Orange Mushroom"], ["green_mushroom", "Green Mushroom"], ["blue_mushroom", "Blue Mushroom"],
  ["horny_mushroom", "Horny Mushroom"], ["zombie_mushroom", "Zombie Mushroom"], ["spotty_mushroom", "Spotty Mushroom"],
  ["slime", "Slime"], ["king_slime", "King Slime"], ["pig", "Pig"], ["ribbon_pig", "Ribbon Pig"], ["fire_boar", "Fire Boar"],
  ["snail", "Snail"], ["blue_snail", "Blue Snail"], ["red_snail", "Red Snail"], ["stump", "Stump"], ["lupin", "Lupin"],
  ["jr_balrog", "Jr. Balrog"]];
const MOBNAME = Object.fromEntries(MOBS);
const mobImg = k => `media/mobs/${MOBNAME[k] ? k : "orange_mushroom"}.png`;
let myMob = MOBNAME[store.get("family_mob")] ? store.get("family_mob") : MOBS[Math.floor(Math.random() * MOBS.length)][0];
$("#mobPick").innerHTML = MOBS.map(([k, n]) => `<button type="button" class="mob" data-k="${k}" title="${n}"><img src="${mobImg(k)}" alt="${n}"></button>`).join("");
function pickMob(k) {
  myMob = k; store.set("family_mob", k); $("#mobName").textContent = MOBNAME[k];
  document.querySelectorAll("#mobPick .mob").forEach(b => b.classList.toggle("on", b.dataset.k === k));
}
$("#mobPick").onclick = e => { const b = e.target.closest(".mob"); if (b) { pickMob(b.dataset.k); blip(500 + Math.random() * 300, .08, .2); } };
pickMob(myMob);

let fameMine = {};
try { fameMine = JSON.parse(store.get("family_fame") || "{}"); } catch (e) {}
let gbLoaded = 0;
async function loadGuestbook(force) {
  if (!force && Date.now() - gbLoaded < 20000) return; gbLoaded = Date.now();
  if (!(await ready)) { $("#gbList").innerHTML = ""; $("#gbSoon").hidden = false; return; }
  $("#gbSoon").hidden = true;
  const { data, error } = await sb.from("guestbook_board").select("id,message,created_at,mob,megaphone,fame")
    .order("fame", { ascending: false }).order("created_at", { ascending: false }).limit(150);
  if (error) { $("#gbList").innerHTML = `<p class="msg err">Couldn't load the guestbook.</p>`; return; }
  $("#gbList").innerHTML = (data || []).filter(g => g.fame > -8).map((g, i) => {
    const mine = fameMine[g.id];
    return `<div class="note-card ${g.fame <= -3 ? "faded" : ""} ${g.megaphone ? "shout" : ""}" style="--r:${rot(i)}" data-id="${g.id}">
      <img src="${mobImg(g.mob)}" alt=""><b>a mysterious ${esc(MOBNAME[g.mob] || "monster")}${g.megaphone ? " 📣" : ""}</b><p>${esc(g.message)}</p>
      <div class="foot"><time>${new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
        <span class="fame"><button class="${mine === -1 ? "on" : ""}" data-d="-1" title="-Fame">⬇️</button><b>${g.fame > 0 ? "+" : ""}${g.fame}</b><button class="${mine === 1 ? "on" : ""}" data-d="1" title="+Fame">⬆️</button></span></div></div>`;
  }).join("") || '<p class="lead">No messages yet. Be the first monster!</p>';
}
$("#gbList").addEventListener("click", async e => {
  const b = e.target.closest(".fame button"); if (!b) return;
  const card = b.closest(".note-card"), id = +card.dataset.id, d = +b.dataset.d;
  if (fameMine[id]) { $("#gbOut").className = "msg err"; $("#gbOut").textContent = "You already famed that one."; return; }
  fameMine[id] = d; store.set("family_fame", JSON.stringify(fameMine));
  const v = card.querySelector(".fame b"); const n = parseInt(v.textContent) + d; v.textContent = (n > 0 ? "+" : "") + n; b.classList.add("on");
  blip(d > 0 ? 880 : 200, .12, .25);
  if (await ready) { await sb.from("guestbook_fame").insert({ note_id: id, device, delta: d }); }
});
$("#gbForm").onsubmit = async e => {
  e.preventDefault();
  const message = $("#gbMsg").value.trim().slice(0, 280), megaphone = $("#gbMega").checked, out = $("#gbOut");
  if (!message) { out.className = "msg err"; out.textContent = "Write a message first."; return; }
  if (BAD.test(message)) { out.className = "msg err"; out.textContent = "Keep it family friendly 🙂"; return; }
  const lastPost = +store.get("family_gb_last") || 0;
  if (Date.now() - lastPost < 60000) { out.className = "msg err"; out.textContent = "Slow down, one message a minute."; return; }
  if (!(await ready)) { out.className = "msg err"; out.textContent = "The guestbook isn't connected yet."; return; }
  const { error } = await sb.from("guestbook").insert({ name: MOBNAME[myMob], message, mob: myMob, megaphone });
  if (error) {
    out.className = "msg err";
    out.textContent = /cooling/.test(error.message) ? "📣 Someone just used the megaphone, try again in a few minutes (or untick it)." : "Couldn't post, try again later.";
    return;
  }
  store.set("family_gb_last", Date.now());
  $("#gbMsg").value = ""; $("#gbMega").checked = false; out.className = "msg ok"; out.textContent = megaphone ? "📣 Shouted to the whole site!" : "Posted!";
  loadGuestbook(true); if (megaphone) checkMegaphone();
};

// ---------- megaphone banner on every page: the latest shout from the last 5 minutes
let shownShout = store.get("family_smega_hidden");
async function checkMegaphone() {
  if (!(await ready)) return;
  const since = new Date(Date.now() - 5 * 60000).toISOString();
  const { data } = await sb.from("guestbook_board").select("id,message,mob").eq("megaphone", true).gt("created_at", since)
    .order("created_at", { ascending: false }).limit(1);
  const m = (data || [])[0];
  if (!m || String(m.id) === shownShout) { $("#smega").hidden = true; return; }
  $("#smegaText").innerHTML = `<img src="${mobImg(m.mob)}" alt=""> <b>${esc(MOBNAME[m.mob] || "a monster")}</b>: ${esc(m.message)}`;
  $("#smega").dataset.id = m.id; $("#smega").hidden = false;
}
$("#smegaX").onclick = () => { shownShout = $("#smega").dataset.id; store.set("family_smega_hidden", shownShout); $("#smega").hidden = true; };
checkMegaphone(); setInterval(checkMegaphone, 30000);

// ======================================================== founders: squeaky hammer bonks + Whack-a-Founder arcade
function squeak(pitch = 1) {
  try {
    const ac = getAC(); if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(900 * pitch, t); o.frequency.exponentialRampToValueAtTime(1700 * pitch, t + .06);
    o.frequency.exponentialRampToValueAtTime(700 * pitch, t + .16);
    g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(.35, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .2);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .22);
  } catch (e) {}
}
const OUCH = ["ow!", "why me 😭", "gm to you too", "BONK", "*squeak*", "rude!", "I founded this guild!", "x_x", "not the face!", "ok I deserved that"];
const bonkPending = {}, bonkCounts = {};
function showBonks() {
  let top = null, tv = 0;
  document.querySelectorAll("#founderGrid .card").forEach(c => {
    const n = bonkCounts[c.title] || 0;
    let b = c.querySelector(".bonks"); if (!b) { b = document.createElement("span"); b.className = "bonks"; c.appendChild(b); }
    b.textContent = n ? `🔨 ${n.toLocaleString()}` : ""; c.classList.remove("mostbonked");
    if (n > tv) { tv = n; top = c; }
  });
  if (top) top.classList.add("mostbonked");
}
async function loadBonks() {
  if (!(await ready)) return;
  const { data } = await sb.from("founder_bonks").select("founder,value");
  (data || []).forEach(r => { bonkCounts[r.founder] = Number(r.value) + (bonkPending[r.founder] || 0); });
  showBonks();
}
async function flushBonks() {
  if (!(await ready)) return;
  for (const f of Object.keys(bonkPending)) {
    const n = Math.min(30, bonkPending[f]); if (!n) continue; bonkPending[f] -= n;
    const { error } = await sb.rpc("add_bonk", { f, n }); if (error) { bonkPending[f] += n; return; }
  }
}
setInterval(flushBonks, 3000); setInterval(loadBonks, 30000); loadBonks();
function stars(x, y) {
  for (let i = 0; i < 5; i++) {
    const st = document.createElement("div"); st.className = "bonkstar"; st.textContent = ["⭐", "✨", "💫"][i % 3];
    st.style.left = x + "px"; st.style.top = y + "px"; st.style.setProperty("--a", (i * 72) + "deg");
    document.body.appendChild(st); setTimeout(() => st.remove(), 700);
  }
}
$("#founderGrid").addEventListener("click", e => {  // "click" = a real tap; scrolling over a card no longer bonks
  const c = e.target.closest(".card"); if (!c) return;
  squeak(.9 + Math.random() * .3); stars(e.clientX, e.clientY);
  c.classList.remove("bonked"); void c.offsetWidth; c.classList.add("bonked");
  const say = document.createElement("div"); say.className = "ouch"; say.textContent = OUCH[Math.floor(Math.random() * OUCH.length)];
  c.appendChild(say); setTimeout(() => say.remove(), 900);
  const name = c.title; bonkPending[name] = (bonkPending[name] || 0) + 1; bonkCounts[name] = (bonkCounts[name] || 0) + 1; showBonks();
});

// ---------- Whack-a-Founder
const arc = $("#arcade"), holes = $("#holes");
holes.innerHTML = Array.from({ length: 9 }, (_, i) => `<div class="hole" data-i="${i}"><div class="mole"></div><div class="dirt"></div></div>`).join("");
let game = null, best = +store.get("family_whack_best") || 0;
$("#arcBest").textContent = best;
const regular = D.founders.filter(f => !f.main && !f.traitor), rain = D.founders.find(f => f.main);
function openArcade() { arc.hidden = false; document.body.style.overflow = "hidden"; menu(); loadBoard(); }
function closeArcade() { stopGame(); arc.hidden = true; document.body.style.overflow = ""; }
$("#playWhack").onclick = openArcade; $("#arcX").onclick = closeArcade;
function menu(endHtml = "") { $("#arcMenu").hidden = false; $("#arcEnd").innerHTML = endHtml; }
async function loadBoard() {
  if (!(await ready)) { $("#arcBoard").innerHTML = "<li>connect the database to see high scores</li>"; return; }
  const { data } = await sb.from("arcade_scores").select("initials,score").order("score", { ascending: false }).order("created_at").limit(10);
  $("#arcBoard").innerHTML = (data || []).map(r => `<li><span>${esc(r.initials)}</span><b>${r.score}</b></li>`).join("") || "<li>no scores yet, be the first!</li>";
}
function stopGame() { if (!game) return; clearInterval(game.tick); clearTimeout(game.spawn); holes.querySelectorAll(".hole").forEach(h => h.classList.remove("up")); game = null; }
function popOne() {
  if (!game) return;
  const free = [...holes.querySelectorAll(".hole:not(.up)")]; if (!free.length) { game.spawn = setTimeout(popOne, 200); return; }
  const h = free[Math.floor(Math.random() * free.length)], r = Math.random();
  const who = r < .12 ? rain : r < .27 ? traitors[Math.floor(Math.random() * traitors.length)] : regular[Math.floor(Math.random() * regular.length)];
  const kind = who === rain ? "rain" : who.traitor ? "traitor" : "founder";
  const m = h.querySelector(".mole");
  m.innerHTML = `<img src="${who.sprite}" alt="">${kind === "traitor" ? '<span class="mk">💀</span>' : kind === "rain" ? '<span class="mk">👑</span>' : ""}`;
  h.dataset.kind = kind; h.classList.remove("hit"); h.classList.add("up");
  const left = Math.max(0, game.end - Date.now()), stay = 550 + left / 30000 * 550;  // faster near the end
  const id = Math.random(); h.dataset.id = id;
  setTimeout(() => { if (h.dataset.id == id) h.classList.remove("up"); }, stay);
  game.spawn = setTimeout(popOne, 250 + left / 30000 * 400);
}
holes.addEventListener("pointerdown", e => {
  const h = e.target.closest(".hole"); if (!game || !h || !h.classList.contains("up") || h.classList.contains("hit")) return;
  h.classList.add("hit"); h.dataset.id = "";
  const pts = { founder: 1, traitor: 5, rain: -10 }[h.dataset.kind];
  game.score = Math.max(0, game.score + pts); $("#arcScore").textContent = game.score;
  if (pts < 0) { blip(140, .35, .35); if (navigator.vibrate) navigator.vibrate(200); } else squeak(pts > 1 ? .7 : 1);
  const f = document.createElement("div"); f.className = "pts " + (pts < 0 ? "neg" : ""); f.textContent = (pts > 0 ? "+" : "") + pts;
  h.appendChild(f); setTimeout(() => f.remove(), 700);
  setTimeout(() => h.classList.remove("up"), 320);  // short black flash, then sink back down
});
$("#arcStart").onclick = () => {
  stopGame(); $("#arcMenu").hidden = true;
  game = { score: 0, end: Date.now() + 30000 }; $("#arcScore").textContent = 0; $("#arcTime").textContent = 30;
  game.tick = setInterval(() => {
    const left = Math.ceil((game.end - Date.now()) / 1000); $("#arcTime").textContent = Math.max(0, left);
    if (left <= 0) finish();
  }, 200);
  popOne();
};
function finish() {
  const score = game.score; stopGame();
  const newBest = score > best; if (newBest) { best = score; store.set("family_whack_best", best); $("#arcBest").textContent = best; }
  const last = store.get("family_initials") || "";
  menu(`<div class="final">SCORE <b>${score}</b>${newBest && score ? " · NEW BEST!" : ""}</div>` + (score > 0 ? `
    <form id="initForm" class="initials">ENTER YOUR INITIALS
      <input id="initIn" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(last)}" placeholder="AAA">
      <button class="btn" type="submit">SAVE</button></form>` : ""));
  $("#arcStart").textContent = "▶ PLAY AGAIN";
  const f = $("#initForm"); if (!f) return;
  const inp = $("#initIn"); inp.focus();
  inp.oninput = () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3); };
  f.onsubmit = async ev => {
    ev.preventDefault(); const initials = inp.value;
    if (!/^[A-Z0-9]{3}$/.test(initials)) { inp.classList.add("bad"); setTimeout(() => inp.classList.remove("bad"), 500); return; }
    if (/^(FUK|FUC|FCK|SEX|ASS|KKK|NIG|FAG|CUM|DIK|TIT|GAY|KYS)$/.test(initials)) { inp.value = ""; return; }
    store.set("family_initials", initials); f.innerHTML = "SAVING…";
    if (await ready) await sb.from("arcade_scores").insert({ initials, score: Math.min(score, 400) });
    f.innerHTML = `SAVED AS <b>${initials}</b> 🏆`; loadBoard();
  };
}

// ======================================================== 9. votes + 10. uploads on the Memories page
let voted = {};  // photo -> "love" | "hate" (this device's reaction)
try { voted = JSON.parse(store.get("family_reacts") || "{}"); } catch (e) {}
async function loadVotes() {
  document.querySelectorAll("#album .photo").forEach(f => {
    if (f.querySelector(".reacts")) return;
    const mine = voted[f.dataset.src];
    f.insertAdjacentHTML("beforeend", `<div class="reacts" data-src="${f.dataset.src}">
      <button class="vote hate ${mine === "hate" ? "on" : ""}" data-kind="hate" title="didn't like it"><i class="em">💀</i> <span>${mine === "hate" ? 1 : 0}</span></button>
      <button class="vote ${mine === "love" ? "on" : ""}" data-kind="love" title="love it">❤️ <span>${mine === "love" ? 1 : 0}</span></button></div>`);
  });
  if (!(await ready)) return;
  const { data } = await sb.from("memory_vote_counts").select("photo,love,hate");
  const counts = Object.fromEntries((data || []).map(r => [r.photo, r]));
  const best = { love: [null, 0], hate: [null, 0] };
  document.querySelectorAll("#album .reacts").forEach(r => {
    const c = counts[r.dataset.src] || { love: 0, hate: 0 };
    for (const k of ["love", "hate"]) {
      r.querySelector(`[data-kind="${k}"] span`).textContent = c[k];
      if (c[k] > best[k][1]) best[k] = [r, c[k]];
    }
  });
  // order by score (❤️ minus 💀), the Founders' Big Gathering stays pinned first; ties keep the original order
  const album = $("#album"), figs = [...album.querySelectorAll(".photo")];
  figs.forEach((f, i) => { if (f.dataset.i == null) f.dataset.i = i; });
  const score = f => { const c = counts[f.dataset.src] || { love: 0, hate: 0 }; return c.love - c.hate; };
  figs.filter(f => !f.classList.contains("first"))
    .sort((a, b) => score(b) - score(a) || a.dataset.i - b.dataset.i)
    .forEach(f => album.appendChild(f));
  document.querySelectorAll("#album .loved").forEach(x => x.remove());
  if (best.love[0]) best.love[0].closest(".photo").insertAdjacentHTML("beforeend", '<span class="loved">❤️ most loved</span>');
  if (best.hate[0]) best.hate[0].closest(".photo").insertAdjacentHTML("beforeend", '<span class="loved hated">💀 most hated</span>');
}
$("#album").addEventListener("click", async e => {
  const b = e.target.closest(".vote"); if (!b) return;
  e.stopPropagation();  // don't open the photo
  const r = b.closest(".reacts"), src = r.dataset.src, kind = b.dataset.kind;
  if (voted[src]) return;  // one reaction per photo per device
  voted[src] = kind; store.set("family_reacts", JSON.stringify(voted));
  b.classList.add("on"); const s = b.querySelector("span"); s.textContent = +s.textContent + 1;
  if (kind === "hate") { b.classList.add("boo"); blip(160, .25, .3); } else blip(700, .1, .2);
  if (await ready) { await sb.from("memory_votes").insert({ photo: src, device, kind }); loadVotes(); }
}, true);
async function loadUploads() {
  if (!(await ready)) return;
  const { data } = await sb.from("memory_uploads").select("path,title,uploader").order("created_at");
  const album = $("#album");
  (data || []).forEach((u, i) => {
    const src = sb.storage.from("memories").getPublicUrl(u.path).data.publicUrl;
    if (album.querySelector(`[data-src="${CSS.escape(src)}"]`)) return;
    album.insertAdjacentHTML("beforeend", `<figure class="photo" style="--r:${rot(i + 3)};margin:0" data-src="${src}"><img src="${src}" alt="" loading="lazy">
      <div class="t">${esc(titleCase(u.title))}</div></figure>`);
  });
  loadVotes();
}
async function compress(file) {  // shrink to max 1600px and re-encode as WebP (falls back to JPEG), typically ~10x smaller
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let blob = await new Promise(r => c.toBlob(r, "image/webp", .82));
  if (!blob || blob.type !== "image/webp") blob = await new Promise(r => c.toBlob(r, "image/jpeg", .85));
  return blob;
}
if (CFG.uploads === false) { $("#uploadBox").hidden = true; $("#addMemBtn").hidden = true; }
$("#addMemBtn").onclick = () => {  // jump to the form at the bottom and highlight it
  const box = $("#uploadBox"); box.scrollIntoView({ behavior: "smooth", block: "center" });
  box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash");
  setTimeout(() => $("#upTitle").focus({ preventScroll: true }), 600);
};
$("#upForm").onsubmit = async e => {
  e.preventDefault();
  const out = $("#upOut"), file = $("#upFile").files[0], title = $("#upTitle").value.trim().slice(0, 80), who = $("#upWho").value.trim().slice(0, 40);
  if (!file || !title) { out.className = "msg err"; out.textContent = "Pick a screenshot and give it a title."; return; }
  if (!/^image\//.test(file.type)) { out.className = "msg err"; out.textContent = "Only images, please."; return; }
  if (BAD.test(title + " " + who)) { out.className = "msg err"; out.textContent = "Keep it family friendly 🙂"; return; }
  if (!(await ready)) { out.className = "msg err"; out.textContent = "Uploads aren't connected yet."; return; }
  out.className = "msg"; out.textContent = "Shrinking and uploading…";
  try {
    const blob = await compress(file);
    const path = `${device.slice(0, 8)}-${Date.now()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
    const up = await sb.storage.from("memories").upload(path, blob, { contentType: blob.type });
    if (up.error) throw up.error;
    const ins = await sb.from("memory_uploads").insert({ path, title, uploader: who || null });
    if (ins.error) throw ins.error;
    out.className = "msg ok";
    out.textContent = `Sent (${Math.round(blob.size / 1024)} KB)! It will appear here once an admin approves it.`;
    $("#upForm").reset();
  } catch (err) { out.className = "msg err"; out.textContent = "Upload failed, try a smaller image or later."; }
};
loadVotes(); loadUploads();
route();
})();
