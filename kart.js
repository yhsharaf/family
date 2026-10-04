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

// Mario Kart style extras placed along the track (i = track point, o = sideways offset from the middle, + is the right side)
const lat = (x, y, i) => { const a = tangent(i); return (x - PTS[i][0]) * -Math.sin(a) + (y - PTS[i][1]) * Math.cos(a); };
const at = (i, o) => { i = ((Math.round(i) % N) + N) % N; const a = tangent(i); return [PTS[i][0] - Math.sin(a) * o, PTS[i][1] + Math.cos(a) * o]; };
const PADS = [
  { t: "boost", i: 36, len: 14, o: 0, w: 60 }, { t: "boost", i: 526, len: 14, o: -26, w: 50 }, { t: "boost", i: 680, len: 14, o: 28, w: 54 },
  { t: "boost", i: 874, len: 14, o: -28, w: 54 },
  { t: "ramp", i: 703, len: 9, o: 0, w: ROAD },
  { t: "rock", i: 150, len: 40, o: 0, w: ROAD }, { t: "rock", i: 578, len: 30, o: 0, w: ROAD },
  { t: "slime", i: 325, len: 8, o: -22, w: 44 }, { t: "slime", i: 455, len: 8, o: 26, w: 44 }, { t: "slime", i: 795, len: 8, o: -28, w: 44 },
  { t: "slime", i: 958, len: 8, o: 22, w: 44 },
];
function padAt(idx, l) {
  for (const p of PADS) { const di = (idx - p.i + N) % N; if (di <= p.len && Math.abs(l - p.o) < p.w / 2) return p; }
  return null;
}
// mesos to collect (each one is a little more top speed, up to 10), pigs wandering across the road, and a stomping King Slime
const COINS = [];
[[60, 95, 5, () => 0], [400, 440, 6, () => -20], [520, 556, 6, () => 25], [648, 676, 5, () => -30], [850, 930, 8, j => (j & 1 ? 26 : -26)]]
  .forEach(([a, b, st, o]) => { for (let i = a, j = 0; i <= b; i += st, j++) { const [x, y] = at(i, o(j)); COINS.push({ x, y, got: false }); } });
const PIGS = [{ i: 262, ph: 0 }, { i: 470, ph: 2 }, { i: 845, ph: 4.2 }];
const KING = { i: 905, T: 3 };
const pigPos = (p, tt) => { const o = Math.sin(tt * 1.25 + p.ph) * (ROAD / 2 + 8), [x, y] = at(p.i, o); return { x, y, dir: Math.cos(tt * 1.25 + p.ph) }; };
const kingPhase = tt => (tt % KING.T) / KING.T;   // 0-.45 up in the air, .45-.55 falling, .55 SLAM, then sitting on the road
const kingZ = ph => ph < .45 ? 150 * Math.sin(Math.min(1, ph / .2) * Math.PI / 2) : ph < .55 ? 150 * (1 - (ph - .45) / .1) : 0;

// the track picture: grass in stripes, flowers, red/white curbs, a dirt road and a chequered start line
const tex = document.createElement("canvas"); tex.width = tex.height = WORLD;
let TEX = null, mini = null;
function paintTrack() {
  const g = tex.getContext("2d");
  g.fillStyle = "#6cc04a"; g.fillRect(0, 0, WORLD, WORLD);
  g.fillStyle = "#5cb03e";                                                     // mowed stripes
  for (let k = -WORLD; k < WORLD * 2; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 32, 0); g.lineTo(k + 32 - WORLD, WORLD); g.lineTo(k - WORLD, WORLD); g.fill(); }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const flowers = ["#ffe066", "#ffffff", "#ff8fb8", "#ffb347"];
  for (let k = 0; k < 2200; k++) { const x = rnd() * WORLD, y = rnd() * WORLD; g.fillStyle = "#3f8a34"; g.fillRect(x + 1, y + 4, 3, 3); g.fillStyle = flowers[k % 4]; g.fillRect(x, y, 5, 5); }
  const path = () => { g.beginPath(); PTS.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
  g.lineJoin = g.lineCap = "round";
  path(); g.strokeStyle = "#2f6e2a"; g.lineWidth = ROAD + CURB * 2 + 8; g.stroke();             // dark edge where grass meets the curb
  path(); g.strokeStyle = "#ffffff"; g.lineWidth = ROAD + CURB * 2; g.stroke();                   // chequered red/white curb
  path(); g.strokeStyle = "#e0453a"; g.setLineDash([16, 16]); g.stroke(); g.setLineDash([]);
  path(); g.strokeStyle = "#6e6558"; g.lineWidth = ROAD + 4; g.stroke();
  path(); g.strokeStyle = "#bdb3a2"; g.lineWidth = ROAD; g.stroke();                             // Henesys cobblestone road
  for (let i = 0; i < N; i++) {          // rows of flat cobbles across the road
    const a = tangent(i), ca = Math.cos(a), sa = Math.sin(a), shift = (i & 1) * 5;
    for (let o = -ROAD / 2 + 4 + shift; o < ROAD / 2 - 4; o += 10) {
      const x = PTS[i][0] - sa * o, y = PTS[i][1] + ca * o, t = rnd();
      g.fillStyle = t < .33 ? "#c9c0b0" : t < .66 ? "#b2a896" : "#a89e8c"; g.fillRect(x - 3.5, y - 3.5, 7, 7);
      if (t > .85) { g.fillStyle = "#d8d0c2"; g.fillRect(x - 3, y - 3, 3, 2); }
    }
  }
  path(); g.strokeStyle = "rgba(255,255,255,.8)"; g.lineWidth = 3; g.setLineDash([20, 28]); g.stroke(); g.setLineDash([]);
  // the extras: boost arrows, jump ramps, rocky patches and slime puddles
  const atf = (i, o) => { const i0 = Math.floor(i), f = i - i0, p = at(i0, o), q = at(i0 + 1, o); return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; };
  const quad = (i, o1, o2, col) => { const a = atf(i, o1), b = atf(i, o2), c = atf(i + .6, o2), d = atf(i + .6, o1);
    g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.fill(); };
  for (const p of PADS) {
    if (p.t === "boost" || p.t === "ramp") for (let j = 0; j <= p.len; j += .5) for (let c = 0; c < 10; c++) {
      const o1 = p.o - p.w / 2 + p.w * c / 10, o2 = o1 + p.w / 10 + .5;
      const chev = ((j * 2 + 40 - Math.abs(c - 4.5) * 1.5) % 6) < 3;   // arrows pointing down the track
      quad(p.i + j, o1, o2, p.t === "boost" ? (chev ? "#ff7a12" : "#ffd84a") : (j < .6 || j > p.len - .6 ? "#1e4f9a" : chev ? "#ffffff" : "#3d8de0"));
    }
    if (p.t === "rock") for (let k = 0; k < p.len * 7; k++) {
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w * .95), z = 8 + rnd() * 9;
      g.fillStyle = "#3e3830"; g.beginPath(); g.ellipse(x + 2, y + 2, z / 2, z * .4, 0, 0, 7); g.fill();
      g.fillStyle = rnd() < .5 ? "#7d7466" : "#696154"; g.beginPath(); g.ellipse(x, y, z / 2, z * .4, 0, 0, 7); g.fill();
      g.fillStyle = "#a59c8c"; g.beginPath(); g.ellipse(x - z * .15, y - z * .12, z * .18, z * .12, 0, 0, 7); g.fill();
    }
    if (p.t === "slime") {
      const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i);
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = "#7c3fa0"; g.beginPath(); g.ellipse(0, 0, p.len * 2.6, p.w / 2, 0, 0, 7); g.fill();
      g.fillStyle = "#b65cd6"; g.beginPath(); g.ellipse(-2, -2, p.len * 2.2, p.w / 2 - 5, 0, 0, 7); g.fill();
      g.fillStyle = "#e3a6f5"; for (const [bx, by, br] of [[-6, -8, 4], [8, 4, 3], [2, -2, 2]]) { g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); }
      g.restore();
    }
  }
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

// roadside things: real Henesys props (trees, mushroom houses, market stalls, hay, sunflowers) and a few monsters.
// s = world units per picture pixel, r = how solid it is
const PROPS = { tree: [.36, 16], bush: [.3, 12], redshrooms: [.42, 10], sunflower: [.45, 6], tallshroom: [.4, 9], stall: [.42, 18], stall2: [.42, 18],
  hay: [.42, 12], haypile: [.38, 16], shroomtower: [.48, 16], shroomhouse: [.5, 18], posts: [.42, 10] };
