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
const BAD = /(p+\W*e+\W*n+\W*[i1!]+\W*[s5$]+|peen|\b(fuck|shit|bitch|cunt|nigg|fag|retard|whore|slut|dick|d1ck|cock|pussy|kys|porn|sex))/i;  // simple filter; the DB is the real gate
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
// suggestions while typing: a few letters show matching faces, tap one to jump to that leaf
let findIdx = -1;
function findSuggest() {
  const q = $("#findme").value.trim().toLowerCase(), box = $("#findSugg");
  if (!q) { box.hidden = true; return; }
  const seen = new Set(), hits = [];
  document.querySelectorAll("#tree .leaf").forEach(l => {
    const n = l.title || "", k = n.toLowerCase();
    if (k.includes(q) && !seen.has(k)) { seen.add(k); hits.push({ n, img: (l.querySelector("img") || {}).src }); }
  });
  hits.sort((a, b) => (b.n.toLowerCase().startsWith(q) - a.n.toLowerCase().startsWith(q)) || a.n.length - b.n.length);
  if (!hits.length) { box.innerHTML = `<i>No one by that name yet</i>`; box.hidden = false; return; }
  findIdx = -1;
  box.innerHTML = hits.slice(0, 8).map(h => `<button type="button" data-n="${esc(h.n)}">${h.img ? `<img src="${h.img}" alt="">` : "<span>👤</span>"}${esc(h.n)}</button>`).join("");
  box.hidden = false;
}
const pickFind = n => { $("#findme").value = n; $("#findSugg").hidden = true; $("#findme").blur(); findMe(); };
$("#findSugg").addEventListener("pointerdown", e => {  // pointerdown so it fires before the input loses focus
  const b = e.target.closest("button"); if (!b) return; e.preventDefault(); pickFind(b.dataset.n);
});
$("#findme").addEventListener("input", findSuggest);
$("#findme").addEventListener("focus", findSuggest);
$("#findme").addEventListener("blur", () => setTimeout(() => $("#findSugg").hidden = true, 150));
$("#findme").addEventListener("keydown", e => {
  const items = [...$("#findSugg").querySelectorAll("button")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!items.length) return; e.preventDefault();
    findIdx = (findIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("on", i === findIdx)); }
  if (e.key === "Enter") { e.preventDefault(); items.length && (findIdx >= 0 || items.length === 1) ? pickFind(items[Math.max(findIdx, 0)].dataset.n) : ($("#findSugg").hidden = true, findMe()); }
});
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
  if ((+store.get("family_gb_next") || 0) > Date.now()) { out.className = "msg err"; out.textContent = "You can post once every 8 hours."; return; }
  if (!(await ready)) { out.className = "msg err"; out.textContent = "The guestbook isn't connected yet."; return; }
  out.className = "msg"; out.textContent = "";
  openQuiz({ title: "guestbook", post: { message, mob: myMob, megaphone } });  // Professor CrtlAltDel's quiz first
};

