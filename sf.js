// Star Force simulator: MapleStory Idle's real enhancement rates, costs and stat bonuses (from mapleidle.gg's database).
// Every try is rolled by the guild server (sf_roll), so the leaderboard is fair; this page only animates what the server rolled.
// Scrolls are unlimited: we count how many each item has eaten.
(() => {
const $s = q => document.querySelector(q);
const B = window.BD; if (!B || !$s("#sf")) return;
const { esc, store, spriteOf, guildOf } = B;

// from star n to n+1: success, maintain, decrease, destroy (%), Star Force scrolls, mesos
const R = [[100, 0, 0, 0, 1, 20000], [100, 0, 0, 0, 1, 30000], [90, 10, 0, 0, 2, 40000], [85, 15, 0, 0, 3, 50000], [80, 20, 0, 0, 4, 60000], [70, 30, 0, 0, 5, 70000],
  [65, 35, 0, 0, 6, 90000], [60, 40, 0, 0, 7, 110000], [55, 45, 0, 0, 8, 130000], [50, 50, 0, 0, 9, 150000], [35, 65, 0, 0, 10, 170000], [34, 66, 0, 0, 11, 190000],
  [33, 67, 0, 0, 12, 210000], [32.5, 67.5, 0, 0, 18, 325000], [31.5, 68.5, 0, 0, 21, 370000], [31, 69, 0, 0, 18, 320000], [29, 71, 0, 0, 28, 520000],
  [26, 74, 0, 0, 37, 700000], [23, 77, 0, 0, 38, 770000], [21, 79, 0, 0, 42, 850000], [12.8, 76.2, 0, 11, 21, 420000], [11.5, 70.5, 8, 10, 38, 750000],
  [11.3, 77.7, 4, 7, 40, 790000], [9, 82, 4, 5, 44, 820000], [7.5, 81, 4, 7.5, 50, 950000], [7, 81.5, 4, 7.5, 54, 1000000], [4.5, 85, 3, 7.5, 68, 1300000],
  [4, 86.5, 3, 6.5, 71, 1400000], [2, 92, 4, 2, 75, 1750000], [2, 92, 4, 2, 80, 1800000]];
// bonus at each star (index = stars): main stat %, sub stat %, final damage %
const MAIN = [0, 10, 20, 30, 40, 60, 75, 90, 105, 120, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 900, 1050, 1200, 1350, 1500, 1750, 2000, 2250, 2500];
const SUB = [0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 25, 25, 25, 25, 25, 50, 60, 70, 80, 90, 100, 110, 130, 145, 160, 180, 200, 225, 250, 275, 300];
const FD = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, .2, .4, .7, 1, 1.4, 2, 2.8, 4, 6, 10, 15];
const MAX = 30;
// average "Star Force cost" to first reach each star with the real rules (1 = one scroll; 25,000 mesos = 1; 50 red diamonds = 1),
// from 4,000 simulated climbs to 30★. The score compares what you spent with this.
const AVG = {1: 2, 2: 4, 3: 8, 4: 14, 5: 22, 6: 33, 7: 48, 8: 67, 9: 91, 10: 122, 11: 170, 12: 225, 13: 286, 14: 378, 15: 490, 16: 586, 17: 749, 18: 990, 19: 1278, 20: 1623, 21: 2976, 22: 6428, 23: 11564, 24: 20339, 25: 42762, 26: 93176, 27: 263320, 28: 731716, 29: 2347536, 30: 7251198};
const spentOf = s => (s.scrolls || 0) + (s.mesos || 0) / 25000 + (s.red || 0) / 50;
const setTotals = cur => {   // the whole set, with the item on screen as it is right now
  const all = { ...(SET ? SET.items : {}) }; if (cur && (cur.attempts || all[item])) all[item] = cur;
  const v = Object.values(all).filter(x => x.attempts);
  const avg = v.reduce((a, x) => a + avgOf(x), 0), spent = v.reduce((a, x) => a + spentOf(x), 0);
  return { score: v.reduce((a, x) => a + scoreOf(x).score, 0), items: v.length, best: Math.max(0, ...v.map(x => x.best)), avg, spent, luck: avg / Math.max(1, spent), tries: v.reduce((a, x) => a + x.attempts, 0) };
};
// average cost from the mode's starting star (0★ or 20★) to the item's best star
const avgOf = s => s.best > mode ? AVG[s.best] - (AVG[mode] || 0) : 0;
const scoreOf = s => { const e = avgOf(s); if (!e) return { score: 0, luck: 0 }; const luck = Math.min(9, Math.max(.1, e / Math.max(1, spentOf(s)))); return { score: Math.round(e * Math.sqrt(luck)), luck }; };
// mitigation (official Sept 3 patch notes): destroy halved; decrease 0% (28★+ halved); the removed chance becomes "no change";
// each mitigation in use costs one more full set of materials, only on stars that have that risk
const mit = st => { const r = R[st], dec = $s("#sfDec").checked && r[2] > 0, des = $s("#sfDes").checked && r[3] > 0;
  const d = dec ? (st >= 28 ? r[2] / 2 : 0) : r[2], b = des ? r[3] / 2 : r[3];
  return { ok: r[0], keep: +(100 - r[0] - d - b).toFixed(2), down: d, boom: b, mult: 1 + dec + des, dec, des }; };
// Enhancement Points (pity): gauge size for each stage from 12 stars (from the game). Each stage keeps its own points. And the price to restore a destroyed item at 12-20 stars [red diamonds, mesos, scrolls]
// (both from the game; the server's sf_rates / sf_restore tables are what the rolls actually use)
const PITY = {"12": 8, "13": 8, "14": 8, "15": 9, "16": 9, "17": 10, "18": 11, "19": 12, "20": 20, "21": 22, "22": 23, "23": 28, "24": 34, "25": 36, "26": 56, "27": 63, "28": 125, "29": 125};
const FIX = {"12": [5000, 1000000, 0], "13": [5000, 1720000, 38], "14": [5000, 2720000, 94], "15": [5000, 3910000, 161], "16": [5000, 4960000, 220], "17": [5000, 6800000, 320], "18": [5000, 9460000, 460], "19": [5000, 13210000, 651], "20": [5000, 18810000, 932]};
// famous classic MapleStory items (icons from maplestory.io). Like in the game, Star Force belongs to the slot, so the item is just its look
const ITEMS = [["zakum_helmet", "Zakum Helmet"], ["horntail_necklace", "Horntail Necklace"], ["facestompers", "Facestompers"], ["brown_work_gloves", "Brown Work Gloves"],
  ["pink_adventurer_cape", "Pink Adventurer Cape"], ["maple_shield", "Maple Shield"], ["maple_sword", "Maple Sword"], ["blue_sauna_robe", "Blue Sauna Robe"]];
const IMG = k => `media/sf/${k}.png?v=2`;
if (!ITEMS.some(i => i[0] === store.get("sf_item"))) store.set("sf_item", "zakum_helmet");
const num = n => Math.round(n).toLocaleString("en-US");
const short = n => n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : num(n);

let mode = store.get("sf_mode") === "0" ? 0 : 20;   // game mode: every item starts at 20★ (default) or 0★
let SET = null, me = "", tok = null, run = null, item = store.get("sf_item") || "zakum_helmet", busy = false, auto = false, boardView = "score", shown = null;
const fresh = () => ({ star: mode, best: mode, attempts: 0, scrolls: 0, mesos: 0, booms: 0, reached: {}, item, pity: {}, red: 0, broken: false, restores: 0 });
const tokKey = () => `sf_tok${mode ? mode : ""}:${me.toLowerCase()}`;

// ------------------------------------------------------------------ drawing
function drawItems() {
  $s("#sfItems").innerHTML = ITEMS.map(([k, n]) => { const it = SET && SET.items[k], st = k === item && shown ? shown.star : it ? it.star : mode;
    return `<button type="button" data-i="${k}" class="${k === item ? "on" : ""}${it && it.broken ? " dead" : ""}" title="${esc(n)}"><img src="${IMG(k)}" alt="${esc(n)}"><i>${it && it.broken ? "💥" : st + "★"}</i></button>`; }).join("");
}
function drawStars(st, best) {
  let h = "";
  for (let i = 0; i < MAX; i++) h += `<i class="${i < st ? "on" : i < best ? "was" : ""}${i >= 20 ? " hi" : ""}">★</i>${i % 5 === 4 && i % 15 !== 14 ? "<b></b>" : ""}${i === 14 ? "<br>" : ""}`;
  $s("#sfStars").innerHTML = h;
}
function draw(s = shown || run || fresh()) {
  const st = s.star, r = R[st], name = (ITEMS.find(i => i[0] === item) || ITEMS[0])[1];
  $s("#sfItemImg").src = IMG(item);
  drawStars(st, s.best);
  $s("#sfStage").classList.toggle("broken", !!s.broken);
  // like the game: mitigation only shows from 20★, and only for a risk that star has (destroy from 20★, drop from 21★)
  $s("#sfMitig").hidden = s.broken || st < 20 || st >= MAX;
  $s("#sfDec").closest("label").hidden = !(r && r[2] > 0); $s("#sfDes").closest("label").hidden = !(r && r[3] > 0);
  $s("#sfNow").innerHTML = s.broken ? `<b class="dead">💥 Destroyed · ${st}★</b><small>${esc(name)} · effects off until restored · best ${s.best}★</small>` : `<b>${st}★</b><small>${esc(name)}${s.best > st ? ` · best ${s.best}★` : ""}</small>`;
  const pm = PITY[st], pp = (s.pity || {})[st] || 0, others = Object.entries(s.pity || {}).filter(([k, v]) => +k !== st && v > 0).sort((a, b) => a[0] - b[0]);
  $s("#sfPity").innerHTML = (!s.broken && pm && st < MAX ? `<div class="sf-gauge${pp >= pm ? " full" : ""}"><i style="width:${Math.min(100, pp / pm * 100)}%"></i></div>
    <small>${pp >= pm ? `🎯 ${st}★ gauge full: the next try is guaranteed!` : `🎯 ${st}★ Enhancement Points ${pp} / ${pm}`}</small>` : "")
    + (others.length ? `<small class="sf-other">Saved: ${others.map(([k, v]) => `${k}★ ${v}/${PITY[k]}`).join(" · ")}</small>` : "");
  $s("#sfFix").hidden = !s.broken;
  if (s.broken) $s("#sfFix").innerHTML = `<b>💥 Your item was destroyed. Restore it at:</b><div class="sf-fixes">
    ${Object.entries(FIX).map(([k, v]) => `<button type="button" data-fix="${k}"><b>${k}★</b><small>💎 ${num(v[0])}<br><img src="media/sf/meso.png" alt="">${short(v[1])} · ${v[2] ? `<img src="media/sf/scroll.png" alt="">${v[2]}` : "no scrolls"}</small></button>`).join("")}</div>`;
  if (s.broken) { $s("#sfOdds").innerHTML = ""; $s("#sfCost").innerHTML = ""; }
  else if (st >= MAX) {
    $s("#sfOdds").innerHTML = `<p class="sf-max">✨ MAX: 30 stars! ✨</p>`; $s("#sfCost").innerHTML = "";
  } else {
    const m = mit(st), bar = (cls, label, v, was) => v || was ? `<div class="sf-bar ${cls}"><span>${label}</span><i style="width:${Math.max(2, v)}%"></i><em>${was != null && was !== v ? `<s>${was}%</s> ` : ""}${v}%</em></div>` : "";
    $s("#sfOdds").innerHTML = `<div class="sf-step">${st}★ <span>→</span> ${st + 1}★</div>` + bar("ok", "Success", m.ok) + bar("keep", "Maintain", m.keep, r[1]) + bar("down", "Decrease", m.down, r[2] || null) + bar("boom", "Destroy 💥", m.boom, r[3] || null)
      + (r[3] ? `<p class="sf-warn">💥 If it's destroyed, you choose where to restore it (12★–20★).</p>` : "");
    const stat = (l, a, b, u) => a === b ? "" : `<span>${l} <b>+${a}${u}</b> → <b class="up">+${b}${u}</b></span>`;
    $s("#sfCost").innerHTML = `<div class="sf-price"><span><img src="media/sf/scroll.png" alt="">× ${r[4] * m.mult}</span><span><img src="media/sf/meso.png" alt="">${num(r[5] * m.mult)}</span><small>per try${m.mult > 1 ? ` (×${m.mult} with mitigation)` : ""}</small></div>
      <div class="sf-statup">${stat("Main stat", MAIN[st], MAIN[st + 1], "%")}${stat("Sub stat", SUB[st], SUB[st + 1], "%")}${stat("Final damage", FD[st], FD[st + 1], "%")}</div>`;
  }
  $s("#sfTally").innerHTML = `<div><img src="media/sf/scroll.png" alt=""><b>${num(s.scrolls)}</b><small>scrolls used · ∞ left</small></div>
    <div><img src="media/sf/meso.png" alt=""><b>${short(s.mesos)}</b><small>mesos</small></div>
    <div><span>🔨</span><b>${num(s.attempts)}</b><small>tries</small></div>
    <div><span>💥</span><b>${num(s.booms)}</b><small>booms</small></div>
    <div><span>💎</span><b>${short(s.red || 0)}</b><small>red diamonds · ${s.restores || 0} restores</small></div>`;
  const T = setTotals(s);
  $s("#sfScore").innerHTML = T.tries ? `<div class="sf-myscore"><span>🏅 Your 8-item set's score if you share now</span><b>${num(T.score)}</b>
    <small>${T.items} item${T.items === 1 ? "" : "s"} enhanced · best ${T.best}★ · luck ×${T.luck.toFixed(2)} ${T.luck >= 1 ? "🍀" : "🥲"} (spent ${short(T.spent)} vs ${short(T.avg)} on average)<br>
    this item: ${num(scoreOf(s).score)} pts</small></div>
    <div class="sf-endbtns"><button class="sk-btn bd-play" data-end="share">📤 Share results</button><button class="sk-btn sk-private" data-end="new">🆕 New game</button></div>` : "";
  const rows = Object.entries(s.reached || {}).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]);
  $s("#sfTrials").innerHTML = rows.length ? `<table class="k-table sf-ttable"><tr><th>Star</th><th>Tries</th><th>Scrolls</th><th>💥</th></tr>${rows.map(([k, v]) =>
    `<tr class="${k >= 20 ? "hi" : ""}"><td>${k}★</td><td>${num(v[0])}</td><td>${num(v[1])}</td><td>${v[2] || ""}</td></tr>`).join("")}</table>`
    : `<p class="bd-none">Press ⭐ Enhance: the first time your item reaches each star, it shows here with how many tries and scrolls it took.</p>`;
  $s("#sfGo").disabled = busy || auto || st >= MAX || !me || !!s.broken;
  $s("#sfAuto").textContent = auto ? "⏹ Stop" : "▶ Auto"; $s("#sfAuto").disabled = (!auto && (busy || st >= MAX || !!s.broken)) || !me;
  drawItems();
}