const MOBS = ["orange_mushroom", "green_mushroom", "blue_mushroom", "snail", "blue_snail", "slime", "pig"];
const IMG = {};
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
function mesoFrames(strip) {   // the real gold meso from MapleStory (Item.wz 09000001), 4 spinning frames side by side
  return [0, 1, 2, 3].map(i => { const c = document.createElement("canvas"); c.width = 26; c.height = 24; c.getContext("2d").drawImage(strip, -i * 26, 0); c.px = true; return c; });
}
let OBJS = [];
function placeObjects() {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const near = ["sunflower", "redshrooms", "bush", "hay", "posts", "tallshroom", "stall", "stall2", "haypile", "tree", "shroomtower", "shroomhouse"];
  OBJS = [];
  for (let s = 20; s < N; s += 26) {
    for (const side of [-1, 1]) {
      if (rnd() < .3) continue;
      const a = tangent(s), off = ROAD / 2 + CURB + 22 + rnd() * 80, x = PTS[s][0] - Math.sin(a) * off * side, y = PTS[s][1] + Math.cos(a) * off * side;
      if (nearest(x, y).d < ROAD / 2 + CURB + 16 || x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) continue;
      if (rnd() < .18) { OBJS.push({ x, y, k: MOBS[Math.floor(rnd() * MOBS.length)], s: .42, r: 10, mob: true }); continue; }
      const k = near[Math.floor(rnd() * near.length)];
      OBJS.push({ x, y, k, s: PROPS[k][0], r: PROPS[k][1] });
    }
  }
  for (let k = 0; k < 170; k++) {   // woods and houses further out
    const x = 30 + rnd() * (WORLD - 60), y = 30 + rnd() * (WORLD - 60), d = nearest(x, y).d;
    if (d < ROAD / 2 + 130) continue;
    const kk = rnd() < .55 ? "tree" : rnd() < .5 ? "bush" : rnd() < .5 ? "shroomhouse" : "shroomtower";
    OBJS.push({ x, y, k: kk, s: PROPS[kk][0] * 1.2, r: PROPS[kk][1] });
  }
}

// ------------------------------------------------------------------ screen
// fixed 320 px wide; the height follows the screen's shape (tall on phones), with the camera raised to match
const W = 320, FOCAL = 170, CAMD = 84;
let H = 192, HOR = 58, CAMH = 30, floor = null, F32 = null, FOG = [], S = 1;
const cv = $k("#kCanvas"), bctx = cv.getContext("2d");
const fxc = $k("#kFx"), ctx = fxc.getContext("2d");   // sky, town, props, karts and the minimap, drawn sharp at screen resolution
function fit() {
  const r = $k(".kt-screen").getBoundingClientRect();
  const h = r.width > 0 ? Math.round(W * r.height / r.width) : 192;
  H = Math.max(130, Math.min(640, h)); HOR = Math.round(H * .27); CAMH = (H * .8 - HOR) * CAMD / FOCAL;
  cv.width = W; cv.height = H; bctx.imageSmoothingEnabled = false;
  floor = bctx.createImageData(W, H - HOR); F32 = new Uint32Array(floor.data.buffer);
  FOG = []; for (let y = 0; y < H - HOR; y++) FOG[y] = y < 8 ? Math.round(150 * (1 - y / 8)) : 0;   // only a thin blend into the horizon
  const dpr = Math.min(2, window.devicePixelRatio || 1), pw = Math.min(1800, Math.round((r.width || W) * dpr));
  fxc.width = pw; fxc.height = Math.round(pw * H / W); S = pw / W;
}
fit();
addEventListener("resize", () => { if (state !== "menu") fit(); });
const OUT = 0xff2e7d32 >>> 0;   // beyond the map edge: dark forest (ABGR)
const HAZE = [214, 236, 255];
let sky = null;

// ------------------------------------------------------------------ rivals and items
// 7 computer racers (real guild members), rows of item boxes, and the MapleStory items: Elixir, 3 Elixirs, Slime drop, Arrow, Zakum's Arm
const RIVAL_COLORS = ["#6eaa64", "#4682be", "#8a6a4a", "#aa64b4", "#3ca0a0", "#e07a12", "#5a64a0"];   // red + gold is yours
const BOXES = [];
[[118, [-42, -14, 14, 42]], [425, [-40, -13, 13, 40]], [772, [-42, -14, 14, 42]]].forEach(([i, os]) => os.forEach(o => { const [x, y] = at(i, o); BOXES.push({ x, y, t: 0 }); }));
function dizzyIcon() {   // a purple swirl with stars
  const c = document.createElement("canvas"); c.width = c.height = 40; const g = c.getContext("2d");
  g.fillStyle = "#7b3fb0"; g.beginPath(); g.arc(20, 20, 17, 0, 7); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath();
  for (let t = 0; t < 14; t += .2) { const r = t * 1.05; g.lineTo(20 + Math.cos(t) * r, 20 + Math.sin(t) * r); } g.stroke();
  g.fillStyle = "#ffd75e"; g.font = "bold 12px sans-serif"; g.fillText("★", 2, 11); g.fillText("★", 28, 38);
  return c.toDataURL();
}
const ITEM_ICON = { elixir: "media/duel/elixir.png", triple: "media/duel/elixir.png", slime: "media/mobs/slime.png", arrow: "media/duel/sk_arrowrain.png", arm: "media/duel/zarm_stand.gif",
  dizzy: dizzyIcon(), splat: "media/mobs/octopus.png" };