// one post per 8 hours: the Post button turns into a countdown (the database enforces the same rule)
function gbTimer() {
  const btn = $("#gbForm button[type=submit]"), left = (+store.get("family_gb_next") || 0) - Date.now();
  if (left > 0) {
    const h = Math.floor(left / 3600000), m = Math.floor(left / 60000) % 60, sec = Math.floor(left / 1000) % 60;
    btn.disabled = true; btn.textContent = `⏳ Next post in ${h ? h + "h " : ""}${m}m ${h ? "" : sec + "s"}`;
  } else { btn.disabled = false; btn.textContent = "✍️ Post"; }
}
gbTimer(); setInterval(gbTimer, 1000);

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
const bonkCounts = {};
function showBonks() {
  let top = null, tv = 0;
  document.querySelectorAll("#founderGrid .card, #coreGrid .card").forEach(c => {
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
  (data || []).forEach(r => { bonkCounts[r.founder] = Number(r.value); });
  showBonks();
}
setInterval(loadBonks, 30000); loadBonks();
function stars(x, y) {
  for (let i = 0; i < 5; i++) {
    const st = document.createElement("div"); st.className = "bonkstar"; st.textContent = ["⭐", "✨", "💫"][i % 3];
    st.style.left = x + "px"; st.style.top = y + "px"; st.style.setProperty("--a", (i * 72) + "deg");
    document.body.appendChild(st); setTimeout(() => st.remove(), 700);
  }
}
// ---------- anti-autoclicker: too fast (>12/s), robot-steady rhythm, or fake (script) clicks don't count
const clickTimes = []; let botStrikes = 0, botUntil = 0;
const BOT_SAYS = ["Autoclick? 🤨", "Are You Sure? 🤖", "Ok Slow Down!!! 🛑"];
function looksLikeBot(e) {
  const now = performance.now();
  if (!e.isTrusted) return true;
  if (now < botUntil) return true;                              // cooling down after being caught
  clickTimes.push(now); while (clickTimes.length > 12) clickTimes.shift();
  const recent = clickTimes.filter(t => now - t < 1000).length;
  let steady = false;
  if (clickTimes.length >= 10) {                                // humans are never perfectly even
    const gaps = clickTimes.slice(1).map((t, i) => t - clickTimes[i]);
    const avg = gaps.reduce((a, b) => a + b) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - avg) ** 2, 0) / gaps.length);
    steady = avg < 250 && sd < 6;
  }
  return recent > 12 || steady;
}
function caughtBot(c) {
  const msg = BOT_SAYS[Math.min(botStrikes, BOT_SAYS.length - 1)];
  botStrikes++; botUntil = performance.now() + 1500 * Math.min(botStrikes, 4); clickTimes.length = 0;
  if (!c.querySelector(".ouch.bot")) {
    const say = document.createElement("div"); say.className = "ouch bot"; say.textContent = msg;
    c.appendChild(say); setTimeout(() => say.remove(), 1400);
  }
  setTimeout(() => { if (performance.now() > botUntil) botStrikes = Math.max(0, botStrikes - 1); }, 20000);
}
// ---------- Professor CrtlAltDel's math quiz: every bonk needs a correct answer (checked by the database)
// his picture is looked up by name: sprite file numbers change whenever the member list is rebuilt
{ const cad = [...D.members, ...D.founders].find(p => p.name === "CrtlAltDel"); if (cad && cad.sprite) $("#profPic").src = cad.sprite; }
const PROF_OK = ["Correct! Bonk approved ✅", "Smart AND violent 🔨", "A+ bonk", "The Professor is proud 🎓"];
const PROF_NO = ["Wrong! Go back to class 📚", "Professor CrtlAltDel is disappointed 😤", "Nope. Did you use a calculator? 🧮"];
let quizCard = null, quizId = null, quizBusy = false;
async function openQuiz(card) {
  quizCard = card; quizId = null;
  $("#quizSub").innerHTML = card.post ? "Solve this to post your message ✍️" : `Solve this to bonk <b>${esc(card.title)}</b>`;
  $("#quizQ").textContent = "…"; $("#quizMsg").textContent = ""; $("#quizMsg").className = "qmsg";
  $("#quizIn").value = ""; $("#quiz").hidden = false;
  if (!(await ready)) { $("#quizQ").textContent = "offline"; return; }
  const { data, error } = await sb.rpc("get_quiz");
  if (error || !data) { $("#quizQ").textContent = "try again later"; return; }
  quizId = data.id; $("#quizQ").textContent = data.question + " = ?";
  setTimeout(() => $("#quizIn").focus(), 50);
}
function closeQuiz() { $("#quiz").hidden = true; quizCard = null; }
function bonkAnim(c) {
  const r = c.getBoundingClientRect();
  squeak(.9 + Math.random() * .3); stars(r.left + r.width / 2, r.top + r.height / 2);
  c.classList.remove("bonked"); void c.offsetWidth; c.classList.add("bonked");
  const say = document.createElement("div"); say.className = "ouch"; say.textContent = OUCH[Math.floor(Math.random() * OUCH.length)];
  c.appendChild(say); setTimeout(() => say.remove(), 900);
}
$("#quizForm").onsubmit = async ev => {
  ev.preventDefault();
  if (!quizId || quizBusy || !quizCard) return;
  const ans = parseInt($("#quizIn").value, 10); if (isNaN(ans)) return;
  quizBusy = true;
  const msg = $("#quizMsg");
  if (quizCard.post) {  // guestbook: the database checks the answer AND posts the note in one go
    const p = quizCard.post, out = $("#gbOut");
    const { data: res } = await sb.rpc("post_guestbook", { qid: quizId, ans, message: p.message, mob: p.mob, megaphone: p.megaphone, device });
    quizBusy = false;
    const r = res && res.r;
    if (res && res.until) { store.set("family_gb_next", Date.parse(res.until)); gbTimer(); }
    if (r === "wrong" || !r) {
      msg.className = "qmsg no"; msg.textContent = PROF_NO[Math.floor(Math.random() * PROF_NO.length)];
      blip(140, .3, .3); $("#quizBox").classList.remove("shakeq"); void $("#quizBox").offsetWidth; $("#quizBox").classList.add("shakeq");
      const again = quizCard; setTimeout(() => { if (quizCard === again) openQuiz(again); }, 1100); return;
    }
    closeQuiz();
    const said = { ok: p.megaphone ? "📣 Shouted to the whole site!" : "Posted! Professor CrtlAltDel approves 🎓",
      bad: "Keep it family friendly 🙂", busy: "The guestbook is busy, try again in a minute.",
      cooling: "📣 Someone just used the megaphone, try again in a few minutes (or untick it).", length: "Message is too long.",
      wait: "You can post once every 8 hours. See the timer on the button." };
    out.className = r === "ok" ? "msg ok" : "msg err"; out.textContent = said[r] || "Couldn't post, try again later.";
    if (r === "ok") { store.set("family_gb_last", Date.now()); $("#gbMsg").value = ""; $("#gbMega").checked = false;
      loadGuestbook(true); if (p.megaphone) checkMegaphone(); }
    return;
  }
  const { data: res } = await sb.rpc("quiz_pass", { qid: quizId, ans, f: quizCard.title });
  quizBusy = false;
  const data = res && res.r === "ok" ? res.value : null;
  if (data != null) { bonkPass = { id: res.pass, left: res.left }; showPass(); }
  if (data != null && data >= 0) {
    msg.className = "qmsg ok"; msg.textContent = PROF_OK[Math.floor(Math.random() * PROF_OK.length)] + " +9 free bonks!";
    const c = quizCard; bonkCounts[c.title] = Number(data); showBonks();
    setTimeout(() => { closeQuiz(); bonkAnim(c); }, 650);
  } else {
    msg.className = "qmsg no"; msg.textContent = PROF_NO[Math.floor(Math.random() * PROF_NO.length)];
    blip(140, .3, .3); $("#quizBox").classList.remove("shakeq"); void $("#quizBox").offsetWidth; $("#quizBox").classList.add("shakeq");
    setTimeout(() => { if (quizCard) openQuiz(quizCard); }, 1100);  // a fresh question
  }
};
$("#quizX").onclick = closeQuiz;
$("#quiz").addEventListener("click", e => { if (e.target.id === "quiz") closeQuiz(); });
// one solved quiz = 10 bonks: the first right away, then 9 free taps (the database counts them)
let bonkPass = null;
function showPass() {
  let b = $("#bonkPass");
  if (!b) { b = document.createElement("div"); b.id = "bonkPass"; b.className = "bonkpass"; document.body.appendChild(b); }
  const n = bonkPass ? bonkPass.left : 0;
  b.innerHTML = n > 0 ? `🔨 <b>${n}</b> free bonk${n === 1 ? "" : "s"} left` : "";
  b.hidden = !n || !["#founders"].includes(location.hash);
}
addEventListener("hashchange", showPass);
async function freeBonk(c) {
  const pass = bonkPass; pass.left--; showPass(); bonkAnim(c);
  const { data } = await sb.rpc("bonk_pass_use", { pass: pass.id, f: c.title });
  if (data && data.r === "ok") { bonkCounts[c.title] = Number(data.value); pass.left = data.left; showBonks(); showPass(); }
  else { bonkPass = null; showPass(); }
}
function onBonk(e) {  // "click" = a real tap; scrolling over a card no longer bonks
  const c = e.target.closest(".card"); if (!c || !$("#quiz").hidden) return;
  if (looksLikeBot(e)) { caughtBot(c); return; }
  if (bonkPass && bonkPass.left > 0) { freeBonk(c); return; }
  openQuiz(c);
}
$("#founderGrid").addEventListener("click", onBonk);
$("#coreGrid").addEventListener("click", onBonk);