// ------------------------------------------------------------------ effects and sounds
let flashT = null;
function flash(text, cls) { const f = $s("#sfFlash"); f.textContent = text; f.className = "sf-flash on " + cls; clearTimeout(flashT); flashT = setTimeout(() => f.className = "sf-flash", 900); }
function fx(kind) {
  const st = $s("#sfStage"), box = $s("#sfFx");
  st.classList.remove("ok", "keep", "down", "boom"); void st.offsetWidth; st.classList.add(kind);
  if (kind === "ok" || kind === "boom") {
    box.innerHTML = Array.from({ length: kind === "boom" ? 22 : 14 }, (_, i) => { const a = i / (kind === "boom" ? 22 : 14) * 6.28, d = kind === "boom" ? 90 : 60;
      return `<i style="--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--c:${kind === "boom" ? ["#ff5a1e", "#ffd23f", "#3a2a26"][i % 3] : ["#ffd75e", "#fff6b0", "#ffb02e"][i % 3]}"></i>`; }).join("");
  }
}
function tone(f, dur, type = "square", vol = .06, f2) {
  const ac = window.getAC && window.getAC(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const sounds = {
  ok: () => { [784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, .18, "triangle", .07), i * 70)); },
  keep: () => tone(330, .18, "square", .04, 260),
  down: () => tone(440, .35, "sawtooth", .05, 160),
  boom: () => { tone(120, .8, "sawtooth", .1, 30); tone(70, 1, "square", .08, 25); },
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ the server
async function sb() { const c = await B.client(); if (!c) $s("#sfErr").textContent = "The Star Force server isn't reachable right now."; return c; }
async function loadRun() {
  SET = null; run = null; shown = null; tok = me ? store.get(tokKey()) : null;
  if (!tok && me) { const c = await sb(); if (c) { const { data } = await c.rpc("sf_find", { p_name: me, p_start: mode }); if (data && data.r === "ok") { tok = data.token; store.set(tokKey(), tok); } } }
  if (tok) { const c = await sb(); if (c) { const { data } = await c.rpc("sf_get", { p_tok: tok }); if (data && data.r === "ok" && !data.closed) { SET = data; run = SET.items[item] || null; } else { tok = null; store.del && store.del(tokKey()); } } }
  draw();
}
async function ensureRun() {
  if (tok && SET) return true;
  const c = await sb(); if (!c) return false;
  const { data } = await c.rpc("sf_open", { p_name: me, p_start: mode });
  if (!data || data.r !== "ok") { $s("#sfErr").textContent = "Couldn't start, try again."; return false; }
  tok = data.token; store.set(tokKey(), tok); SET = { items: {} }; run = null; return true;
}
// roll on the server, then play back what happened, one try at a time
async function roll(n, stop, restoreTo) {
  const c = await sb(); if (!c) return null;
  const { data, error } = await c.rpc("sf_roll", { p_tok: tok, p_item: item, p_n: n, p_stop: stop, p_boom_stop: !restoreTo, p_restore: restoreTo || null, p_dec: $s("#sfDec").checked, p_des: $s("#sfDes").checked });
  if (error || !data || data.r !== "ok") { $s("#sfErr").textContent = data && data.r === "gone" ? "That item is gone. Start a new one." : "The server said no (too fast?). Try again in a moment."; return null; }
  $s("#sfErr").textContent = "";
  const fast = $s("#sfFast").checked, s = { ...(shown || run || fresh()) }, step = n === 1 ? 0 : fast ? 0 : 110;
  for (let i = 0; i < data.seq.length; i++) {
    const o = data.seq[i], last = i === data.seq.length - 1;
    if (o >= "a" && o <= "i") {   // restored automatically after a boom
      const to = 12 + o.charCodeAt(0) - 97, f = FIX[to]; s.broken = false; s.star = to; s.restores++; s.red += f[0]; s.mesos += f[1]; s.scrolls += f[2];
      if (!fast) { flash(`🔧 Restored to ${to}★`, "keep"); draw(s); await wait(500); }
      continue;
    }
    const r = R[s.star], mm = mit(s.star).mult;
    s.attempts++; s.scrolls += r[4] * mm; s.mesos += r[5] * mm;
    const at = s.star, pm = PITY[at]; s.pity = { ...(s.pity || {}) };
    if (o === "S" || o === "G") { s.star++; delete s.pity[at]; } else if (o === "D") s.star--; else if (o === "B") { s.star = 12; s.broken = true; s.booms++; }
    if (pm && o !== "S" && o !== "G") s.pity[at] = Math.min(pm, (s.pity[at] || 0) + (o === "B" ? 4 : o === "D" ? 2 : 1));   // points stay on the stage you tried
    s.best = Math.max(s.best, s.star);
    if (!fast || last || o === "B") {
      shown = s;
      if (o === "G") { fx("ok"); flash(`🎯 PITY! Guaranteed ${s.star}★`, "ok"); sounds.ok(); }
      if (o === "S" && (!fast || last)) { fx("ok"); flash(`✨ SUCCESS! ${s.star}★`, "ok"); if (step || n === 1) sounds.ok(); }
      if (o === "M" && (n === 1 || last)) { fx("keep"); flash("Failed: no change", "keep"); sounds.keep(); }
      if (o === "D") { fx("down"); flash(`▼ Dropped to ${s.star}★`, "down"); sounds.down(); }
      if (o === "B") { fx("boom"); flash("💥 DESTROYED!", "boom"); sounds.boom(); draw(s); if (!fast || last) await wait(fast ? 500 : 1400); }
      draw(s); if (step && !last) await wait(o === "S" ? step * 2 : step);
    }
  }
  run = data.run; SET.items[item] = run; shown = null; draw();
  return { ...data, ...data.run };
}
async function enhanceOnce() {
  if (busy || auto || !me) return; busy = true; draw();
  try { if (await ensureRun()) { $s("#sfStage").classList.add("charge"); await wait(450); $s("#sfStage").classList.remove("charge"); await roll(1, MAX, null); } }
  finally { busy = false; draw(); }
}
async function autoRun() {
  if (auto) { auto = false; draw(); return; }
  if (busy || !me) return;
  if (!(await ensureRun())) return;
  auto = true; draw();
  const pick = +$s("#sfStop").value, st0 = run ? run.star : mode, stop = pick === 1 ? st0 + 1 : Math.max(pick, st0 + 1), after = $s("#sfAfter").value, restoreTo = after === "stop" ? null : +after;
  try {
    while (auto && (run ? run.star : mode) < stop && (run ? run.star : mode) < MAX) {
      const d = await roll($s("#sfFast").checked ? 1000 : 25, stop, restoreTo);
      if (!d) break;
      if (d.broken) break;
      await wait(60);
    }
  } finally { auto = false; draw(); loadBoard(); }
}

// ------------------------------------------------------------------ leaderboard
async function loadBoard() {
  document.querySelectorAll("#sfBoardTabs [data-b]").forEach(b => b.classList.toggle("on", b.dataset.b === boardView));
  const c = await B.client(); if (!c) return;
  const { data } = await c.rpc("sf_board", { p_start: mode }); if (!data) return;
  const rows = data[boardView] || [];
  const line = r => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b>`;
  if (boardView === "score") { $s("#sfBoard").innerHTML = rows.length ? rows.map(r => `${line(r)}<span class="sf-st">${num(r.score)}</span><small>${r.best}★ · luck ×${(+r.avg / Math.max(1, +r.spent)).toFixed(2)} · ${short(+r.spent)} spent</small></li>`).join("") : `<p class="bd-none">No shared results yet. Press 📤 Share results to be the first!</p>`; return; }
  if (boardView === "fast30") { const nm = k => (ITEMS.find(i => i[0] === k) || [k, k])[1];
    $s("#sfBoard").innerHTML = rows.length ? rows.map(r => `${line(r)}<span class="sf-st">${num(r.tries)} tries</span><small>30★ ${esc(nm(r.item))} · ${num(r.scr)} 📜 · ${short(+r.mesos)} mesos · ${num(r.red)} 💎${r.bm ? ` · ${r.bm}💥` : ""}</small></li>`).join("") : `<p class="bd-none">Nobody has taken an item to 30★ yet. It takes about 300,000 tries on average… or a lot of luck.</p>`; return; }
  if (boardView === "lucky") { $s("#sfBoard").innerHTML = rows.length ? rows.map(r => `${line(r)}<span class="sf-st">×${(+r.luck).toFixed(2)}</span><small>${r.best}★ for ${short(+r.spent)} (avg ${short(+r.avg)})</small></li>`).join("") : `<p class="bd-none">Share a ${mode ? "21" : "20"}★+ result to show up here.</p>`; return; }
  $s("#sfBoard").innerHTML = !rows.length ? `<p class="bd-none">Nobody on the board yet. Be the first!</p>` : boardView === "top"
    ? rows.map(r => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b><span class="sf-st">${r.best}★</span><small>${num(r.scr || 0)} scrolls · ${num(r.att || 0)} tries${r.bm ? ` · ${r.bm}💥` : ""}</small></li>`).join("")
    : rows.map(r => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b><span>${num(r.scrolls)} 📜</span><small>${r.booms ? `${num(r.booms)}💥` : ""}</small></li>`).join("");
}
$s("#sfBoardTabs").addEventListener("click", e => { const b = e.target.closest("[data-b]"); if (!b) return; boardView = b.dataset.b; loadBoard(); });

// ------------------------------------------------------------------ name (search with pictures, like the other games) and buttons
const ROSTER = (typeof D !== "undefined" ? [...D.founders, ...D.members] : []).filter((p, i, a) => p && p.name && a.findIndex(q => q.name === p.name) === i);
function setName() {
  const n = $s("#sfName").value.trim().slice(0, 20), g = n && guildOf(n), nn = g ? g.name : n;
  $s("#sfGuest").hidden = !n || !!g;
  if (nn.length >= 2 && nn !== me) { me = nn; if (g) store.set("family_me", g.name); auto = false; loadRun(); }
  else if (nn.length < 2) { me = ""; run = null; draw(); }
}
// your character shown big, and the name search with pictures and arrow keys (same as Family Kart)
function showFace() {
  const n = $s("#sfName").value.trim(), g = guildOf(n);
  $s("#sfFace").innerHTML = `<img src="${n ? spriteOf(g ? g.name : n) : B.M + "guest.png?v=2"}" alt="">`;
}
let suggIdx = -1;
function suggest() {
  const q = $s("#sfName").value.trim().toLowerCase(), box = $s("#sfSugg");
  if (!q) { box.hidden = true; return; }
  const hits = ROSTER.filter(p => p.name.toLowerCase().includes(q)).sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length).slice(0, 8);
  if (!hits.length || (hits.length === 1 && hits[0].name.toLowerCase() === q)) { box.hidden = true; return; }
  suggIdx = -1;
  box.innerHTML = hits.map(p => `<button type="button" data-n="${esc(p.name)}">${p.sprite ? `<img src="${p.sprite}" alt="">` : "<span style='width:34px'>👤</span>"} ${esc(p.name)}</button>`).join("");
  box.hidden = false;
}
const pickName = n => { $s("#sfName").value = n; $s("#sfSugg").hidden = true; showFace(); setName(); };
$s("#sfSugg").addEventListener("pointerdown", e => { const b = e.target.closest("button"); if (!b) return; e.preventDefault(); pickName(b.dataset.n); });
$s("#sfName").addEventListener("input", () => { showFace(); suggest(); clearTimeout(setName.t); setName.t = setTimeout(setName, 500); });
$s("#sfName").addEventListener("blur", () => setTimeout(() => { $s("#sfSugg").hidden = true; setName(); }, 150));
$s("#sfName").addEventListener("keydown", e => {
  const items = [...$s("#sfSugg").querySelectorAll("button")], open = items.length && !$s("#sfSugg").hidden;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) { e.preventDefault();
    suggIdx = (suggIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("on", i === suggIdx)); }
  if (e.key === "Enter") { e.preventDefault(); if (open && suggIdx >= 0 && items[suggIdx]) pickName(items[suggIdx].dataset.n); else { $s("#sfSugg").hidden = true; setName(); } }
  if (e.key === "Escape") $s("#sfSugg").hidden = true;
});
$s("#sfItems").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b || busy || auto) return; item = b.dataset.i; store.set("sf_item", item); run = SET && SET.items[item] || null; shown = null; draw(); });
$s("#sfFix").addEventListener("click", async e => {
  const b = e.target.closest("[data-fix]"); if (!b || busy || !run || !run.broken) return;
  busy = true; draw();
  try {
    const c = await sb(); if (!c) return;
    const { data } = await c.rpc("sf_fix", { p_tok: tok, p_item: item, p_star: +b.dataset.fix });
    if (data && data.r === "ok") { run = data.run; SET.items[item] = run; flash(`🔧 Restored to ${b.dataset.fix}★`, "keep"); fx("ok"); }
    else $s("#sfErr").textContent = "Couldn't restore, try again.";
  } finally { busy = false; draw(); }
});
for (const id of ["#sfDec", "#sfDes"]) { $s(id).checked = store.get("sf" + id) === "1"; $s(id).addEventListener("change", () => { store.set("sf" + id, $s(id).checked ? "1" : "0"); draw(); }); }
$s("#sfScore").addEventListener("click", async e => {
  const b = e.target.closest("[data-end]"); if (!b || busy || auto || !SET) return;
  const T = setTotals(run), guest = !guildOf(me);
  const msg = b.dataset.end === "share"
    ? `📤 Share your results?\n\n${T.items} item${T.items === 1 ? "" : "s"} · best ${T.best}★ · score ${num(T.score)}${guest ? "\n(Guests don't show on the guild board.)" : ""}\n\n⚠️ After sharing, ALL 8 items RESET TO ${mode}★ and you start a brand new set. This can't be undone.`
    : `🆕 Start a new game?\n\n⚠️ ALL 8 items RESET TO ${mode}★ and these results will NOT be shared (best ${T.best}★, score ${num(T.score)}).\n\nAre you sure you don't want to share them first?`;
  if (!confirm(msg)) return;
  await closeSet(b.dataset.end === "share");
});
// share (or throw away) the open set; a fresh one starts at the mode's star
async function closeSet(share) {
  busy = true; draw();
  try {
    const c = await sb(); if (!c) return false;
    const { data } = await c.rpc("sf_close", { p_tok: tok, p_share: share });
    if (!data || data.r !== "ok") { $s("#sfErr").textContent = "Couldn't do that, try again."; return false; }
    tok = data.token; store.set(tokKey(), tok); SET = { items: {} }; run = null; shown = null;
    flash(share ? `📤 Shared! Score ${num(data.score)}${data.rank && guildOf(me) ? ` · #${data.rank}` : ""}` : `🆕 A fresh set, all ${mode}★`, "ok");
    loadBoard(); return true;
  } finally { busy = false; draw(); }
}
function drawMode() {
  document.querySelectorAll("#sfMode [data-m]").forEach(b => b.classList.toggle("on", +b.dataset.m === mode));
  const sel = $s("#sfStop"); [...sel.options].forEach(o => o.hidden = o.value !== "1" && +o.value <= mode);   // no "auto until 15★/20★" when you start at 20★
  if (sel.selectedOptions[0] && sel.selectedOptions[0].hidden) sel.value = "25";
}
// switching modes throws the current set away unless it's shared first (sharing resets it to this mode's start)
$s("#sfMode").addEventListener("click", async e => { const b = e.target.closest("[data-m]"); if (!b || busy || auto || +b.dataset.m === mode) return;
  const T = SET && tok ? setTotals(run) : null, to = +b.dataset.m;
  if (T && T.items) {
    if (confirm(`📤 Share your ${mode}★ mode results before switching to ${to}★?\n\n${T.items} item${T.items === 1 ? "" : "s"} · best ${T.best}★ · score ${num(T.score)}\n\nOK = share them (your ${mode}★ set resets to ${mode}★), then switch.\nCancel = don't share.`)) {
      if (!(await closeSet(true))) return;
    } else if (confirm(`⚠️ Switch to ${to}★ WITHOUT sharing?\n\nYour ${mode}★ mode results (best ${T.best}★, score ${num(T.score)}) will NOT be saved. They're gone for good.`)) {
      if (!(await closeSet(false))) return;
    } else return;
  }
  mode = to; store.set("sf_mode", String(mode)); drawMode(); loadRun(); loadBoard(); });
drawMode();
$s("#sfGo").onclick = enhanceOnce;
$s("#sfAuto").onclick = autoRun;
addEventListener("keydown", e => { if (location.hash === "#sf" && e.key === " " && document.activeElement === document.body) { e.preventDefault(); enhanceOnce(); } });
addEventListener("hashchange", () => { if (location.hash !== "#sf") auto = false; else loadBoard(); });
$s("#sfName").value = store.get("family_me") || "";
setName(); showFace(); draw(); if (location.hash === "#sf") loadBoard();
})();