const ITEM_NAME = { elixir: "Elixir", triple: "3 Elixirs", slime: "Slime drop", arrow: "Arrow", arm: "Zakum's Arm", dizzy: "Dizzy", splat: "Splat" };
let RIV = [], DROPS = [], SHOTS = [], ARMS = [];
const progOf = r => (r.done ? 1e6 - r.finish : 0) + r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx);
const racers = () => [K, ...RIV];
function rankOf(r) { const p = progOf(r); return 1 + racers().filter(o => o !== r && progOf(o) > p).length; }
function gridSpot(slot) { const row = Math.floor(slot / 2), col = slot % 2, i = N - 6 - row * 9 - col * 3; return { i, o: col ? 24 : -24 }; }
function makeRivals() {
  const pool = [...(typeof D !== "undefined" ? [...D.founders, ...D.members] : [])].map(p => p.name).filter((n, i, a) => n && /^[A-Za-z0-9]{2,13}$/.test(n) && n !== me && a.indexOf(n) === i);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const names = pool.slice(0, 7); while (names.length < 7) names.push(["Orange Mushroom", "Blue Snail", "Slime", "Pig", "Stump", "Green Mushroom", "Ribbon Pig"][names.length]);
  const slots = [0, 1, 2, 3, 5, 6, 7];   // you start 5th on the grid
  RIV = names.map((name, n) => {
    const g = gridSpot(slots[n]), [x, y] = at(g.i, g.o), img = new Image(); img.src = spriteOf(name);
    return { name, img, color: RIVAL_COLORS[n], x, y, a: tangent((g.i + N) % N), v: 0, idx: (g.i + N) % N, lap: 0, cps: 0, prog: 0, done: false, finish: 0,
      lane: g.o, laneT: 1 + Math.random() * 2, skill: 228 + n * 3 + Math.random() * 10, steer: 0, spin: 0, inv: 0, squash: 0, z: 0, vz: 0, boost: 0,
      item: null, itemN: 0, itemT: 0, lastPad: null, kingWas: 0 };
  });
  DROPS = []; SHOTS = []; ARMS = []; BOXES.forEach(b => b.t = 0);
}
let bloopCD = 0, armCD = 0;   // Zakum's Arm: at most one every 20 seconds   // Dizzy/Splat: only one in the whole race every 14 seconds, so they stay special
function rollItem(rank, rival) {
  const b = bloopCD > 0 ? 0 : rival ? .25 : 1;   // rivals get them far less often than you
  const t = (rank <= 2 ? [["slime", 5], ["arrow", 3], ["elixir", 2], ["dizzy", .5 * b]] : rank <= 5 ? [["elixir", 3], ["arrow", 4], ["slime", 2], ["triple", 1], ["dizzy", 1 * b], ["splat", 1 * b]]
    : [["triple", 4], ["arrow", 3], ["arm", armCD > 0 ? 0 : 1.5], ["elixir", 2], ["dizzy", 1 * b], ["splat", 1.5 * b]]).filter(x => x[1] > 0);
  let r = Math.random() * t.reduce((a, b) => a + b[1], 0);
  for (const [k, w] of t) { if ((r -= w) < 0) return k; }
  return "elixir";
}
function hit(r, msg) { if (r === K) spinOut(msg); else if (r.spin <= 0 && r.inv <= 0 && r.z <= 0) { r.spin = .9; r.inv = 1.6; r.boost = 0; } }
function useItem(r) {
  const it = r.item; if (!it) return;
  if (it === "triple") { r.boost = Math.max(r.boost, 1.2); if (--r.itemN <= 0) r.item = null; }
  else r.item = null;
  if (it === "elixir") r.boost = Math.max(r.boost, 1.3);
  if (it === "slime") DROPS.push({ x: r.x - Math.cos(r.a) * 24, y: r.y - Math.sin(r.a) * 24, t: 40, by: r, grace: .5 });
  if (it === "arrow") {
    const p = progOf(r), ahead = racers().filter(o => o !== r && progOf(o) > p && progOf(o) - p < N * .5).sort((a, b) => progOf(a) - progOf(b))[0];
    SHOTS.push({ x: r.x + Math.cos(r.a) * 16, y: r.y + Math.sin(r.a) * 16, a: r.a, v: Math.max(420, r.v + 220), tgt: ahead || null, by: r, life: 3 });
  }
  if (it === "dizzy" || it === "splat") {   // like the Blooper: hits everyone ahead of whoever uses it
    bloopCD = 14;
    const p = progOf(r), from = r === K ? "" : ` from ${r.name}`;
    const hitList = racers().filter(o => o !== r && !o.done && progOf(o) > p && !(o.rescue > 0) && !(o.bloopSafe > 0) && !(o.dizzy > 0) && !(o.ink > 0));
    for (const o of hitList) {
      if (it === "dizzy") o.dizzy = 4; else o.ink = 4;
      o.bloopSafe = 12;   // 4s of effect + 8s safe afterwards
      if (o === K) { if (it === "dizzy") { flash(`😵 Dizzy${from}! Left and right swapped`, 1500); dizzySound(); } else { makeInk(); flash(`🐙 Splat${from}!`, 1000); splatSound(); } }
    }
    if (r === K) flash(hitList.length ? `${it === "dizzy" ? "😵" : "🐙"} Hit ${hitList.length} racer${hitList.length > 1 ? "s" : ""} ahead!` : "Nobody ahead of you!", 1000);
  }
  if (it === "arm") {
    const leader = racers().filter(o => o !== r && !o.done).sort((a, b) => progOf(b) - progOf(a))[0];
    if (leader) { ARMS.push({ tgt: leader, t: 1.3 }); armCD = 20; }
  }
  if (r === K) itemSound();
}
// one computer racer: follows the road in its own lane, dodges slime puddles, keeps races close (rubber band), uses items
function rivalStep(r, dt, tt) {
  if (rescueStep(r, dt)) return;
  const near = nearest(r.x, r.y, r.idx); r.idx = near.i; const off = near.d > ROAD / 2 + CURB * .6, L = lat(r.x, r.y, r.idx);
  if (r.z > 0 || r.vz > 0) { r.vz -= 720 * dt; r.z += r.vz * dt; if (r.z <= 0) { r.z = 0; r.vz = 0; if (Math.random() < .5) r.boost = Math.max(r.boost, .8); } }
  const air = r.z > 0;
  for (const key of ["spin", "inv", "squash", "boost", "itemT", "dizzy", "ink", "bloopSafe", "noItem"]) if (r[key] > 0) r[key] -= dt;
  const lost = near.d > ROAD / 2 + 110 || (r.v < 20 && r.spin <= 0 && r.squash <= 0);
  r.lostT = lost ? (r.lostT || 0) + dt : 0; if (r.lostT > 2.5) { rescue(r); return; }
  if ((r.laneT -= dt) <= 0) { r.lane = (Math.random() - .5) * 76; r.laneT = 1.5 + Math.random() * 3; }
  for (const p of PADS) if (p.t === "slime") { const di = (p.i - r.idx + N) % N; if (di < 45 && Math.abs(r.lane - p.o) < 34) r.lane = p.o > 0 ? p.o - 48 : p.o + 48; }
  for (const d of DROPS) { const dd = Math.hypot(d.x - r.x, d.y - r.y); if (dd < 90 && dd > 20 && Math.random() < .5) { const dl = lat(d.x, d.y, r.idx); if (Math.abs(dl - r.lane) < 26) r.lane = dl > 0 ? dl - 40 : dl + 40; } }
  r.lane = Math.max(-ROAD / 2 + 14, Math.min(ROAD / 2 - 14, r.lane));
  const [tx, ty] = at(r.idx + 14, r.lane); let d = Math.atan2(ty - r.y, tx - r.x) - r.a; d = Math.atan2(Math.sin(d), Math.cos(d));
  if (r.dizzy > 0) d += Math.sin(tt * 4.5 + r.skill) * .9;   // wobbling about
  if (r.ink > 0) d += Math.sin(tt * 2.2 + r.skill * 3) * .35;
  const turn = Math.max(-2.6, Math.min(2.6, d * 4)); r.steer += (Math.sign(turn) * Math.min(1, Math.abs(turn) / 2) - r.steer) * Math.min(1, dt * 8);
  if (r.spin <= 0) r.a += turn * dt * Math.min(1, r.v / 80);
  const gap = (progOf(K) - progOf(r)) / N;   // + when you're ahead of them
  const band = 1 + Math.max(-.13, Math.min(.15, gap * .7));
  const top = r.done ? 140 : (off && !air ? 110 : r.skill * band * (r.dizzy > 0 ? .85 : r.ink > 0 ? .88 : 1)) + (r.boost > 0 ? 90 : 0);
  if (r.spin > 0) r.v *= Math.pow(.3, dt); else r.v += (r.v < top ? (r.v < 120 ? 190 : 110) : -220) * dt;
  r.x += Math.cos(r.a) * r.v * dt; r.y += Math.sin(r.a) * r.v * dt;
  const pad = air ? null : padAt(r.idx, L);
  if (pad && pad !== r.lastPad) {
    if (pad.t === "boost") r.boost = Math.max(r.boost, 1);
    if (pad.t === "ramp" && r.v > 60) { r.vz = 160 + r.v * .22; r.z = .1; }
    if (pad.t === "slime") hit(r);
  }
  r.lastPad = pad;
  for (const p of PIGS) { const q = pigPos(p, tt); if (!air && Math.hypot(r.x - q.x, r.y - q.y) < 17) hit(r); }
  const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0);
  if (r.kingWas < .55 && kp >= .55 && Math.hypot(r.x - kx, r.y - ky) < 36 && !air) { hit(r); r.squash = 1.1; r.v = 0; }
  r.kingWas = kp;
  // items: Elixirs and the Arm right away, a slime when someone is close behind, an arrow when someone is ahead
  if (r.item && r.itemT <= 0 && r.spin <= 0) {
    const p = progOf(r), others = racers().filter(o => o !== r);
    const behind = others.some(o => p - progOf(o) > 0 && p - progOf(o) < 30), ahead = others.some(o => progOf(o) - p > 0 && progOf(o) - p < 120);
    if (["elixir", "triple", "arm"].includes(r.item) || (["dizzy", "splat"].includes(r.item) && (ahead || progOf(K) > p || Math.random() < dt * .1)) || (r.item === "slime" && (behind || Math.random() < dt * .15)) || (r.item === "arrow" && (ahead || Math.random() < dt * .1))) {
      useItem(r); r.itemT = .6; if (!r.item) r.noItem = 6 + Math.random() * 6;
    }
  }
  lapTick(r);
}
function lapTick(r) {   // 4 checkpoints in order, then the start line; true when a lap is done
  const prog = r.idx / N, cp = Math.floor(prog * 4);
  if (cp === (r.cps + 1) % 4 && r.cps < 3) r.cps = cp;
  let done = false;
  if (r.cps === 3 && r.prog > .9 && prog < .1) { r.lap++; r.cps = 0; done = true; if (r !== K && r.lap >= LAPS && !r.done) { r.done = true; r.finish = ++finishers; } }
  r.prog = prog; return done;
}
let finishers = 0;
// everything that moves besides you: rivals, item boxes, slime drops, arrows, Zakum's arm, karts bumping
function worldStep(dt, tt) {
  if (bloopCD > 0) bloopCD -= dt; if (armCD > 0) armCD -= dt;
  for (const r of RIV) rivalStep(r, dt, tt);
  const all = racers();
  for (const b of BOXES) {
    if (b.t > 0) { b.t -= dt; continue; }
    for (const r of all) if (r.z < 22 && Math.hypot(r.x - b.x, r.y - b.y) < 15) {
      b.t = 2.5;
      if (r === K) { if (!K.item && K.roll <= 0) { K.roll = 1.1; K.pending = rollItem(rankOf(K)); boxSound(); } }
      else if (!r.item && !(r.noItem > 0) && Math.random() < .6) { r.item = rollItem(rankOf(r), true); r.itemN = r.item === "triple" ? 3 : 0; r.itemT = 1.5 + Math.random() * 3; }
      break;
    }
  }
  for (let i = DROPS.length - 1; i >= 0; i--) {
    const d = DROPS[i]; d.t -= dt; if (d.grace > 0) d.grace -= dt;
    let gone = d.t <= 0;
    for (const r of all) if (!gone && r.z <= 0 && Math.hypot(r.x - d.x, r.y - d.y) < 15 && !(r === d.by && d.grace > 0)) { hit(r, "🫧 Slimed!"); gone = true; }
    if (gone) DROPS.splice(i, 1);
  }
  for (let i = SHOTS.length - 1; i >= 0; i--) {
    const sh = SHOTS[i]; sh.life -= dt;
    if (sh.tgt) { let d = Math.atan2(sh.tgt.y - sh.y, sh.tgt.x - sh.x) - sh.a; d = Math.atan2(Math.sin(d), Math.cos(d)); sh.a += Math.max(-7, Math.min(7, d * 9)) * dt; }
    sh.x += Math.cos(sh.a) * sh.v * dt; sh.y += Math.sin(sh.a) * sh.v * dt;
    let gone = sh.life <= 0;
    for (const r of all) if (!gone && r !== sh.by && Math.hypot(r.x - sh.x, r.y - sh.y) < 16) { hit(r, "🏹 Arrowed!"); gone = true; if (r !== K && sh.by === K) flash(`🏹 Got ${r.name}!`, 900); }
    if (gone) SHOTS.splice(i, 1);
  }
  for (let i = ARMS.length - 1; i >= 0; i--) {
    const a = ARMS[i]; a.t -= dt;
    if (a.t <= 0) { hit(a.tgt, "🖐️ Zakum's Arm!"); a.tgt.squash = 1; if (a.tgt === K) { K.v = 0; K.shake = .4; } slamSound(0); ARMS.splice(i, 1); }
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {   // karts bump each other
    const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < 15 && Math.abs(a.z - b.z) < 12) {
      const push = (15 - d) / 2, nx = dx / d, ny = dy / d; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      const fast = a.v > b.v ? a : b; fast.v *= .9;
      if (a === K || b === K) { K.shake = Math.max(K.shake, .1); if (K.bump <= 0) { bumpSound(); K.bump = .3; } }
    }
  }
}