// ---------- Whack-a-Founder
const arc = $("#arcade"), holes = $("#holes");
holes.innerHTML = Array.from({ length: 9 }, (_, i) =>
  `<div class="hole" data-i="${i}"><div class="back"></div><div class="pit"><div class="mole"></div></div><div class="front"></div></div>`).join("");
const HAMMER = `<svg viewBox="0 0 56 56" width="64" height="64"><rect x="24" y="20" width="7" height="34" rx="3" fill="#f6d36b" stroke="#5a3a1e" stroke-width="2"/>
  <rect x="6" y="4" width="40" height="22" rx="9" fill="#ff7eb6" stroke="#5a3a1e" stroke-width="2.5"/><rect x="10" y="8" width="10" height="5" rx="2" fill="#fff" opacity=".6"/></svg>`;
function fx(cls, html, x, y, ms) {  // a short-lived effect at a point inside the field
  const f = $("#field"), r = f.getBoundingClientRect(), d = document.createElement("div");
  d.className = cls; d.innerHTML = html; d.style.left = (x - r.left) + "px"; d.style.top = (y - r.top) + "px";
  f.appendChild(d); setTimeout(() => d.remove(), ms);
}
let game = null, best = +store.get("family_whack_best") || 0;
$("#arcBest").textContent = best;
const regular = D.founders.filter(f => !f.main && !f.traitor && !f.member && f.sprite), rain = D.founders.find(f => f.main);
function openArcade() { arc.hidden = false; document.body.style.overflow = "hidden"; menu(); loadBoard(); }
function closeArcade() { stopGame(); arc.hidden = true; document.body.style.overflow = ""; }
$("#playWhack").onclick = openArcade; $("#arcX").onclick = closeArcade;
function menu(endHtml = "") { $("#arcMenu").hidden = false; $("#arcEnd").innerHTML = endHtml; }
async function loadBoard() {
  if (!(await ready)) { $("#arcBoard").innerHTML = "<li>connect the database to see high scores</li>"; return; }
  const { data } = await sb.from("arcade_scores").select("initials,score").order("score", { ascending: false }).order("created_at").limit(10);
  $("#arcBoard").innerHTML = (data || []).map(r => `<li><span>${esc(r.initials)}</span><b>${r.score}</b></li>`).join("") || "<li>no scores yet, be the first!</li>";
}
function stopGame() { if (!game) return; clearInterval(game.tick); clearTimeout(game.spawn); holes.querySelectorAll(".hole").forEach(h => h.classList.remove("up")); game = null;
  $("#arcCount").textContent = ""; $("#arcCombo").textContent = ""; }
