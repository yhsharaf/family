// Family Kart: a time-trial racer drawn the way the SNES Mario Kart did it ("Mode 7"): a flat track picture is tilted into
// a 3D-looking floor one screen row at a time, and the karts, monsters and trees are flat pictures (billboards) on top.
// Step 1 of the plan: one track (Henesys), your character in a kart, drifting with mini-boosts, 3 laps and best times.
(() => {
const $k = s => document.querySelector(s);
const B = window.BD; if (!B || !$k("#kart")) return;
const { esc, store, spriteOf, guildOf } = B;

// ------------------------------------------------------------------ track
const WORLD = 2048, ROAD = 124, CURB = 12, LAPS = 3;
const CTRL = [[400, 1450], [400, 900], [520, 520], [850, 390], [1150, 560], [1110, 880], [900, 1050], [1000, 1260], [1400, 1250],
  [1590, 900], [1650, 470], [1850, 360], [1910, 800], [1850, 1400], [1650, 1750], [1100, 1860], [650, 1820], [430, 1720]];
// closed Catmull-Rom spline -> evenly spaced points every ~4 world units
const PTS = (() => {
  const raw = [], n = CTRL.length;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [CTRL[(i + n - 1) % n], CTRL[i], CTRL[(i + 1) % n], CTRL[(i + 2) % n]];
    for (let t = 0; t < 1; t += 1 / 60) {
      const t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const out = [raw[0]]; let acc = 0;
  for (let i = 1; i <= raw.length; i++) {
    const a = raw[i - 1], b = raw[i % raw.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += d;
    if (acc >= 4) { out.push(b); acc = 0; }
  }
  return out;
})();
const N = PTS.length;
const tangent = i => { const a = PTS[(i + N - 2) % N], b = PTS[(i + 2) % N]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
function nearest(x, y, guess) {   // nearest track point, searching around the last one (or everywhere)
  let best = -1, bd = 1e12;
  const scan = (from, to) => { for (let k = from; k <= to; k++) { const i = (k + N) % N, dx = PTS[i][0] - x, dy = PTS[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } };
  if (guess == null) scan(0, N - 1); else scan(guess - 40, guess + 40);
  return { i: best, d: Math.sqrt(bd) };
}

// the track picture: grass in stripes, flowers, red/white curbs, a dirt road and a chequered start line
const tex = document.createElement("canvas"); tex.width = tex.height = WORLD;
let TEX = null, mini = null;
function paintTrack() {
  const g = tex.getContext("2d");
  g.fillStyle = "#62b04c"; g.fillRect(0, 0, WORLD, WORLD);
  g.fillStyle = "#58a444";
  for (let k = -WORLD; k < WORLD * 2; k += 96) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 48, 0); g.lineTo(k + 48 - WORLD, WORLD); g.lineTo(k - WORLD, WORLD); g.fill(); }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const flowers = ["#ffe066", "#ffffff", "#ff8fb8", "#ffb347"];
  for (let k = 0; k < 2600; k++) { g.fillStyle = flowers[k % 4]; const x = rnd() * WORLD, y = rnd() * WORLD; g.fillRect(x, y, 5, 5); g.fillStyle = "#3f8a34"; g.fillRect(x + 1, y + 5, 3, 3); }
  const path = () => { g.beginPath(); PTS.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
  g.lineJoin = g.lineCap = "round";
  path(); g.strokeStyle = "#3c7a30"; g.lineWidth = ROAD + CURB * 2 + 10; g.stroke();             // grass edge shadow
  path(); g.strokeStyle = "#ffffff"; g.lineWidth = ROAD + CURB * 2; g.stroke();
  path(); g.strokeStyle = "#e0453a"; g.setLineDash([26, 26]); g.stroke(); g.setLineDash([]);
  path(); g.strokeStyle = "#c79a62"; g.lineWidth = ROAD; g.stroke();
  for (let k = 0; k < 1800; k++) { const i = Math.floor(rnd() * N), [x, y] = PTS[i], a = rnd() * 6.28, r = rnd() * ROAD * .45;   // pebbles
    g.fillStyle = rnd() < .5 ? "#b78a55" : "#d4ab74"; g.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 4, 4); }
  path(); g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 3; g.setLineDash([22, 30]); g.stroke(); g.setLineDash([]);
  // start line across the road at point 0
  const [sx, sy] = PTS[0], ta = tangent(0), nx = -Math.sin(ta), ny = Math.cos(ta), sq = 10;
  for (let r = 0; r < 2; r++) for (let c = -ROAD / 2; c < ROAD / 2; c += sq) {
    g.fillStyle = ((c / sq + r) & 1) ? "#222" : "#fff";
    g.save(); g.translate(sx + nx * (c + sq / 2) + Math.cos(ta) * (r - 1) * sq, sy + ny * (c + sq / 2) + Math.sin(ta) * (r - 1) * sq); g.rotate(ta);
    g.fillRect(-sq / 2, -sq / 2, sq + .5, sq + .5); g.restore();
  }
  TEX = new Uint32Array(g.getImageData(0, 0, WORLD, WORLD).data.buffer);
  // minimap
  mini = document.createElement("canvas"); mini.width = mini.height = 128; const m = mini.getContext("2d"), k = 128 / WORLD;
  m.lineJoin = "round"; m.beginPath(); PTS.forEach(([x, y], i) => i ? m.lineTo(x * k, y * k) : m.moveTo(x * k, y * k)); m.closePath();
  m.strokeStyle = "rgba(0,0,0,.45)"; m.lineWidth = 9; m.stroke(); m.strokeStyle = "#f4e2b8"; m.lineWidth = 5; m.stroke();
}

// roadside things: Henesys monsters and trees (flat pictures that always face the camera)
const MOBS = ["orange_mushroom", "green_mushroom", "blue_mushroom", "spotty_mushroom", "snail", "blue_snail", "red_snail", "slime", "stump", "pig", "ribbon_pig"];
const IMG = {};
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
function treeImg() {   // a chunky pixel tree drawn here (no picture to download)
  const c = document.createElement("canvas"); c.width = 60; c.height = 84; const g = c.getContext("2d");
  g.fillStyle = "#6b4426"; g.fillRect(25, 50, 10, 34); g.fillStyle = "#4e301a"; g.fillRect(31, 50, 4, 34);
  const blob = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  blob(30, 34, 26, "#2f7d32"); blob(18, 40, 16, "#2f7d32"); blob(42, 40, 16, "#2f7d32");
  blob(26, 28, 18, "#43a047"); blob(38, 32, 13, "#43a047"); blob(22, 22, 8, "#66bb6a");
  return c;
}
let OBJS = [];
function placeObjects() {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  OBJS = [];
  for (let s = 20; s < N; s += 30) {
    for (const side of [-1, 1]) {
      if (rnd() < .35) continue;
      const a = tangent(s), off = ROAD / 2 + CURB + 26 + rnd() * 70, x = PTS[s][0] - Math.sin(a) * off * side, y = PTS[s][1] + Math.cos(a) * off * side;
      if (nearest(x, y).d < ROAD / 2 + CURB + 18 || x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) continue;
      const tree = rnd() < .38;
      OBJS.push({ x, y, k: tree ? "tree" : MOBS[Math.floor(rnd() * MOBS.length)], s: tree ? 1.05 : .42, r: tree ? 14 : 10 });
    }
  }
  for (let k = 0; k < 160; k++) {   // a forest further out
    const x = 30 + rnd() * (WORLD - 60), y = 30 + rnd() * (WORLD - 60);
    if (nearest(x, y).d > ROAD / 2 + 140) OBJS.push({ x, y, k: "tree", s: 1.25, r: 16 });
  }
}

// ------------------------------------------------------------------ screen
// fixed 320 px wide; the height follows the screen's shape (tall on phones), with the camera raised to match
const W = 320, FOCAL = 170, CAMD = 64;
let H = 192, HOR = 58, CAMH = 30, floor = null, F32 = null, FOG = [];
const cv = $k("#kCanvas"), ctx = cv.getContext("2d");
function fit() {
  const r = $k(".kt-screen").getBoundingClientRect();
  const h = r.width > 0 ? Math.round(W * r.height / r.width) : 192;
  H = Math.max(130, Math.min(640, h)); HOR = Math.round(H * .3); CAMH = (H * .75 - HOR) * CAMD / FOCAL;
  cv.width = W; cv.height = H; ctx.imageSmoothingEnabled = false;
  floor = ctx.createImageData(W, H - HOR); F32 = new Uint32Array(floor.data.buffer);
  FOG = []; for (let y = 0; y < H - HOR; y++) FOG[y] = Math.max(0, Math.round(256 * Math.pow(1 - y / (H - HOR), 5) * .9));   // haze near the horizon
}
fit();
addEventListener("resize", () => { if (state !== "menu") fit(); });
const OUT = 0xff2e7d32 >>> 0;   // beyond the map edge: dark forest (ABGR)
const HAZE = [214, 236, 255];
let sky = null;

// ------------------------------------------------------------------ the race
let me = null, state = "menu", raf = 0, last = 0, keys = {}, touch = { l: 0, r: 0, d: 0, b: 0 };
let K = null, best = null;
function freshKart() {
  const i = (N - 10) % N, a = tangent(i);
  return { x: PTS[i][0], y: PTS[i][1], a, v: 0, steer: 0, drift: 0, charge: 0, boost: 0, hop: 0, idx: i, lap: 0, cps: 0,
    t: 0, lapStart: 0, laps: [], wrong: 0, prog: 0, off: false, bump: 0, parts: [] };
}
const fmt = ms => ms == null ? "--" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
const bestKey = () => "kart_best:henesys:" + me;

function input() {
  const l = keys.ArrowLeft || keys.a || touch.l, r = keys.ArrowRight || keys.d || touch.r;
  return { steer: (r ? 1 : 0) - (l ? 1 : 0), drift: !!(keys[" "] || keys.Shift || touch.d), brake: !!(keys.ArrowDown || keys.s || touch.b) };
}
function step(dt) {
  const k = K, inp = input(), racing = state === "race";
  k.steer += (inp.steer - k.steer) * Math.min(1, dt * 10);
  const near = nearest(k.x, k.y, k.idx); k.idx = near.i; k.off = near.d > ROAD / 2 + CURB * .6;
  // speed: always accelerating (phone friendly), the brake slows / reverses
  const top = (k.off ? 105 : 250) + (k.boost > 0 ? 90 : 0);
  if (!racing) k.v *= Math.pow(.2, dt);
  else if (inp.brake) k.v = Math.max(-60, k.v - 380 * dt);
  else k.v += (k.v < top ? (k.v < 120 ? 210 : 120) : -260) * dt;
  if (k.boost > 0) k.boost -= dt;
  // drifting: hold drift while turning, the longer you hold the bigger the boost when you let go
  if (racing && inp.drift && !k.drift && Math.abs(inp.steer) > 0 && k.v > 140) { k.drift = Math.sign(inp.steer); k.charge = 0; k.hop = .18; hopSound(); }
  if (k.drift && (!inp.drift || k.v < 90)) {
    if (k.charge > 1.6) { k.boost = 1.1; boostSound(); } else if (k.charge > .75) { k.boost = .6; boostSound(); }
    k.drift = 0; k.charge = 0;
  }
  let turn = k.steer * 2.1 * Math.min(1, Math.abs(k.v) / 110) * (k.v < 0 ? -1 : 1);
  if (k.drift) { turn = (k.drift * 1.55 + k.steer * .9) * Math.min(1, k.v / 110); if (!k.off) k.charge += dt * (1 + Math.abs(k.steer) * .4); }
  k.a += turn * dt;
  let mx = Math.cos(k.a) * k.v, my = Math.sin(k.a) * k.v;
  if (k.drift) { mx += -Math.sin(k.a) * -k.drift * k.v * .16; my += Math.cos(k.a) * -k.drift * k.v * .16; }   // slide outwards a bit
  k.x += mx * dt; k.y += my * dt;
  if (k.hop > 0) k.hop -= dt;
  // the map edge and roadside things push you back
  if (k.x < 20 || k.y < 20 || k.x > WORLD - 20 || k.y > WORLD - 20) { k.x = Math.min(WORLD - 20, Math.max(20, k.x)); k.y = Math.min(WORLD - 20, Math.max(20, k.y)); k.v *= .5; }
  for (const o of OBJS) {
    const dx = k.x - o.x, dy = k.y - o.y, d = Math.hypot(dx, dy);
    if (d < o.r + 7 && d > 0) { k.x = o.x + dx / d * (o.r + 7); k.y = o.y + dy / d * (o.r + 7); if (k.bump <= 0) { k.v *= .35; k.bump = .4; bumpSound(); } k.drift = 0; }
  }
  if (k.bump > 0) k.bump -= dt;
  if (!racing) return;
  // laps: 4 checkpoints in order, then crossing the start line
  k.t += dt * 1000;
  const prog = k.idx / N, cp = Math.floor(prog * 4);
  if (cp === (k.cps + 1) % 4 && k.cps < 3) k.cps = cp;
  if (k.cps === 3 && k.prog > .9 && prog < .1) {
    k.laps.push(k.t - k.lapStart); k.lapStart = k.t; k.lap++; k.cps = 0; lapSound();
    if (k.lap >= LAPS) finish();
    else flash(k.lap === LAPS - 1 ? "🏁 FINAL LAP!" : `Lap ${k.lap + 1}`, 1300);
  }
  // wrong way: moving against the track direction for a moment
  const along = Math.cos(k.a - tangent(k.idx)) * k.v;
  k.wrong = along < -20 ? k.wrong + dt : Math.max(0, k.wrong - dt * 2);
  k.prog = prog;
}

// ------------------------------------------------------------------ drawing
function render() {
  const k = K, ca = Math.cos(k.a), sa = Math.sin(k.a);
  const cx = k.x - ca * CAMD, cy = k.y - sa * CAMD;
  // sky: the Henesys background, scrolling as you turn
  ctx.fillStyle = "#8fd0ff"; ctx.fillRect(0, 0, W, HOR + 2);
  if (sky) {
    const sh = HOR + 26, sw = sky.width * sh / sky.height, off = ((k.a / (Math.PI * 2)) * sw * 2 % sw + sw) % sw;
    const tile = Math.floor(((k.a / (Math.PI * 2)) * sw * 2) / sw);
    for (let x = -off, i = 0; x < W; x += sw, i++) {
      if ((tile + i) & 1) { ctx.save(); ctx.translate(x + sw, 0); ctx.scale(-1, 1); ctx.drawImage(sky, 0, HOR + 4 - sh, sw, sh); ctx.restore(); }
      else ctx.drawImage(sky, x, HOR + 4 - sh, sw, sh);
    }
  }
  // floor, one row at a time
  for (let y = 0; y < H - HOR; y++) {
    const z = CAMH * FOCAL / (y + 1), half = z * (W / 2) / FOCAL;
    let wx = cx + ca * z + sa * half, wy = cy + sa * z - ca * half;   // left end of the row
    const stx = -sa * 2 * half / W, sty = ca * 2 * half / W, f = FOG[y], nf = 256 - f;
    const hr = HAZE[0] * f, hg = HAZE[1] * f, hb = HAZE[2] * f;
    let o = y * W;
    for (let x = 0; x < W; x++, wx += stx, wy += sty, o++) {
      const ix = wx | 0, iy = wy | 0;
      let c = (ix >= 0 && iy >= 0 && ix < WORLD && iy < WORLD) ? TEX[iy * WORLD + ix] : OUT;
      if (f) c = 0xff000000 | ((((c >>> 16) & 255) * nf + hb) >> 8) << 16 | ((((c >>> 8) & 255) * nf + hg) >> 8) << 8 | (((c & 255) * nf + hr) >> 8);
      F32[o] = c;
    }
  }
  ctx.putImageData(floor, 0, HOR);
  // billboards, far to near
  const vis = [];
  for (const ob of OBJS) {
    const rx = ob.x - cx, ry = ob.y - cy, fz = rx * ca + ry * sa;
    if (fz < 8 || fz > 1400) continue;
    const side = -rx * sa + ry * ca, sx = W / 2 + side * FOCAL / fz;
    if (sx < -80 || sx > W + 80) continue;
    vis.push({ ob, fz, sx });
  }
  vis.sort((a, b) => b.fz - a.fz);
  for (const { ob, fz, sx } of vis) {
    const im = IMG[ob.k]; if (!im) continue;
    const sc = FOCAL / fz * ob.s, w = im.width * sc, h = im.height * sc, gy = HOR + CAMH * FOCAL / fz;
    if (w < .6) continue;
    ctx.globalAlpha = fz > 1000 ? Math.max(0, (1400 - fz) / 400) : 1;
    ctx.drawImage(im, sx - w / 2, gy - h, w, h);
  }
  ctx.globalAlpha = 1;
  drawKart(k);
  // minimap
  if (mini) {
    const mx = W - 54, my = TOUCH ? 30 : 4, s = 50 / 128;
    ctx.globalAlpha = .85; ctx.drawImage(mini, mx, my, 50, 50); ctx.globalAlpha = 1;
    ctx.fillStyle = "#e0453a"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 2, my + k.y * 128 / WORLD * s - 2, 4, 4);
  }
}
function drawKart(k) {
  const gy = HOR + CAMH * FOCAL / CAMD, sc = FOCAL / CAMD, x = W / 2 + k.steer * 4;
  const hop = k.hop > 0 ? Math.sin((k.hop / .18) * Math.PI) * 6 : 0, rumble = k.off && k.v > 40 ? (Math.random() - .5) * 2 : 0;
  const y = gy - hop + rumble, tilt = (k.drift ? k.drift * .16 : 0) + k.steer * .06;
  const w = 18 * sc, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(x, gy + 2, w * .55, 4, 0, 0, 7); ctx.fill();
  // drift sparks and dust
  if (k.drift && k.charge > .2) {
    const col = k.charge > 1.6 ? ["#ff9a2e", "#ffd34d"] : k.charge > .75 ? ["#5ab4ff", "#c8ecff"] : ["#ffffff", "#dddddd"];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = col[i & 1]; const sx = x + (i < 3 ? -1 : 1) * w * .42 + (Math.random() - .5) * 10, sy = y - Math.random() * 8;
      ctx.fillRect(sx, sy, 2, 2); }
  }
  if (k.off && k.v > 60) for (let i = 0; i < 4; i++) { ctx.fillStyle = "rgba(120,90,50,.6)"; ctx.fillRect(x + (Math.random() - .5) * w, y - Math.random() * 6, 3, 3); }
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
  const bw = w, bh = w * .42;
  // driver (their picture faces right; mirror it when turning left), sitting in the kart: the body hides their legs
  const sp = IMG.me;
  if (sp) {
    const dh = 58, dw = sp.width * dh / sp.height;
    ctx.save(); ctx.translate(0, -bh * .45); if (k.steer < -.3 || k.drift < 0) ctx.scale(-1, 1);
    ctx.drawImage(sp, -dw / 2, -dh, dw, dh); ctx.restore();
  }
  // kart body from behind: Family green with gold trim, wheels and a low spoiler
  ctx.fillStyle = "#1d1d22";
  ctx.fillRect(-bw / 2 - 2, -bh * .55, bw * .22, bh * .75); ctx.fillRect(bw / 2 + 2 - bw * .22, -bh * .55, bw * .22, bh * .75);
  ctx.fillStyle = "#3b3b44"; for (const sx of [-bw / 2 - 2, bw / 2 + 2 - bw * .22]) ctx.fillRect(sx, -bh * .55 + ((t * k.v / 8) % 4), bw * .22, 1.5);
  ctx.fillStyle = "#2d6e3c"; rr(-bw * .36, -bh * .8, bw * .72, bh * .65, 4); ctx.fill();
  ctx.fillStyle = "#46a05a"; rr(-bw * .34, -bh * .8, bw * .68, bh * .48, 4); ctx.fill();
  ctx.fillStyle = "#cd961e"; ctx.fillRect(-bw * .34, -bh * .4, bw * .68, 2);
  ctx.fillStyle = "#2d2832"; ctx.fillRect(-bw * .42, -bh * .84, bw * .84, 2.5);
  ctx.fillStyle = "#ffe08a"; ctx.font = `bold ${Math.round(bh * .34)}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.fillText("F", 0, -bh * .45);
  if (k.boost > 0) for (const sx of [-bw * .16, bw * .16]) { ctx.fillStyle = Math.random() < .5 ? "#ffb02e" : "#ff5a2e"; ctx.beginPath();
    ctx.moveTo(sx - 3, -bh * .2); ctx.lineTo(sx + 3, -bh * .2); ctx.lineTo(sx, -bh * .2 + 6 + Math.random() * 6); ctx.fill(); }
  ctx.restore();
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ------------------------------------------------------------------ HUD + flow
function hud() {
  const k = K;
  $k("#kLap").textContent = state === "menu" ? "" : `Lap ${Math.min(k.lap + 1, LAPS)}/${LAPS}`;
  $k("#kTime").textContent = state === "menu" ? "" : fmt(k.t);
  $k("#kBest").textContent = best && best.lap ? `Best lap ${fmt(best.lap)}` : "";
  $k("#kSpeed").textContent = state === "race" ? `${Math.max(0, Math.round(k.v * .5))} km/h` : "";
  $k("#kWrong").hidden = !(state === "race" && k.wrong > .6);
}
let flashT = null;
function flash(t, ms) { const f = $k("#kFlash"); f.textContent = t; f.className = "k-flash on"; clearTimeout(flashT); flashT = setTimeout(() => f.className = "k-flash", ms); }
// phones race sideways: go fullscreen + lock to landscape where the browser allows it (Android), otherwise ask to rotate and pause
const TOUCH = matchMedia("(pointer: coarse)").matches;
const upright = () => TOUCH && innerHeight > innerWidth;
async function goLandscape() {
  if (!TOUCH) return;
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch (e) {}
  try { await screen.orientation.lock("landscape"); } catch (e) {}
}
function leaveLandscape() {
  try { screen.orientation.unlock(); } catch (e) {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
}
const waitLandscape = () => new Promise(res => { const chk = () => { if (!upright()) { removeEventListener("resize", chk); res(); } }; addEventListener("resize", chk); chk(); });
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  const rot = upright(); $k("#kRotate").hidden = !rot;
  if (TEX) { if (!rot) step(dt); render(); hud(); engine(); }
  raf = requestAnimationFrame(loop);
}
async function start() {
  const n = $k("#kName").value.trim().slice(0, 20);
  if (n.length < 2) { $k("#kErr").textContent = "Type your character name first."; return; }
  $k("#kErr").textContent = "";
  const g = guildOf(n); me = g ? g.name : n; if (g) store.set("family_me", g.name);
  try { best = JSON.parse(store.get(bestKey())) || null; } catch (e) { best = null; }
  $k("#kMenu").hidden = true; $k("#kResult").hidden = true; $k("#kGame").hidden = false;
  $k("#kart").classList.add("racing"); document.body.classList.add("bd-playing");
  window.getAC && window.getAC(); goLandscape();
  if (!TEX) { $k("#kLoad").hidden = false; await prepare(); $k("#kLoad").hidden = true; }
  IMG.me = await loadImg(spriteOf(me)); fit();
  K = freshKart(); state = "wait"; B.music("henesys"); syncMusicBtn();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  await waitLandscape(); fit(); if (state !== "wait") return; state = "count";
  for (const [t, d] of [["3", 0], ["2", 1000], ["1", 2000]]) setTimeout(() => { if (state === "count") { flash(t, 900); beep(440); } }, d);
  setTimeout(() => { if (state !== "count") return; state = "race"; flash("GO!", 900); beep(880); }, 3000);
}
async function prepare() {
  paintTrack(); placeObjects();
  const [s, tr] = [await loadImg(B.M + "bg_henesys.webp?v=9"), treeImg()]; sky = s; IMG.tree = tr;
  await Promise.all(MOBS.map(async m => { IMG[m] = await loadImg(`media/mobs/${m}.png`); }));
}
function finish() {
  state = "done"; const k = K, total = k.laps.reduce((a, b) => a + b, 0), bl = Math.min(...k.laps);
  const newRace = !best || !best.race || total < best.race, newLap = !best || !best.lap || bl < best.lap;
  best = { race: newRace ? total : best.race, lap: newLap ? bl : best.lap }; store.set(bestKey(), JSON.stringify(best));
  B.sound("win"); flash("🏁 FINISH!", 1600);
  const sent = guildOf(me) ? submit(k.laps) : Promise.resolve(null);
  setTimeout(() => {
    $k("#kResult").innerHTML = `<h3>🏁 ${fmt(total)}</h3>
      <div class="k-laps">${k.laps.map((l, i) => `<span class="${l === bl ? "b" : ""}">Lap ${i + 1}: ${fmt(l)}</span>`).join("")}</div>
      <p>${newRace ? "🎉 New personal best race!" : `Your best race: ${fmt(best.race)}`}${newLap ? "<br>⚡ New best lap!" : ""}</p>
      <p class="k-rank" id="kRank">${guildOf(me) ? "Saving your time…" : "Guests aren't on the guild board."}</p>
      <div class="row"><button class="sk-btn bd-play" id="kAgain">Race again</button><button class="sk-btn sk-private" id="kBack">Back</button></div>`;
    $k("#kResult").hidden = false;
    sent.then(r => { const el = $k("#kRank"); if (!el || !r) return;
      el.innerHTML = r.r === "ok" ? `🏆 You're <b>#${r.rank}</b> on the guild board` : r.r === "laps" ? "That time looks impossible, so it wasn't saved 🤔" : "Couldn't save your time this time."; });
  }, 1400);
}
function quit() {
  state = "menu"; leaveLandscape(); $k("#kRotate").hidden = true; cancelAnimationFrame(raf); raf = 0; stopEngine(); B.music(null);
  $k("#kGame").hidden = true; $k("#kMenu").hidden = false; $k("#kResult").hidden = true;
  $k("#kart").classList.remove("racing"); document.body.classList.remove("bd-playing"); showBest();
}
async function submit(laps) {
  const sb = await B.client(); if (!sb) return null;
  const { data } = await sb.rpc("kart_submit", { p_track: "henesys", p_name: me, p_laps: laps.map(Math.round) });
  loadBoard(); return data;
}
async function loadBoard() {
  const sb = await B.client(); if (!sb) return;
  const { data } = await sb.from("kart_times").select("player,race_ms,lap_ms").eq("track", "henesys").order("race_ms").limit(10);
  $k("#kBoard").innerHTML = (data || []).length ? data.map((r, i) => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b>
    <span>${fmt(r.race_ms)}</span><small>lap ${fmt(r.lap_ms)}</small></li>`).join("") : `<p class="bd-none">No times yet. Be the first!</p>`;
}
if (location.hash === "#kart") loadBoard();
addEventListener("hashchange", () => { if (location.hash === "#kart") loadBoard(); });
function showBest() {
  const n = ($k("#kName").value || "").trim(), g = n && guildOf(n), key = "kart_best:henesys:" + (g ? g.name : n);
  let b = null; try { b = JSON.parse(store.get(key)); } catch (e) {}
  $k("#kMine").innerHTML = b && b.race ? `🏆 Your best: race <b>${fmt(b.race)}</b> · lap <b>${fmt(b.lap)}</b>` : "No time yet on this track. Go set one!";
}
$k("#kGo").onclick = start;
$k("#kName").addEventListener("keydown", e => { if (e.key === "Enter") start(); });
$k("#kName").addEventListener("input", showBest);
$k("#kName").value = store.get("family_me") || "";
showBest();
$k("#kLeave").onclick = quit;
$k("#kResult").addEventListener("click", e => { if (e.target.id === "kAgain") start(); if (e.target.id === "kBack") quit(); });
const syncMusicBtn = () => { $k("#kMusic").textContent = B.musicOn && B.musicOn() ? "🔊" : "🔇"; };
$k("#kMusic").onclick = () => { B.toggleMusic(); syncMusicBtn(); };
syncMusicBtn();
addEventListener("hashchange", () => { if (location.hash !== "#kart" && state !== "menu") quit(); });

// keyboard + touch buttons
const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Shift", "a", "d", "s"];
addEventListener("keydown", e => { if (state === "menu" || !GAME_KEYS.includes(e.key)) return; keys[e.key] = true; e.preventDefault(); });
addEventListener("keyup", e => { keys[e.key] = false; });
addEventListener("blur", () => { keys = {}; touch = { l: 0, r: 0, d: 0, b: 0 }; });
document.querySelectorAll("#kPad [data-k]").forEach(b => {
  const on = v => e => { e.preventDefault(); touch[b.dataset.k] = v; b.classList.toggle("on", !!v); };
  b.addEventListener("pointerdown", e => { try { b.setPointerCapture(e.pointerId); } catch (er) {} on(1)(e); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => b.addEventListener(ev, on(0)));
  b.addEventListener("contextmenu", e => e.preventDefault());
});

// ------------------------------------------------------------------ sounds (made in the browser)
let eng = null;
function engine() {
  const ac = window.getAC && window.getAC(); if (!ac || state === "menu") return;
  if (!eng) {
    const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = "sawtooth"; o2.type = "square"; f.type = "lowpass"; f.frequency.value = 600; g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g).connect(ac.destination); o.start(); o2.start(); eng = { o, o2, g };
  }
  const v = Math.abs(K.v), base = 55 + v * .55 + (K.boost > 0 ? 40 : 0);
  eng.o.frequency.setTargetAtTime(base, ac.currentTime, .05); eng.o2.frequency.setTargetAtTime(base * .5, ac.currentTime, .05);
  eng.g.gain.setTargetAtTime(state === "done" ? 0 : .025 + Math.min(.03, v / 8000), ac.currentTime, .1);
}
function stopEngine() { if (eng) { try { eng.o.stop(); eng.o2.stop(); } catch (e) {} eng = null; } }
function tone(f, dur, type = "square", vol = .08, f2) {
  const ac = window.getAC && window.getAC(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const beep = f => tone(f, .25, "square", .09);
const hopSound = () => tone(300, .12, "triangle", .08, 520);
const boostSound = () => { tone(220, .35, "sawtooth", .07, 880); };
const bumpSound = () => tone(140, .2, "square", .1, 60);
const lapSound = () => { tone(660, .12, "square", .07); setTimeout(() => tone(990, .2, "square", .07), 110); };
})();