// ------------------------------------------------------------------ the race
let me = null, state = "menu", raf = 0, last = 0, keys = {}, touch = { x: 0, d: 0, b: 0, i: 0 };
let K = null, best = null, countAt = 0;
const DEV = location.hostname === "localhost" ? (window.__kart = { auto: false, get K() { return K; }, get RIV() { return RIV; }, PADS, PIGS, KING, at }) : null;
function freshKart() {
  const g = gridSpot(4), i = (g.i + N) % N, a = tangent(i), [x, y] = at(i, g.o);
  return { x, y, a, item: null, itemN: 0, roll: 0, pending: null, v: 0, steer: 0, drift: 0, charge: 0, boost: 0, hop: 0, idx: i, lap: 0, cps: 0,
    t: 0, lapStart: 0, laps: [], wrong: 0, prog: 0, off: false, bump: 0, z: 0, vz: 0, trick: false, flip: 0, spin: 0, inv: 0, squash: 0,
    shake: 0, stall: 0, mesos: 0, held: null, lastPad: null, prevDrift: false, prevItem: false, kingWas: 0 };
}
const fmt = ms => ms == null ? "--" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
const bestKey = () => "kart_best:henesys:" + me;

function input() {
  if (DEV && DEV.auto && K) {   // local testing only: aim at a point further along the track
    const tg = PTS[(K.idx + 18) % N], want = Math.atan2(tg[1] - K.y, tg[0] - K.x);
    let d = want - K.a; d = Math.atan2(Math.sin(d), Math.cos(d));
    return { steer: d > .05 ? 1 : d < -.05 ? -1 : 0, drift: DEV.drift != null ? DEV.drift : false, brake: false, item: !!DEV.item };
  }
  const l = keys.ArrowLeft || keys.a, r = keys.ArrowRight || keys.d;
  return { steer: (r ? 1 : 0) - (l ? 1 : 0) || touch.x, drift: !!(keys[" "] || keys.Shift || touch.d), brake: !!(keys.ArrowDown || keys.s || touch.b),
    item: !!(keys.ArrowUp || keys.w || keys.e || touch.i) };
}
function spinOut(msg) {
  const k = K; if (k.spin > 0 || k.inv > 0 || k.z > 0 || k.rescue > 0) return;
  k.spin = .9; k.inv = 1.9; k.drift = 0; k.charge = 0; k.boost = 0; spinSound();
  const lose = Math.min(3, k.mesos); k.mesos -= lose;   // getting hit drops mesos, like coins in Mario Kart
  for (let i = 0; i < lose; i++) COINFX.push({ x: (Math.random() - .5) * 10, y: 0, vx: (Math.random() - .5) * 90, vy: -120 - Math.random() * 60, t: 1 });
  flash(lose ? `${msg} −${lose} mesos` : msg, 1000);
}
const COINFX = [];
let INK = [];   // 🐙 ink splats on your screen (screen coordinates)
function makeInk() {
  INK = [];
  for (let n = 0; n < 5; n++) {
    const x = W * (.12 + Math.random() * .76), y = H * (.18 + Math.random() * .6), r = H * (.1 + Math.random() * .1), parts = [];
    for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28, d = r * (.6 + Math.random() * .7); parts.push([Math.cos(a) * d, Math.sin(a) * d, r * (.18 + Math.random() * .3)]); }
    const drips = []; for (let i = 0; i < 3; i++) drips.push([(Math.random() - .5) * r * 1.2, r * (.6 + Math.random() * 1.4), r * (.08 + Math.random() * .08)]);
    INK.push({ x, y, r, parts, drips });
  }
}   // mesos flying out of your kart (screen space, relative to the kart)
// 📜 Return Scroll: wrong way, lost far off the road or stuck for a few seconds -> lifted out and put back on the road facing forward
function rescue(r) {
  if (r.rescue > 0) return;
  r.rescue = 1.4; r.rescueAt = (r.idx - 4 + N) % N; r.drift = 0; r.charge = 0; r.boost = 0; r.spin = 0;
  if (r === K) { flash("📜 Return Scroll!", 1200); scrollSound(); }
}
function rescueStep(r, dt) {   // true while being rescued (no driving)
  if (!(r.rescue > 0)) return false;
  const before = r.rescue; r.rescue -= dt; r.v = 0;
  if (before > .7 && r.rescue <= .7) {   // halfway: move to the road
    const [x, y] = at(r.rescueAt, 0); r.x = x; r.y = y; r.a = tangent(r.rescueAt); r.idx = r.rescueAt; r.z = 0; r.vz = 0;
    r.lostT = 0; r.wrong = 0;
  }
  if (r.rescue <= 0) { r.rescue = 0; r.inv = 1; }
  return true;
}
function step(dt) {
  const k = K, inp = input(), racing = state === "race", tt = performance.now() / 1000;
  if (k.dizzy > 0) inp.steer = -inp.steer;   // 😵 left is right and right is left
  for (let i = COINFX.length - 1; i >= 0; i--) { const c = COINFX[i]; c.t -= dt; c.vy += 320 * dt; c.x += c.vx * dt; c.y += c.vy * dt; if (c.t <= 0) COINFX.splice(i, 1); }
  if (rescueStep(k, dt)) { if (racing) { k.t += dt * 1000; worldStep(dt, tt); } return; }
  const near = nearest(k.x, k.y, k.idx); k.idx = near.i; k.off = near.d > ROAD / 2 + CURB * .6;
  if (racing) {
    const lost = near.d > ROAD / 2 + 150 || (k.v < 25 && !inp.brake && k.spin <= 0 && k.stall <= 0 && k.squash <= 0);
    k.lostT = lost ? (k.lostT || 0) + dt : Math.max(0, (k.lostT || 0) - dt);
    if (k.lostT > 2.6 || k.wrong > 3) { rescue(k); return; }
  }
  const L = lat(k.x, k.y, k.idx);
  // in the air (ramps): gravity, and a trick on the way up/down gives a boost when you land
  if (k.z > 0 || k.vz > 0) {
    k.vz -= 720 * dt; k.z += k.vz * dt;
    if (k.z <= 0) { k.z = 0; k.vz = 0; k.hop = .14; if (k.trick) { k.boost = Math.max(k.boost, .9); flash("✨ Trick boost!", 700); boostSound(); } else bumpSound(); k.trick = false; }
  }
  const air = k.z > 0;
  if (air && inp.drift && !k.prevDrift && !k.trick) { k.trick = true; k.flip = .4; hopSound(); }
  k.prevDrift = inp.drift;
  // countdown: hold Drift when the "2" shows for a rocket start (from the "3" is too early)
  if (state === "count") { if (inp.drift) { if (k.held == null) k.held = performance.now() - countAt; } else k.held = null; }
  k.steer += ((k.spin > 0 ? 0 : inp.steer) - k.steer) * Math.min(1, dt * 10);
  // what's under the wheels
  const pad = air ? null : padAt(k.idx, L);
  if (pad && pad !== k.lastPad) {
    if (pad.t === "boost") { k.boost = Math.max(k.boost, 1); padSound(); }
    if (pad.t === "ramp" && k.v > 60) { k.vz = 160 + k.v * .22; k.z = .1; k.drift = 0; jumpSound(); if (!k.tricked) { k.tricked = true; flash("Tap Drift in the air! ✨", 900); } }
    if (pad.t === "slime") spinOut("🫧 Slimed!");
  }
  k.lastPad = pad;
  const rocky = pad && pad.t === "rock" && k.v > 60;
  if (rocky) { k.shake = Math.max(k.shake, .12); if (Math.random() < dt * 9) k.hop = .1; }
  if (!air && !k.off && Math.abs(L) > ROAD / 2 - 2 && k.v > 100) k.shake = Math.max(k.shake, .04);   // rumble on the curbs
  // speed: always accelerating (phone friendly), the brake slows / reverses; mesos raise the top speed a little
  const top = (k.off && !air ? 105 : rocky && k.boost <= 0 ? 185 : 250 + k.mesos * 3) + (k.boost > 0 ? 90 : 0);
  if (!racing || k.spin > 0 || k.stall > 0) k.v *= Math.pow(k.spin > 0 ? .3 : .2, dt);
  else if (inp.brake) k.v = Math.max(-60, k.v - 380 * dt);
  else k.v += (k.v < top ? (k.v < 120 ? 210 : 120) : -260) * dt;
  for (const key of ["boost", "spin", "inv", "squash", "shake", "stall", "flip", "dizzy", "ink", "bloopSafe"]) if (k[key] > 0) k[key] -= dt;
  // items from the boxes: the slot spins like a slot machine for a second, then it's yours to use
  if (k.roll > 0) { k.roll -= dt; if (k.roll <= 0) { k.item = k.pending; k.itemN = k.item === "triple" ? 3 : 0; flash(`${ITEM_NAME[k.item]}!`, 700); } }
  if (racing && inp.item && !k.prevItem && k.item && k.roll <= 0 && k.spin <= 0) useItem(k);
  k.prevItem = inp.item;
  // drifting: hold drift while turning, the longer you hold the bigger the boost when you let go
  if (racing && !air && k.spin <= 0 && inp.drift && !k.drift && Math.abs(inp.steer) > .25 && k.v > 140) { k.drift = Math.sign(inp.steer); k.charge = 0; k.hop = .18; hopSound(); }
  if (k.drift && (!inp.drift || k.v < 90)) {
    if (k.charge > 1.6) { k.boost = 1.1; boostSound(); } else if (k.charge > .75) { k.boost = .6; boostSound(); }
    k.drift = 0; k.charge = 0;
  }
  let turn = k.steer * 2.1 * Math.min(1, Math.abs(k.v) / 110) * (k.v < 0 ? -1 : 1) * (air ? .5 : 1);
  if (k.drift) { turn = (k.drift * 1.55 + k.steer * .9) * Math.min(1, k.v / 110); if (!k.off) k.charge += dt * (1 + Math.abs(k.steer) * .4); }
  k.a += turn * dt;
  let mx = Math.cos(k.a) * k.v, my = Math.sin(k.a) * k.v;
  if (k.drift) { mx += -Math.sin(k.a) * -k.drift * k.v * .16; my += Math.cos(k.a) * -k.drift * k.v * .16; }   // slide outwards a bit
  k.x += mx * dt; k.y += my * dt;
  if (k.hop > 0) k.hop -= dt;
  // the map edge and roadside things push you back
  if (k.x < 20 || k.y < 20 || k.x > WORLD - 20 || k.y > WORLD - 20) { k.x = Math.min(WORLD - 20, Math.max(20, k.x)); k.y = Math.min(WORLD - 20, Math.max(20, k.y)); k.v *= .5; }
  const solid = (ox, oy, r) => {
    const dx = k.x - ox, dy = k.y - oy, d = Math.hypot(dx, dy);
    if (d < r + 7 && d > 0) { k.x = ox + dx / d * (r + 7); k.y = oy + dy / d * (r + 7); if (k.bump <= 0) { k.v *= .35; k.bump = .4; bumpSound(); k.shake = .15; } k.drift = 0; }
  };
  for (const o of OBJS) solid(o.x, o.y, o.r);
  if (k.bump > 0) k.bump -= dt;
  // mesos, pigs and the King Slime
  for (const c of COINS) if (!c.got && k.z < 26 && Math.hypot(k.x - c.x, k.y - c.y) < 16) { c.got = true; k.mesos = Math.min(10, k.mesos + 1); coinSound(); }
  for (const p of PIGS) { const q = pigPos(p, tt); if (!air && Math.hypot(k.x - q.x, k.y - q.y) < 17) spinOut("🐷 Oink!"); }
  const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0), kd = Math.hypot(k.x - kx, k.y - ky);
  if (k.kingWas < .55 && kp >= .55) {   // SLAM
    if (kd < 300) { k.shake = Math.max(k.shake, kd < 120 ? .35 : .15); slamSound(kd); }
    if (kd < 36 && !air && k.inv <= 0) { k.squash = 1.1; k.inv = 0; spinOut("💥 SQUASHED!"); k.v = 0; }
  }
  k.kingWas = kp;
  if (kp >= .55) solid(kx, ky, 26);
  if (!racing) return;
  worldStep(dt, tt);
  // laps: 4 checkpoints in order, then crossing the start line
  k.t += dt * 1000;
  if (lapTick(k)) {
    k.laps.push(k.t - k.lapStart); k.lapStart = k.t; lapSound();
    COINS.forEach(c => c.got = false);   // mesos come back every lap (the 10 max stays)
    if (k.lap >= LAPS) finish();
    else flash(k.lap === LAPS - 1 ? "🏁 FINAL LAP!" : `Lap ${k.lap + 1}`, 1300);
  }
  // wrong way: moving against the track direction for a moment
  const along = Math.cos(k.a - tangent(k.idx)) * k.v;
  k.wrong = along < -20 ? k.wrong + dt : Math.max(0, k.wrong - dt * 2);
}