function popOne() {
  if (!game) return;
  const free = [...holes.querySelectorAll(".hole:not(.up)")]; if (!free.length) { game.spawn = setTimeout(popOne, 200); return; }
  const h = free[Math.floor(Math.random() * free.length)], r = Math.random();
  const who = r < .12 ? rain : r < .27 ? traitors[Math.floor(Math.random() * traitors.length)] : regular[Math.floor(Math.random() * regular.length)];
  const kind = who === rain ? "rain" : who.traitor ? "traitor" : "founder";
  const m = h.querySelector(".mole");
  m.innerHTML = `<img src="${who.sprite}" alt="">${kind === "traitor" ? '<span class="mk">💀</span>' : kind === "rain" ? '<span class="mk">👑</span>' : ""}<span class="dizzy">💫</span>`;
  h.dataset.kind = kind; h.classList.remove("hit"); h.classList.add("up");
  const left = Math.max(0, game.end - Date.now()), stay = 550 + left / 30000 * 550;  // faster near the end
  const id = Math.random(); h.dataset.id = id;
  setTimeout(() => { if (h.dataset.id == id) h.classList.remove("up"); }, stay);
  game.spawn = setTimeout(popOne, 250 + left / 30000 * 400);
}
holes.addEventListener("pointerdown", e => {
  if (!game || !game.live) return;
  fx("hammer", HAMMER, e.clientX, e.clientY, 260);   // the hammer swings wherever you tap
  const h = e.target.closest(".hole");
  if (!h || !h.classList.contains("up") || h.classList.contains("hit")) {   // whiff
    game.combo = 0; showCombo(); fx("miss", "miss", e.clientX, e.clientY, 600); return;
  }
  h.classList.add("hit"); h.dataset.id = "";
  const pts = { founder: 1, traitor: 5, rain: -10 }[h.dataset.kind];
  game.score = Math.max(0, game.score + pts); $("#arcScore").textContent = game.score;
  game.combo = pts < 0 ? 0 : game.combo + 1; showCombo();
  if (pts < 0) {
    blip(140, .35, .35); if (navigator.vibrate) navigator.vibrate(200);
    $("#field").classList.remove("quake"); void $("#field").offsetWidth; $("#field").classList.add("quake");
  } else squeak(pts > 1 ? .7 : 1);
  const r = h.getBoundingClientRect(), cx = r.left + r.width / 2;
  fx("bonk", pts < 0 ? "OUCH!" : "BONK!", cx, r.top + r.height * .35, 450);
  fx("dmg " + (pts < 0 ? "neg" : pts > 1 ? "crit" : ""), (pts > 1 ? "<small>CRITICAL</small>" : "") + (pts > 0 ? "+" : "") + pts, cx, r.top + r.height * .1, 900);
  setTimeout(() => h.classList.remove("up"), 380);  // short black flash with dizzy stars, then sink back down
});
function showCombo() {
  const c = $("#arcCombo");
  if (game.combo >= 3) { c.textContent = `COMBO ×${game.combo}`; c.classList.remove("go"); void c.offsetWidth; c.classList.add("go"); }
  else c.textContent = "";
}
$("#arcStart").onclick = () => {
  stopGame(); $("#arcMenu").hidden = true;
  game = { score: 0, combo: 0, live: false }; $("#arcScore").textContent = 0; $("#arcTime").textContent = 30; setBar(1); $("#arcCombo").textContent = "";
  const g = game, cd = $("#arcCount"), steps = ["3", "2", "1", "GO!"];
  steps.forEach((t, i) => setTimeout(() => {   // 3-2-1-GO! countdown before the moles come up
    if (game !== g) return;
    cd.textContent = t; cd.classList.remove("go"); void cd.offsetWidth; cd.classList.add("go"); blip(t === "GO!" ? 880 : 520, .12, .2);
    if (t !== "GO!") return;
    setTimeout(() => { if (game === g) cd.textContent = ""; }, 500);
    g.live = true; g.end = Date.now() + 30000;
    g.tick = setInterval(() => {
      const ms = g.end - Date.now(), left = Math.ceil(ms / 1000); $("#arcTime").textContent = Math.max(0, left); setBar(ms / 30000);
      if (left <= 0) finish();
    }, 100);
    popOne();
  }, i * 650));
};
function setBar(f) { const b = $("#arcBar"); b.style.width = Math.max(0, f) * 100 + "%"; b.classList.toggle("low", f < 1 / 6); }
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
  lastCounts = counts; sortAlbum();
  document.querySelectorAll("#album .loved").forEach(x => x.remove());
  if (best.love[0]) best.love[0].closest(".photo").insertAdjacentHTML("beforeend", '<span class="loved">❤️ most loved</span>');
  if (best.hate[0]) best.hate[0].closest(".photo").insertAdjacentHTML("beforeend", '<span class="loved hated">💀 most hated</span>');
}
// album order: 🆕 Newest (default) or ❤️ Most loved (score = ❤️ minus 💀, the Founders' gathering pinned first)
let lastCounts = {}, memSort = store.get("family_mem_sort") || "new";
const WEEK = 7 * 24 * 3600 * 1000;
function sortAlbum() {
  const album = $("#album"), figs = [...album.querySelectorAll(".photo")];
  figs.forEach((f, i) => { if (f.dataset.i == null) f.dataset.i = 1000 + i; });
  const gathering = figs.find(f => f.dataset.i == 0);
  const score = f => { const c = lastCounts[f.dataset.src] || { love: 0, hate: 0 }; return c.love - c.hate; };
  const hates = f => (lastCounts[f.dataset.src] || { hate: 0 }).hate;
  const order = memSort === "loved"
    ? [gathering, ...figs.filter(f => f !== gathering).sort((a, b) => score(b) - score(a) || a.dataset.i - b.dataset.i)]
    : memSort === "hated"   // most 💀 first; ties: lowest score first
    ? figs.slice().sort((a, b) => hates(b) - hates(a) || score(a) - score(b) || a.dataset.i - b.dataset.i)
    : figs.slice().sort((a, b) => (+b.dataset.added || 0) - (+a.dataset.added || 0) || b.dataset.i - a.dataset.i);
  order.filter(Boolean).forEach(f => album.appendChild(f));
  if (gathering) gathering.classList.toggle("first", memSort === "loved");  // big banner only where it's pinned
  // NEW ribbon on anything added in the last 7 days, except the launch-day batch (the site went live with those)
  const launch = Math.min(...D.memories.map(m => Date.parse(m.added) || Infinity));
  figs.forEach(f => {
    const DAY = 24 * 3600 * 1000, t = +f.dataset.added || 0, fresh = Date.now() - t < WEEK && t >= (Math.floor(launch / DAY) + 1) * DAY;
    const tag = f.querySelector(".newtag");
    if (fresh && !tag) f.insertAdjacentHTML("afterbegin", '<span class="newtag">NEW</span>'); else if (!fresh && tag) tag.remove();
  });
  document.querySelectorAll("#memSort .chip").forEach(b => b.classList.toggle("on", b.dataset.s === memSort));
}
$("#memSort").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return;
  memSort = b.dataset.s; store.set("family_mem_sort", memSort); sortAlbum();
});
sortAlbum();
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
  const { data } = await sb.from("memory_uploads").select("path,title,uploader,created_at").order("created_at");
  const album = $("#album");
  (data || []).forEach((u, i) => {
    const src = sb.storage.from("memories").getPublicUrl(u.path).data.publicUrl;
    if (album.querySelector(`[data-src="${CSS.escape(src)}"]`)) return;
    album.insertAdjacentHTML("beforeend", `<figure class="photo" style="--r:${rot(i + 3)};margin:0" data-src="${src}" data-added="${Date.parse(u.created_at) || 0}"><img src="${src}" alt="" loading="lazy">
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
    // 2 uploads per person per day: the database hands out a ticket (the file name) only while you have one left
    const { data: tk, error: te } = await sb.rpc("upload_ticket", { device, ext: blob.type === "image/webp" ? "webp" : "jpg" });
    if (te) throw te;
    if (tk.r === "wait") {
      const t = new Date(tk.until), hrs = Math.max(1, Math.ceil((t - Date.now()) / 3600000));
      out.className = "msg err"; out.textContent = `You've used your 2 uploads for today. Try again in about ${hrs} hour${hrs > 1 ? "s" : ""}.`; return;
    }
    const up = await sb.storage.from("memories").upload(tk.path, blob, { contentType: blob.type });
    if (up.error) throw up.error;
    const { data: res, error: ie } = await sb.rpc("submit_upload", { p: tk.path, title, uploader: who || null });
    if (ie) throw ie;
    if (res.r === "bad") { out.className = "msg err"; out.textContent = "Keep it family friendly 🙂"; return; }
    if (res.r !== "ok") throw new Error(res.r);
    out.className = "msg ok";
    out.textContent = `Sent (${Math.round(blob.size / 1024)} KB)! It will appear here once an admin approves it. ` +
      (tk.left > 0 ? "You can upload 1 more today." : "That was your last upload for today.");
    $("#upForm").reset();
  } catch (err) { out.className = "msg err"; out.textContent = "Upload failed, try a smaller image or later."; }
};
loadVotes(); loadUploads();
route();
})();