// ------------------------------------------------------------------ drawing
function render() {
  const k = K, ca = Math.cos(k.a), sa = Math.sin(k.a);
  const cx = k.x - ca * CAMD, cy = k.y - sa * CAMD;
  // sky: Henesys hills and clouds, then the town panorama on the horizon, scrolling as you turn (sharp layer)
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fxc.width, fxc.height); ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#8fd0ff"; ctx.fillRect(0, 0, W, HOR + 1);
  const turn = k.a / (Math.PI * 2);
  if (sky) {
    const sh = HOR + 10, sw = sky.width * sh / sky.height, off = ((turn * sw * 1.2) % sw + sw) % sw, tile = Math.floor(turn * 1.2);
    for (let x = -off, i = 0; x < W; x += sw, i++) {
      if ((tile + i) & 1) { ctx.save(); ctx.translate(x + sw, 0); ctx.scale(-1, 1); ctx.drawImage(sky, 0, HOR + 1 - sh, sw, sh); ctx.restore(); }
      else ctx.drawImage(sky, x, HOR + 1 - sh, sw, sh);
    }
  }
  if (IMG.strip) {
    const st = IMG.strip, sh = Math.min(HOR * .78, H * .2), sw = st.width * sh / st.height, off = ((turn * sw * 1.6) % sw + sw) % sw;
    for (let x = -off; x < W; x += sw) ctx.drawImage(st, x, HOR + 1.5 - sh, sw + .5, sh);
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
  bctx.putImageData(floor, 0, HOR);
  // billboards, far to near: scenery, mesos, pigs and the King Slime (with a shadow when it's up in the air)
  const tt = performance.now() / 1000, vis = [];
  const add = (x, y, im, sc, z, flip, shadow) => {
    const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa;
    if (fz < 8 || fz > 1400 || !im) return;
    const sx = W / 2 + (-rx * sa + ry * ca) * FOCAL / fz;
    if (sx < -120 || sx > W + 120) return;
    vis.push({ im, fz, sx, sc, z, flip, shadow, px: im.px });
  };
  const addDraw = (x, y, draw) => {
    const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa;
    if (fz < 6 || fz > 1300) return;
    const sx = W / 2 + (-rx * sa + ry * ca) * FOCAL / fz;
    if (sx < -80 || sx > W + 80) return;
    vis.push({ fz, sx, draw });
  };
  for (const r of RIV) addDraw(r.x, r.y, (sx, gy, sc, fz) => drawRival(r, sx, gy, sc, fz));
  for (const b of BOXES) if (b.t <= 0) addDraw(b.x, b.y, (sx, gy, sc) => drawBox(sx, gy, sc, tt));
  for (const d of DROPS) add(d.x, d.y, IMG.slime, .32, 0, false, .5);
  for (const sh of SHOTS) addDraw(sh.x, sh.y, (sx, gy, sc) => { const im = IMG.arrowIcon; if (!im) return; const w = 26 * sc; ctx.save(); ctx.translate(sx, gy - 12 * sc);
    ctx.fillStyle = "rgba(255,240,120,.5)"; ctx.beginPath(); ctx.arc(0, 0, w * .6, 0, 7); ctx.fill(); ctx.drawImage(im, -w / 2, -w / 2, w, w); ctx.restore(); });
  for (const a of ARMS) addDraw(a.tgt.x, a.tgt.y, (sx, gy, sc) => { const im = IMG.arm; if (!im) return; const h = 70 * sc, w = h * im.width / im.height, drop = Math.max(0, a.t - .3) / 1;
    ctx.drawImage(im, sx - w / 2, gy - h - drop * 160 * sc, w, h); });
  for (const ob of OBJS) add(ob.x, ob.y, IMG[ob.k], ob.s, 0);
  if (IMG.meso) for (const c of COINS) if (!c.got) add(c.x, c.y, IMG.meso[Math.floor(tt * 8 + c.x * .05) % 4], .55, 6 + Math.sin(tt * 4 + c.x) * 2);
  for (const p of PIGS) { const q = pigPos(p, tt); add(q.x, q.y, IMG.pig, .45, 0, q.dir > 0); }
  const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0), kz = kingZ(kp); add(kx, ky, IMG.king_slime, .5, kz, false, kz > 0 ? 1 - kz / 170 : 0);
  vis.sort((a, b) => b.fz - a.fz);
  let kartDrawn = false;
  for (const v of vis) {
    if (!kartDrawn && v.fz < CAMD) { ctx.globalAlpha = 1; drawKart(k); kartDrawn = true; }   // things between the camera and you go in front of your kart
    if (v.draw) { ctx.globalAlpha = 1; v.draw(v.sx, HOR + CAMH * FOCAL / v.fz, FOCAL / v.fz, v.fz); continue; }
    const { im, fz, sx, z, flip, shadow } = v, sc = FOCAL / fz * v.sc, w = im.width * sc, h = im.height * sc, gy = HOR + CAMH * FOCAL / fz;
    if (w < .6) continue;
    ctx.globalAlpha = fz > 1000 ? Math.max(0, (1400 - fz) / 400) : 1; ctx.imageSmoothingEnabled = !v.px;
    if (shadow) { ctx.fillStyle = `rgba(0,0,0,${.15 + shadow * .3})`; ctx.beginPath(); ctx.ellipse(sx, gy, w * .45 * (.4 + shadow * .6), h * .08 + 1, 0, 0, 7); ctx.fill(); }
    const top = gy - h - z * FOCAL / fz;
    if (flip) { ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(im, -w / 2, top, w, h); ctx.restore(); }
    else ctx.drawImage(im, sx - w / 2, top, w, h);
  }
  ctx.globalAlpha = 1;
  if (!kartDrawn) drawKart(k);
  // 🐙 ink on the screen, fading out at the end
  if (k.ink > 0 && INK.length) {
    ctx.globalAlpha = Math.min(1, k.ink / 1.3) * .94; ctx.fillStyle = "#0b0a12";
    for (const b of INK) {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      for (const [px, py, pr] of b.parts) { ctx.beginPath(); ctx.arc(b.x + px, b.y + py, pr, 0, 7); ctx.fill(); }
      for (const [dx, len, dw] of b.drips) { ctx.fillRect(b.x + dx - dw, b.y, dw * 2, len); ctx.beginPath(); ctx.arc(b.x + dx, b.y + len, dw * 1.4, 0, 7); ctx.fill(); }
      ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.arc(b.x - b.r * .35, b.y - b.r * .35, b.r * .25, 0, 7); ctx.fill(); ctx.fillStyle = "#0b0a12";
    }
    ctx.globalAlpha = 1;
  }
  // minimap
  if (mini) {
    ctx.imageSmoothingEnabled = true;
    const mx = W - 54, my = Math.round(H * .3), s = 50 / 128;
    ctx.globalAlpha = .85; ctx.drawImage(mini, mx, my, 50, 50); ctx.globalAlpha = 1;
    for (const r of RIV) { ctx.fillStyle = r.color; ctx.fillRect(mx + r.x * 128 / WORLD * s - 1.5, my + r.y * 128 / WORLD * s - 1.5, 3, 3); }
    ctx.fillStyle = "#fff"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 3, my + k.y * 128 / WORLD * s - 3, 6, 6);
    ctx.fillStyle = "#c8232c"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 2, my + k.y * 128 / WORLD * s - 2, 4, 4);
  }
}
function drawKart(k) {
  const gy = HOR + CAMH * FOCAL / CAMD, sc = FOCAL / CAMD, x = W / 2 + k.steer * 4;
  const hop = k.hop > 0 ? Math.sin((k.hop / .18) * Math.PI) * 6 : 0, rumble = k.off && k.v > 40 ? (Math.random() - .5) * 2 : 0;
  const y = gy - hop + rumble - k.z * sc * .45, tilt = (k.drift ? k.drift * .16 : 0) + k.steer * .06 + (k.flip > 0 ? (1 - k.flip / .4) * Math.PI * 2 : 0);
  const w = 20 * sc, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(x, gy + 2, w * .55 / (1 + k.z / 80), 4, 0, 0, 7); ctx.fill();
  cv.style.transform = fxc.style.transform = k.shake > 0 ? `translate(${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px, ${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px)` : "";
  // drift sparks and dust
  if (k.drift && k.charge > .2) {
    const col = k.charge > 1.6 ? ["#ff9a2e", "#ffd34d"] : k.charge > .75 ? ["#5ab4ff", "#c8ecff"] : ["#ffffff", "#dddddd"];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = col[i & 1]; const sx = x + (i < 3 ? -1 : 1) * w * .42 + (Math.random() - .5) * 10, sy = y - Math.random() * 8;
      ctx.fillRect(sx, sy, 2, 2); }
  }
  if (k.off && k.v > 60) for (let i = 0; i < 4; i++) { ctx.fillStyle = "rgba(120,90,50,.6)"; ctx.fillRect(x + (Math.random() - .5) * w, y - Math.random() * 6, 3, 3); }
  if (IMG.meso) for (const c of COINFX) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(IMG.meso[Math.floor(c.t * 16) % 4], x + c.x - 6.5, y - 30 + c.y, 13, 12); ctx.restore(); }
  let lift = 0;
  if (k.rescue > 0) { const p = k.rescue > .7 ? (1.4 - k.rescue) / .7 : k.rescue / .7; lift = p * 40; ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("📜", x, y - 60 - lift); }
  ctx.save(); ctx.translate(x, y - lift); ctx.rotate(tilt);
  if (k.spin > 0) ctx.scale(Math.cos((.9 - k.spin) * Math.PI * 4), 1);      // spinning out
  if (k.squash > 0) ctx.scale(1.35, .45);                                   // flattened by the King Slime
  if (k.inv > 0 && k.spin <= 0 && Math.floor(performance.now() / 90) % 2) ctx.globalAlpha = .55;
  const bw = w, bh = w * .42;
  // driver (their picture faces right; mirror it when turning left), sitting in the kart: the body hides their legs
  const sp = IMG.me;
  if (sp) {
    const zoom = Math.max(1, Math.round(H * .2 * S / sp.height)), dh = sp.height * zoom / S, dw = sp.width * zoom / S;
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(0, -bh * .45); if (k.steer < -.3 || k.drift < 0) ctx.scale(-1, 1);
    ctx.drawImage(sp, -dw / 2, -dh, dw, dh); ctx.restore();
  }
  // kart body from behind in the Family colours, red, gold and white like a royal crown: a red body with gold trim,
  // a white stripe, a gold spoiler and a gold crown "F" badge
  ctx.fillStyle = "#1d1d22";
  ctx.fillRect(-bw / 2 - 2, -bh * .55, bw * .22, bh * .75); ctx.fillRect(bw / 2 + 2 - bw * .22, -bh * .55, bw * .22, bh * .75);
  ctx.fillStyle = "#3b3b44"; for (const sx of [-bw / 2 - 2, bw / 2 + 2 - bw * .22]) ctx.fillRect(sx, -bh * .55 + ((t * k.v / 8) % 4), bw * .22, 1.5);
  ctx.fillStyle = "#cd961e"; for (const sx of [-bw / 2 - 2, bw / 2 + 2 - bw * .22]) ctx.fillRect(sx + bw * .07, -bh * .3, bw * .08, bh * .22);   // gold hubs
  ctx.fillStyle = "#7a1418"; rr(-bw * .37, -bh * .82, bw * .74, bh * .68, 4); ctx.fill();          // dark red base
  ctx.fillStyle = "#c8232c"; rr(-bw * .35, -bh * .82, bw * .7, bh * .5, 4); ctx.fill();            // royal red body
  ctx.fillStyle = "#ffffff"; ctx.fillRect(-bw * .35, -bh * .44, bw * .7, 2.2);                      // white stripe
  ctx.fillStyle = "#e8b43a"; ctx.fillRect(-bw * .35, -bh * .44 + 2.2, bw * .7, 1.4);                // gold trim
  ctx.fillStyle = "#b07a12"; ctx.fillRect(-bw * .44, -bh * .9, bw * .88, 3.2);                       // gold spoiler
  ctx.fillStyle = "#ffd75e"; ctx.fillRect(-bw * .44, -bh * .9, bw * .88, 1.4);
  // crown badge with a gold F
  const cy0 = -bh * .62, cw = bh * .5;
  ctx.fillStyle = "#ffd75e"; ctx.strokeStyle = "#7a5200"; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.moveTo(-cw * .55, cy0 - cw * .05); ctx.lineTo(-cw * .55, cy0 - cw * .55); ctx.lineTo(-cw * .28, cy0 - cw * .3); ctx.lineTo(0, cy0 - cw * .68);
  ctx.lineTo(cw * .28, cy0 - cw * .3); ctx.lineTo(cw * .55, cy0 - cw * .55); ctx.lineTo(cw * .55, cy0 - cw * .05); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ffffff"; for (const px of [-cw * .55, 0, cw * .55]) { ctx.beginPath(); ctx.arc(px, cy0 - (px ? cw * .58 : cw * .72), cw * .08, 0, 7); ctx.fill(); }
  ctx.fillStyle = "#ffd75e"; ctx.strokeStyle = "#5a0d10"; ctx.lineWidth = 1.6; ctx.font = `900 ${Math.round(bh * .42)}px Ubuntu, sans-serif`; ctx.textAlign = "center";
  ctx.strokeText("F", 0, cy0 + bh * .33); ctx.fillText("F", 0, cy0 + bh * .33);
  if (k.boost > 0) for (const sx of [-bw * .16, bw * .16]) { ctx.fillStyle = Math.random() < .5 ? "#ffb02e" : "#ff5a2e"; ctx.beginPath();
    ctx.moveTo(sx - 3, -bh * .2); ctx.lineTo(sx + 3, -bh * .2); ctx.lineTo(sx, -bh * .2 + 6 + Math.random() * 6); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha = 1;
  if (k.dizzy > 0) dizzyStars(x, y - lift - w * .42 * .45 - H * .2 - 2, 9, t);
}
// a rival's kart: same shape as yours in their colour, their character picture sharp when close, their name above
function drawRival(r, sx, gy, sc, fz) {
  const w = 17 * sc, bh = w * .42, y = gy - r.z * sc * .45, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(sx, gy + 1, w * .55, Math.max(1, 3 * sc / 2), 0, 0, 7); ctx.fill();
  if (r.rescue > 0) { const p = r.rescue > .7 ? (1.4 - r.rescue) / .7 : r.rescue / .7; ctx.globalAlpha = Math.max(0, 1 - p); }
  ctx.save(); ctx.translate(sx, y); ctx.rotate(r.steer * .06);
  if (r.spin > 0) ctx.scale(Math.cos((.9 - r.spin) * Math.PI * 4), 1);
  if (r.squash > 0) ctx.scale(1.35, .45);
  if (r.inv > 0 && r.spin <= 0 && Math.floor(t * 11) % 2) ctx.globalAlpha = .55;
  if (fz < CAMD * .9) ctx.globalAlpha = Math.min(ctx.globalAlpha, .4);   // right behind you, between you and the camera: see-through so your kart stays visible
  const sp = r.img;
  if (sp && sp.complete && sp.naturalHeight) {
    const dh = (H * .2 / (FOCAL / CAMD)) * sc, dev = dh * S;
    const zoom = dev >= sp.height ? Math.round(dev / sp.height) : 0, h = zoom ? sp.height * zoom / S : dh, ww = sp.width * h / sp.height;
    ctx.save(); ctx.imageSmoothingEnabled = !zoom; ctx.translate(0, -bh * .45); if (r.steer < -.3) ctx.scale(-1, 1);
    ctx.drawImage(sp, -ww / 2, -h, ww, h); ctx.restore();
  }
  ctx.fillStyle = "#1d1d22"; ctx.fillRect(-w / 2 - 1, -bh * .55, w * .22, bh * .75); ctx.fillRect(w / 2 + 1 - w * .22, -bh * .55, w * .22, bh * .75);
  ctx.fillStyle = "#2d2832"; rr(-w * .36, -bh * .8, w * .72, bh * .65, Math.max(1, 3 * sc / 2)); ctx.fill();
  ctx.fillStyle = r.color; rr(-w * .34, -bh * .8, w * .68, bh * .48, Math.max(1, 3 * sc / 2)); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillRect(-w * .34, -bh * .4, w * .68, Math.max(.5, sc));
  if (r.boost > 0) { ctx.fillStyle = Math.random() < .5 ? "#ffb02e" : "#ff5a2e"; ctx.fillRect(-w * .1, -bh * .2, w * .2, bh * .4 + Math.random() * bh * .4); }
  ctx.restore(); ctx.globalAlpha = 1;
  if (r.dizzy > 0) dizzyStars(sx, y - bh * .45 - (H * .2 / (FOCAL / CAMD)) * sc - 4, Math.max(4, 4 * sc), t);
  if (r.ink > 0 && fz < 500) { ctx.fillStyle = "rgba(10,10,18,.75)"; ctx.beginPath(); ctx.arc(sx + w * .1, y - bh * .45 - (H * .2 / (FOCAL / CAMD)) * sc * .7, w * .22, 0, 7); ctx.fill(); }
  if (fz < 420 && fz >= CAMD * .9) {
    ctx.font = `bold ${Math.max(5, Math.min(9, 7 * sc / 2))}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.7)";
    const ny = y - bh * .45 - (H * .2 / (FOCAL / CAMD)) * sc - 2; ctx.strokeText(r.name, sx, ny); ctx.fillStyle = "#fff"; ctx.fillText(r.name, sx, ny);
  }
}
// an item box: a spinning rainbow "?" block
function drawBox(sx, gy, sc, tt) {
  const s2 = 15 * sc, y = gy - s2 - 4 * sc + Math.sin(tt * 3 + sx) * 1.5 * sc, hue = (tt * 120) % 360, sq = Math.abs(Math.cos(tt * 2)) * .3 + .7;
  ctx.save(); ctx.translate(sx, y + s2 / 2); ctx.scale(sq, 1);
  ctx.fillStyle = `hsla(${hue},90%,60%,.85)`; ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(.6, sc * .8);
  rr(-s2 / 2, -s2 / 2, s2, s2, s2 * .18); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.max(4, s2 * .7)}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("?", 0, s2 * .04);
  ctx.textBaseline = "alphabetic"; ctx.restore();
}
function dizzyStars(x, y, size, t) {   // 3 yellow stars circling above a dizzy driver
  ctx.fillStyle = "#ffd75e"; ctx.strokeStyle = "#7a5200"; ctx.lineWidth = .6; ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = "center";
  for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; ctx.strokeText("★", x + Math.cos(a) * size * 1.3, y + Math.sin(a) * size * .4); ctx.fillText("★", x + Math.cos(a) * size * 1.3, y + Math.sin(a) * size * .4); }
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ------------------------------------------------------------------ HUD + flow
function hud() {
  const k = K;
  $k("#kLap").textContent = state === "menu" ? "" : `LAP ${Math.min(k.lap + 1, LAPS)}/${LAPS}`;
  $k("#kTime").textContent = state === "menu" ? "" : fmt(k.t);
  $k("#kBest").textContent = best && best.lap ? `Best ${fmt(best.lap)}` : "";
  $k("#kSpeed").textContent = state === "race" ? `${Math.max(0, Math.round(k.v * .5))} km/h` : "";
  $k("#kWrong").hidden = !(state === "race" && k.wrong > .6);
  const bag = state === "menu" ? "" : `${k.mesos}/10`; if ($k("#kBag").dataset.v !== bag) { $k("#kBag").dataset.v = bag; $k("#kBag").innerHTML = bag ? `<img src="media/kart/meso1.png" alt="">${bag}` : ""; }
  const icon = k.roll > 0 ? ITEM_ICON[Object.keys(ITEM_ICON)[Math.floor(performance.now() / 80) % 7]] : k.item ? ITEM_ICON[k.item] : "";
  const img = $k("#kItemBox img"); if (img.dataset.src !== icon) { img.dataset.src = icon; if (icon) img.src = icon; img.hidden = !icon; }
  $k("#kItemBox").classList.toggle("empty", !k.item && k.roll <= 0);
  $k("#kItemBoxN").textContent = k.item === "triple" ? k.itemN : ""; $k("#kItemBoxN").hidden = k.item !== "triple";
  const pb = $k("#kPad [data-k=i]"); pb.disabled = !k.item || k.roll > 0; const pi = pb.querySelector("img"); if (pi.dataset.src !== icon) { pi.dataset.src = icon; if (icon) pi.src = icon; pi.hidden = !icon; }
  const rk = state === "menu" ? 0 : state === "done" ? K.place : rankOf(k);
  $k("#kPos").textContent = rk ? rk + (["", "st", "nd", "rd"][rk] || "th") : ""; $k("#kPos").className = "kt-pos p" + rk;
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
  const rot = upright(); $k("#kRotate").hidden = !rot; $k("#kFull").hidden = !wantFull();
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
  window.getAC && window.getAC(); fullTries = 0; goLandscape();
  if (!TEX) { $k("#kLoad").hidden = false; await prepare(); $k("#kLoad").hidden = true; }
  IMG.me = await loadImg(spriteOf(me)); fit();
  K = freshKart(); finishers = 0; bloopCD = 0; armCD = 0; makeRivals(); state = "wait"; B.music("henesys"); syncMusicBtn();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  await waitLandscape(); fit(); if (state !== "wait") return; state = "count";
  countAt = performance.now(); COINS.forEach(c => c.got = false);
  for (const [t, d] of [["3", 0], ["2", 1000], ["1", 2000]]) setTimeout(() => { if (state === "count") { flash(t, 900); beep(440); } }, d);
  setTimeout(() => {
    if (state !== "count") return; state = "race"; beep(880);
    const h = K.held;
    if (h != null && h >= 950) { K.boost = 1.2; K.v = 160; flash("🚀 ROCKET START!", 1000); boostSound(); }
    else if (h != null) { K.stall = .9; flash("💨 Too early!", 1000); bumpSound(); }
    else flash("GO!", 900);
    RIV.forEach(r => { if (Math.random() < .35) { r.boost = 1; r.v = 120; } });
  }, 3000);
}
async function prepare() {
  paintTrack(); placeObjects();
  sky = await loadImg(B.M + "bg_henesys.webp?v=9");
  const mstrip = await loadImg("media/kart/meso.png?v=1"); IMG.meso = mstrip ? mesoFrames(mstrip) : null;
  [IMG.arrowIcon, IMG.arm] = await Promise.all([loadImg(B.M + "sk_arrowrain.png"), loadImg(B.M + "zarm_stand.gif")]);
  await Promise.all([...MOBS, "king_slime"].map(async m => { IMG[m] = await loadImg(`media/mobs/${m}.png`); if (IMG[m]) IMG[m].px = true; })
    .concat(Object.keys(PROPS).map(async k => { IMG[k] = await loadImg(`media/kart/${k}.webp?v=1`); }))
    .concat([(async () => { IMG.strip = await loadImg("media/kart/henesys_strip.webp?v=1"); })()]));
}
function finish() {
  const k = K; k.place = 1 + RIV.filter(r => r.done).length; state = "done"; const total = k.laps.reduce((a, b) => a + b, 0), bl = Math.min(...k.laps);
  const newRace = !best || !best.race || total < best.race, newLap = !best || !best.lap || bl < best.lap;
  best = { race: newRace ? total : best.race, lap: newLap ? bl : best.lap }; store.set(bestKey(), JSON.stringify(best));
  B.sound(k.place <= 3 ? "win" : "lose"); flash(k.place === 1 ? "🏆 1st PLACE!" : "🏁 FINISH!", 1600);
  const sent = guildOf(me) ? submit(k.laps) : Promise.resolve(null);
  setTimeout(() => {
    const medal = ["", "🥇", "🥈", "🥉"][k.place] || "🏁", suffix = ["", "st", "nd", "rd"][k.place] || "th";
    $k("#kResult").innerHTML = `<h3>${medal} ${k.place}${suffix} place · ${fmt(total)}</h3>
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
const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Shift", "a", "d", "s", "w", "e"];
addEventListener("keydown", e => { if (state === "menu" || !GAME_KEYS.includes(e.key)) return; keys[e.key] = true; e.preventDefault(); });
addEventListener("keyup", e => { keys[e.key] = false; });
addEventListener("blur", () => { keys = {}; touch = { x: 0, d: 0, b: 0, i: 0 }; stickSet(0); });
document.querySelectorAll("#kPad [data-k]").forEach(b => {
  const on = v => e => { e.preventDefault(); touch[b.dataset.k] = v; b.classList.toggle("on", !!v); };
  b.addEventListener("pointerdown", e => { try { b.setPointerCapture(e.pointerId); } catch (er) {} on(1)(e); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => b.addEventListener(ev, on(0)));
  b.addEventListener("contextmenu", e => e.preventDefault());
});
// steering joystick: slide your thumb left or right; the further you slide, the harder you turn
const stick = $k("#kStick"), knob = stick.querySelector("i");
let stickId = null, stickX0 = 0;
function stickSet(v) { touch.x = Math.abs(v) < .12 ? 0 : v; knob.style.transform = `translateX(${v * stick.clientWidth * .32}px)`; }
stick.addEventListener("pointerdown", e => {
  e.preventDefault(); stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (er) {}
  const r = stick.getBoundingClientRect(); stickX0 = r.left + r.width / 2; stick.classList.add("on"); stickMove(e);
});
function stickMove(e) {
  if (e.pointerId !== stickId) return;
  const v = (e.clientX - stickX0) / (stick.clientWidth * .32);
  stickSet(Math.max(-1, Math.min(1, v)));
}
stick.addEventListener("pointermove", stickMove);
const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; stick.classList.remove("on"); stickSet(0); };
["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => stick.addEventListener(ev, stickEnd));
stick.addEventListener("contextmenu", e => e.preventDefault());
// after turning the phone sideways, the first touch goes fullscreen (browsers only allow it right after a tap)
let fullTries = 0;
const wantFull = () => TOUCH && state !== "menu" && !upright() && !document.fullscreenElement && !!document.documentElement.requestFullscreen && fullTries < 3;
["pointerup", "touchend"].forEach(ev => $k("#kGame").addEventListener(ev, () => { if (wantFull()) { fullTries++; goLandscape(); } }, true));

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
const coinSound = () => { tone(1320, .07, "square", .05); setTimeout(() => tone(1760, .12, "square", .05), 60); };
const padSound = () => tone(330, .3, "sawtooth", .06, 990);
const jumpSound = () => tone(200, .3, "triangle", .1, 700);
const itemSound = () => { tone(520, .1, "square", .06); setTimeout(() => tone(780, .25, "sawtooth", .06, 1200), 80); };
const spinSound = () => { for (let i = 0; i < 4; i++) setTimeout(() => tone(600 - i * 90, .12, "square", .06, 300 - i * 50), i * 110); };
const slamSound = d => tone(90, .5, "square", Math.max(.03, .16 - d / 2500), 35);
const boxSound = () => { for (let i = 0; i < 8; i++) setTimeout(() => tone(700 + (i % 3) * 180, .06, "square", .04), i * 120); };
const scrollSound = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .14, "triangle", .07), i * 90)); };
const dizzySound = () => { for (let i = 0; i < 6; i++) setTimeout(() => tone(i % 2 ? 520 : 390, .14, "sine", .07), i * 110); };
const splatSound = () => { tone(180, .25, "square", .09, 50); tone(90, .35, "sawtooth", .06, 40); };
const lapSound = () => { tone(660, .12, "square", .07); setTimeout(() => tone(990, .2, "square", .07), 110); };
})();
