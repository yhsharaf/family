// Family Kart: a time-trial racer drawn the way the SNES Mario Kart did it ("Mode 7"): a flat track picture is tilted into
// a 3D-looking floor one screen row at a time, and the karts, monsters and trees are flat pictures (billboards) on top.
// Step 1 of the plan: one track (Henesys), your character in a kart, drifting with mini-boosts, 3 laps and best times.
(() => {
const $k = s => document.querySelector(s);
const B = window.BD; if (!B || !$k("#kart")) return;
const { esc, store, spriteOf, guildOf } = B;

// ------------------------------------------------------------------ tracks
// Three Henesys tracks (the Henesys Cup). Each one has its own loop, theme, hazards and props; loadTrack() switches between them.
const TW = 2048, CURB = 14, VMAX = 270;
let WORLD = TW, WS = 1;   // the world's size in units, and its scale: each track can be bigger (T.scale) so laps last 35-45 s. Its pictures stay TW pixels wide   // base top speed
let ROAD = 160;   // road width: ~8 karts; a track can set its own (Henesys Circuit: 200, ~10 karts like Mario Kart Tour's Mario Circuit)
let LAPS = 3;   // 1 on the Zakum runs (one long climb, no laps)
// closed Catmull-Rom spline -> evenly spaced points every ~4 world units
function loopPts(ctrl) {
  const raw = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [ctrl[(i + n - 1) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
    for (let t = 0, st = 1 / Math.max(60, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5)); t < 1; t += st) {   // (fine steps, so the points come out evenly spaced even on long segments)
      const t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push(p1.length > 2 ? [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])] : [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const out = [raw[0]]; let acc = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += d;
    if (acc >= 5.4) { out.push(b); acc = 0; }
  }
  return out;
}
// an open spline through c (the first and last points only steer the ends), every ~5 units
function pathPts(c) {
  const raw = [];
  for (let i = 1; i < c.length - 2; i++) {
    const [p0, p1, p2, p3] = [c[i - 1], c[i], c[i + 1], c[i + 2]];
    for (let t = 0; t < 1; t += 1 / 80) {
      const t2 = t * t, t3 = t2 * t, f = (a, b, cc, d) => .5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push(c[c.length - 2]);
  const out = [raw[0]]; let acc = 0;
  for (let i = 1; i < raw.length; i++) { acc += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); if (acc >= 5) { out.push(raw[i]); acc = 0; } }
  return out;
}
// an open path through every control point (the Zakum runs), points every ~4 units like the loops
function openPts(c) {
  const ext = (a, b) => a.map((v, k) => 2 * v - b[k]), e = [ext(c[0], c[1]), ...c, ext(c[c.length - 1], c[c.length - 2])];   // (keeps the heights, if the track has them)
  const raw = [];
  for (let i = 1; i < e.length - 2; i++) {
    const [p0, p1, p2, p3] = [e[i - 1], e[i], e[i + 1], e[i + 2]];
    for (let t = 0, st = 1 / Math.max(80, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5)); t < 1; t += st) {
      const t2 = t * t, t3 = t2 * t, f = (a, b, cc, d) => .5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      raw.push(p1.length > 2 ? [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])] : [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push(e[e.length - 2]);
  const out = [raw[0]]; let acc = 0;
  for (let i = 1; i < raw.length; i++) { acc += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); if (acc >= 5.4) { out.push(raw[i]); acc = 0; } }
  return out;
}
// the current track (loadTrack fills these in)
let GAPS = [], MOLES = [], HEDGES = [], CHOMPS = [], WANDER = [], BUILDINGS = [], HOLES = [], RINGS = [], PLANE = null, THWOMPS = [], CARTS = [], LEDGES = [], FIREBALLS = [], GEARS = [], HANDS = [], PENDS = [];
// 🕰️ the clockwork: a hand's angle, a pendulum's bob (swinging across the road), a gear's turn
const handAng = (h, now) => h.ph + now * h.sp;
const pendAt = (p, now) => { const s = Math.sin(now * p.sp + p.ph), [x, y] = [p.base[0] - Math.sin(p.a) * s * p.amp, p.base[1] + Math.cos(p.a) * s * p.amp]; return { x, y, s }; };
// 🔥 a fireball from the volcano: unseen high up, then it drops onto its spot and bursts
const fireZ = (f, now) => { const p = ((now + f.ph) % f.T) / f.T; return p < .72 ? -1 : p < .9 ? 700 * (1 - (p - .72) / .18) : -1; };
// 🛒 a mine cart rolls along the rails in its stretch of track, over and over
const cartAt = (c, now) => { const span = c.b - c.a, f = ((now * c.sp / SPC + c.ph) % span + span) % span, i = c.a + f, [x, y] = at(i, c.o || 0); return { x, y, a: tangent(Math.round(i)), i }; };
// 🗿 a Thwomp: up high, then it slams down, sits a moment and rises again (the same clock for everyone)
const thwompZ = (t, now) => { const p = ((now + t.ph) % t.T) / t.T; return p < .5 ? 150 : p < .58 ? 150 * (1 - (p - .5) / .08) : p < .8 ? 0 : 150 * (p - .8) / .2; };   // (Pets Park: solid hedge blocks, pets on chains, pets wandering the gardens)
// 🐾 the pets from maplestory.io (media/kart/pets): how many frames each animation has
const PETF = { husky: { move: 3, stand0: 3, jump: 1 }, blackpig: { move: 3, stand0: 3, jump: 1 }, jrbalrog: { move: 4, stand0: 3, jump: 1 }, whitetiger: { move: 3, stand0: 4, jump: 1 },
  pinkbunny: { move: 4, stand0: 3, jump: 1 }, whitebunny: { move: 4, stand0: 3, jump: 1 }, blackbunny: { move: 4, stand0: 3, jump: 1 }, kitty: { move: 3, stand0: 3, jump: 1 },
  puppy: { move: 3, stand0: 3, jump: 1 }, panda: { move: 3, stand0: 3, jump: 1 }, dino: { move: 5, stand0: 3, jump: 1 }, penguin: { move: 5, stand0: 3, jump: 2 },
  elephant: { move: 6, stand0: 4, jump: 1 }, babydragon: { move: 4, stand0: 4, jump: 3 }, porcupine: { move: 3, stand0: 4, jump: 1 }, snowman: { move: 6, stand0: 4, jump: 1 }, monkey: { move: 3, stand0: 4, jump: 1 } };
const petFrame = (k, act, tt, fps = 7) => IMG[`pet_${k}_${act}${Math.floor(tt * fps) % ((PETF[k] || {})[act] || 1)}`];   // 🍄 mushroom-platform crossings: { a, b (track points with no road), kind: "gorge" | "water", caps: [{ x, y, r, col }] }
let FINALMSG = null, AREAS = [], SPORES = [], areaAt = -1, OPEN = false, SPC = 6.6, START_I = 0, MECH = null, LAVA = null, PIDX = null, LAVAT = null, T = null, TRACK_KEY = null, TRACK_ID = "henesys2", PTS = [], N = 1, FORK_A = -1e9, FORK_B = -1e9, ALT = [], AN = 0, ALT_ROAD = 92, ALT_STYLE = "cobble",
  ALTPADS = [], PEN = null, PADS = [], COINS = [], PIGS = [], KING = null, PENPIGS = [], BOXES = [], TUNNEL = null, LAKE = null, CAVES = [], BARE = [], STREAMS = [], LEAVES = [], PLANKS = [], CHUTES = [], HIDE = [];
const tangent = i => { const a = OPEN ? PTS[Math.max(0, i - 2)] : PTS[(i + N - 2) % N], b = OPEN ? PTS[Math.min(N - 1, i + 2)] : PTS[(i + 2) % N]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
function nearest(x, y, guess) {   // nearest track point, searching around the last one (or everywhere)
  let best = -1, bd = 1e12;
  const scan = (from, to) => { for (let k = from; k <= to; k++) { const i = (k + N) % N, dx = PTS[i][0] - x, dy = PTS[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } };
  if (guess == null) scan(0, N - 1); else if (OPEN) scan(Math.max(0, guess - 40), Math.min(N - 1, guess + 40)); else scan(guess - 40, guess + 40);
  return { i: best, d: Math.sqrt(bd) };
}
const I = (x, y) => nearest(x * WS, y * WS).i;                    // the track point nearest a spot on the (2048-wide) layout map
const ws = v => v * WS;                                            // a spot on the layout map, in world units
// Mario Kart style extras placed along the track (i = track point, o = sideways offset from the middle, + is the right side)
const lat = (x, y, i) => { const a = tangent(i); return (x - PTS[i][0]) * -Math.sin(a) + (y - PTS[i][1]) * Math.cos(a); };
const at = (i, o) => { i = OPEN ? Math.max(0, Math.min(N - 1, Math.round(i))) : ((Math.round(i) % N) + N) % N; const a = tangent(i); return [PTS[i][0] - Math.sin(a) * o, PTS[i][1] + Math.cos(a) * o]; };
// a fork (Henesys market path, the forest bridge): ALT is the second road between main points FORK_A and FORK_B
const altTan = j => { const a = ALT[Math.max(0, j - 2)], b = ALT[Math.min(AN - 1, j + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
const altIdx = j => Math.round(FORK_A + (FORK_B - FORK_A) * j / (AN - 1));   // where you are on the second road, as a main-road point (laps, positions)
const altAt = (j, o) => { j = Math.max(0, Math.min(AN - 1, Math.round(j))); const a = altTan(j); return [ALT[j][0] - Math.sin(a) * o, ALT[j][1] + Math.cos(a) * o]; };
function nearAlt(x, y) { let best = 0, bd = 1e12; for (let j = 0; j < AN; j++) { const dx = ALT[j][0] - x, dy = ALT[j][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } } return { j: best, d: Math.sqrt(bd) }; }
// which road you're on: the main loop, or the second road when you're on it (or nearer to it)
function nav(x, y, guess) {
  const m = nearest(x, y, guess);
  if (!AN) return { i: m.i, d: m.d, alt: false, half: ROAD / 2 };   // (a short cut can pass near any part of the road, so always check it)
  const a = nearAlt(x, y);
  if (a.d < m.d && a.j > 0 && a.j < AN - 1) return { i: altIdx(a.j), d: a.d, alt: true, j: a.j, half: ALT_ROAD / 2 };
  return { i: m.i, d: m.d, alt: false, half: ROAD / 2 };
}
const offAlt = (x, y, m) => !AN || nearAlt(x, y).d > ALT_ROAD / 2 + CURB + m;   // (off the second road too, if there is one)
const roadDist = (x, y) => Math.min(nearest(x, y).d, AN ? nearAlt(x, y).d : 1e9);
// sideways offset and the pad under you, on whichever road you're on
function under(nv, x, y) {
  if (!nv.alt) { const L = lat(x, y, nv.i); return { L, pad: padAt(nv.i, L) }; }
  const a = altTan(nv.j), L = (x - ALT[nv.j][0]) * -Math.sin(a) + (y - ALT[nv.j][1]) * Math.cos(a);
  for (const p of ALTPADS) { const dj = nv.j - p.j * (AN - 1); if (dj >= 0 && dj <= p.len && Math.abs(L - p.o) < p.w / 2) return { L, pad: p }; }
  return { L, pad: null };
}
const inPen = (idx, L) => !!PEN && idx >= PEN.a && idx <= PEN.b && Math.abs(L) < ROAD / 2 + 4;
const inLake = (x, y) => !!LAKE && ((x - LAKE.cx) / LAKE.rx) ** 2 + ((y - LAKE.cy) / LAKE.ry) ** 2 < 1;
const lakeFall = () => !!LAKE && LAKE.kind !== "ice" && LAKE.kind !== "shallow" && LAKE.kind !== "clock" && LAKE.kind !== "fountain";   // the frozen lake is safe to drive on (just slippery)
const onRink = (x, y) => (!!LAKE && (LAKE.kind === "ice" || LAKE.kind === "shallow" || LAKE.kind === "clock") && inLake(x, y)) || GEARS.some(g => Math.hypot(x - g.x, y - g.y) < g.r);   // (a clock face or a turning gear too)   // ⛸ a frozen rink (or a shallow pond): all of it is road
function padAt(idx, l) {
  for (const p of PADS) { const di = OPEN ? idx - p.i : (idx - p.i + N) % N; if (di >= 0 && di <= p.len && Math.abs(l - p.o) < p.w / 2) return p; }
  return null;
}
function penPigPos(p, tt) {
  const i = PEN.a + (PEN.b - PEN.a) * (p.f + Math.sin(tt * .5 + p.ph) * .06), [x, y] = at(i, p.o + Math.sin(tt * .9 + p.ph * 2) * 18);
  return { x: x + p.dx, y: y + p.dy, dir: Math.cos(tt * .9 + p.ph * 2) };
}
// road crossers: pigs (Henesys Loop), snails (Town Run, slow), mushrooms that hop (Mushroom Forest)
const pigPos = (p, tt) => { const sp = p.sp || 1.25, o = Math.sin(tt * sp + p.ph) * (p.amp || ROAD / 2 + 8), [x, y] = at(p.i + (p.loop ? Math.cos(tt * sp + p.ph) * p.loop : 0), o);   // (loop: skating round in a ring)
  return { x, y, dir: Math.cos(tt * sp + p.ph), z: p.hop ? Math.abs(Math.sin(tt * 5 + p.ph)) * 16 : 0 }; };
function areaSign(name) {
  const c = document.createElement("canvas"); c.width = 300; c.height = 190; const g = c.getContext("2d"), txt = name.replace(/^\S+\s/, "");
  g.fillStyle = "#6b4426"; g.fillRect(52, 70, 18, 120); g.fillRect(230, 70, 18, 120);   // posts
  g.fillStyle = "#4a2c14"; g.fillRect(64, 70, 6, 120); g.fillRect(242, 70, 6, 120);
  const gr = g.createLinearGradient(0, 18, 0, 108); gr.addColorStop(0, "#c98a4e"); gr.addColorStop(1, "#8a5428"); g.fillStyle = gr; g.strokeStyle = "#4a2c14"; g.lineWidth = 6;
  g.beginPath(); g.roundRect(14, 18, 272, 92, 18); g.fill(); g.stroke();
  g.strokeStyle = "rgba(74,44,20,.35)"; g.lineWidth = 2; for (const y of [44, 70, 92]) { g.beginPath(); g.moveTo(26, y); g.lineTo(274, y); g.stroke(); }   // planks
  for (const [x, y] of [[30, 32], [270, 32], [30, 96], [270, 96]]) { g.fillStyle = "#3a2410"; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }   // nails
  g.font = "900 " + (txt.length > 14 ? 30 : 36) + "px Ubuntu, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 7; g.strokeStyle = "#3a2008"; g.strokeText(txt, 150, 66); g.fillStyle = "#fff4d6"; g.fillText(txt, 150, 66);
  g.fillStyle = "#e8452c"; g.beginPath(); g.ellipse(150, 14, 26, 15, 0, Math.PI, 0); g.fill(); g.fillStyle = "#fff"; for (const dx of [-12, 4, 14]) { g.beginPath(); g.arc(150 + dx, 8 + Math.abs(dx) * .2, 3.5, 0, 7); g.fill(); }   // a little toadstool on top
  g.fillStyle = "#f6e8c4"; g.fillRect(143, 14, 14, 6);
  return c;
}
const lapNow = () => (K ? Math.min(LAPS, K.lap + 1) : 1);   // the lap you're on (some things only come out on the last one)
const kingPhase = tt => (tt % KING.T) / KING.T;   // 0-.45 up in the air, .45-.55 falling, .55 SLAM, then sitting on the road
const kingZ = ph => ph < .45 ? 150 * Math.sin(Math.min(1, ph / .2) * Math.PI / 2) : ph < .55 ? 150 * (1 - (ph - .45) / .1) : 0;
const coinRow = (a, b, st, o) => { const out = []; for (let i = a, j = 0; i <= b; i += st, j++) { const [x, y] = at(i, typeof o === "function" ? o(j) : o); out.push({ x, y, z: 0, got: false }); } return out; };
const boxRow = (i, os) => os.map(o => { const [x, y] = at(i, o); return { x, y, t: 0, i, o }; });
const PROPS_ALL = ["tree", "bush", "redshrooms", "sunflower", "tallshroom", "stall", "stall2", "hay", "haypile", "shroomtower", "shroomhouse", "posts", "treehouse"];

const OPEN_ZK1 = [[230, 1900], [1025, 1865], [1820, 1900], [1820, 1600], [1025, 1635], [230, 1600], [230, 1300], [1025, 1265], [1820, 1300], [1820, 1000], [1025, 1035], [230, 1000], [230, 700], [1025, 665], [1820, 700], [1820, 400], [1025, 435], [230, 400], [230, 120], [1025, 85], [1820, 120]];
const OPEN_ZK2 = [[200, 1880], [1000, 1890], [1850, 1860], [1880, 1000], [1850, 190], [1000, 170], [190, 200], [180, 900], [230, 1590], [1000, 1610], [1580, 1580], [1600, 1000], [1570, 480], [1000, 460], [480, 490], [470, 1000], [520, 1310], [1000, 1330], [1300, 1290], [1310, 1000], [1270, 760], [1000, 760]];
const OPEN_ZK3 = [[1850, 1900], [1000, 1820], [180, 1720], [180, 1460], [1000, 1560], [1860, 1640], [1860, 1380], [1000, 1300], [180, 1200], [180, 940], [1000, 1040], [1860, 1120], [1860, 860], [1000, 780], [180, 680], [180, 420], [1000, 520], [1860, 600], [1860, 340], [1000, 260], [300, 140]];
// looks for each place: ground colours (stripes, or a chequered toy floor), sprinkles, road surface, curb colours, sky and the colour past the map edge
const TH = {
  henesys: { grass: ["#6cc04a", "#5cb03e"], flowers: 2200, road: "cobble" },
  elnath: { grass: ["#e9f1fb", "#dde8f6"], flowers: 900, flowerCols: ["#ffffff", "#cfe3ff", "#b8d4f5", "#ffffff"], stem: null, road: "snow", curb: ["#2f6fb8", "#f4f8ff"], border: "#6f86a8",
    sky: "#b9c8e6", out: "#cfdcee", haze: [225, 236, 252], line: "rgba(70,110,190,.6)", dust: "235,242,255", snow: 1 },
  elnathNight: { grass: ["#b9c8de", "#adbdd6"], flowers: 700, flowerCols: ["#ffffff", "#dfe9ff", "#c6d8f5", "#ffffff"], stem: null, road: "snow", curb: ["#3a4f9a", "#dfe7f6"], border: "#4c5f80",
    sky: "#16224f", out: "#7f8fb0", haze: [70, 90, 140], line: "rgba(200,220,255,.55)", dust: "210,222,245", snow: 2, night: .25 },
  sleepy: { grass: ["#2f4a2a", "#2a4326"], flowers: 1600, flowerCols: ["#b07cff", "#6fd0ff", "#ffe08a", "#ff8fd0"], stem: "#1e3319", road: "moss", curb: ["#5a3d22", "#c9b48a"], border: "#1d2a18",
    sky: "#24331f", out: "#1d2a18", haze: [40, 58, 40], line: "rgba(230,220,170,.5)", dust: "60,70,40" },
  swamp: { grass: ["#33503f", "#2c4737"], flowers: 900, flowerCols: ["#9fe0a0", "#6fd0ff", "#d0ff8a", "#ffffff"], stem: "#20362a", road: "moss", curb: ["#4a5a3a", "#a8b88a"], border: "#1a2a20",
    sky: "#2c4a44", out: "#1e3328", haze: [50, 80, 70], line: "rgba(220,230,190,.45)", dust: "60,80,60" },
  temple: { grass: ["#3a3324", "#332d20"], flowers: 700, flowerCols: ["#ffcf5a", "#ff8a3a", "#b07cff", "#ffe08a"], stem: "#2a2418", road: "ruin", curb: ["#8a1418", "#d8c08a"], border: "#1a140c",
    sky: "#120c06", out: "#1a140c", haze: [40, 30, 14], line: "rgba(255,210,120,.45)", dust: "90,70,40" },
  mine: { grass: ["#3d3f44", "#36383d"], flowers: 500, flowerCols: ["#ff8a3a", "#ffb02e", "#8a8d96", "#6a6d76"], stem: null, road: "basalt", curb: ["#c8a23a", "#2a2a30"], border: "#18181c",
    sky: "#2a2c32", out: "#26272c", haze: [60, 60, 66], line: "rgba(255,200,90,.5)", dust: "90,90,95" },
  molten: { grass: ["#3a2a26", "#33241f"], flowers: 1400, flowerCols: ["#ff6a1e", "#ffb02e", "#c8232c", "#ff8a3a"], stem: null, road: "basalt", curb: ["#c8232c", "#1d1d22"], border: "#140c0a",
    sky: "#3a0d06", out: "#3a1208", haze: [120, 40, 20], line: "rgba(255,150,60,.55)", dust: "90,50,40", cracks: 1 },
  altar: { grass: ["#4a2c22", "#42271e"], flowers: 1000, flowerCols: ["#ff6a1e", "#ffb02e", "#ffd75e", "#ff8a3a"], stem: null, road: "ruin", curb: ["#c8232c", "#e8b43a"], border: "#1e0e08",
    sky: "#5a1a0a", out: "#3a1208", haze: [150, 60, 30], line: "rgba(255,190,90,.55)", dust: "110,60,40", cracks: 1 },
  ludi: { grass: ["#cfe9ff", "#ffe0f0"], checker: 1, flowers: 500, flowerCols: ["#ff5a8a", "#ffd23f", "#5ac8ff", "#8aff7a"], stem: null, road: "toy", curb: ["#ffd23f", "#3d8de0"], border: "#6b4fa0",
    sky: "#7fb6ff", out: "#9fc8ff", haze: [190, 220, 255], line: "rgba(255,255,255,.8)", dust: "200,180,230" },
  factory: { grass: ["#ffe7a6", "#ffd36b"], checker: 1, flowers: 300, flowerCols: ["#ff5a5a", "#5a8aff", "#5aff8a", "#ffffff"], stem: null, road: "toy", curb: ["#ff5a2e", "#ffffff"], border: "#8a5a10",
    sky: "#5a8ae0", out: "#e8c060", haze: [200, 220, 250], line: "rgba(255,255,255,.8)", dust: "220,200,140" },
  clock: { grass: ["#6a5aa0", "#5a4b8e"], checker: 1, flowers: 900, flowerCols: ["#ffffff", "#ffe08a", "#c8b0ff", "#8ad0ff"], stem: null, road: "toy", curb: ["#ffd23f", "#6b2fa0"], border: "#2a1650",
    sky: "#2a1650", out: "#3a2a6a", haze: [90, 60, 140], line: "rgba(255,240,200,.7)", dust: "150,130,200", night: .15 },
};
// a pad on the road: t type, i track point, o sideways offset, w width, len length in track points
const pad = (t, i, o, w, len = 14) => ({ t, i, len, o, w });
const big = (k, m) => PROPS[k][0] * m;
// the Zakum runs share a layout recipe: boosts, ramps, rocks, lava pools, monsters crossing and item boxes spread along one long climb
function zakumBuild(F, o) {
  const pads = [], coins = [], pigs = [], boxes = [];
  for (let f = .06, n = 0; f < .97; f += .075, n++) pads.push(pad("boost", F(f), [0, -28, 28][n % 3], 54, 12));
  for (const f of [.27, .58, .86]) pads.push(pad("ramp", F(f), 0, ROAD, 9));
  for (const f of [.17, .44, .72]) pads.push(pad("rock", F(f), 0, ROAD, 22));
  if (o.lava) for (const [f, off] of [[.12, -44], [.34, 44], [.5, -44], [.66, 44], [.8, -44], [.93, 44]]) pads.push(pad("lava", F(f), off, 56, 10));
  for (const f of [.22, .4, .63, .9]) pads.push(pad("slime", F(f), f * 10 & 1 ? 52 : -52, 40, 8));
  for (let f = .03; f < .97; f += .1) coins.push(...coinRow(F(f), F(f + .025), 6, 0));
  [.15, .31, .47, .69, .83].forEach((f, n) => pigs.push({ i: F(f), ph: n * 1.3, k: o.cross[n % o.cross.length], sp: 1.1, hop: !!o.hop && n % 2 === 0 }));
  for (const f of [.08, .2, .33, .46, .6, .74, .88]) boxes.push(...boxRow(F(f), [-56, -19, 19, 56]));
  return {
    pads, coins, pigs, boxes, king: o.king ? { i: F(.54), T: 3.1, k: o.king.k, s: o.king.s, name: o.king.name } : null,
    extra(push) {
      for (let f = .02; f < .98; f += .022) { const [x, y] = at(F(f), (Math.round(f * 1000) & 1 ? 1 : -1) * (ROAD / 2 + CURB + 12)); push(x, y, o.edge[Math.round(f * 500) % o.edge.length]); }
      const [gx, gy] = at(START_I + 4, 0); push(gx, gy, "zk_gate", big("zk_gate", 1.3), 0);
      if (o.altar) { const [zx, zy] = at(N - 1, 0), a = tangent(N - 1); push(zx + Math.cos(a) * 120, zy + Math.sin(a) * 120, "zakum_body", .5, 60); }
    },
  };
}
const HEN_ART = { sky: "media/duel/bg_henesys.webp?v=9", strip: "media/kart/henesys_strip.webp?v=1" };
const TRACKS = {
  // 1. Oink Oink Meadows: Henesys's own Moo Moo Meadows (Mario Kart Wii). A wide dirt country road with soft grass edges and no curbs, rolling
  // hills and the farm on the hill (white barn, blue roof, silos). Out of the start a left turn, then the pig herds wander across the road (the
  // Moo Moos), a blue ramp halfway, the bumpy hills where Stumps dig about and pop out of the ground (the Monty Moles), and the wide end field
  // with grass patches all over, crossed by a boost ramp that flies you over the grass through an item box in the air; a left turn and the line.
  henesys: {
    id: "meadows2", scale: 1.75, road: 220, cup: "henesys", art: HEN_ART, name: "Oink Oink Meadows", sub: "pig herds · stumps · the flying field", icon: "🐷", music: "henesys",
    ctrl: [[1810, 1125, 0], [1805, 900, 4], [1797, 650, 10], [1780, 425, 16], [1715, 245, 20], [1560, 145, 22], [1380, 130, 24], [1215, 190, 20], [1115, 300, 14], [1072, 450, 10],
      [990, 557, 14], [822, 587, 20], [660, 650, 16], [522, 755, 22], [335, 770, 18], [215, 855, 12], [197, 1012, 8], [272, 1162, 16], [405, 1280, 4], [460, 1462, 16],
      [472, 1650, 3], [540, 1805, 10], [690, 1890, 2], [890, 1905, 0], [1072, 1855, 0], [1215, 1730, 0], [1360, 1620, 0], [1535, 1545, 0], [1685, 1462, 0], [1797, 1362, 0], [1822, 1250, 0]],
    theme: { grass: ["#5fc63e", "#58bb38"], flowers: 300, tufts: 12000, road: "farm", curb: ["#4ea834", "#57b83a"] },
    near: ["bush", "tree", "sunflower", "hay"], far: ["tree", "tree", "bush"], mobs: ["pig", "ribbon_pig", "stump"],
    build() {
      makeFarmArt();
      const u = d => Math.round(d / SPC), coins = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      const fieldA = I(1000, 1898), launch = I(1110, 1830);
      row(I(1800, 980), I(1795, 760), 5, 0);                              // up the start straight
      row(I(1650, 200), I(1470, 132), 5, 50);                             // the inside of the first left turn
      row(I(822, 587), I(600, 690), 6, j => Math.sin(j * 1.2) * 50);    // weaving through the pig field
      row(I(250, 1100), I(450, 1400), 6, j => Math.sin(j * 1.3) * 55);  // over the stump hills
      for (let j = 0; j < 6; j++) { const [x, y] = at(launch + u(40 + j * 35), 0); coins.push({ x, y, z: 30 + 60 * Math.sin(Math.PI * (j + .5) / 6), got: false }); }   // the flight over the field
      // 🐷 the pig herds: a few pigs crossing together, slowly (they bump and slow you: it's a beginner track)
      const herd = (i, ph, k3) => [0, 1, 2].map(n => ({ i: i + n * 3, ph: ph + n * .5, k: k3[n % k3.length], sp: .42, soft: true, herd: true, s: .55 }));
      // 🐷 the final lap: a stampede! a big herd charging back and forth across the start straight (only on lap 3)
      const stampede = [0, 1, 2, 3, 4, 5].map(n => ({ i: I(1803, 800) + (n % 3) * 4 + Math.floor(n / 3) * 14, ph: n * .9, k: ["pig", "ribbon_pig"][n % 2], sp: .95, soft: true, herd: true, s: .6, lap: 3 }));
      // 🌾 hay bales across the road before the stump hills: hit one for a hop and +2 mesos
      const hay = [[205, 925, -55], [199, 985, 50], [210, 1045, -15]].map(([x, y, o]) => ({ i: I(x, y), o }));
      return {
        lake: { cx: ws(1180), cy: ws(1020), rx: ws(300), ry: ws(105) },   // the river by the farm
        pads: [{ t: "ramp", i: I(430, 762), len: 9, o: 0, w: ROAD },                  // the blue ramp halfway round (trick!)
          { t: "boost", i: I(1640, 190), len: 12, o: 0, w: 64 },                    // out of the first turn
          { t: "boost", i: fieldA, len: 10, o: 0, w: 80 },                           // the boost pad into the field…
          { t: "bigramp", i: launch, len: 7, o: 0, w: ROAD },                          // …that flies you over the grass
          ...hay.map(h => ({ t: "hay", i: h.i, len: 4, o: h.o, w: 46 })),
          ...[[50, -60, 70, 20], [140, 55, 80, 22], [230, -40, 90, 20], [320, 60, 70, 18], [400, -55, 80, 22], [470, 30, 60, 16]].map(([d, o, w, len]) => ({ t: "grass", i: launch + u(d), len: Math.round(len / 4) + 3, o, w }))],
        coins, pigs: [...herd(I(1180, 210), 0, ["pig", "ribbon_pig", "pig"]), ...herd(I(1040, 500), 2.1, ["ribbon_pig", "pig", "pig"]), ...herd(I(700, 630), 4, ["pig", "pig", "ribbon_pig"]), ...stampede],
        finalMsg: "🐷 STAMPEDE on the straight!",
        // 🌳 Stumps (the Monty Moles): they dig about under the bumpy hills and pop up; their dirt slows you, a stump that's up bumps you
        moles: [[I(240, 1080), -50], [I(300, 1200), 60], [I(420, 1330), -30], [I(455, 1470), 55], [I(468, 1580), -60], [I(500, 1720), 20]].map(([i, o], n) => ({ i, o, ph: n * .9, sp: 1 })),
        boxes: [...boxRow(I(1800, 700), [-80, -27, 27, 80]), ...boxRow(I(1150, 260), [-80, -27, 27, 80]), ...boxRow(I(240, 960), [-80, -27, 27, 80]),
          ...boxRow(launch + u(130), [-50, 0, 50]).map(b => ({ ...b, z: 62 }))],   // the item box in the air, over the field
        extra(push) {
          // the farm on the hill: a white barn with a blue roof, two silos and a windmill (seen from all over the track)
          for (const [x, y, k, sc] of [[1380, 720, "farm_barn", .9], [1495, 690, "farm_silo", .8], [1545, 730, "farm_silo", .7], [1240, 640, "farm_mill", .9], [760, 1250, "farm_barn", .6]]) OBJS.push({ x: ws(x), y: ws(y), k, s: sc, r: 30, z: 0 });
          for (let i = I(1215, 190); i <= I(660, 650); i += 10) for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 14)); push(x, y, "posts", .32, 6); }   // fences along the pig field
          for (let i = I(1808, 1060); i <= I(1782, 470); i += 9) for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 10)); push(x, y, "posts", .32, 6); }   // fence posts flashing past down the start straight
          for (const h of hay) { const [x, y] = at(h.i + 2, h.o); OBJS.push({ x, y, k: "hay", s: .45, r: 0, z: 0 }); }   // the hay bales you hop off
          for (const [x, y, k] of [[1000, 760, "hay"], [1120, 700, "haypile"], [700, 1500, "tree"], [1400, 1300, "tree"], [1550, 800, "tree"], [880, 1320, "bush"]]) push(ws(x), ws(y), k);
        },
      };
    },
  },
  // 2. Mushroom Gorge (Henesys): laid out like Mario Kart Wii's Mushroom Gorge. From the Henesys Market start you climb the cliffside,
  // bounce over the first gap on a single giant mushroom, round the hook at the top, bounce down three mushrooms across the gorge, sweep
  // round the far side and cross the big abyss on two rows of trampoline mushrooms (steer to pick a row), then race the hopping mushrooms
  // (the Goombas' job) round the bottom U-turn back to the start. Wide beginner road; fall in and you're put back before the gap.
  town: {
    id: "gorge", scale: 1.75, road: 200, gate: "market", cup: "henesys", art: HEN_ART, music: "town", name: "Mushroom Canyon", sub: "trampoline mushrooms · the abyss · market start", icon: "🌼",
    ctrl: [[1868, 1432, 0], [1878, 1211, 8], [1896, 1040, 18], [1911, 881, 30], [1880, 790, 34], [1800, 735, 42], [1710, 712, 47], [1645, 670, 51], [1612, 595, 54], [1604, 500, 57],
      [1605, 366, 60], [1572, 231, 66], [1470, 138, 72], [1320, 118, 74], [1200, 150, 72], [1110, 230, 68], [993, 262, 60], [858, 305, 52], [723, 362, 44], [628, 423, 40],
      [463, 440, 36], [297, 538, 30], [213, 709, 24], [279, 888, 18], [437, 1028, 14], [718, 1138, 10], [973, 1285, 6], [1228, 1432, 2], [1420, 1560, 0], [1520, 1720, -4],
      [1590, 1870, -6], [1720, 1915, -4], [1850, 1840, -2], [1875, 1640, 0]],
    theme: { grass: ["#74c94f", "#6dc149"], flowers: 500, tufts: 9000, road: "pave", cliffs: "shroom" },
    near: ["sunflower", "redshrooms", "bush", "tallshroom", "tree", "shroomtower", "shroomhouse"],
    far: ["tree", "tree", "bush", "shroomhouse", "shroomtower"], mobs: ["orange_mushroom", "green_mushroom", "blue_mushroom"],
    build() {
      const u = d => Math.round(d / SPC), coins = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      // the three crossings. You drive onto the first mushroom of each; every bounce then carries you one hop (200) forward, and you steer
      // in the air to land on the next one. They come in different sizes and heights, zig-zagging; miss and you fall.
      const g1a = I(1605, 560), g2a = I(1112, 228), g3a = I(437, 1028);
      const cap = (a, along, o, r, top, col) => ({ i: a + u(along), o, r, top, col });
      const COL = ["r", "b", "g", "o", "n"];   // red, blue, green, orange, brown
      const G1 = { a: g1a, b: g1a + u(160), kind: "gorge", caps: [cap(g1a, 70, 0, 95, 0, "r")] };                                     // the first jump: one big mushroom
      const G2 = { a: g2a, b: g2a + u(500), kind: "gorge", caps: [cap(g2a, 75, 0, 100, 0, "o"), cap(g2a, 185, 55, 68, 26, "b"), cap(g2a, 380, -45, 82, 12, "n")] };   // three down the gorge
      const cave = [cap(g3a, 85, 0, 115, 0, "g")];   // the abyss: one wide mushroom in, then two rows (the middle is open: pick a side)
      cave.push({ ...cap(g3a, 370, 0, 30, 46, "y"), gold: true, hop: 400 }, { ...cap(g3a, 770, 0, 30, 40, "y"), gold: true, hop: 400 });
      for (const [d, z] of [[470, 90], [570, 115], [670, 90], [870, 90], [970, 115], [1070, 90]]) { const [x, y] = at(g3a + u(d), 0); coins.push({ x, y, z, got: false }); }   // mesos up along the golden arcs   // ✨ the risky middle line: two small golden mushrooms, each a double-length, faster bounce (about 2 s quicker; miss and you fall)
      [[170, -70, 72, 18], [370, -52, 58, 34], [570, -78, 80, 8], [770, -50, 62, 28], [970, -68, 76, 14]].forEach(([d, o, r, top], k) => cave.push(cap(g3a, d, o, r, top, COL[k % 5])));
      [[170, 72, 60, 30], [370, 60, 84, 10], [570, 76, 56, 36], [770, 55, 80, 6], [970, 74, 66, 24]].forEach(([d, o, r, top], k) => cave.push(cap(g3a, d, o, r, top, COL[(k + 2) % 5])));
      const G3 = { a: g3a, b: g3a + u(1055), kind: "gorge", caps: cave };
      // 🗺️ the journey round the canyon: each area's name pops up as you reach it, with a signpost by the road
      const areas = [[0, "market", "🏘️ Henesys Market"], [I(1890, 1110), "climb", "🧗 Cliffside Climb"], [g1a - 40, "leap", "🍄 Toadstool Leap"], [I(1500, 150), "hook", "🪝 The Hook"],
        [g2a - 40, "steps", "🍄 Mushroom Steps"], [I(700, 375), "spore", "✨ Spore Hill"], [g3a - 50, "abyss", "🕳️ Mushmom's Abyss"], [I(1460, 1600) + 20, "run", "🐾 Mushroom Run"]].map(([i, k, name]) => ({ i, k, name }));
      // ✨ spores drifting up out of the gorges and over Spore Hill, glowing
      const spores = [];
      for (const [ga, len, n] of [[g1a, 160, 10], [g2a, 500, 22], [g3a, 1055, 46]]) for (let k = 0; k < n; k++) { const [x, y] = at(ga + u(len * (k + .5) / n), (Math.random() - .5) * 700); spores.push({ x, y, ph: Math.random(), sp: .06 + Math.random() * .05, sw: Math.random() * 6.28, s: .7 + Math.random() * .6 }); }
      for (let k = 0; k < 18; k++) { const [x, y] = at(I(860, 310) + Math.round((k / 18) * (I(260, 600) - I(860, 310))), (Math.random() < .5 ? -1 : 1) * (ROAD / 2 + 60 + Math.random() * 200)); spores.push({ x, y, ph: Math.random(), sp: .05 + Math.random() * .04, sw: Math.random() * 6.28, s: .6 + Math.random() * .5, low: true }); }
      row(I(1885, 1120), I(1900, 960), 5, 0);                             // up the cliffside
      row(I(1520, 160), I(1360, 120), 5, 40);                             // round the inside of the hook
      row(I(560, 430), I(260, 600), 6, j => Math.sin(j * 1.1) * 40);    // the sweep round the far side
      row(I(1540, 1790), I(1700, 1912), 5, -40);                          // the inside of the bottom U-turn
      return {
        gaps: [G1, G2, G3], areas, spores, finalMsg: "🍄 Mushmom is STOMPING!",
        pads: [{ t: "boost", i: I(1560, 200), len: 14, o: 0, w: 60 },       // out of the first jump, into the hook
          { t: "boost", i: I(1460, 1600), len: 14, o: 0, w: 60 }],          // out of the abyss
        coins,
        // mushrooms hopping across the last stretch (Mushroom Gorge's Goombas): they only bump you
        pigs: [{ i: I(1555, 1810), ph: 0, k: "orange_mushroom", sp: .7, hop: true, soft: true, s: .6 }, { i: I(1720, 1912), ph: 2, k: "green_mushroom", sp: .65, hop: true, soft: true, s: .6 },
          { i: I(1868, 1760), ph: 4, k: "blue_mushroom", sp: .75, hop: true, soft: true, s: .6 }, { i: I(400, 480), ph: 1.3, k: "orange_mushroom", sp: .7, hop: true, soft: true, s: .6 }],
        boxes: [...boxRow(I(1885, 1180), [-72, -24, 24, 72]), ...boxRow(I(1360, 118), [-72, -24, 24, 72]), ...boxRow(I(250, 800), [-72, -24, 24, 72])],
        extra(push) {
          const span = (a, b, st) => { const out = []; for (let k = 0, n = (b - a + N) % N; k <= n; k += st) out.push((a + k) % N); return out; };   // (round the start line)
          span(I(1868, 1680), I(1878, 1300), 22).forEach((i, n) => { for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 60)); push(x, y, ["stall", "stall2"][(n + (side > 0 ? 1 : 0)) & 1]); } });   // the market
          for (const [x, y, k, sc] of [[1150, 700, "orange_mushroom", 1.6], [1350, 900, "green_mushroom", 1.5], [800, 750, "blue_mushroom", 1.5], [1500, 1180, "orange_mushroom", 1.3]])
            OBJS.push({ x: ws(x), y: ws(y), k, s: sc, r: 20, z: 0, bob: 14, mob: true });   // giant mushrooms bouncing on the spot
          for (const [x, y, k] of [[1000, 900, "shroomhouse"], [1250, 650, "shroomtower"], [650, 650, "shroomhouse"], [1650, 1350, "shroomtower"]]) push(ws(x), ws(y), k);
          // 🍄 Mushmom, huge, sitting on the far rim of the abyss and bouncing, watching everyone try the mushrooms (on the last lap she stomps)
          { const [x, y] = at(g3a + u(560), -(ROAD / 2 + CURB + 600)); OBJS.push({ x, y, k: "mushmom", s: 2.8, r: 0, z: 0, bob: 22, mob: true, stomp: true }); }
          // 🏘️ the mushroom village round Henesys Market: houses and towers behind the stalls, red toadstools between them
          span(I(1866, 1700), I(1878, 1260), 26).forEach((i, n) => { for (const sd of [-1, 1]) {
            const [x, y] = at(i, sd * (ROAD / 2 + CURB + 200 + (n % 2) * 40)); push(x, y, ["shroomhouse", "shroomtower", "shroomhouse", "tallshroom"][(n + (sd > 0 ? 1 : 0)) % 4]);
            const [x2, y2] = at((i + 13) % N, sd * (ROAD / 2 + CURB + 120)); push(x2, y2, "redshrooms", .42, 0); } });
          // 🪧 a signpost at the start of every area
          for (const a of areas) if (a.i > 5) { const [x, y] = at(a.i, ROAD / 2 + CURB + 44); OBJS.push({ x, y, k: "areasign_" + a.k, s: .55, r: 10, z: 0 }); }
          // little mushrooms cheering on the lips of every gorge, where you take off and where you land
          const kinds = ["orange_mushroom", "green_mushroom", "blue_mushroom", "horny_mushroom"];
          [G1, G2, G3].forEach((g, gi) => [g.a - 10, g.b + 10].forEach((i, e) => [-1, 1].forEach((sd, k) => { for (let n = 0; n < 2; n++) { const [x, y] = at(i - n * 7, sd * (ROAD / 2 + CURB + 22 + n * 26)); OBJS.push({ x, y, k: kinds[(gi + e + k + n) % 4], s: .5, r: 0, z: 0, bob: 9, mob: true }); } })));
        },
      };
    },
  },
  // 3. Pets Park: Henesys's Peach Gardens (Mario Kart DS / Wii / Tour). A pink-and-white finish line by a giant hedge pet, round the fountain
  // and its moat, a curl and a climb on the left, the hedge maze across the top where giant pets on chains lunge at you (the Chain Chomps),
  // down round the peace-sign hedges, the winding bunny path (bunnies pop out of their burrows: the Monty Moles), and up across the porch of
  // the white mansion with the pink roof, then right at the door back to the line. Gazebos, hot-air balloons, heart lawns and pets everywhere.
  forest: {
    id: "pets2", scale: 1.45, road: 170, gate: "pets", cup: "henesys", art: HEN_ART, music: "forest", name: "Pets Park", sub: "hedge maze · chained pets · bunny path · the mansion", icon: "🐾",
    pets: ["husky", "blackpig", "jrbalrog", "pinkbunny", "whitebunny", "blackbunny", "kitty", "puppy", "panda", "dino", "penguin", "elephant", "babydragon", "porcupine", "monkey"],
    ctrl: [[1027, 1533, 0], [1036, 1303, 2], [1220, 1188, 4], [1266, 1036, 6], [1174, 866, 8], [1027, 806, 8], [866, 880, 8], [805, 1015, 8], [700, 1085, 8], [560, 1100, 10],
      [406, 1119, 12], [245, 1082, 14], [176, 958, 16], [236, 774, 20], [273, 544, 26], [337, 360, 30], [498, 319, 32], [751, 337, 32], [1027, 346, 32], [1303, 337, 32],
      [1533, 337, 30], [1717, 392, 28], [1772, 613, 22], [1754, 820, 16], [1643, 981, 12], [1652, 1165, 10], [1730, 1300, 8], [1790, 1440, 6], [1735, 1580, 6], [1758, 1735, 10],
      [1670, 1835, 18], [1441, 1837, 20], [1165, 1827, 18], [1036, 1754, 10], [1018, 1625, 4]],
    theme: { grass: ["#58b84a", "#50ad43"], flowers: 900, flowerCols: ["#ff7ab8", "#ffffff", "#ffd23f", "#ff5a6a"], tufts: 9000, road: "garden", curb: ["#ff9ad0", "#ffffff"], finish: ["#ff7ab8", "#ffffff"], hearts: true, beds: true },
    near: ["bush", "sunflower", "hp_clover", "hp_violet"], far: ["tree", "bush", "tree"], mobs: [],
    build() {
      makePetsArt();
      const u = d => Math.round(d / SPC), coins = [], pa = I(560, 330);
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      row(I(1250, 1080), I(1100, 830), 5, -50);                           // the inside of the fountain roundabout
      row(I(250, 1060), I(240, 700), 5, 0);                               // up the left side
      row(pa + u(110), pa + u(850), 8, j => (j & 1 ? 30 : -30));         // between the hedges
      row(I(1730, 1310), I(1750, 1700), 6, j => Math.sin(j * 1.4) * 35); // down the bunny path
      const porch = I(1580, 1836);                                         // ✈ off the end of the porch: a boost and a big ramp, coins in the air and an item box up there
      for (let j = 0; j < 6; j++) { const [x, y] = at(porch + u(45 + j * 38), 0); coins.push({ x, y, z: 35 + 70 * Math.sin(Math.PI * (j + .5) / 6), got: false }); }
      row(I(1250, 1832), I(1170, 1828), 3, 0);                            // along the porch
      // 🌿 the hedge maze: blocks to weave between (a slalom), and the giant pets on their chains at its edges
      const hedges = [0, 1, 2, 3, 4, 5, 6].map(k => ({ i: pa + u(70 + k * 128), o: k % 2 ? 44 : -44, w: 52, h: 46 }));   // a slalom of hedges, left and right
      for (const [x, y] of [[1840, 960], [1890, 1030], [1840, 1100]]) hedges.push({ x: ws(x), y: ws(y), w: 46, h: 30 });   // the peace-sign hedges by the right-hand bend
      const chomp = (d, o, k, ph) => { const [ax, ay] = at(pa + u(d), o); return { ax, ay, k, ph, R: 78, s: 1.45 }; };
      // 🗺️ the journey round the park: each area's name pops up as you reach it, with a signpost by the road
      const areas = [[0, "plaza", "🐾 Pet Plaza"], [I(1036, 1303), "fountain", "⛲ Fountain Circle"], [I(406, 1119), "climb", "🌸 Blossom Climb"], [pa - 25, "maze", "🌿 Hedge Maze"],
        [I(1717, 392), "peace", "☮️ Peace Garden"], [I(1700, 1250) - 10, "bunny", "🐰 Bunny Trail"], [porch - u(110), "porch", "🏥 Pet Hospital"], [I(1165, 1827), "home", "🎀 Home Stretch"]].map(([i, k, name]) => ({ i, k, name }));
      // 🐾 the last lap: the pets got loose! they dash back and forth across the home stretch
      const loose = ["puppy", "kitty", "husky", "panda", "pinkbunny", "dino"].map((k, n) => ({ i: I(1060, 1790) + (n % 3) * 5 + Math.floor(n / 3) * 16, ph: n * 1.1, k: `pet_${k}_move0`, sp: .9, soft: true, herd: true, s: .95, lap: 3 }));
      return {
        lake: { cx: ws(1050), cy: ws(1030), rx: 170, ry: 170, kind: "fountain", r: 118 },   // ⛲ the fountain's plaza in the middle of the roundabout (built in 3D: kept clear, and the shortcut finder stays out)
        hedges, chomps: [chomp(250, 96, "husky", 0), chomp(520, -96, "blackpig", 2), chomp(780, 96, "jrbalrog", 4)], areas, pigs: loose, finalMsg: "🐾 The pets got loose!",
        // 🐰 bunnies popping out of their burrows along the winding path (the Monty Moles); a bunny that's up bumps you
        moles: [[I(1735, 1310), 30], [I(1785, 1430), -35], [I(1745, 1560), 30], [I(1755, 1700), -30], [I(1700, 1250), -40]].map(([i, o], n) => ({ i, o, ph: n * .8, sp: 1.1, img: ["pet_pinkbunny_jump0", "pet_whitebunny_jump0", "pet_blackbunny_jump0"][n % 3], msg: "🐰 Bunny!" })),
        // 🐾 pets wandering about the gardens
        wander: [["kitty", 1050, 1180, 60, 25], ["puppy", 640, 900, 90, 40], ["panda", 900, 560, 80, 30], ["dino", 1300, 600, 70, 50], ["penguin", 520, 1350, 60, 30], ["elephant", 1450, 1300, 90, 40],
          ["babydragon", 1250, 1500, 70, 30], ["porcupine", 420, 600, 50, 40], ["monkey", 1550, 950, 60, 60], ["kitty", 1600, 1650, 60, 20], ["puppy", 800, 1700, 70, 30]].map(([k, x, y, rx, ry], n) => ({ k, x: ws(x), y: ws(y), rx: ws(rx), ry: ws(ry), sp: .35 + (n % 3) * .1, ph: n, s: .9 })),
        pads: [{ t: "boost", i: I(520, 1105), len: 12, o: 0, w: 60 },        // out of the fountain roundabout
          { t: "boost", i: I(1690, 380), len: 12, o: 0, w: 60 },              // out of the hedge maze
          { t: "ramp", i: I(1785, 1460), len: 8, o: 0, w: ROAD },              // the bunny path's two little ramps (added in Mario Kart Wii)
          { t: "ramp", i: I(1745, 1640), len: 8, o: 0, w: ROAD },
          { t: "boost", i: porch - u(70), len: 10, o: 0, w: 80 }, { t: "bigramp", i: porch, len: 7, o: 0, w: ROAD }],   // the porch launch
        coins,
        boxes: [...boxRow(I(420, 1115), [-60, -20, 20, 60]), ...boxRow(pa + u(380), [-70, 70]), ...boxRow(porch + u(150), [-50, 0, 50]).map(b => ({ ...b, z: 62 }))],
        extra(push) {
          OBJS.push({ x: ws(1050), y: ws(1030), k: "fountain", s: .8, r: 116, z: 0, f3d: true });                         // the fountain (a 2D picture only in the flat view; solid)
          BUILDINGS.push({ x: ws(1420), y: ws(2008), w: ws(600), d: 70, h: 120, wall: "#fbf7f2", roof: "#f07ab0", tower: true, hospital: true });   // 🏥 the Pet Hospital by the porch (3D): white, a red band, a big red cross on the tower
          for (let i = OBJS.length - 1; i >= 0; i--) { const o = OBJS[i], dx = Math.abs(o.x - ws(1420)), dy = ws(2008) - o.y; if (dx < ws(330) && dy > 0 && dy < 330 && !String(o.k).startsWith("pet_")) OBJS.splice(i, 1); }   // (a clear lawn in front of it)
          for (const [x, y] of [[640, 640], [1420, 640], [520, 1500]]) OBJS.push({ x: ws(x), y: ws(y), k: "gazebo", s: .8, r: 30, z: 0, f3d: true });
          for (const [x, y, z] of [[700, 1300, 330], [1500, 500, 380], [300, 1600, 300]]) OBJS.push({ x: ws(x), y: ws(y), k: "hotair", s: 1, r: 0, z, bob: 18, f3d: true });
          for (const [x, y, k] of [[870, 1300, "bush"], [1350, 1450, "bush"], [430, 900, "tree"], [1600, 1100, "tree"]]) push(ws(x), ws(y), k);
          // 🐾 pets here and there round the park, watching the race and bouncing
          ["husky", "kitty", "puppy", "panda", "pinkbunny", "dino", "elephant", "babydragon", "monkey", "penguin", "whitebunny", "blackpig"].forEach((k, n) => { const sd = n % 2 ? 1 : -1, [x, y] = at(Math.round(N * (n + .55) / 12) % N, sd * (ROAD / 2 + CURB + 40 + (n % 3) * 28)); OBJS.push({ x, y, k: `pet_${k}_stand00`, s: .9, r: 0, z: 0, bob: 10, mob: true });
            const [ox, oy] = at(Math.round(N * (n + .55) / 12) % N, sd * (ROAD / 2 + CURB + 40 + (n % 3) * 28 + 50));   // their things beside them: a doghouse and a bowl, or a ball to play with
            if (n % 4 === 0 && Math.hypot(ox - ws(1050), oy - ws(1030)) > 260) { push(ox, oy, "hp_doghouse"); push(ox + 26, oy + 18, "hp_bowl"); } else if (n % 4 === 2) push(x + 24, y + 10, n % 8 === 2 ? "hp_ball" : "hp_ball2"); });
          for (const a of [2.2, .95]) push(ws(1050) + Math.cos(a) * 148, ws(1030) + Math.sin(a) * 148, "hp_catstatue");   // 🐱 cat statues on the fountain's plaza, facing the road in
          push(ws(1420) - ws(240), ws(2008) - 110, "hp_bath"); push(ws(1420) + ws(240), ws(2008) - 110, "hp_cushion");   // a pet bath and a cushion on the hospital's lawn
          // 🌸 a few flower clusters at the nice spots (not rows of them)
          for (const [n, [i, o]] of [[I(1220, 1188), -1], [I(245, 1082), 1], [I(337, 360), 1], [I(1772, 613), -1], [I(1600, 1838), 1], [I(1036, 1754), -1]].entries()) { const cl = n % 2 ? [["hp_clover", 0, 0, .7], ["hp_violet", 26, 14, .62], ["sunflower", -24, 16, .5], ["hp_violet2", -6, -20, .62]] : [["hp_clover", 0, 0, .7], ["hp_orange", 26, 14, .55], ["sunflower", -24, 16, .5], ["hp_orange2", -6, -20, .55]];
            for (const [k, dx, dy, sc] of cl) { const [x, y] = at(i, o * (ROAD / 2 + CURB + 40)); push(x + dx, y + dy, k, sc, 0); } }
        },
      };
    },
  },
  // ---- El Nath Cup ❄️: icy roads, your kart keeps sliding the way it was going
  // 1. Snow Land (Mario Kart: Super Circuit, remade in 8 Deluxe and Tour): the most fun of the El Nath cup. Through the ice archway and
  // straight into a long row of mesos, penguins sliding across the road, snowmen with red scarves standing in it, slippery ice patches,
  // a ramp down into the thin-ice basin with a hole in the ice in the middle, boost pads back out, and the snowy S-bends home.
  en1: {
    id: "snowland", scale: 1.22, road: 180, gate: "ice", cup: "elnath", music: "k_elnath1", name: "Penguin Snowfield", sub: "penguins · snowmen · the thin-ice basin", icon: "⛄",
    ctrl: [[242, 1420, 0], [242, 990, 6], [262, 840, 10], [330, 748, 14], [472, 722, 18], [702, 689, 22], [817, 517, 26], [886, 302, 30], [1070, 225, 32], [1438, 238, 34], [1691, 388, 42],
      [1829, 646, 56], [1815, 900, 74], [1765, 1030, 90], [1620, 1060, 96], [1470, 1010, 80], [1254, 900, 48], [1070, 904, 18], [923, 1012, 4], [932, 1205, 2], [1116, 1313, 4], [1438, 1356, 6], [1737, 1377, 8],
      [1852, 1528, 10], [1815, 1721, 8], [1622, 1807, 6], [1300, 1798, 4], [1070, 1721, 4], [909, 1571, 6], [748, 1592, 4], [610, 1700, 2], [472, 1786, 0], [288, 1764, 0], [233, 1592, 0]],
    theme: { ...TH.elnath, flowers: 300, tufts: 0, road: "icy", curb: ["#5a6fd8", "#f4f8ff"], peaks: true, drifts: true }, art: { sky: "media/duel/bg_elnath.webp", strip: "media/kart/elnath/strip1.webp" },
    near: ["en_pine", "en_pine3", "en_bush", "en_bush2"], far: ["en_pine", "en_pine2", "en_pine3"], mobs: ["pepe", "jr_yeti"],
    build() {
      makeSnowArt();
      const u = d => Math.round(d / SPC), coins = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      row(I(242, 1330), I(250, 880), 25, 0);                              // the famous row of 25 mesos right after the start
      row(I(1700, 1100), I(1300, 960), 5, -40);                           // round the inside of the right-hand turn
      row(I(1500, 1360), I(1780, 1400), 5, 30);                           // the lower straight
      // ⛄ snowmen standing in the road (solid: steer round them)
      const snowmen = [[I(886, 330), -42], [I(1600, 330), 45], [I(1825, 760), -40], [I(1830, 1560), 42], [I(800, 1590), -40]].map(([i, o]) => ({ i, o, w: 34, h: 50, sprite: "snowman_big" }));
      const basin = I(1000, 940), slide = { a: I(1620, 1060), b: basin - 4 };   // 🐧 the penguin slide: an ice chute down the hill to the jump into the basin
      return {
        chutes: [slide],
        hedges: snowmen,
        holes: [{ i: I(927, 1110), o: 0, r: 46 }],   // the hole in the thin ice: fall in and you're fished out behind it
        pads: [{ t: "ramp", i: basin, len: 8, o: 0, w: ROAD },                                    // the ramp down into the thin-ice basin
          ...[[u(60), -30, 70], [u(150), 35, 70], [u(250), -20, 80]].map(([d, o, w]) => ({ t: "ice", i: basin + d, len: u(70), o, w })),
          { t: "boost", i: slide.a + 4, len: 10, o: -35, w: 55 }, { t: "boost", i: slide.a + 4, len: 10, o: 35, w: 55 },   // whoosh down the slide
          { t: "boost", i: I(1060, 1280), len: 10, o: -30, w: 50 }, { t: "boost", i: I(1060, 1280), len: 10, o: 30, w: 50 },   // the two boost pads back out
          { t: "ice", i: I(1438, 238), len: u(120), o: 0, w: 120 }, { t: "ice", i: I(1500, 1800), len: u(110), o: 30, w: 100 }, { t: "ice", i: I(1829, 600), len: u(90), o: -20, w: 90 }],
        coins,
        // 🐧 penguins sliding across the road (they bump you)
        pigs: [{ i: I(472, 722), ph: 0, k: "pepe", sp: .8, soft: true, s: .55 }, { i: I(1250, 228), ph: 2, k: "pepe", sp: .9, soft: true, s: .55 },
          { i: I(1300, 1798), ph: 1, k: "pepe", sp: .85, soft: true, s: .55 }, { i: I(1300, 1795), ph: 3.5, k: "pepe", sp: .75, soft: true, s: .55 }],
        boxes: [...boxRow(I(890, 330), [-60, -20, 20, 60]), ...boxRow(I(1810, 1100), [-60, -20, 20, 60]), ...boxRow(I(700, 1640), [-60, -20, 20, 60])],
        extra(push) {
          for (const [x, y, sc] of [[600, 1000, 1.1], [1350, 650, 1.3], [1450, 1550, 1], [560, 420, .9], [1950, 300, 1.4], [120, 300, 1.2], [1200, 1980, 1.2]]) OBJS.push({ x: ws(x), y: ws(y), k: "icicle", s: sc, r: 30, z: 0 });   // crystal ice spires
          for (const [x, y] of [[420, 1500], [700, 900], [1500, 600], [1600, 1200], [1100, 1600]]) OBJS.push({ x: ws(x), y: ws(y), k: "snowman_big", s: .8, r: 20, z: 0 });
          const clear = (x, y, d) => roadDist(x, y) > ROAD / 2 + CURB + d;
          // 🐧 penguins sliding down the slide's rims beside you, and a few cheering at the top
          for (let n = 0; n < 6; n++) { const sd = n % 2 ? 1 : -1; OBJS.push({ x: 0, y: 0, k: "pepe", s: .45, r: 0, z: 40, slide: { a: slide.a, b: slide.b, o: sd * (ROAD / 2 + CURB + 6), sp: .22 + (n % 3) * .04, ph: n / 6 } }); }
          for (const sd of [-1, 1]) for (let n = 0; n < 2; n++) { const [x, y] = at(slide.a - 6 - n * 10, sd * (ROAD / 2 + CURB + 40)); OBJS.push({ x, y, k: "pepe", s: .5, r: 0, z: 0, bob: 8, mob: true }); }
          // 🏠 El Nath town along the start straight: fat little houses with thick snow on their roofs and warm lights in the windows
          { const roofs = [0xd2602a, 0xb8402e, 0x3f7fae, 0xd2602a, 0x8a5a9a, 0xc8702a]; let n = 0;
            for (let i = I(242, 1380); i < I(262, 840); i += 34) { const sd = at(i, 1)[0] > at(i, -1)[0] ? 1 : -1, [x, y] = at(i, sd * (ROAD / 2 + CURB + 115)), sc = .85 + (n % 3) * .12;
              if (clear(x, y, 95 * sc)) { OBJS.push({ x, y, k: "enhouse", s: sc, r: 70 * sc, z: 0, roof: roofs[n % roofs.length], wall: n % 2 ? "#f3e3c3" : "#e8d2a8" }); n++; } }
            for (const i of [I(472, 1786) + 10, I(288, 1764) + 4]) { const [x, y] = at(i, -(ROAD / 2 + CURB + 120)); if (clear(x, y, 90)) { OBJS.push({ x, y, k: "enhouse", s: .9, r: 64, z: 0, roof: roofs[n % roofs.length], wall: "#f3e3c3" }); n++; } } }
          // 🛖 the penguins' igloo village inside the bend by the thin-ice basin, penguins standing about, a bench and a swing
          for (const [x, y, sc] of [[1150, 1110, 1], [1250, 1170, .8], [1060, 1185, .75], [1300, 1060, .7]]) if (clear(ws(x), ws(y), 80 * sc)) OBJS.push({ x: ws(x), y: ws(y), k: "igloo", s: sc, r: 60 * sc, z: 0 });
          for (const [x, y] of [[1110, 1050], [1205, 1100], [1180, 1215], [1240, 1240], [1020, 1130]]) if (clear(ws(x), ws(y), 30)) OBJS.push({ x: ws(x), y: ws(y), k: "pepe", s: .5, r: 0, z: 0, bob: 6, mob: true });
          if (clear(ws(1330), ws(1150), 40)) push(ws(1330), ws(1150), "en_swing"); if (clear(ws(1100), ws(990), 30)) push(ws(1100), ws(990), "en_bench");
          // 🏮 lamps down both sides of the start straight, snowy fences round the outside of the big bends, barrels and hay by the line
          for (let i = I(242, 1330); i < I(250, 900); i += 18) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB + 18)); push(x, y, "en_lamp"); }
          for (const [a, b] of [[I(1070, 225), I(1691, 388)], [I(1852, 1528), I(1622, 1807)], [I(472, 1786), I(233, 1592)]]) for (let i = a; i < b; i += 9) {
            const [x1, y1] = at(i, ROAD / 2 + CURB + 75), [x2, y2] = at(i, -(ROAD / 2 + CURB + 75)), out = Math.hypot(x1 - ws(1050), y1 - ws(1000)) > Math.hypot(x2 - ws(1050), y2 - ws(1000));
            const [x, y] = out ? [x1, y1] : [x2, y2]; if (clear(x, y, 14)) push(x, y, "en_fence"); }
          { const [x, y] = at(I(242, 1420) + 8, ROAD / 2 + CURB + 60); push(x, y, "en_barrel"); push(x + 26, y + 14, "en_barrel", .36); push(x - 10, y + 40, "en_hay"); }
        },
      };
    },
  },
  // 2. Sherbet Land: Double Dash!!'s icy night course (as remade for Mario Kart 8). Down from the ice-block arch onto the big frozen rink, where
  // Jr. Yetis skate round in rings (the Skating Shy Guys) and spin you out; round the far corner and up through the S-bends inside the ice
  // cave (red rail along one wall); over the top past the snowmen and back along the Freezies' stretch, where blocks of living ice slide across.
  // Deep snow off the road everywhere. A full moon, pines and towers of ice blocks round it all.
  en2: {
    id: "sherbet", scale: 1.36, road: 180, gate: "ice", cup: "elnath", music: "k_elnath2", name: "Frost Rink", sub: "the skating rink · ice cave · living ice blocks", icon: "🧊",
    ctrl: [[256, 1062, 20], [346, 1216, 16], [456, 1382, 10], [614, 1485, 4], [794, 1510, 2], [960, 1580, 0], [1120, 1660, 0], [1331, 1664, 0], [1536, 1590, 0], [1740, 1505, 4],
      [1860, 1482, 6], [1935, 1420, 9], [1948, 1340, 11], [1885, 1268, 13], [1741, 1215, 16], [1536, 1140, 20], [1331, 1165, 24], [1180, 1165, 27], [1075, 1105, 29], [1055, 1000, 30],
      [1115, 905, 28], [1120, 790, 24], [1010, 700, 20], [880, 640, 18], [840, 530, 18], [910, 445, 18], [1050, 420, 18], [1200, 420, 19], [1320, 380, 20], [1360, 290, 22],
      [1290, 200, 24], [1120, 165, 24], [940, 185, 24], [790, 235, 24], [614, 300, 22], [410, 280, 22], [200, 310, 22], [140, 460, 22], [200, 610, 22], [170, 770, 22], [205, 925, 21]],
    theme: { ...TH.elnathNight, flowers: 400, tufts: 0, road: "snow", curb: ["#3a5fc0", "#eef4ff"], aurora: true, fairy: true, drifts: true }, art: { sky: "media/kart/elnath/sky3.webp", strip: "media/kart/elnath/strip3.webp" },
    near: ["en_pine", "en_pine3", "en_pine2"], far: ["en_pine", "en_pine2", "en_pine3", "en_snowpines"], mobs: ["jr_yeti", "pepe"],
    build() {
      makeSnowArt();
      const coins = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      row(I(400, 1310), I(600, 1478), 6, 0);                                    // down the hill to the rink
      row(I(1000, 1600), I(1400, 1650), 8, j => Math.sin(j * .9) * 70);        // weaving across the rink
      row(I(1180, 1165), I(1115, 905), 6, 0);                                   // inside the ice cave
      row(I(1120, 165), I(800, 235), 6, -35);                                   // over the top
      // ⛸ the rink's skaters: Jr. Yetis gliding round in rings (bump one and you spin out, like the Skating Shy Guys)
      const skaters = [[I(1030, 1610), 0, 170, 16], [I(1200, 1665), 2.1, 190, 22], [I(1360, 1660), 4.2, 160, 16]]
        .map(([i, ph, amp, loop]) => ({ i, ph, amp, loop, k: "jr_yeti", sp: .75, s: .5 }));
      // 🧊 the Freezies: blocks of ice sliding to and fro across the last stretch (they spin you out, like Mario Kart 8's)
      const freezies = [[I(700, 270), 0], [I(560, 290), 1.6], [I(420, 282), 3.2], [I(290, 290), .8], [I(190, 340), 2.4]].map(([i, ph]) => ({ i, ph, k: "freezie", sp: .55, s: .55 }));
      return {
        lake: { cx: ws(1170), cy: ws(1625), rx: ws(330), ry: ws(130), kind: "ice" },   // the frozen rink
        caves: [{ a: I(1440, 1150), b: I(1115, 820), crystal: true }],                 // the crystal cave through the S-bends (glowing crystals inside, big crystals crowning it)
        hedges: [{ i: I(1060, 1630), o: 150, w: 40, h: 30, sprite: "ice_rock" }, { i: I(1290, 1665), o: -165, w: 40, h: 30, sprite: "ice_rock" }],   // little rock islands on the rink
        pads: [],
        coins,
        pigs: [...skaters, ...freezies],
        boxes: [...boxRow(I(700, 1500), [-60, -20, 20, 60]), ...boxRow(I(1890, 1290), [-60, -20, 20, 60]), ...boxRow(I(1050, 420), [-60, -20, 20, 60])],
        extra(push) {
          // towers and walls of ice blocks round the rink and along the Freezies' stretch
          // 🏰 the ice castle: the rink is its courtyard, chubby round towers along both long sides with battlemented walls between them
          { const cx = ws(1170), cy = ws(1625), ex = ws(330) + 85, ey = ws(130) + 75, pt = a => [cx + Math.cos(a) * ex, cy + Math.sin(a) * ey];
            for (const side of [0, 1]) { const ts = [.2, .35, .5, .65, .8].map(f => Math.PI * (side + f)), ok = ts.map(a => roadDist(...pt(a)) > ROAD / 2 + CURB + 55);
              ts.forEach((a, k) => { if (ok[k]) { const [x, y] = pt(a); BUILDINGS.push({ x, y, w: k === 2 ? 92 : 74, d: k === 2 ? 92 : 74, h: k === 2 ? 190 : k % 2 ? 120 : 150, castle: "tower" }); } });
              for (let k = 0; k < 4; k++) { if (!ok[k] || !ok[k + 1]) continue; const [x1, y1] = pt(ts[k]), [x2, y2] = pt(ts[k + 1]); let clearW = true; for (let f = 0; f <= 1; f += .125) if (roadDist(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f) < ROAD / 2 + CURB + 35) clearW = false;
                if (clearW) BUILDINGS.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.hypot(x2 - x1, y2 - y1), d: 26, h: 78, a: Math.atan2(y2 - y1, x2 - x1), castle: "wall" }); } } }
          for (const [i, o, h] of [[I(650, 290), -150, 150], [I(480, 285), 160, 110], [I(330, 285), -160, 170], [I(220, 300), 170, 120]]) { const [x, y] = at(i, o); BUILDINGS.push({ x, y, w: 70, d: 70, h, a: tangent(i), castle: "tower" }); }   // towers along the Freezies' stretch
          // 🏮 lamps down the hill to the rink and along the top, benches by the rink for the spectators (maplestory.io)
          for (const [a, b] of [[I(346, 1216), I(614, 1485)], [I(1120, 165), I(410, 280)]]) for (let i = a, n = 0; i < b; i += 20, n++) { const [x, y] = at(i, (n % 2 ? 1 : -1) * (ROAD / 2 + CURB + 22)); if (roadDist(x, y) > ROAD / 2 + CURB + 10) push(x, y, "en_lamp"); }
          for (const [i, o] of [[I(960, 1580), 230], [I(1331, 1664), -230], [I(1120, 1660), 240]]) { const [x, y] = at(i, o); if (roadDist(x, y) > ROAD / 2 + CURB + 40) push(x, y, "en_bench"); }
          for (const [i, o] of [[I(1290, 200), 150], [I(1050, 170), -150], [I(900, 190), 150], [I(1360, 290), -150]]) { const [x, y] = at(i, o); OBJS.push({ x, y, k: "snowman_big", s: .8, r: 20, z: 0 }); }   // snowmen along the top (added in Mario Kart 8)
          for (const [x, y, sc] of [[700, 900, 1.2], [1500, 800, 1.3], [520, 560, 1], [1650, 420, 1.1]]) OBJS.push({ x: ws(x), y: ws(y), k: "icicle", s: sc, r: 30, z: 0 });   // crystal spires
        },
      };
    },
  },
  // 3. Mount El Nath (after Mario Kart 8's Mount Wario, made a 3-lap loop so the pack stays together): off the summit on a glider, round
  // into the ice cave with its Cold Eyes and out over the ravine on another glider, past the two flat rocks and up the boost ramp to the
  // dam, down the spillway streams, through the forest split (rocks to trick off), down the slalom run to the ski jump (a glide through
  // three boost rings), then the long climb back up the east face to the summit.
  en3: {
    id: "mtelnath", scale: 1.18, road: 180, gate: "ice", cup: "elnath", music: "k_elnath3", name: "Mount El Nath", sub: "glider jumps · the dam · the ski jump · the climb", icon: "🏔️",
    ctrl: [[1700, 300, 300], [1560, 300, 300], [1420, 305, 298], [1200, 320, 270], [1000, 340, 255], [800, 320, 245], [600, 300, 236], [430, 330, 228], [310, 430, 220], [290, 580, 210],
      [380, 690, 200], [550, 730, 190], [750, 740, 180], [1000, 750, 160], [1180, 760, 150], [1350, 790, 145], [1520, 860, 140], [1640, 980, 130], [1650, 1120, 120], [1560, 1250, 105],
      [1380, 1300, 95], [1180, 1320, 85], [980, 1330, 75], [760, 1330, 65], [560, 1340, 55], [400, 1400, 48], [330, 1520, 42], [400, 1640, 36], [560, 1700, 30], [700, 1710, 26],
      [1150, 1720, 15], [1400, 1700, 12], [1620, 1640, 20], [1790, 1520, 40], [1910, 1340, 75], [1950, 1120, 115], [1950, 900, 160], [1930, 700, 205], [1890, 520, 250], [1830, 380, 285]],
    theme: { ...TH.elnath, mountain: true, flowers: 500, tufts: 0, road: "snow", curb: ["#c8302a", "#f4f8ff"] }, art: { sky: "media/duel/bg_elnath.webp", strip: "media/kart/elnath/strip1.webp" },
    near: ["en_pine", "en_pine3", "en_pine2"], far: ["en_pine", "en_pine2", "en_pine3", "en_snowpines", "en_house1", "en_house3"], mobs: ["cold_eye", "jr_yeti"],
    build() {
      makeSnowArt(); makePetsArt();
      const u = d => Math.round(d / SPC), coins = [], pads = [], gaps = [], rings = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      // a glider jump: the ramp, then a ravine (fall short and you're put back before it)
      const glide = (x, y, len) => { const a = I(x, y); pads.push({ t: "glide", i: a - 7, len: 6, o: 0, w: ROAD }); gaps.push({ a, b: a + u(len), kind: "chasm", caps: [] }); return a; };
      glide(1420, 305, 300);                                   // off the summit
      const cave = { a: I(400, 700), b: I(750, 740), rock: true };
      const g2 = glide(780, 742, 420);                         // out of the cave, over the ravine
      pads.push({ t: "boost", i: I(1180, 760), len: 10, o: -45, w: 60 }, { t: "boost", i: I(1350, 790), len: 10, o: 45, w: 60 });   // the two flat rocks
      pads.push({ t: "boost", i: I(1520, 860) - 12, len: 8, o: 0, w: 70 }, { t: "ramp", i: I(1520, 860), len: 8, o: 0, w: ROAD });     // the boost ramp to the dam
      for (const [x, y, o] of [[1380, 1300, -40], [1280, 1310, 40], [1180, 1320, -40]]) pads.push({ t: "boost", i: I(x, y), len: 10, o, w: 55 });   // down the spillway streams
      for (const [x, y, o] of [[900, 1330, -45], [700, 1335, 45]]) pads.push({ t: "ramp", i: I(x, y), len: 6, o, w: 70 });   // rocks to trick off
      for (const [x, y] of [[560, 1700], [620, 1705]]) pads.push({ t: "boost", i: I(x, y), len: 10, o: 0, w: 80 });                // down the ski jump
      const g3 = glide(700, 1710, 480);                        // the ski jump's glide…
      for (const [d, z, o] of [[160, 150, 0], [290, 180, 25], [420, 160, -25]]) rings.push({ i: g3 + u(d), o, z, r: 42 });     // …through three boost rings
      // 🔢 coins
      row(I(1200, 320) + 6, I(800, 320), 6, j => Math.sin(j) * 40); row(cave.a + 8, cave.b - 8, 5, 0); row(I(1640, 980), I(1560, 1250), 6, -35);
      row(I(400, 1640), I(560, 1700), 5, j => (j & 1 ? 40 : -40)); row(I(1620, 1640), I(1950, 1120), 7, 0); row(I(1930, 700), I(1830, 380), 5, 30);
      for (let n = 0; n < 4; n++) { const [x, y] = at(g2 + u(80 + n * 90), 0); coins.push({ x, y, z: 120 + 40 * Math.sin(n / 3 * Math.PI), got: false }); }   // a trail over the ravine
      return {
        plane: { i: I(1560, 300), o: -(ROAD / 2 + CURB + 120) },   // ✈ parked at the summit
        gaps, caves: [cave], rings, pads, coins,
        fork: { a: I(980, 1330), b: I(560, 1340), via: [[ws(880), ws(1250)], [ws(660), ws(1255)]], width: 140, style: "cobble" },   // 🌲 the forest split
        pigs: [{ i: I(1350, 790), ph: 0, k: "jr_yeti", sp: .7, soft: true, s: .55 }, { i: I(1400, 1700), ph: 2, k: "jr_yeti", sp: .8, soft: true, s: .55 }],   // snowboarding yetis drifting across
        boxes: [...boxRow(I(1000, 340), [-60, -20, 20, 60]), ...boxRow(I(1000, 750), [-60, -20, 20, 60]), ...boxRow(I(1560, 1250), [-60, -20, 20, 60]), ...boxRow(I(330, 1520), [-60, -20, 20, 60]), ...boxRow(I(1950, 1000), [-60, -20, 20, 60])],
        extra(push) {
          // 🌊 the dam along the outside of the bend, and the spillway wall
          for (const [x0, y0, x1, y1] of [[1520, 860, 1640, 980], [1640, 980, 1650, 1120], [1650, 1120, 1560, 1250]]) { const i0 = I(x0, y0), i1 = I(x1, y1), [ax, ay] = at(i0, -(ROAD / 2 + CURB + 40)), [bx, by] = at(i1, -(ROAD / 2 + CURB + 40));
            BUILDINGS.push({ x: (ax + bx) / 2, y: (ay + by) / 2, w: Math.hypot(bx - ax, by - ay) + 30, d: 40, h: 150, a: Math.atan2(by - ay, bx - ax), dam: true }); }
          { const i0 = I(1380, 1300), i1 = I(1180, 1320), [ax, ay] = at(i0, -(ROAD / 2 + CURB + 40)), [bx, by] = at(i1, -(ROAD / 2 + CURB + 40));
            BUILDINGS.push({ x: (ax + bx) / 2, y: (ay + by) / 2, w: Math.hypot(bx - ax, by - ay), d: 40, h: 140, a: Math.atan2(by - ay, bx - ax), dam: true }); }
          // 🌲 the wood between the two forest roads, and pines round the ski run
          for (let n = 0; n < 7; n++) push(ws(640 + n * 32), ws(1288 + (n & 1) * 12), n % 2 ? "en_pine" : "en_pine3");
          // ⛷ slalom flags down to the ski jump
          for (let i = I(330, 1520), n = 0; i < I(560, 1700); i += 14, n++) { const [x, y] = at(i, (n & 1 ? 1 : -1) * (ROAD / 2 + CURB + 6)); OBJS.push({ x, y, k: n & 1 ? "flag_r" : "flag_b", s: .5, r: 0, z: 0 }); }
          // 👁 Cold Eyes floating in the cave (the Swoopers)
          for (let n = 0; n < 5; n++) { const [x, y] = at(cave.a + 10 + n * 12, (n & 1 ? 1 : -1) * 55); OBJS.push({ x, y, k: "cold_eye", s: .45, r: 0, z: 60, bob: 10, mob: true }); }
          // banners across the road a third and two thirds round, the log cabin by the line, hot-air balloons, icicles
          for (const f of [1 / 3, 2 / 3]) { const i = Math.round(N * f); for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB + 8)); OBJS.push({ x, y, k: "ice_post", s: .9, r: 0, z: 0 }); }
            const [x, y] = at(i, 0); OBJS.push({ x, y, k: "ice_banner", s: .5, r: 0, z: 118 }); }
          { const i = N - 30, [x, y] = at(i, ROAD / 2 + CURB + 170); BUILDINGS.push({ x, y, w: 260, d: 160, h: 110, a: tangent(i), wall: "#8a5a32", roof: "#5a3420" }); }
          for (const [x, y, z] of [[700, 1020, 420], [1300, 560, 520], [250, 1150, 600], [1650, 1500, 700]]) OBJS.push({ x: ws(x), y: ws(y), k: "hotair", s: 1.2, r: 0, z, bob: 18 });
          for (const [x, y, sc] of [[1100, 520, 1.3], [450, 1050, 1.2], [1250, 1520, 1.1]]) OBJS.push({ x: ws(x), y: ws(y), k: "icicle", s: sc, r: 30, z: 0 });
        },
      };
    },
  },
  // ---- Sleepywood Cup 🌙: the deep forest. Fun to challenging: Treetop Village, Golden Temple Jungle, Phantom Lake.
  // 1. Wild Woods (Mario Kart 8): up the trunk of a giant tree from the start; the road splits (coins one way, trick ramps the other); through
  // the tree-house village where the mushrooms live; off the end of the village on a glider, over the void to a round platform; down the
  // winding boardwalk with a stream running down its middle; out into the shallow pond with giant leaves carrying boost pads; one last ramp
  // over the water onto the boardwalk, and the detour round to the line.
  sw1: {
    id: "woods", scale: 1.7, road: 180, cup: "sleepy", music: "k_sleepy1", name: "Treetop Village", sub: "the giant tree · tree-house village · glider · leaf pond", icon: "🌳",
    ctrl: [[328, 640, 70], [328, 486, 78], [384, 358, 88], [538, 256, 98], [742, 210, 106], [947, 192, 112], [1101, 243, 116], [1203, 371, 118], [1357, 474, 120], [1536, 499, 122],
      [1690, 550, 122], [1766, 678, 122], [1690, 806, 121], [1562, 870, 120], [1075, 1050, 80], [947, 1126, 77], [858, 1242, 72], [883, 1344, 66], [1011, 1421, 58], [1101, 1536, 48],
      [1075, 1651, 38], [947, 1741, 28], [794, 1741, 18], [640, 1664, 6], [538, 1536, 0], [486, 1382, 0], [499, 1229, 8], [512, 1075, 24], [550, 909, 40], [461, 814, 52], [358, 755, 62]],
    theme: { ...TH.sleepy, road: "planks", tufts: 9000, flowers: 900 }, art: { sky: "media/duel/bg_sleepy.webp", strip: "media/kart/sleepy/strip1.webp" },
    near: ["sw_fern", "sw_flower", "sw_bush", "sw_shrooms", "sw_puff", "sw_lamp"], far: ["sw_treehouse", "sw_hut", "sw_tree", "sw_tree", "sw_stump", "sw_vine"],
    mobs: ["horny_mushroom", "zombie_mushroom", "evil_eye"],
    build() {
      const u = d => Math.round(d / SPC), coins = [], pads = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      const fa = I(742, 210), fb = I(1203, 371);
      row(fa + 12, fb - 12, 8, 0);                                                          // the coin road (the other one has the trick ramps)
      // 🪂 off the end of the village and over the void
      const gl = I(1562, 870); pads.push({ t: "glide", i: gl - 7, len: 6, o: 0, w: ROAD });
      const gap = { a: gl, b: gl + u(600), kind: "chasm", caps: [] };   // (a glider carries about 670+ units even at 50cc)
      for (let n = 0; n < 6; n++) { const [x, y] = at(gl + u(90 + n * 120), 0); coins.push({ x, y, z: 110 + 50 * Math.sin(n / 5 * Math.PI), got: false }); }
      // 🌊 the stream down the boardwalk (its current gives you a push)
      const sa = I(947, 1126), sb = I(947, 1741);
      for (const f of [.2, .45, .7]) pads.push({ t: "boost", i: Math.round(sa + (sb - sa) * f), len: 8, o: 0, w: 46 });
      // 🍃 the leaf pond: boost pads on giant leaves
      const leaves = [[I(720, 1712), 50], [I(600, 1610), -55], [I(530, 1500), 45]].map(([i, o]) => ({ i, o, r: 46 }));
      for (const l of leaves) pads.push({ t: "boost", i: l.i - 4, len: 8, o: l.o, w: 52 });
      // the last ramp, over the water onto the boardwalk
      const lr = I(492, 1290); pads.push({ t: "bigramp", i: lr - 8, len: 7, o: 0, w: ROAD });
      return {
        gaps: [gap, { a: lr, b: lr + u(170), kind: "water", caps: [] }],
        lake: { cx: ws(610), cy: ws(1580), rx: ws(200), ry: ws(185), kind: "shallow" },
        streams: [{ a: sa, b: sb, w: 56 }], leaves, pads, coins,
        fork: { a: fa, b: fb, via: [[ws(870), ws(330)], [ws(1060), ws(405)]], width: 140, style: "planks", pads: [{ t: "ramp", j: .3, len: 6, o: 0, w: 110 }, { t: "ramp", j: .62, len: 6, o: 0, w: 110 }] },
        // 🍄 the village folk wandering across the road
        pigs: [{ i: I(1450, 490), ph: 0, k: "horny_mushroom", sp: .7, soft: true, s: .5 }, { i: I(1650, 530), ph: 2, k: "zombie_mushroom", sp: .6, soft: true, s: .5 }, { i: I(1740, 720), ph: 4, k: "horny_mushroom", sp: .75, soft: true, s: .5 }],
        boxes: [...boxRow(I(538, 256), [-60, -20, 20, 60]), ...boxRow(I(1075, 1050) + 8, [-60, -20, 20, 60]), ...boxRow(I(486, 1382) - 6, [-60, -20, 20, 60])],
        extra(push) {
          // 🏡 the tree-house village round the hook at the far end
          for (let i = I(1357, 474), n = 0; i < I(1562, 870); i += 14, n++) { const [x, y] = at(i, (n & 1 ? 1 : -1) * (ROAD / 2 + CURB + 75)); push(x, y, n % 3 === 2 ? "sw_hut" : "sw_treehouse"); }
          for (let i = I(1357, 474); i < I(1562, 870); i += 9) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB + 10)); OBJS.push({ x, y, k: "sw_lamp", s: .32, r: 0, z: 0 }); }
          // 🌳 the giant tree you climb at the start
          { const [x, y] = at(I(328, 560), -(ROAD / 2 + CURB + 120)); OBJS.push({ x, y, k: "sw_tree", s: 2.2, r: 60, z: 0 }); }
          for (const [x, y] of [[700, 700], [1300, 700], [1300, 1300], [300, 1200], [1500, 1600], [900, 1550]]) push(ws(x), ws(y), "sw_tree");
          for (let n = 0; n < 8; n++) { const a = n / 8 * 6.28, [x, y] = [ws(610) + Math.cos(a) * (ws(200) + 40), ws(1580) + Math.sin(a) * (ws(185) + 40)]; if (roadDist(x, y) > ROAD / 2 + CURB + 30) push(x, y, n & 1 ? "sw_lily" : "sw_fern"); }
        },
      };
    },
  },
  // 2. DK Jungle (Mario Kart 7 / 8): out of the start into the jungle, where the road splits round a giant tree with roots to trick off; a dash
  // panel onto the giant red flower that bounces you on; the high road curving down past the tree house, stumps wandering across (the Tiki
  // Goons); the long wooden bridge; the second jungle's S; two jumps over a chasm into the golden temple (a right, a U-turn, a dash up the
  // slope); a glide out of the temple over the shallow lake past the stone pillars; the lakeside run and the last split with trick ramps.
  sw2: {
    id: "jungle", scale: 1.6, road: 180, cup: "sleepy", music: "k_sleepy2", name: "Golden Temple Jungle", sub: "giant flower bounce · golden temple · glide over the lake", icon: "🛕",
    ctrl: [[1626, 1403, 40], [1600, 1203, 44], [1741, 1075, 50], [1818, 973, 54], [1792, 845, 58], [1741, 742, 60], [1702, 614, 62], [1664, 461, 62], [1638, 333, 60], [1536, 192, 56], [1434, 179, 52],
      [1280, 282, 46], [1178, 410, 40], [1075, 486, 36], [922, 520, 34], [800, 470, 34], [680, 440, 34], [600, 520, 34], [660, 630, 36], [780, 700, 40], [800, 800, 44], [755, 890, 48], [690, 1000, 52],
      [600, 1170, 60], [500, 1260, 66], [370, 1230, 70], [250, 1290, 72], [240, 1410, 74], [330, 1480, 74], [450, 1505, 74], [614, 1536, 72], [768, 1600, 60], [845, 1702, 20], [1075, 1725, 12],
      [1331, 1766, 10], [1580, 1805, 12], [1720, 1790, 16], [1800, 1710, 22], [1770, 1620, 28], [1680, 1560, 34], [1640, 1480, 38]],
    theme: { ...TH.sleepy, road: "dirt", grass: ["#3f6a2a", "#386026"], tufts: 14000, flowers: 1200 }, art: { sky: "media/duel/bg_sleepy.webp", strip: "media/kart/sleepy/strip2.webp" },
    near: ["sw_fern", "sw_bush", "sw_leaf", "sw_shrooms", "sw_vine", "sw_flower"], far: ["sw_tree", "sw_tree", "sw_treehouse", "sw_temple", "sw_ruin", "sw_ruin2"],
    mobs: ["stump", "evil_eye", "curse_eye"],
    build() {
      makeSnowArt();
      const u = d => Math.round(d / SPC), coins = [], pads = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      const fa = I(1741, 1075), fb = I(1720, 760);                                            // the split round the giant tree
      pads.push({ t: "boost", i: I(1712, 680), len: 8, o: 0, w: 70 }, { t: "shroom", i: I(1702, 614), len: 8, o: 0, w: 120, col: "r" });   // dash panel, then the giant red flower
      const bridge = { a: I(1280, 282), b: I(1075, 486) };                                     // 🪵 the long wooden bridge
      // two jumps over the chasm, dash panels before each
      const j1 = I(778, 860), j2 = I(705, 975);
      pads.push({ t: "boost", i: j1 - 16, len: 6, o: 0, w: 70 }, { t: "bigramp", i: j1 - 5, len: 5, o: 0, w: ROAD }, { t: "boost", i: j2 - 16, len: 6, o: 0, w: 70 }, { t: "bigramp", i: j2 - 5, len: 5, o: 0, w: ROAD });   // (big jumps: they carry you over even if you come in slow)
      const temple = { a: I(600, 1170), b: I(560, 1525), temple: true };
      pads.push({ t: "boost", i: I(330, 1480), len: 8, o: 0, w: 70 });                        // the dash up the temple slope
      const gl = I(700, 1570); pads.push({ t: "glide", i: gl - 7, len: 6, o: 0, w: ROAD });     // 🪂 out of the temple, over the lake
      // the last split: a rock in the middle, a trick ramp each side
      const sp = I(1790, 1690);
      pads.push({ t: "ramp", i: sp, len: 6, o: -55, w: 60 }, { t: "ramp", i: sp, len: 6, o: 55, w: 60 });
      row(I(1600, 1203), I(1741, 1075), 5, 0); row(bridge.a + 6, bridge.b - 6, 7, 0); row(I(1075, 1725), I(1500, 1790), 7, j => (j & 1 ? 35 : -35));
      return {
        gaps: [{ a: j1, b: j1 + u(75), kind: "chasm", caps: [] }, { a: j2, b: j2 + u(75), kind: "chasm", caps: [] }],
        lake: { cx: ws(930), cy: ws(1660), rx: ws(230), ry: ws(120), kind: "shallow" },
        caves: [temple], planks: [bridge], pads, coins,
        fork: { a: fa, b: fb, via: [[ws(1680), ws(960)], [ws(1665), ws(850)]], width: 140, style: "dirt", pads: [{ t: "ramp", j: .45, len: 6, o: 0, w: 100 }] },
        hedges: [{ i: sp + 3, o: 0, w: 46, h: 40, sprite: "ice_rock" }],   // the rock between the last two trick ramps
        pigs: [{ i: I(1536, 192), ph: 0, k: "stump", sp: .55, soft: true, s: .55 }, { i: I(1434, 179) + 10, ph: 2.2, k: "stump", sp: .5, soft: true, s: .55 }, { i: I(1178, 410), ph: 4, k: "stump", sp: .6, soft: true, s: .55 }],
        boxes: [...boxRow(I(1600, 1203), [-60, -20, 20, 60]), ...boxRow(I(922, 520), [-60, -20, 20, 60]), ...boxRow(I(1331, 1766), [-60, -20, 20, 60])],
        extra(push) {
          { const [x, y] = at(Math.round((fa + fb) / 2), -95); OBJS.push({ x, y, k: "sw_tree", s: 2.4, r: 50, z: 0 }); }   // 🌳 the giant tree in the split
          { const [x, y] = at(I(1434, 179), -(ROAD / 2 + CURB + 140)); OBJS.push({ x, y, k: "sw_treehouse", s: 1.4, r: 50, z: 0 }); }   // the tree house up on the high road
          for (let i = bridge.a; i <= bridge.b; i += 10) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB + 4)); OBJS.push({ x, y, k: "posts", s: .3, r: 0, z: 0 }); }   // the bridge's rails
          for (const [x, y] of [[860, 1600], [990, 1700], [1080, 1610], [800, 1710]]) { const [bx, by] = [ws(x), ws(y)]; if (roadDist(bx, by) > ROAD / 2 + 60) BUILDINGS.push({ x: bx, y: by, w: 44, d: 44, h: 170, a: .4, stone: true }); }   // 🗿 the pillars in the lake
          for (const [x, y, sc] of [[420, 1360, 1.3], [180, 1150, 1.1], [520, 1660, 1]]) OBJS.push({ x: ws(x), y: ws(y), k: "sw_temple", s: sc, r: 40, z: 0 });
          for (const [x, y] of [[1200, 900], [1400, 1300], [1000, 1200], [500, 800], [1300, 600], [300, 600]]) push(ws(x), ws(y), "sw_tree");
        },
      };
    },
  },
  // 3. Boo Lake (Super Circuit, as remade for Tour and Mario Kart 8 Deluxe): a wooden boardwalk on piles over a dark lake at night, lanterns
  // all along it and flooded dead trees round about. Up from the line and a sharp right onto the jumps (ramps with dash panels over the gaps
  // between boardwalks); down the right side and round the split; orange trick ramps on the long right-hand turn; then the boardwalk dives under
  // the lake: the long diagonal and the twisting J are underwater, with Fish Bones swimming across; three ramps carry you up out of the water
  // to the line. Fall off the edge and you're fished out of the lake. Ghosts drift over the water.
  sw3: {
    id: "boolake", scale: 1.28, road: 180, cup: "sleepy", music: "k_sleepy3", name: "Phantom Lake", sub: "boardwalk over the lake · the underwater stretch · Bone Fish", icon: "👻",
    ctrl: [[294, 768, 20], [294, 512, 20], [320, 294, 20], [448, 205, 20], [678, 205, 20], [973, 205, 20], [1267, 225, 20], [1403, 346, 20], [1413, 576, 20], [1408, 819, 20], [1423, 1050, 20],
      [1567, 1229, 18], [1715, 1385, 14], [1790, 1510, 10], [1745, 1625, 4], [1605, 1630, -10], [1470, 1465, -30], [1216, 1183, -42], [993, 973, -46], [781, 781, -46], [614, 799, -46], [525, 960, -46],
      [527, 1203, -44], [594, 1382, -40], [748, 1449, -34], [824, 1592, -30], [748, 1751, -26], [525, 1792, -20], [320, 1702, -12], [276, 1472, -2], [282, 1203, 8], [287, 986, 16]],
    water: { level: 0, bed: -90 },
    theme: { ...TH.sleepy, road: "planks", grass: ["#1d3550", "#1a3048"], flowers: 0, tufts: 0, hills: 1, curb: ["#4a3420", "#8a6a42"] }, art: { sky: "media/kart/sleepy/sky2.webp", strip: "media/kart/sleepy/strip2.webp" },
    near: [], far: ["sw_deadtree", "sw_deadtree2", "sw_deadtree", "sw_hotel"], mobs: ["wraith", "evil_eye"],
    build() {
      makeSnowArt();
      const u = d => Math.round(d / SPC), coins = [], pads = [], gaps = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      // the jumps along the top: a ramp with a dash panel, over the gap to the next boardwalk
      for (const x of [560, 1010]) { const g = I(x, 205);   // (far enough apart that you land before the next ramp)
        pads.push({ t: "boost", i: g - 15, len: 6, o: 0, w: 70 }, { t: "bigramp", i: g - 5, len: 5, o: 0, w: ROAD }); gaps.push({ a: g, b: g + u(75), kind: "water", caps: [] }); }
      const split = I(1408, 819);                                                        // the split: a stump in the middle of the boardwalk
      for (const [x, y, o] of [[1700, 1360, -50], [1780, 1490, 50], [1760, 1590, -50]]) pads.push({ t: "ramp", i: I(x, y), len: 6, o, w: 60 });   // the orange trick ramps round the long turn
      for (const o of [-60, 0, 60]) pads.push({ t: "ramp", i: I(278, 1300), len: 6, o, w: 52 });   // three ramps up out of the water
      row(I(640, 205), I(900, 205), 6, 0); row(split - 14, split + 14, 5, -55); row(split - 14, split + 14, 5, 55); row(I(1216, 1183), I(781, 781), 7, j => (j & 1 ? 40 : -40)); row(I(282, 1203), I(287, 986), 5, 0);
      // 🐟 Fish Bones swimming across the underwater stretch
      const fish = [[I(1216, 1183), 0], [I(993, 973), 1.7], [I(614, 799), 3.1], [I(527, 1203), .8], [I(748, 1449), 2.4], [I(525, 1792), 4]].map(([i, ph]) => ({ i, ph, k: "fishbone", sp: .8, s: .55 }));
      return {
        gaps, pads, coins, pigs: fish,
        hedges: [{ i: split, o: 0, w: 40, h: 34, sprite: "ice_rock" }],
        boxes: [...boxRow(I(1403, 346), [-60, -20, 20, 60]), ...boxRow(I(1715, 1385), [-60, -20, 20, 60]), ...boxRow(I(320, 1702), [-60, -20, 20, 60])],
        extra(push) {
          // 🏮 lanterns all along the boardwalk's edges
          for (let i = 6, n = 0; i < N; i += 16, n++) { if (gaps.some(g => i >= g.a - 2 && i <= g.b + 2)) continue; const [x, y] = at(i, (n & 1 ? 1 : -1) * (ROAD / 2 + CURB - 6)); OBJS.push({ x, y, k: "sw_lamp", s: .34, r: 0, z: 0 }); }
          // 👻 ghosts drifting over the water
          for (const [x, y, z] of [[700, 420, 60], [1150, 420, 80], [1200, 760, 50], [1620, 900, 70], [900, 1500, 60], [450, 1450, 80], [1000, 1800, 60]]) OBJS.push({ x: ws(x), y: ws(y), k: "wraith", s: .5, r: 0, z, bob: 16, mob: true });
          OBJS.push({ x: ws(1000), y: ws(620), k: "sw_hotel", s: 2.6, r: 0, z: 0 });   // the haunted hotel out in the lake
        },
      };
    },
  },
  // ---- Zakum Cup 🔥: normal 3-lap races. Fun to challenging: Golem Ruins, Dead Mine Rails, Zakum's Volcano.
  zk1: {
    // 1. Thwomp Ruins (Mario Kart 8): stone ruins in the Zakum mine. The start straight and two lefts; the long tunnel along the top where Rollers
    // roll out across the road; out of it the road splits round a pool (stay right past a Thwomp, go left past another, or splash straight across
    // the shallow water); in through the Thwomp-mouth tunnel; the zig-zag past two more Thwomps; and a glide off the ledge back down to the line.
    id: "thwomp", scale: 1.7, road: 180, cup: "zakum", music: "k_zakum1", name: "Golem Ruins", sub: "Block Golems · boulders in the tunnel · the pool split · glide home", icon: "🗿",
    ctrl: [[1567, 768, 40], [1536, 563, 44], [1510, 384, 48], [1382, 302, 50], [1203, 320, 50], [1050, 461, 48], [845, 384, 44], [589, 243, 38], [307, 179, 32], [141, 294, 26], [159, 525, 18],
      [218, 691, 12], [525, 845, 10], [563, 1101, 10], [512, 1280, 14], [576, 1459, 22], [678, 1741, 30], [845, 1766, 32], [1024, 1640, 34], [1150, 1580, 36], [1300, 1640, 38], [1485, 1592, 46],
      [1766, 1395, 58], [1792, 1203, 40], [1690, 1024, 38], [1613, 896, 39]],
    theme: { ...TH.mine, tufts: 8000, flowers: 300 }, art: { sky: "media/kart/zakum/sky1.webp", strip: "media/kart/zakum/strip1.webp" },
    near: ["zk_rocks", "zk_rocks2", "zk_lantern", "zk_logs"], far: ["zk_rocks", "zk_rocks2", "zk_crane", "zk_board", "zk_lantern"], mobs: ["fire_boar", "drake"],
    build() {
      makeSnowArt();
      const u = d => Math.round(d / SPC), coins = [], pads = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      const tunnel = { a: I(1000, 440), b: I(250, 210), rock: true, mound: 0x5a5560 }, mouth = { a: I(530, 1330), b: I(610, 1560), rock: true, mound: 0x5a5560 };
      const rollers = [I(800, 370), I(600, 250), I(420, 200)].map((i, n) => ({ i, ph: n * 2.1, k: "roller", sp: .9, s: .6 }));
      const fa = I(218, 691), fb = I(512, 1280);
      const gl = I(1766, 1395); pads.push({ t: "glide", i: gl - 7, len: 6, o: 0, w: ROAD });   // 🪂 off the ledge, back down to the line
      pads.push({ t: "boost", i: I(1300, 1640), len: 8, o: 0, w: 70 }, { t: "boost", i: I(141, 294) + 6, len: 8, o: 0, w: 70 });
      row(I(1536, 563), I(1382, 302), 6, 0); row(tunnel.a + 10, tunnel.b - 10, 8, j => (j & 1 ? 35 : -35)); row(mouth.a + 6, mouth.b - 6, 5, 0); row(I(845, 1766), I(1300, 1640), 6, 30);
      return {
        gaps: [{ a: gl, b: gl + u(420), kind: "chasm", caps: [] }], caves: [tunnel, mouth], pads, coins, pigs: rollers,
        lake: { cx: ws(385), cy: ws(1000), rx: ws(135), ry: ws(225), kind: "shallow" },   // the pool in the middle of the split
        fork: { a: fa, b: fb, via: [[ws(185), ws(900)], [ws(235), ws(1120)], [ws(360), ws(1275)]], width: 150, style: "cobble" },
        thwomps: [{ i: I(552, 980), o: 0, ph: 0 }, { x: ws(200), y: ws(1010), ph: 1.1 }, { i: I(845, 1766), o: -45, ph: 2.2 }, { i: I(1150, 1580), o: 45, ph: .6 }],
        boxes: [...boxRow(I(1203, 320), [-60, -20, 20, 60]), ...boxRow(I(218, 691), [-60, -20, 20, 60]), ...boxRow(I(1485, 1592), [-60, -20, 20, 60])],
        extra(push) {
          for (const [i, sd] of [[I(1567, 700), 1], [I(1550, 600), -1], [I(1530, 480), 1], [I(678, 1741), -1], [I(1024, 1640), 1], [I(1485, 1592), -1]]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB + 40)); BUILDINGS.push({ x, y, w: 40, d: 40, h: 150, a: tangent(i), stone: true }); }   // ruined pillars
          for (let i = tunnel.a; i < tunnel.b; i += 14) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB - 4)); OBJS.push({ x, y, k: "zk_lantern", s: .3, r: 0, z: 0 }); }   // the tunnel's orange lamps
        },
      };
    },
  },
  zk2: {
    // 2. Wario's Gold Mine (Mario Kart Wii / 8): the Zakum mine at dusk. From the line a slight right, a dash pad down into the dip (item boxes at
    // the bottom) and up again; round the top and into the tunnel where bats flit about; inside the mine a right, down and up, then a ramp with a
    // boost across the dark chasm; mine carts trundle along the rails (bump one and it shoves you on); out of the mine down the dipping road and
    // the twisting stretch, and a right at the line. No railings in the mine or on the twisty bit: drive off the edge and you fall.
    id: "goldmine", scale: 1.65, road: 180, cup: "zakum", music: "k_zakum2", name: "Dead Mine Rails", sub: "mine carts · the chasm jump · no railings", icon: "⛏️",
    ctrl: [[179, 1306, 60], [307, 1126, 58], [480, 1010, 40], [640, 922, 30], [768, 768, 42], [845, 512, 56], [800, 330, 60], [740, 200, 60], [790, 110, 58], [920, 95, 56], [1178, 230, 52],
      [1536, 435, 44], [1860, 500, 36], [1930, 666, 24], [1880, 820, 30], [1818, 930, 40], [1754, 1120, 26], [1741, 1280, 18], [1613, 1459, 10], [1357, 1613, 20], [1101, 1677, 30], [845, 1638, 36],
      [512, 1562, 46], [260, 1510, 54], [150, 1420, 58]],
    theme: { ...TH.mine, road: "planks", curb: ["#6a4424", "#c8a23a"], tufts: 6000, flowers: 200 }, art: { sky: "media/kart/zakum/sky1.webp", strip: "media/kart/zakum/strip1.webp" },
    near: ["zk_crate", "zk_logs", "zk_lantern", "zk_rocks"], far: ["zk_crane", "zk_rig", "zk_board", "zk_rocks2", "zk_logs"], mobs: ["fire_boar", "drake"],
    build() {
      makeSnowArt();
      const u = d => Math.round(d / SPC), coins = [], pads = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      pads.push({ t: "boost", i: I(307, 1126), len: 10, o: 0, w: 80 });                            // the dash pad down into the dip
      const tunnel = { a: I(1178, 230), b: I(1700, 460), rock: true, mound: 0x4a4048 };            // the tunnel into the mine (bats)
      const mine = { a: I(1830, 520), b: I(1613, 1459), rock: true, mound: 0x4a4048 };              // inside the mine
      const jp = I(1818, 930); pads.push({ t: "boost", i: jp - 14, len: 6, o: 0, w: 80 }, { t: "bigramp", i: jp - 5, len: 5, o: 0, w: ROAD });   // the boost ramp over the chasm
      row(I(480, 1010), I(768, 768), 6, 0); row(tunnel.a + 8, tunnel.b - 8, 6, j => (j & 1 ? 40 : -40)); row(I(1357, 1613), I(845, 1638), 7, j => Math.sin(j) * 45);
      const carts = [{ a: I(1930, 666), b: jp - 16, o: -50, sp: 120, ph: 0 }, { a: I(1930, 666), b: jp - 16, o: 50, sp: 110, ph: 30 }, { a: jp + 30, b: I(1613, 1459), o: -45, sp: 125, ph: 10 }, { a: jp + 30, b: I(1613, 1459), o: 45, sp: 115, ph: 60 }];
      return {
        gaps: [{ a: jp, b: jp + u(170), kind: "chasm", caps: [] }], caves: [tunnel, mine], pads, coins, carts,
        ledges: [{ a: mine.a, b: mine.b }, { a: I(1357, 1613), b: I(845, 1638) }],
        boxes: [...boxRow(I(640, 922), [-60, -20, 20, 60]), ...boxRow(I(1536, 435), [-60, -20, 20, 60]), ...boxRow(I(1741, 1280), [-60, -20, 20, 60])],
        extra(push) {
          for (let n = 0; n < 6; n++) { const [x, y] = at(tunnel.a + 10 + n * 14, (n & 1 ? 1 : -1) * 60); OBJS.push({ x, y, k: "bat", s: .35, r: 0, z: 70, bob: 14 }); }   // 🦇 bats in the tunnel
          for (let i = mine.a; i < mine.b; i += 16) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB - 4)); OBJS.push({ x, y, k: "zk_lantern", s: .3, r: 0, z: 0 }); }   // lamps along the mine road
          for (const [x, y] of [[560, 1180], [1000, 900], [1300, 1300], [400, 700], [1500, 900]]) push(ws(x), ws(y), "zk_crane");
        },
      };
    },
  },
  zk3: {
    // 3. Grumble Volcano (Mario Kart Wii / 8): round the erupting volcano, on rock above a sea of lava (no railings: off the edge is the
    // lava). Down from the line to the split round a rock; up the far side and leap the hexagon stepping stones; through the cave in the
    // volcano's flank and glide out of it; round the summit hairpin and back down to the line. The volcano lobs fireballs onto the road
    // (watch for their shadows), and on laps 2 and 3 more of the road crumbles away into the lava.
    id: "volcano", scale: 1.42, road: 180, cup: "zakum", music: "k_zakum3", name: "Zakum's Volcano", sub: "lava all round · fireballs · the road crumbles on later laps", icon: "🌋",
    ctrl: [[576, 1190, 40], [666, 1382, 34], [794, 1510, 28], [860, 1700, 22], [1040, 1820, 20], [1300, 1830, 22], [1530, 1780, 26], [1792, 1638, 30], [1870, 1520, 34], [1792, 1400, 38], [1600, 1310, 42],
      [1430, 1200, 48], [1340, 1080, 54], [1270, 950, 60], [1210, 840, 64], [1150, 720, 68], [1060, 590, 72], [900, 520, 76], [800, 430, 80], [860, 330, 84], [1020, 300, 88], [1180, 260, 90], [1240, 150, 90],
      [1130, 50, 90], [880, 60, 90], [620, 100, 88], [400, 160, 84], [210, 260, 78], [200, 400, 70], [330, 520, 62], [420, 770, 54], [500, 1000, 46]],
    theme: { ...TH.mine, lava: true, ledgeDrop: 0, sea: -10, skyPic: 2700, grass: ["#c63e12", "#cc4416"], flowers: 0, tufts: 0, road: "basalt", haze: [120, 40, 20] },   // a plain lava sea just below the road edge
    art: { sky: "media/kart/zakum/sky2t.webp" },   // just the lava pillars far away, mirrored upward so they rise tall from the horizon: clean
    near: ["zk_rocks", "zk_rocks2", "zk_skull", "zk_bones"], far: [], mobs: ["fire_boar", "firebomb"],   // (small things only: no big pictures by the narrow road)
    build() {
      const u = d => Math.round(d / SPC), coins = [], pads = [], gaps = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      // the hexagon stepping stones: a leap over the lava
      for (const [x, y] of [[1290, 990]]) { const g = I(x, y); pads.push({ t: "boost", i: g - 15, len: 6, o: 0, w: 70 }, { t: "bigramp", i: g - 5, len: 5, o: 0, w: ROAD }); gaps.push({ a: g, b: g + u(140), kind: "chasm", caps: [] }); }
      const cave = { a: I(1060, 590), b: I(860, 330), rock: true, mound: 0x4a2a20 };
      const gl = I(1000, 300); pads.push({ t: "glide", i: gl - 7, len: 6, o: 0, w: ROAD }); gaps.push({ a: gl, b: gl + u(300), kind: "chasm", caps: [] });   // 🪂 glide out of the cave (Mario Kart 8)
      pads.push({ t: "boost", i: I(420, 770), len: 8, o: 0, w: 70 });
      row(I(860, 1700), I(1300, 1830), 7, 0); row(cave.a + 8, cave.b - 8, 5, 0); row(I(620, 100), I(210, 260), 6, j => (j & 1 ? 40 : -40));
      // 🕳️ the road that crumbles away: on lap 2 a few bites out of its edges, on lap 3 more
      const holes = [[I(666, 1382), 55, 2], [I(1870, 1520), 50, 2], [I(1600, 1310), 55, 2], [I(880, 60), -50, 2], [I(330, 520), 55, 2],
        [I(210, 260), -50, 3], [I(1430, 1200), -55, 3], [I(1130, 50), 50, 3], [I(400, 160), -55, 3], [I(500, 1000), 50, 3]].map(([i, o, lap]) => ({ i, o, r: 38, lap }));
      const fireballs = [[I(1040, 1820), -30, 0], [I(1870, 1520), 30, 1.3], [I(1150, 720), 0, 2.6], [I(620, 100), 25, .7], [I(200, 400), -25, 2]].map(([i, o, ph]) => ({ i, o, ph }));
      // 🔥 bubbling lava patches on the road's edges (they spin you out)
      for (const [x, y, o] of [[1040, 1820, 50], [1600, 1310, -50], [620, 100, -50], [200, 400, 50]]) pads.push({ t: "lava", i: I(x, y), len: 10, o, w: 50 });
      // 🐗 Zakum's creatures: Fire Boars charging across the road, Firebombs hopping across
      const pigs = [[I(1300, 1830), "fire_boar", 0, false], [I(1792, 1400), "firebomb", 1.3, true], [I(880, 60), "fire_boar", 2.6, false], [I(330, 520), "firebomb", .7, true]]
        .map(([i, k, ph, hop]) => ({ i, k, ph, hop, sp: 1, s: .5 }));
      return {
        gaps, caves: [cave], pads, coins, holes, fireballs, pigs,
        ledges: [{ a: 0, b: N - 1 }],
        fork: { a: I(794, 1510), b: I(1530, 1780), via: [[ws(950), ws(1590)], [ws(1200), ws(1650)], [ws(1420), ws(1690)]], width: 140, style: "cobble" },
        boxes: [...boxRow(I(860, 1700), [-60, -20, 20, 60]), ...boxRow(I(1600, 1310), [-60, -20, 20, 60]), ...boxRow(I(620, 100), [-60, -20, 20, 60])],
        extra(push) {
          for (let i = 0; i < N; i += 40) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB - 6)); if (!gaps.some(g => i >= g.a - 3 && i <= g.b + 3)) OBJS.push({ x, y, k: "zk_lantern", s: .28, r: 0, z: 0 }); }   // lamp posts along the edges
        },
      };
    },
  },
  // ---- Ludibrium Cup 🧸: the toy town and its clocktower. Fun to challenging: Ludibrium Clocktower, Toybox Rainbow, Starlight Rainbow.
  ld1: {
    // 1. Tick-Tock Clock (Mario Kart DS / 8): inside Ludibrium's clocktower. The two long diagonals cross over the giant clock face, where the
    // hands sweep round (they knock you spinning); pendulums swing across the road; turning gears carry you round with them; the open stretches
    // at the top and round the far corner have no railings (into the clockwork you go); the big gears near the end throw you forward.
    id: "ticktock", scale: 1.38, road: 180, cup: "ludi", fall: "⚙️ Into the clockwork!", music: "k_ludi3", name: "Ludibrium Clocktower", sub: "the giant clock · pendulums · turning gears", icon: "🕰️",
    ctrl: [[1114, 1664, 20], [1434, 1600, 22], [1620, 1500, 24], [1590, 1330, 30], [1470, 1150, 36], [1331, 883, 40], [1203, 614, 48], [1100, 330, 56], [1150, 160, 60], [1357, 115, 62], [1766, 102, 62],
      [1882, 200, 60], [1766, 410, 54], [1587, 640, 46], [1331, 883, 40], [1203, 1101, 36], [1080, 1230, 34], [880, 1420, 30], [700, 1520, 28], [560, 1470, 26], [440, 1360, 24], [340, 1360, 23],
      [250, 1450, 22], [170, 1600, 20], [190, 1810, 18], [410, 1843, 18], [768, 1766, 18], [973, 1702, 19]],
    theme: { ...TH.clock, flowers: 500 }, art: { sky: "media/kart/ludi/sky3.webp", strip: "media/kart/ludi/strip3.webp" },
    near: ["ld_lamp", "ld_flower2", "ld_banner", "ld_fan"], far: ["ld_h1", "ld_h3", "ld_h5", "ld_clock", "ld_blocks", "ld_lego", "ld_tree2"], mobs: ["chronos", "master_chronos"],
    build() {
      const coins = [], pads = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      for (const [x, y] of [[768, 1766], [410, 1843]]) pads.push({ t: "boost", i: I(x, y), len: 10, o: 0, w: 90 });   // the big gears near the end, turning your way
      row(I(1434, 1600), I(1590, 1330), 6, 0); row(I(1357, 115), I(1766, 102), 7, j => (j & 1 ? 40 : -40)); row(I(1080, 1230), I(700, 1520), 6, 0); row(I(190, 1810), I(768, 1766), 6, -35);
      return {
        lake: { cx: ws(1331), cy: ws(883), rx: ws(230), ry: ws(230), kind: "clock" },   // 🕰️ the giant clock face where the two diagonals cross
        hands: [{ len: ws(205), w: 16, sp: .32, ph: 0 }, { len: ws(140), w: 26, sp: -.12, ph: 2 }],
        gears: [{ i: I(880, 1420), r: 120, w: .55 }, { i: I(560, 1470), r: 120, w: -.55, col: 0xc8c8d8 }],
        pendulums: [{ i: I(1590, 1330), amp: 110, sp: 1.6, ph: 0 }, { i: I(1150, 450), amp: 110, sp: 1.4, ph: 1.3 }],
        ledges: [{ a: I(1150, 160), b: I(1766, 410) }, { a: I(170, 1600), b: I(410, 1843) }],
        pads, coins,
        boxes: [...boxRow(I(1620, 1500), [-60, -20, 20, 60]), ...boxRow(I(1882, 200), [-60, -20, 20, 60]), ...boxRow(I(340, 1360), [-60, -20, 20, 60])],
        extra(push) {
          { const [x, y] = at(14, -(ROAD / 2 + CURB + 60)); OBJS.push({ x, y, k: "ld_clock", s: 1.4, r: 30, z: 0 }); }   // ⏰ the alarm clock by the line
          for (const [x, y, sc] of [[600, 900, 1.6], [1700, 1150, 1.4], [400, 400, 1.3], [1000, 1900, 1.2]]) OBJS.push({ x: ws(x), y: ws(y), k: "ld_clock", s: sc, r: 30, z: 0 });
        },
      };
    },
  },
  ld2: {
    // 2. Rainbow Road (Super Mario Kart, as remade for Mario Kart 7 / 8): a road of glowing rainbow tiles over the night sky above Ludibrium.
    // No railings anywhere (fall off and you're fished back out of space), tight right-angle turns and hairpins, rainbow Thwomps slamming down
    // on the corners, a hole in the middle of the bottom straight (go either side), and Ludibrium's toy houses far below.
    id: "rrsnes", scale: 1.12, road: 180, cup: "ludi", fall: "🌌 Lost in space!", music: "k_ludi1", name: "Toybox Rainbow", sub: "no railings · rainbow Block Golems · hairpins", icon: "🌈",
    ctrl: [[240, 930, 30], [240, 470, 32], [300, 280, 34], [480, 200, 36], [1320, 198, 36], [1520, 260, 36], [1590, 440, 34], [1590, 780, 32], [1518, 900, 30], [1320, 942, 30], [900, 942, 30],
      [750, 1008, 30], [702, 1170, 30], [750, 1302, 30], [930, 1350, 30], [1680, 1350, 32], [1840, 1395, 34], [1910, 1520, 36], [1920, 1740, 36], [1860, 1860, 34], [1650, 1890, 32], [1110, 1890, 30],
      [510, 1890, 30], [318, 1854, 30], [222, 1710, 30], [222, 1230, 30]],
    theme: { space: true, grass: ["#0a0a26", "#0e0e32"], flowers: 2600, flowerCols: ["#ffffff", "#fff3a0", "#c8d8ff", "#ffffff"], stem: null, tufts: 0, road: "rainbow", curb: ["#ffffff", "#ff5ac8"], border: "#0a0a26", sky: "#16103a", out: "#0a0a20", haze: [30, 24, 70], night: .1 },
    art: { sky: "media/kart/ludi/sky3.webp", strip: "media/kart/ludi/strip3.webp" },
    near: [], far: [], mobs: ["chronos"],
    build() {
      const coins = [], pads = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      pads.push({ t: "ramp", i: I(1590, 600), len: 6, o: 0, w: 120 }, { t: "ramp", i: I(1300, 1350), len: 6, o: 0, w: 120 });   // trick ramps (Mario Kart 7 / 8)
      pads.push({ t: "boost", i: I(900, 198), len: 10, o: 0, w: 70 }, { t: "boost", i: I(1400, 1890), len: 10, o: 0, w: 70 });
      row(I(240, 800), I(240, 520), 6, 0); row(I(700, 198), I(1150, 198), 6, j => (j & 1 ? 35 : -35)); row(I(1110, 1890), I(600, 1890), 6, 0);
      const C = [0xff5a7a, 0xffb43a, 0x7ae06a, 0x5ac8ff, 0xb87aff];
      return {
        ledges: [{ a: 0, b: N - 1 }], pads, coins,
        thwomps: [[I(480, 200), -45], [I(1590, 780), 45], [I(750, 1008), -40], [I(1840, 1395), 45], [I(318, 1854), -45]].map(([i, o], n) => ({ i, o, ph: n * .7, col: C[n] })),
        holes: [{ i: I(820, 1890), o: 0, r: 46 }],   // the hole in the middle of the bottom straight
        boxes: [...boxRow(I(1320, 198), [-60, -20, 20, 60]), ...boxRow(I(930, 1350), [-60, -20, 20, 60]), ...boxRow(I(222, 1500), [-60, -20, 20, 60])],
        extra(push) {
          for (let i = 0; i < N; i += 30) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB - 4)); OBJS.push({ x, y, k: "ld_lamp", s: .26, r: 0, z: 0 }); }   // little lights along the edges
        },
      };
    },
  },
  ld3: {
    // 3. Rainbow Road (Mario Kart Wii, as remade for Tour / 8 Deluxe): a narrow pastel rainbow high above the Earth, almost no railings. The long
    // start straight and the drop with its dash panels; up and a dash ramp over a gap; a sharp left, three dash panels and the U-turn with its
    // trick ramps; the wavy straight with item boxes and star bits; another dash ramp; the twisting holes section (red ramps round the holes);
    // a sharp left, a long right and the Star Shooter, which fires you through three star rings over the void; up a left with dash panels to the
    // ring ramp over a gap; the split round a hole with dash panels each side; and the last wide U-turn through the starry tunnel to the line.
    id: "rrwii", scale: 1.15, road: 170, cup: "ludi", fall: "🌍 Fell toward the Earth!", music: "k_ludi2", name: "Starlight Rainbow", sub: "the Star Cannon · star rings · no railings", icon: "🌠",
    ctrl: [[300, 1720, 140], [700, 1730, 120], [1000, 1730, 96], [1250, 1700, 90], [1450, 1640, 104], [1650, 1560, 110], [1820, 1440, 108], [1860, 1250, 106], [1840, 1060, 104], [1750, 930, 102],
      [1600, 930, 100], [1540, 1060, 98], [1420, 1200, 92], [1200, 1250, 100], [1000, 1210, 92], [820, 1240, 96], [640, 1170, 94], [520, 1020, 92], [600, 860, 90], [780, 780, 92], [880, 640, 94],
      [1060, 520, 98], [1300, 520, 104], [1500, 600, 110], [1820, 520, 70], [1880, 340, 74], [1760, 200, 80], [1500, 170, 84], [1200, 180, 86], [880, 200, 86], [600, 240, 84], [420, 330, 82],
      [300, 500, 84], [250, 800, 100], [240, 1150, 120], [250, 1450, 136]],
    theme: { space: true, earth: true, grass: ["#060618", "#0a0a22"], flowers: 2000, flowerCols: ["#ffffff", "#fff3a0", "#c8d8ff", "#ffc8f0"], stem: null, tufts: 0, road: "pastel", curb: ["#fff3a0", "#ffffff"], border: "#060618", sky: "#0a0a2a", out: "#05051a", haze: [16, 14, 46], night: .1 },
    art: { sky: "media/kart/ludi/sky3.webp", strip: "media/kart/ludi/strip3.webp" },
    near: [], far: [], mobs: ["chronos"],
    build() {
      const u = d => Math.round(d / SPC), coins = [], pads = [], gaps = [], rings = [];
      const row = (a, b, n, o, z = 0) => { for (let j = 0; j < n; j++) { const i = a + (b - a) * j / (n - 1), [x, y] = at(i, typeof o === "function" ? o(j) : o); coins.push({ x, y, z, got: false }); } };
      const jump = (x, y, len) => { const g = I(x, y); pads.push({ t: "boost", i: g - 15, len: 6, o: 0, w: 70 }, { t: "bigramp", i: g - 5, len: 5, o: 0, w: ROAD }); gaps.push({ a: g, b: g + u(len), kind: "chasm", caps: [] }); return g; };
      pads.push({ t: "boost", i: I(760, 1730), len: 10, o: 0, w: 80 }, { t: "boost", i: I(860, 1730), len: 8, o: -48, w: 46 }, { t: "boost", i: I(900, 1730), len: 8, o: 48, w: 46 });   // the drop
      jump(1460, 1636, 120);                                                                   // the dash ramp over the first gap
      for (const y of [1330, 1260, 1190]) pads.push({ t: "boost", i: I(1858, y), len: 5, o: 0, w: 60 });   // three dash panels
      pads.push({ t: "ramp", i: I(1700, 905), len: 6, o: -50, w: 50 }, { t: "ramp", i: I(1640, 905), len: 6, o: 50, w: 50 });   // trick ramps round the U-turn (the half-pipe)
      jump(830, 1238, 110);                                                                    // another dash ramp
      pads.push({ t: "ramp", i: I(560, 1080), len: 5, o: 40, w: 60 }, { t: "ramp", i: I(700, 800), len: 5, o: -40, w: 60 });   // red ramps by the holes
      // ⭐ the Star Shooter: fired through three star rings over the void
      const gl = I(1500, 600); pads.push({ t: "glide", i: gl - 7, len: 6, o: 0, w: ROAD }); gaps.push({ a: gl, b: gl + u(380), kind: "chasm", caps: [] });
      for (const [d, z, o] of [[150, 135, 0], [280, 185, 20], [420, 170, -20]]) rings.push({ i: gl + u(d), o, z, r: 42 });
      for (const x of [1820, 1790]) pads.push({ t: "boost", i: I(x, x === 1820 ? 260 : 220), len: 6, o: 0, w: 60 });   // up the left, dash panels
      const rr = jump(1450, 170, 120); rings.push({ i: rr + u(60), o: 0, z: 70, r: 50 });     // the ring ramp over a gap
      for (const o of [-62, 62]) pads.push({ t: "boost", i: I(980, 195), len: 8, o, w: 40 });   // the split: dash panels each side of the hole
      for (const x of [480, 380, 320]) pads.push({ t: "boost", i: I(x, x === 480 ? 290 : x === 380 ? 380 : 470), len: 6, o: 0, w: 60 });   // three dash panels round the last U-turn
      row(I(1200, 1250), I(820, 1240), 8, 0, 18); row(I(1060, 520), I(1300, 520), 6, 0); row(I(250, 1200), I(250, 900), 5, 0);
      return {
        gaps, pads, coins, rings, ledges: [{ a: 0, b: N - 1 }],
        holes: [{ i: I(520, 1020), o: -70, r: 40 }, { i: I(780, 780), o: 70, r: 40 }, { i: I(1050, 190), o: 0, r: 44 }],
        caves: [{ a: I(560, 255), b: I(270, 620), star: true }],   // ✨ the starry tunnel round the last U-turn
        boxes: [...boxRow(I(1000, 1210), [-55, -18, 18, 55]), ...boxRow(I(1300, 520), [-55, -18, 18, 55]), ...boxRow(I(250, 1000), [-55, -18, 18, 55])],
        extra(push) {
          for (let i = 0; i < N; i += 26) for (const sd of [-1, 1]) { const [x, y] = at(i, sd * (ROAD / 2 + CURB - 4)); if (!gaps.some(g => i >= g.a - 3 && i <= g.b + 3)) OBJS.push({ x, y, k: "ld_lamp", s: .24, r: 0, z: 0 }); }
        },
      };
    },
  },
};
// the cups: 3 tracks each, raced in this order in the Grand Prix. Each new cup has its own twist.
const CUPS = {
  henesys: { name: "Henesys Cup", icon: "🍄", tracks: ["henesys", "town", "forest"], rule: "" },
  elnath: { name: "El Nath Cup", icon: "❄️", tracks: ["en1", "en2", "en3"], rule: "❄️ Icy roads: brake early and drift round the corners" },
  sleepy: { name: "Sleepywood Cup", icon: "🌙", tracks: ["sw1", "sw2", "sw3"], rule: "🌙 Deep in the forest: boardwalks, ponds and gliders" },
  zakum: { name: "Zakum Cup", icon: "🔥", tracks: ["zk1", "zk2", "zk3"], rule: "🔥 Block Golems, mine carts and lava: no railings in places, so mind the edges" },
  ludi: { name: "Ludibrium Cup", icon: "🧸", tracks: ["ld1", "ld2", "ld3"], rule: "🧸 The clocktower and two rainbow roads: no railings on the rainbows, so mind the edges" },
};
const cupOf = key => Object.keys(CUPS).find(c => CUPS[c].tracks.includes(key)) || "henesys";
function loadTrack(key) {
  if (TRACK_KEY === key) return;
  T = TRACKS[key]; TRACK_KEY = key; TRACK_ID = T.id; OPEN = !!T.open; ROAD = T.road || 160;
  WS = T.scale || 1; WORLD = Math.round(TW * WS / 8) * 8;   // a bigger world for a longer lap: the layout (drawn on a 2048 map) is stretched, the road, karts and speed are not
  const ctrl = WS === 1 ? T.ctrl : T.ctrl.map(p => p.map((v, j) => v * WS));   // (hills scale too, so the slopes stay the same)
  PTS = OPEN ? openPts(ctrl) : loopPts(ctrl); N = PTS.length; TRACK_LEN = 0;
  LAPS = OPEN ? 1 : 3; START_I = OPEN ? (PTS[0].length > 2 ? 90 : 44) : 0;   // (a 3D grid is deeper: it needs more road behind the line)
  { let L = 0; for (let i = 1; i < N; i++) L += Math.hypot(PTS[i][0] - PTS[i - 1][0], PTS[i][1] - PTS[i - 1][1]); SPC = L / (N - 1); }   // world units between track points
  MECH = { elnath: "ice" }[T.cup] || null;   // only El Nath keeps its own rule (slippery ice); the lights-out, swapped controls and lava chase made races annoying
  OUT = T.theme.out ? hexABGR(T.theme.out) : OUT0; HAZE = T.theme.haze || HAZE0;
  const F = OPEN ? (fr => Math.round(Math.max(0, Math.min(1, fr)) * (N - 1))) : (fr => Math.round((((fr % 1) + 1) % 1) * N) % N);
  const f = T.build(F);
  // (the redesigned 3D tracks, laid out like real Mario Kart courses, have no tacked-on short cut: the old ones were placed for the old layouts)
  if (!f.fork && SHORTCUTS[key] && T.ctrl[0].length < 3) { const [a, b, via] = SHORTCUTS[key], w = 46;   // 🔀 the other maps' short cuts: each its own shape, one thing to dodge, two boosts
    const dodge = { sleepy: "mud", elnath: "ice", ludi: "slime", zakum: "rock" }[T.cup] || "rock";
    const ww = SHORTCUTS[key][3] === "straight" ? 40 : 46;
    const heavy = HEAVY_CUTS.includes(key);   // the short cuts that save the most get heavier traps (and no boost halfway)
    f.fork = { a, b, via, width: ww, style: T.cup === "zakum" || T.cup === "sleepy" ? "planks" : "cobble", coins: true,
      pads: heavy ? [{ t: "rock", j: .2, len: 8, o: w / 4, w: w / 2 }, { t: "slime", j: .38, len: 6, o: 0, w: w * .55 }, { t: "rock", j: .5, len: 8, o: -w / 4, w: w / 2 },
          ...(T.cup === "elnath" ? [{ t: "ice", j: .6, len: 12, o: 0, w }] : []), { t: dodge, j: .7, len: 7, o: w / 4, w: w / 2 }, { t: "boost", j: .88, len: 5, o: 0, w: w * .8 }]
        : [{ t: "rock", j: .28, len: 7, o: w / 4, w: w / 2 }, { t: "boost", j: .45, len: 5, o: 0, w: w * .7 }, { t: dodge, j: .63, len: 7, o: -w / 4, w: w / 2 }, { t: "boost", j: .84, len: 5, o: 0, w: w * .8 }] }; }   // every other map gets a short cut where its road loops back near itself
  if (f.fork) {
    FORK_A = f.fork.a; FORK_B = f.fork.b; ALT_ROAD = f.fork.width; ALT_STYLE = f.fork.style;
    ALT = pathPts([PTS[(FORK_A - 10 + N) % N], PTS[FORK_A], ...f.fork.via, PTS[FORK_B], PTS[(FORK_B + 10) % N]]); AN = ALT.length; ALTPADS = f.fork.pads || [];
  } else { FORK_A = FORK_B = -1e9; ALT = []; AN = 0; ALTPADS = []; }
  CHUTES = f.chutes || [];
  PEN = f.pen || null; LAKE = f.lake || null; TUNNEL = f.tunnel || null; CAVES = f.caves || []; STREAMS = f.streams || []; PLANKS = f.planks || [];
  LEAVES = (f.leaves || []).map(l => { const [x, y] = at(l.i, l.o || 0); return { ...l, x, y, a: tangent(l.i) }; });
  HIDE = [];
  GEARS = (f.gears || []).map(g => { const [x, y] = at(g.i, 0); return { ...g, x, y }; }); HANDS = f.hands || []; PENDS = (f.pendulums || []).map(p => ({ ...p, a: tangent(p.i), base: at(p.i, 0) }));
  BARE = []; if (LAKE && (LAKE.kind === "ice" || LAKE.kind === "shallow" || LAKE.kind === "clock")) for (let i = 0; i < N; i++) { const e = (o) => { const [x, y] = at(i, o); return inLake(x, y); }; if (e(ROAD / 2 + CURB) && e(-ROAD / 2 - CURB)) { const l = BARE[BARE.length - 1]; if (l && l.b === i) l.b = i + 1; else BARE.push({ a: i, b: i + 1 }); } }   // no curbs across the rink
  { const on = i => { const [x, y] = PTS[i]; return (LAKE && LAKE.kind === "clock" && inLake(x, y)) || GEARS.some(g => Math.hypot(x - g.x, y - g.y) < g.r - 10); };   // the road isn't drawn over the clock face or a gear: you drive on them
    for (let i = 0; i < N; i++) if (on(i)) { const l = HIDE[HIDE.length - 1]; if (l && l.b === i) l.b = i + 1; else HIDE.push({ a: i, b: i + 1 }); } }
  MOLES = f.moles || []; CHOMPS = f.chomps || []; WANDER = f.wander || []; BUILDINGS = [];
  HOLES = (f.holes || []).map(h => { const [x, y] = at(h.i, h.o || 0); return { ...h, x, y }; });
  CARTS = f.carts || []; LEDGES = f.ledges || []; FIREBALLS = (f.fireballs || []).map(b => { const [x, y] = at(b.i, b.o || 0); return { T: 4.2, ...b, x, y }; });
  THWOMPS = (f.thwomps || []).map(t => { if (t.x != null) return { T: 3.4, ...t }; const [x, y] = at(t.i, t.o || 0); return { T: 3.4, ...t, x, y }; });
  RINGS = (f.rings || []).map(g => { const [x, y] = at(g.i, g.o || 0); return { ...g, x, y, a: tangent(g.i) }; });   // ⭕ boost rings in the air
  PLANE = f.plane ? (() => { const [x, y] = at(f.plane.i, f.plane.o || 0), [sx, sy] = at(f.plane.i, 0); return { x, y, a: tangent(f.plane.i) + (f.plane.turn || 0), at: [sx, sy] }; })() : null;
  HEDGES = (f.hedges || []).map(b => { if (b.x != null) return { ...b, a: 0 }; const [x, y] = at(b.i, b.o); return { ...b, x, y, a: tangent(b.i) }; });
  GAPS = (f.gaps || []).map(g => { const G = { ...g }; G.caps = g.caps.map(c => { const [x, y] = at(c.i, c.o || 0); return { ...c, x, y, squash: 0, g: G }; }); return G; });
  { const PAL = ["r", "b", "g", "o", "n"], all = GAPS.flatMap(g => g.caps); let k = 0;   // 🎨 no two mushrooms near each other share a colour
    for (const c of all) { if (c.gold) { c.col = "y"; c.colSet = true; continue; } const near = all.filter(d => d !== c && d.colSet && Math.hypot(d.x - c.x, d.y - c.y) < 330).map(d => d.col);
      let pick = null; for (let j = 0; j < PAL.length && !pick; j++) { const col = PAL[(k + j) % PAL.length]; if (!near.includes(col)) pick = col; }
      if (!pick) { const cnt = col => near.filter(n => n === col).length; pick = PAL.slice().sort((p, q) => cnt(p) - cnt(q))[0]; }
      c.col = pick; c.colSet = true; k++; } }
  { const g0 = gridSpot(7).i - 25, g1 = (OPEN ? START_I : N) + Math.round(400 / SPC), inStart = i => { const j = OPEN ? i : (i < N / 2 ? i + N : i); return j >= g0 && j <= g1; };
    f.pads = f.pads.filter(p => !(["boost", "ramp", "bigramp"].includes(p.t) && (inStart(p.i) || inStart(p.i + (p.len || 0))))); }
  PADS = f.pads; COINS = f.coins; PIGS = f.pigs || []; FINALMSG = f.finalMsg || null; AREAS = f.areas || []; SPORES = f.spores || []; areaAt = -1;
  for (const a of AREAS) IMG["areasign_" + a.k] = areaSign(a.name); KING = f.king || null; BOXES = f.boxes || [];
  if (f.fork && f.fork.coins) for (let q = .15; q <= .85; q += .07) { const [x, y] = altAt(q * (AN - 1), 0); COINS.push({ x, y, z: 0, got: false }); }
  PENPIGS = PEN ? [0, 1, 2, 3, 4, 5].map(n => ({ f: .12 + n * .15, o: (n % 3 - 1) * 34, ph: n * 1.7, k: n % 2 ? "ribbon_pig" : "pig", dx: 0, dy: 0 })) : [];
  T.extraFn = f.extra;
  paintTrack(); placeObjects(); if (MECH === "lava") lavaMap();
  G3 = G3E && PTS[0].length > 2 ? G3E : null; fit();   // the redesigned tracks (with planned hills) are drawn in 3D
}

// 🔀 each map's short cut, every one a different shape: [from track point, to track point, its bends, the shape]. Each was placed where that
// shape fits at full size with grass + curbs between it and the road (found with __kart.findShape(kind, width) on localhost; run again if a track changes).
const HEAVY_CUTS = ["en1", "en2"];   // El Nath's two big short cuts save the most time, so they're the most dangerous
const SHORTCUTS = {
  en1: [502, 721, [[1328, 1291], [1356, 1366], [1319, 1446], [1355, 1540]], "camel"],
  en2: [544, 775, [[1151, 1014], [1091, 1096], [1059, 1187], [1055, 1288]], "arc"],
  en3: [616, 760, [[1624, 560], [1681, 493], [1727, 490], [1786, 527]], "bulge"],
  sw1: [283, 460, [[1373, 278], [1412, 375], [1374, 471], [1413, 568], [1374, 665], [1413, 761]], "slalom"],
  sw2: [142, 283, [[753, 741], [772, 723], [887, 723], [906, 705], [910, 590], [928, 572]], "zigzag"],
  sw3: [670, 820, [[1431, 1459], [1416, 1498], [1430, 1607], [1473, 1638], [1488, 1747], [1475, 1786]], "steps"],
  zk1: [137, 275, [[1651, 1803], [1526, 1705]], "scurve"],
  zk2: [1088, 1289, [[636, 550], [671, 630], [641, 712], [676, 792], [646, 874], [681, 954], [651, 1036], [686, 1116], [656, 1198]], "snake"],
  zk3: [1334, 1424, [[1832, 540], [1800, 453], [1830, 388]], "swoop"],
  ld1: [115, 334, [[505, 624], [588, 628], [675, 610], [757, 615], [832, 658], [907, 702], [990, 707], [1077, 688], [1159, 693]], "wave"],
  ld2: [859, 1078, [], "straight"],
  ld3: [388, 565, [[1227, 948], [1238, 1026], [1185, 1096], [1199, 1195]], "camel"] };
// every short cut has its own shape: offsets sideways from the short cut's centre line, at fractions u of its length.
// "f" offsets are a fraction of the length (big sweeps), plain numbers are world units (small, sharp moves).
const SHORTCUT_SHAPE = { en1: "arc", en2: "chicane", en3: "slalom", sw1: "scurve", sw2: "zigzag", sw3: "dogleg", zk2: "straight", ld1: "bulge", ld2: "wave", ld3: "steps" };
const SHAPES = {
  arc: { f: 1, pts: [[.2, .1], [.4, .16], [.6, .16], [.8, .1]] },                      // one big sweeping curve
  chicane: { pts: [[.38, 0], [.46, 46], [.54, -46], [.62, 0]] },                         // straight, a sharp left-right jink, straight
  slalom: { pts: [[.15, 24], [.29, -24], [.43, 24], [.57, -24], [.71, 24], [.85, -24]] }, // lots of small wiggles
  scurve: { f: 1, pts: [[.3, .12], [.7, -.12]] },                                          // one long S
  zigzag: { pts: [[.22, 40], [.28, 40], [.47, -40], [.53, -40], [.72, 40], [.78, 40]] },   // sharp corners (pairs of points make the corners crisp)
  dogleg: { f: 1, pts: [[.5, 0], [.68, .1], [.84, .1]] },                                  // straight, then it bends away near the end
  straight: { pts: [] },                                                                     // a narrow plank bridge, dead straight
  bulge: { f: 1, pts: [[.25, .05], [.45, .2], [.58, .18], [.72, .04]] },                   // swings wide on one side, lopsided
  wave: { pts: [.1, .2, .3, .4, .5, .6, .7, .8, .9].map(u => [u, 30 * Math.sin(u * Math.PI * 4)]) },   // a long rolling wave
  steps: { pts: [[.2, 0], [.27, 34], [.48, 34], [.55, -30], [.76, -30], [.83, 0]] },       // side-steps, like a staircase
  kink: { pts: [[.42, 0], [.49, 40], [.53, 40], [.6, 0]] },                                // one sharp bump
  camel: { f: 1, pts: [[.22, .09], [.38, .02], [.56, .09], [.76, 0]] },                   // two humps on the same side
  snake: { pts: [.12, .21, .3, .39, .48, .57, .66, .75, .84].map((u, i) => [u, i % 2 ? -16 : 16]) },   // lots of tiny wiggles
  swoop: { f: 1, pts: [[.25, -.06], [.55, .14], [.8, .05]] },                              // dips one way, then swings wide the other
};
function shapeCut(a, b, via, w, kind) {
  const poly = [PTS[a], ...via, PTS[b]], seg = []; let tot = 0;
  for (let q = 1; q < poly.length; q++) { const d = Math.hypot(poly[q][0] - poly[q - 1][0], poly[q][1] - poly[q - 1][1]); seg.push(d); tot += d; }
  const P = u => { let d = u * tot, q = 0; while (q < seg.length - 1 && d > seg[q]) { d -= seg[q]; q++; } const A = poly[q], B2 = poly[q + 1], f = Math.min(1, d / seg[q]);
    return [A[0] + (B2[0] - A[0]) * f, A[1] + (B2[1] - A[1]) * f, Math.atan2(B2[1] - A[1], B2[0] - A[0])]; };
  const S = SHAPES[kind] || SHAPES.scurve, need = ROAD / 2 + CURB + w / 2 + 4, roadLen = (b - a + 20) * SPC;
  const build = (side, k) => S.pts.map(([u, off]) => { const [x, y, ang] = P(u), o = (S.f ? off * tot : off) * side * k; return [x - Math.sin(ang) * o, y + Math.cos(ang) * o]; });
  const fits = pts => { const all = [PTS[a], ...pts, PTS[b]]; let len = 0;
    for (let q = 1; q < all.length; q++) len += Math.hypot(all[q][0] - all[q - 1][0], all[q][1] - all[q - 1][1]);
    let walked = 0;
    for (let q = 1; q < all.length; q++) { const d = Math.hypot(all[q][0] - all[q - 1][0], all[q][1] - all[q - 1][1]);
      for (let s2 = 0; s2 < d; s2 += 20) { const t = s2 / d, at2 = walked + s2; if (at2 < 110 || at2 > len - 110) continue;   // the whole line every 20 units (its two ends join the road, of course)
        const x = all[q - 1][0] + (all[q][0] - all[q - 1][0]) * t, y = all[q - 1][1] + (all[q][1] - all[q - 1][1]) * t;
        if (nearest(x, y).d < need || x < 60 || y < 60 || x > WORLD - 60 || y > WORLD - 60) return false; }
      walked += d; }
    return roadLen - len * 1.08 > 320; };   // (the spline is a little longer than the straight pieces) still worth taking
  if (shapeCut.search) { for (const k of [1, .8, .6, .45]) for (const side of [1, -1]) { const pts = build(side, k); if (fits(pts)) { shapeCut.k = k; return pts; } } return null; }   // (searching: the biggest size that fits)
  for (let k = 1; k > .15; k *= .8) for (const side of [1, -1]) { const pts = build(side, k); if (fits(pts)) return pts; }
  return via;   // nothing fitted: keep the plain short cut
}
// a short cut for a map that doesn't have one: where the road loops back near itself, a narrow path across saves real time
// (35-60% of that stretch). Its line must stay well clear of every other part of the road (and of water). Over lava it's a plank bridge.
function autoFork(f) {
  const W2 = T.cup === "zakum" ? 54 : 64, lo = OPEN ? START_I + 30 : 25, hi = OPEN ? N - FIN_OFF - 30 : N - 25, CL = ROAD / 2 + CURB + W2 / 2 + 8;   // a strip of grass + curbs between it and the road
  const wet = (x, y) => f.lake && f.lake.kind !== "ice" && ((x - f.lake.cx) / (f.lake.rx + 40)) ** 2 + ((y - f.lake.cy) / (f.lake.ry + 40)) ** 2 < 1;
  let best = null;
  for (let a = lo; a < hi; a += 2) for (let b = a + 24; b < Math.min(hi, a + Math.round(N * .42)); b += 2) {
    const A = PTS[a], Bp = PTS[b], dl = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), dt = (b - a) * SPC;
    if (dl < 200 || dl > 1150 || dl / dt > .78 || dl / dt < .2) continue;
    const nx = -(Bp[1] - A[1]) / dl, ny = (Bp[0] - A[0]) / dl;
    for (const bw of [.05, -.05, .15, -.15, .25, -.25, .35, -.35]) {   // a bendier path is longer: that keeps a big cut-through fair
      const bow = dl * bw, via = [[A[0] + (Bp[0] - A[0]) / 3 + nx * bow, A[1] + (Bp[1] - A[1]) / 3 + ny * bow], [A[0] + (Bp[0] - A[0]) * 2 / 3 + nx * bow, A[1] + (Bp[1] - A[1]) * 2 / 3 + ny * bow]];
      const poly = [A, ...via, Bp]; let len = 0; for (let q = 1; q < 4; q++) len += Math.hypot(poly[q][0] - poly[q - 1][0], poly[q][1] - poly[q - 1][1]);
      const save = dt - len; if (save < 300 || save > 950) continue;   // worth taking (300+ saved), never more than ~3 s
      let ok = true;
      for (let k2 = 0; k2 < 3 && ok; k2++) for (let t = 0; t <= 1 && ok; t += .1) {
        const u = (k2 + t) / 3; if (u < .16 || u > .84) continue;
        const x = poly[k2][0] + (poly[k2 + 1][0] - poly[k2][0]) * t, y = poly[k2][1] + (poly[k2 + 1][1] - poly[k2][1]) * t;
        if (x < 70 || y < 70 || x > WORLD - 70 || y > WORLD - 70 || nearest(x, y).d < CL || wet(x, y)) ok = false;
      }
      if (!ok) continue;
      const score = Math.min(save, 650) - Math.max(0, save - 650) * .8 - Math.abs(bw) * 300;
      if (!best || score > best.score) best = { a, b, via, score };
      break;
    }
  }
  if (!best) return null;
  const style = T.cup === "zakum" || T.cup === "sleepy" ? "planks" : "cobble";
  return { a: best.a, b: best.b, via: best.via, width: W2, style, pads: [{ t: "boost", j: .45, len: 6, o: 0, w: 40 }], coins: true };
}
// the track picture: grass in stripes, flowers, red/white curbs, a dirt road and a chequered start line
const tex = document.createElement("canvas"); tex.width = tex.height = TW;
let TEX = null, mini = null;
function paintTrack(dg) {   // dg: paint only what lies ON the road (pads, ramps, the pen, black ice, the start line) onto a see-through layer for the 3D road
  const g = (dg || tex).getContext("2d"), only = !!dg; g.setTransform(TW / WORLD, 0, 0, TW / WORLD, 0, 0);   // (painted in world units)
  const th = T.theme, dirt = th.road === "dirt", RS = th.road === "cobble" || !th.road ? (dirt ? "dirt" : "cobble") : th.road;
  if (!only) { g.fillStyle = th.grass[0]; g.fillRect(0, 0, WORLD, WORLD); }
  g.fillStyle = th.grass[1];
  if (only) {}
  else if (th.checker) for (let y = 0; y < WORLD; y += 64) for (let x = (y / 64 & 1) * 64; x < WORLD; x += 128) g.fillRect(x, y, 64, 64);   // Ludibrium: a chequered toy floor
  else for (let k = -WORLD; k < WORLD * 2; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 32, 0); g.lineTo(k + 32 - WORLD, WORLD); g.lineTo(k - WORLD, WORLD); g.fill(); }   // mowed stripes
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const flowers = th.flowerCols || ["#ffe066", "#ffffff", "#ff8fb8", "#ffb347"], stem = th.stem === undefined ? "#3f8a34" : th.stem;
  if (!th.checker && !only) {   // grass tufts: little darker and lighter blades all over, so the ground isn't flat colour
    const sh = (hex, d) => { const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, c + d)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
    const tuftCols = [sh(th.grass[0], -22), sh(th.grass[0], -12), sh(th.grass[0], 14), sh(th.grass[1], -18)];
    for (let k = 0, n = (th.tufts || 26000) * WS * WS; k < n; k++) { const x = rnd() * WORLD, y = rnd() * WORLD; g.fillStyle = tuftCols[k & 3]; g.fillRect(x, y, 1.5, 3); g.fillRect(x + 1.5, y + 1, 1.5, 2); }
  }
  if (!only) for (let k = 0, n = th.flowers * WS * WS; k < n; k++) { const x = rnd() * WORLD, y = rnd() * WORLD; if (stem) { g.fillStyle = stem; g.fillRect(x + 1, y + 4, 3, 3); } g.fillStyle = flowers[k % 4]; g.fillRect(x, y, 5, 5); }
  if (th.hearts && !only) for (let k = 0; k < 26 * WS * WS; k++) { const x = 100 + rnd() * (WORLD - 200), y = 100 + rnd() * (WORLD - 200); if (roadDist(x, y) < ROAD / 2 + 70) continue;   // 💗 heart-shaped lawns
    const sz = 30 + rnd() * 30; g.fillStyle = "#6fd060"; g.beginPath(); g.moveTo(x, y + sz * .9); g.bezierCurveTo(x - sz * 1.4, y - sz * .1, x - sz * .6, y - sz, x, y - sz * .35); g.bezierCurveTo(x + sz * .6, y - sz, x + sz * 1.4, y - sz * .1, x, y + sz * .9); g.fill(); }
  if (th.beds && !only) for (let k = 0; k < 34 * WS * WS; k++) { const x = 100 + rnd() * (WORLD - 200), y = 100 + rnd() * (WORLD - 200); if (roadDist(x, y) < ROAD / 2 + 50) continue;   // 🌷 flower beds
    const rx = 30 + rnd() * 40, ry = 18 + rnd() * 20; g.fillStyle = "#6b4a2e"; g.beginPath(); g.ellipse(x, y, rx, ry, rnd() * 3, 0, 7); g.fill();
    for (let f = 0; f < rx * ry / 20; f++) { const a = rnd() * 6.28, rr2 = Math.sqrt(rnd()); g.fillStyle = flowers[f % flowers.length]; g.fillRect(x + Math.cos(a) * rx * rr2 * .85 - 2, y + Math.sin(a) * ry * rr2 * .85 - 2, 5, 5); } }
  if (T.theme.sea != null && !only) {   // 🌋 a clean lava sea: smooth glowing lava, and dark rock under the road's edges (no blobs, no veins)
    g.fillStyle = th.grass[0]; g.fillRect(0, 0, WORLD, WORLD);
    for (let k = 0; k < 90 * WS * WS; k++) { const x = rnd() * WORLD, y = rnd() * WORLD, r = 120 + rnd() * 220, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,150,60,.16)"); gr.addColorStop(1, "rgba(255,150,60,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let k = 0, n = 1100 * WS * WS; k < n; k++) { const x = rnd() * WORLD, y = rnd() * WORLD, r = 6 + rnd() * 22; g.fillStyle = ["#a8280a", "#e0561e", "#ff8a2a", "#8a1e08"][k & 3]; g.globalAlpha = .45; g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill(); }   // glowing patches…
    g.globalAlpha = .9; g.lineWidth = 2.5; for (let k = 0, n = 220 * WS * WS; k < n; k++) { let x = rnd() * WORLD, y = rnd() * WORLD; g.strokeStyle = rnd() < .5 ? "#ffd23f" : "#ff9a2e"; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (rnd() - .5) * 50; y += (rnd() - .5) * 50; g.lineTo(x, y); } g.stroke(); }   // …and bright veins
    g.globalAlpha = 1;
    g.lineJoin = g.lineCap = "round"; g.strokeStyle = "#2a1c1a"; g.lineWidth = ROAD + 2 * CURB + 60; g.beginPath(); PTS.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
  }
  else if (T.cup === "zakum" && !only) {   // 🔥 no ground beside the road: it's all lava (glowing blobs and bright veins)
    g.fillStyle = "#6a1806"; g.fillRect(0, 0, WORLD, WORLD);
    for (let k = 0; k < 2600; k++) { const x = rnd() * WORLD, y = rnd() * WORLD, r = 6 + rnd() * 26; g.fillStyle = ["#a8280a", "#d2441a", "#ff7a1e", "#8a1e08"][k & 3]; g.globalAlpha = .55; g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.lineWidth = 2.5; for (let k = 0; k < 500; k++) { let x = rnd() * WORLD, y = rnd() * WORLD; g.strokeStyle = rnd() < .5 ? "#ffd23f" : "#ff9a2e"; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (rnd() - .5) * 50; y += (rnd() - .5) * 50; g.lineTo(x, y); } g.stroke(); }
  }
  if (th.cracks && !only) { g.lineWidth = 2; for (let k = 0; k < 260; k++) {   // glowing cracks in the rock
    let x = rnd() * WORLD, y = rnd() * WORLD; g.strokeStyle = rnd() < .5 ? "#ff6a1e" : "#c8321a"; g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += (rnd() - .5) * 40; y += (rnd() - .5) * 40; g.lineTo(x, y); } g.stroke(); } }
  const pathOf = (pts, closed) => () => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (closed) g.closePath(); };
  const path = pathOf(PTS, !OPEN), apath = pathOf(ALT, false), CC = th.curb || ["#d8352d", "#f4f1ea"];
  g.lineJoin = g.lineCap = "round";
  // racing curbs: solid red and white blocks that follow the road exactly (each block is one shape, so no seams or smudges)
  const curbs = (p, wd, pts, tan, closed) => {
    p(); g.strokeStyle = th.border || "#24561f"; g.lineWidth = wd + CURB * 2 + (th.checker ? 22 : T.cup === "zakum" ? 18 : 6); g.stroke();   // dark line where the grass meets the curb (wide on Ludibrium's pastel floors)
    const n = pts.length, last = closed ? n : n - 1, off = (i, o) => { const k = i % n, a = tan(k); return [pts[k][0] - Math.sin(a) * o, pts[k][1] + Math.cos(a) * o]; };
    for (const side of [-1, 1]) {
      const o1 = side * wd / 2, o2 = side * (wd / 2 + CURB);
      let acc = 0, start = 0, col = 0;
      const block = (a, b, c) => {
        g.fillStyle = c ? CC[1] : CC[0]; g.beginPath();
        for (let i = a; i <= b; i++) { const q = off(i, o1); i === a ? g.moveTo(q[0], q[1]) : g.lineTo(q[0], q[1]); }
        for (let i = b; i >= a; i--) { const q = off(i, o2); g.lineTo(q[0], q[1]); }
        g.closePath(); g.fill();
      };
      for (let i = 0; i < last; i++) {
        const A = pts[i % n], Bp = pts[(i + 1) % n]; acc += Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
        const c = Math.floor(acc / 16) % 2;
        if (c !== col) { block(start, i + 1, col); start = i + 1; col = c; }
      }
      block(start, last, col);
    }
  };
  const edge = (p, wd) => { p(); g.strokeStyle = "#6e6558"; g.lineWidth = wd + 4; g.stroke(); };
  const SURF = { icy: "#a2b0ee", garden: "#efe2c6", farm: "#d4a15c", planks: "#8a5a2e", dirt: "#b98b5a", cobble: "#bdb3a2", snow: "#dfe8f4", moss: "#5b5a4c", ruin: "#a08a62", basalt: "#4a4044", toy: "#f4f0ff" };
  const surface = (p, wd, st) => { p(); g.strokeStyle = SURF[st] || "#bdb3a2"; g.lineWidth = wd; g.stroke(); };
  const lake = () => {   // the forest lake (the wooden bridge crosses it), the swamp, or El Nath's frozen lake (drawn over the road: it's all ice)
    const LC = { water: ["#2f6e2a", "#3d8de0", "#5aa8f0"], ice: ["#8fb4d8", "#bfe0fa", "#ffffff"], swamp: ["#1e3326", "#3d5e3a", "#6f8f4a"], shallow: ["#3f7a4a", "#4fb0a0", "#c8f4e8"], clock: ["#c8962a", "#e8dcc0", "#e8dcc0"] }[LAKE.kind || "water"];
    g.fillStyle = LC[0]; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx + 10, LAKE.ry + 10, 0, 0, 7); g.fill();
    g.fillStyle = LC[1]; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry, 0, 0, 7); g.fill();
    g.fillStyle = LC[2]; for (let k = 0; k < 40; k++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * .85; g.fillRect(LAKE.cx + Math.cos(a) * LAKE.rx * r, LAKE.cy + Math.sin(a) * LAKE.ry * r, 14, 3); }
    if (LAKE.kind === "clock") {   // 🕰️ a giant clock face: a gold rim, the twelve hours, minute ticks, and a brass boss in the middle
      g.strokeStyle = "#8a6a1a"; g.lineWidth = 10; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx - 4, LAKE.ry - 4, 0, 0, 7); g.stroke();
      for (let k = 0; k < 60; k++) { const a = k / 60 * 6.283, r0 = k % 5 ? .9 : .82; g.strokeStyle = k % 5 ? "#9a8a70" : "#3a2a50"; g.lineWidth = k % 5 ? 3 : 8; g.beginPath(); g.moveTo(LAKE.cx + Math.cos(a) * LAKE.rx * r0, LAKE.cy + Math.sin(a) * LAKE.ry * r0); g.lineTo(LAKE.cx + Math.cos(a) * LAKE.rx * .95, LAKE.cy + Math.sin(a) * LAKE.ry * .95); g.stroke(); }
      g.fillStyle = "#3a2a50"; g.font = `900 ${Math.round(LAKE.rx * .13)}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
      ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"].forEach((t, k) => { const a = k / 12 * 6.283 - Math.PI / 2; g.fillText(t, LAKE.cx + Math.cos(a) * LAKE.rx * .7, LAKE.cy + Math.sin(a) * LAKE.ry * .7); });
      g.fillStyle = "#c8962a"; g.beginPath(); g.arc(LAKE.cx, LAKE.cy, LAKE.rx * .1, 0, 7); g.fill();
    }
    if (LAKE.kind === "ice" && TILEPAT.glacierExplorer) { const pat = g.createPattern(TILEPAT.glacierExplorer, "repeat"); pat.setTransform(new DOMMatrix().scale(.75)); g.save(); g.globalAlpha = .5; g.fillStyle = pat; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry, 0, 0, 7); g.fill(); g.restore(); }   // 🧊 real MapleStory glacier ice under the rink's shine
    if (LAKE.kind === "ice") {   // ⛸ a skating rink: deeper blue in the middle, and the curly white marks of skates all over it
      const gr = g.createRadialGradient(LAKE.cx, LAKE.cy, 0, LAKE.cx, LAKE.cy, LAKE.rx); gr.addColorStop(0, "rgba(90,160,225,.55)"); gr.addColorStop(1, "rgba(150,205,245,0)");
      g.fillStyle = gr; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry, 0, 0, 7); g.fill();
      g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1.6;
      for (let k = 0; k < 60; k++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * .8, x = LAKE.cx + Math.cos(a) * LAKE.rx * r, y = LAKE.cy + Math.sin(a) * LAKE.ry * r, rr = 20 + rnd() * 50, a0 = rnd() * 6.28;
        g.beginPath(); g.arc(x, y, rr, a0, a0 + 1.5 + rnd() * 2.5); g.stroke(); }
    }
  };
  if (LAKE && LAKE.kind !== "ice" && LAKE.kind !== "shallow" && LAKE.kind !== "clock" && LAKE.kind !== "fountain" && !only) lake();
  const cobbles = (n, pt, tan, wd, st) => { for (let i = 0; i < n; i++) {   // rows of flat cobbles across the road (or dirt specks, or planks)
    if (st === "planks") { if (i % 2) continue; const a = tan(i), ca = Math.cos(a), sa = Math.sin(a), x = pt(i)[0], y = pt(i)[1];
      g.strokeStyle = i % 4 ? "#a36c38" : "#6b4423"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + sa * wd / 2, y - ca * wd / 2); g.lineTo(x - sa * wd / 2, y + ca * wd / 2); g.stroke(); continue; }
    if (st === "dirt" || st === "farm") { for (let k = 0; k < 3; k++) { const a = tan(i), o = (rnd() - .5) * wd * .9, x = pt(i)[0] - Math.sin(a) * o, y = pt(i)[1] + Math.cos(a) * o;
      g.fillStyle = rnd() < .5 ? "#a87a4a" : "#c99d68"; g.fillRect(x - 3, y - 2, 6, 4); } continue; }
    if (st === "snow") { for (let k = 0; k < 3; k++) { const a = tan(i), o = (rnd() - .5) * wd * .9, x = pt(i)[0] - Math.sin(a) * o, y = pt(i)[1] + Math.cos(a) * o;
      g.fillStyle = rnd() < .5 ? "#c9d6ea" : "#f6faff"; g.fillRect(x - 3, y - 2, 6, 4); }
      for (const tr of [-.22, .22]) { const a = tan(i), x = pt(i)[0] - Math.sin(a) * wd * tr, y = pt(i)[1] + Math.cos(a) * wd * tr; g.fillStyle = "#c2cfe4"; g.fillRect(x - 3, y - 3, 6, 6); }   // wheel ruts
      continue; }
    if (st === "basalt") { for (let k = 0; k < 3; k++) { const a = tan(i), o = (rnd() - .5) * wd * .9, x = pt(i)[0] - Math.sin(a) * o, y = pt(i)[1] + Math.cos(a) * o;
      g.fillStyle = rnd() < .12 ? "#d2501e" : rnd() < .5 ? "#3a3236" : "#5a5054"; g.fillRect(x - 3, y - 2, 6, 4); } continue; }
    if (st === "toy") { if (i % 5) continue; const a = tan(i), ca2 = Math.cos(a), sa2 = Math.sin(a), cols = ["#ffe39a", "#ffc8de", "#c4e8ff", "#cdf0bd"];
      for (let c = 0, o = -wd / 2 + 10; o < wd / 2 - 8; o += 20, c++) { const x = pt(i)[0] - sa2 * o, y = pt(i)[1] + ca2 * o; g.fillStyle = cols[(c + i / 5) % 4]; g.fillRect(x - 8, y - 8, 16, 16); g.fillStyle = "rgba(255,255,255,.5)"; g.fillRect(x - 7, y - 7, 6, 3); }
      continue; }
    const a = tan(i), ca = Math.cos(a), sa = Math.sin(a), shift = (i & 1) * 5, pal = st === "moss" ? ["#4a4a3e", "#55574a", "#3d3f34"] : st === "ruin" ? ["#b39a6c", "#9c845a", "#8a744e"] : ["#c9c0b0", "#b2a896", "#a89e8c"];
    for (let o = -wd / 2 + 4 + shift; o < wd / 2 - 4; o += 10) {
      const x = pt(i)[0] - sa * o, y = pt(i)[1] + ca * o, t = rnd();
      g.fillStyle = t < .33 ? pal[0] : t < .66 ? pal[1] : pal[2]; g.fillRect(x - 3.5, y - 3.5, 7, 7);
      if (t > .85) { g.fillStyle = st === "moss" ? "#5f7a3a" : "#d8d0c2"; g.fillRect(x - 3, y - 3, 3, 2); }
    }
  } };
  if (AN && SHORTCUTS[TRACK_KEY] && T.cup !== "zakum" && !only) {   // what you fall into if you slip off the short cut
    const H = { sleepy: ["#33584a", "#4a7a66"], ludi: ["#d8c8f0", "#ffffff"], elnath: ["#f8fbff", "#c4d6ee"] }[T.cup];
    if (H) { apath(); g.strokeStyle = H[0]; g.lineWidth = ALT_ROAD + 90; g.stroke();
      for (let j = 0; j < AN; j++) for (let q = 0; q < 3; q++) { const o = (rnd() - .5) * (ALT_ROAD + 160), [x, y] = altAt(j, o); g.fillStyle = H[1];
        if (T.cup === "ludi") g.fillRect(x, y, 2, 2); else { g.beginPath(); g.ellipse(x, y, 6 + rnd() * 12, 3 + rnd() * 4, rnd() * 3, 0, 7); g.fill(); } } }
  }
  if (!only) {
  curbs(path, ROAD, PTS, tangent, !OPEN); if (AN) curbs(apath, ALT_ROAD, ALT, altTan, false);
  edge(path, ROAD); edge(apath, ALT_ROAD); surface(path, ROAD, RS); surface(apath, ALT_ROAD, ALT_STYLE === "planks" ? "planks" : RS);   // the market path's road paints over the main curbs where they meet
  cobbles(N, i => PTS[i], tangent, ROAD, RS); cobbles(AN, j => ALT[j], altTan, ALT_ROAD, ALT_STYLE === "planks" ? "planks" : RS);
  }
  if (LAKE && (LAKE.kind === "ice" || LAKE.kind === "shallow")) { g.globalAlpha = LAKE.kind === "ice" ? .88 : .8; lake(); g.globalAlpha = 1; }
  if (LAKE && LAKE.kind === "clock" && !only) lake();   // (the road isn't drawn over the clock face, so it's painted on the ground)
  for (const pl of PLANKS) {   // 🪵 a wooden bridge: boards across the road
    for (let i = pl.a; i < pl.b; i += .5) { const [x0, y0] = at(i, -ROAD / 2), [x1, y1] = at(i, ROAD / 2); g.strokeStyle = (Math.floor(i * 2) & 1) ? "#8a5a32" : "#9a6a3a"; g.lineWidth = SPC * .5 + .6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.strokeStyle = "rgba(50,30,15,.6)"; g.lineWidth = 1.2; for (let i = pl.a; i < pl.b; i += 1.6) { const [x0, y0] = at(i, -ROAD / 2), [x1, y1] = at(i, ROAD / 2); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); } }
  for (const st of STREAMS) {   // 🌊 a stream of water running down the middle of the road
    g.lineJoin = g.lineCap = "round"; g.beginPath(); for (let i = st.a; i <= st.b; i++) { const p = PTS[i % N]; i === st.a ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); }
    g.strokeStyle = "rgba(70,160,230,.75)"; g.lineWidth = st.w; g.stroke(); g.strokeStyle = "rgba(220,245,255,.7)"; g.lineWidth = 2;
    for (let i = st.a; i < st.b; i += 6) for (const o of [-st.w / 4, 0, st.w / 4]) { const [x0, y0] = at(i + (o ? 2 : 0), o), [x1, y1] = at(i + (o ? 2 : 0) + 3, o); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); } }
  for (const lf of LEAVES) {   // 🍃 giant leaves floating on the pond
    g.save(); g.translate(lf.x, lf.y); g.rotate(lf.a); g.fillStyle = "#3f9a3a"; g.beginPath(); g.ellipse(0, 0, lf.r * 1.25, lf.r * .8, 0, 0, 7); g.fill();
    g.fillStyle = "#5cc04e"; g.beginPath(); g.ellipse(0, 0, lf.r * 1.15, lf.r * .7, 0, 0, 7); g.fill(); g.strokeStyle = "#2f7a2c"; g.lineWidth = 3; g.beginPath(); g.moveTo(-lf.r * 1.1, 0); g.lineTo(lf.r * 1.1, 0); g.stroke();
    for (const sx of [-.6, -.2, .2, .6]) for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(sx * lf.r, 0); g.lineTo((sx + .25) * lf.r, sd * lf.r * .55); g.stroke(); } g.restore(); }
  for (const cv of CAVES) if (!cv.rock && !cv.temple) {   // ❄ the ice cave's floor: glassy blue ice
    g.lineJoin = g.lineCap = "round"; g.beginPath(); for (let i = cv.a; i <= cv.b; i++) { const p = PTS[i % N]; i === cv.a ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); }
    g.strokeStyle = "rgba(110,175,235,.5)"; g.lineWidth = ROAD; g.stroke(); g.strokeStyle = "rgba(220,242,255,.45)"; g.lineWidth = 3; for (const o of [-40, 25]) { g.beginPath(); for (let i = cv.a; i <= cv.b; i += 2) { const [x, y] = at(i, o); i === cv.a ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); } }
  if (!only) { let acc = 0;   // speed bands
    for (let i = 0; i < (OPEN ? N - 1 : N); i++) {
      const j = (i + 1) % N, d = Math.hypot(PTS[j][0] - PTS[i][0], PTS[j][1] - PTS[i][1]); acc += d;
      if (Math.floor(acc / 20) % 2) { const a1 = at(i, -ROAD / 2), b1 = at(i, ROAD / 2), c1 = at(j, ROAD / 2), d1 = at(j, -ROAD / 2);
        g.fillStyle = dirt ? "rgba(70,40,10,.09)" : "rgba(40,30,20,.075)"; g.beginPath(); g.moveTo(a1[0], a1[1]); g.lineTo(b1[0], b1[1]); g.lineTo(c1[0], c1[1]); g.lineTo(d1[0], d1[1]); g.fill(); }
    } }
  if (!only) { path(); g.strokeStyle = th.line || "rgba(255,255,255,.8)"; g.lineWidth = 3; g.setLineDash([20, 28]); g.stroke(); g.setLineDash([]); }
  if (!only) { apath(); g.strokeStyle = "rgba(255,226,140,.85)"; g.lineWidth = 3; g.setLineDash([12, 18]); g.stroke(); g.setLineDash([]); }
  // the market path's boost arrows
  for (const p of ALTPADS) if (p.t !== "boost") for (let k = 0; k < p.len * (p.t === "rock" ? 5 : 3); k++) {   // the short cut's rocks, mud, black ice and slime
    const jj = p.j * (AN - 1) + rnd() * p.len, [x, y] = altAt(jj, p.o + (rnd() - .5) * p.w * .9), z = p.t === "rock" ? 9 + rnd() * 8 : 7 + rnd() * 9;
    g.fillStyle = p.t === "rock" ? "rgba(0,0,0,.35)" : "rgba(0,0,0,0)"; g.beginPath(); g.ellipse(x + 2, y + 2, z / 2, z * .4, 0, 0, 7); g.fill();
    g.fillStyle = { rock: rnd() < .5 ? "#7d7466" : "#5e574c", mud: rnd() < .5 ? "#3e3a22" : "#5a5230", ice: rnd() < .5 ? "#a9d4f5" : "#d8eeff", slime: rnd() < .5 ? "#7c3fa0" : "#b65cd6" }[p.t];
    g.beginPath(); g.ellipse(x, y, z / 2, z * .4, rnd() * 3, 0, 7); g.fill();
  }
  for (const p of ALTPADS) if (p.t === "boost") for (let j = 0; j <= p.len; j += .5) for (let c = 0; c < 10; c++) {
    const jj = p.j * (AN - 1) + j, o1 = p.o - p.w / 2 + p.w * c / 10, o2 = o1 + p.w / 10 + .5, chev = ((j * 2 + 40 - Math.abs(c - 4.5) * 1.5) % 6) < 3;
    const a = altAt(jj, o1), b = altAt(jj, o2), cc = altAt(jj + 1, o2), d = altAt(jj + 1, o1);
    g.fillStyle = chev ? "#ff7a12" : "#ffd84a"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.lineTo(d[0], d[1]); g.fill();
  }
  // the extras: boost arrows, jump ramps, rocky patches and slime puddles
  const atf = (i, o) => { const i0 = Math.floor(i), f = i - i0, p = at(i0, o), q = at(i0 + 1, o); return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; };
  const quad = (i, o1, o2, col) => { const a = atf(i, o1), b = atf(i, o2), c = atf(i + .6, o2), d = atf(i + .6, o1);
    g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.fill(); };
  // the muddy pig pen across the road under the jump
  if (PEN) for (let i = PEN.a; i <= PEN.b; i += .5) quad(i, -ROAD / 2 - 6, ROAD / 2 + 6, "#7a5531");
  if (PEN) for (let k = 0; k < 60; k++) {
    const [x, y] = at(PEN.a + rnd() * (PEN.b - PEN.a), (rnd() - .5) * ROAD), r = 6 + rnd() * 16;
    g.fillStyle = rnd() < .5 ? "#5e3f22" : "#94683c"; g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill();
  }
  if (PEN) for (const pos of [PEN.a, PEN.b]) for (let o = -ROAD / 2; o < ROAD / 2; o += 8) { const [x, y] = at(pos, o); g.fillStyle = "#6b4426"; g.fillRect(x - 3, y - 3, 6, 6); }   // fence rails
  const tileFill = (set, path, alpha = 1) => { const c = TILEPAT[set]; if (!c) return false; const pat = g.createPattern(c, "repeat"); pat.setTransform(new DOMMatrix().scale(.75)); g.save(); g.globalAlpha = alpha; g.fillStyle = pat; path(); g.fill(); g.restore(); return true; };   // a shape filled with a MapleStory tile
  const band = (i0, len, o, w, shape) => () => { g.beginPath(); for (let j = 0; j <= len; j += .5) { const e = shape(j), [x, y] = at(i0 + j, o - w / 2 * e); j ? g.lineTo(x, y) : g.moveTo(x, y); } for (let j = len; j >= 0; j -= .5) { const e = shape(j), [x, y] = at(i0 + j, o + w / 2 * e); g.lineTo(x, y); } g.closePath(); };
  const blob = (x, y, a, rx, ry) => () => { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, 7); };
  for (const p of PADS) {
    if (p.t === "glide") for (let j = 0; j <= p.len; j += .5) for (let c = 0; c < 10; c++) {   // 🪁 a glider ramp: blue with white chevrons
      const o1 = p.o - p.w / 2 + p.w * c / 10, o2 = o1 + p.w / 10 + .5, chev = ((j * 2 + 40 - Math.abs(c - 4.5) * 1.5) % 6) < 3;
      quad(p.i + j, o1, o2, j < .6 || j > p.len - .6 ? "#1d3f8a" : chev ? "#ffffff" : "#2f8fe8");
    }
    if (p.t === "bigramp") for (let j = 0; j <= p.len; j += .5) for (let c = 0; c < 10; c++) {
      const o1 = p.o - p.w / 2 + p.w * c / 10, o2 = o1 + p.w / 10 + .5, chev = ((j * 2 + 40 - Math.abs(c - 4.5) * 1.5) % 6) < 3;
      quad(p.i + j, o1, o2, j < .6 || j > p.len - .6 ? "#7a1418" : chev ? "#ffd75e" : "#c8232c");
    }
    if (p.t === "boost") for (let j = 0; j <= p.len; j += .25) for (let c = 0; c < 12; c++) {   // big readable arrows: bright chevrons on a hot orange pad, dark rim
      const o1 = p.o - p.w / 2 + p.w * c / 12, o2 = o1 + p.w / 12 + .5, edge = c === 0 || c === 11 || j < .4 || j > p.len - .4;
      const ph = ((j * 1.6 - Math.abs(c - 5.5) * .55) % 3.2 + 3.2) % 3.2;
      quad(p.i + j, o1, o2, edge ? "#7a2a08" : ph < 1.1 ? "#fff6c2" : ph < 1.5 ? "#ffd23f" : "#ff6a12");
    }
    if (p.t === "ramp") for (let j = 0; j <= p.len; j += .5) for (let c = 0; c < 10; c++) {
      const o1 = p.o - p.w / 2 + p.w * c / 10, o2 = o1 + p.w / 10 + .5;
      const chev = ((j * 2 + 40 - Math.abs(c - 4.5) * 1.5) % 6) < 3;   // arrows pointing down the track
      quad(p.i + j, o1, o2, j < .6 || j > p.len - .6 ? "#1e4f9a" : chev ? "#ffffff" : "#3d8de0");
    }
    const rockSet = T.cup === "elnath" ? "snowyLightrock" : "deepMine";
    if (p.t === "rock" && TILEPAT[rockSet]) { for (let k = 0; k < Math.max(3, p.len / 3); k++) { const [x, y] = at(p.i + rnd() * p.len, p.o + (rnd() - .5) * p.w * .6), a = tangent(p.i) + (rnd() - .5) * .8, rx = 22 + rnd() * 22, ry = 14 + rnd() * 12;   // 🪨 rubble: patches of real MapleStory rock (snowy rock in El Nath)
        g.save(); g.fillStyle = "rgba(30,24,20,.45)"; blob(x + 2, y + 3, a, rx + 3, ry + 3)(); g.fill(); g.restore(); tileFill(rockSet, blob(x, y, a, rx, ry)); } }
    else if (p.t === "rock") for (let k = 0; k < p.len * 16; k++) {   // gravel first, then fewer, bigger shaded rocks
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w * .98); g.fillStyle = RS === "snow" ? "#c9d6ea" : RS === "toy" ? "#e8dcff" : rnd() < .5 ? "#8a8274" : "#6e675b"; g.fillRect(x - 1.5, y - 1, 3, 2);
    }
    if (p.t === "rock" && !TILEPAT[rockSet]) for (let k = 0; k < p.len * 4; k++) {
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w * .9), z = 10 + rnd() * 10;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(x + 3, y + 3, z / 2 + 1, z * .42, 0, 0, 7); g.fill();   // its shadow
      const rp = RS === "toy" ? [["#c8323c", "#ff5a64", "#ffb0b4"], ["#2a6ac8", "#5a9aff", "#b0d0ff"], ["#d8a020", "#ffd23f", "#fff0a0"], ["#2a9a3a", "#5ad06a", "#b8f0c0"]][Math.floor(rnd() * 4)]
        : RS === "snow" ? [rnd() < .5 ? "#c4d4ea" : "#b0c4e0", "#eef4ff"] : RS === "basalt" ? [rnd() < .5 ? "#3a3236" : "#4a3e40", "#ff7a3a"] : [rnd() < .5 ? "#7d7466" : "#696154", "#a59c8c"];
      g.fillStyle = "#3e3830"; g.beginPath(); g.ellipse(x + 2, y + 2, z / 2, z * .4, 0, 0, 7); g.fill();   // lumpy rocks (toy blocks in Ludibrium, snow lumps in El Nath)
      g.fillStyle = rp.length === 3 ? rp[1] : rp[0]; g.beginPath(); g.ellipse(x, y, z / 2, z * .4, 0, 0, 7); g.fill();
      g.fillStyle = rp.length === 3 ? rp[2] : rp[1]; g.beginPath(); g.ellipse(x - z * .15, y - z * .12, z * .18, z * .12, 0, 0, 7); g.fill();
    }
    if (p.t === "ice" && TILEPAT.glacierExplorer) {   // ❄ black ice: a patch of real MapleStory glacier ice, a white frosty rim, glints
      const sh = j => .55 + .45 * Math.sin(Math.PI * j / p.len), path = band(p.i, p.len, p.o, p.w, sh);
      g.save(); g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 5; path(); g.stroke(); g.restore(); tileFill("glacierExplorer", path, .95);
      g.fillStyle = "rgba(255,255,255,.8)"; for (let k = 0; k < p.len; k++) { const [x, y] = at(p.i + rnd() * p.len, p.o + (rnd() - .5) * p.w * .5); g.fillRect(x - 5, y - 1, 10, 2); }
    }
    else if (p.t === "ice") for (let j = 0; j <= p.len; j += .5) {   // a glassy patch of black ice
      const e = Math.sin(Math.PI * j / p.len), w2 = p.w / 2 * (.55 + .45 * e);
      quad(p.i + j, p.o - w2, p.o + w2, j % 2 < 1 ? "#a9d4f5" : "#bfe2fb");
      if (rnd() < .5) { const [x, y] = at(p.i + j, p.o + (rnd() - .5) * w2 * 1.6); g.fillStyle = "#ffffff"; g.fillRect(x - 4, y - 1, 8, 2); }
    }
    if (p.t === "lava" && TILEPAT.moltenRock) { const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i), rx = p.len * SPC / 2 + 8, ry = p.w / 2;   // 🔥 a patch of real MapleStory molten rock, glowing at its heart
      g.save(); g.fillStyle = "#24100a"; blob(x, y, a, rx + 5, ry + 5)(); g.fill(); g.restore(); tileFill("moltenRock", blob(x, y, a, rx, ry));
      const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); gr.addColorStop(0, "rgba(255,170,40,.45)"); gr.addColorStop(1, "rgba(255,90,0,0)"); g.fillStyle = gr; blob(x, y, a, rx, ry)(); g.fill(); }
    else if (p.t === "lava") { const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i);   // a bubbling pool of lava on the road
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = "#3a1208"; g.beginPath(); g.ellipse(0, 0, p.len * 2.9, p.w / 2 + 4, 0, 0, 7); g.fill();
      g.fillStyle = "#e0401a"; g.beginPath(); g.ellipse(0, 0, p.len * 2.6, p.w / 2, 0, 0, 7); g.fill();
      g.fillStyle = "#ffb02e"; for (const [bx, by, br] of [[-8, -6, 6], [10, 5, 5], [2, -1, 4], [-14, 8, 3]]) { g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); }
      g.restore(); }
    if (p.t === "hole") {}
    if (p.t === "grass") { const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i);   // a patch of long grass on the road
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = "#3f9a2c"; g.beginPath(); g.ellipse(0, 0, p.len * SPC / 2 + 6, p.w / 2, 0, 0, 7); g.fill();
      g.fillStyle = "#58bb38"; g.beginPath(); g.ellipse(-2, -2, p.len * SPC / 2, p.w / 2 - 5, 0, 0, 7); g.fill();
      g.strokeStyle = "#2f7d22"; g.lineWidth = 1.6; for (let k = 0; k < 40; k++) { const bx = (rnd() - .5) * p.len * SPC, by = (rnd() - .5) * (p.w - 12); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + 2, by - 5); g.stroke(); } g.restore(); }
    if (p.t === "mud" && TILEPAT.swamp) { for (let k = 0; k < Math.max(4, p.len / 2); k++) { const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w * .7), a = tangent(p.i) + (rnd() - .5), rx = 24 + rnd() * 26, ry = 16 + rnd() * 14; tileFill("swamp", blob(x, y, a, rx, ry), .95); } }   // 🌿 swamp mud: real Sleepywood swamp roots
    else if (p.t === "mud") for (let k = 0; k < p.len * 5; k++) {   // swamp mud across the road: slows you down
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w), r = 6 + rnd() * 14;
      g.fillStyle = rnd() < .5 ? "#3e3a22" : "#5a5230"; g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill();
    }
    if (p.t === "shroom" && !only) { const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i), C = { o: ["#e8742a", "#ffb35a"], g: ["#4aa83a", "#8ee070"], b: ["#3a86d8", "#8cc8ff"] }[p.col] || ["#e8742a", "#ffb35a"];
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = C[0]; g.beginPath(); g.ellipse(0, 0, p.len * SPC / 2 + 4, p.w / 2, 0, 0, 7); g.fill();
      g.fillStyle = C[1]; g.beginPath(); g.ellipse(-2, -3, p.len * SPC / 2 - 2, p.w / 2 - 6, 0, 0, 7); g.fill();
      g.fillStyle = "#fff"; for (const [bx, by, br] of [[-6, -12, 6], [8, 6, 7], [-10, 14, 5], [10, -16, 4]]) { g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); } g.restore(); }
    if (p.t === "slime" && TILEPAT.slime) { const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i), rx = p.len * SPC / 2 + 8, ry = p.w / 2;   // 🟢 a puddle of green slime: the Slime's own body, a darker rim and a wet shine
      g.save(); g.fillStyle = "#1f6a10"; blob(x, y, a, rx + 4, ry + 4)(); g.fill(); g.restore(); tileFill("slime", blob(x, y, a, rx, ry));
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = "rgba(255,255,255,.5)"; g.beginPath(); g.ellipse(-rx * .3, -ry * .35, rx * .35, ry * .18, -.2, 0, 7); g.fill(); g.restore(); }
    else if (p.t === "slime") {
      const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i);
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = "#7c3fa0"; g.beginPath(); g.ellipse(0, 0, p.len * 2.6, p.w / 2, 0, 0, 7); g.fill();
      g.fillStyle = "#b65cd6"; g.beginPath(); g.ellipse(-2, -2, p.len * 2.2, p.w / 2 - 5, 0, 0, 7); g.fill();
      g.fillStyle = "#e3a6f5"; for (const [bx, by, br] of [[-6, -8, 4], [8, 4, 3], [2, -2, 2]]) { g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); }
      g.restore();
    }
  }
  // 🍄 under a mushroom crossing the 3D view digs out a gorge (or the pond): paint that ground as rock and earth, not road and grass
  if (!only) for (const gp of GAPS) {
    const xs = [], ys = []; for (let i = gp.a; i <= gp.b; i++) { xs.push(PTS[i][0]); ys.push(PTS[i][1]); }
    const x0 = Math.max(0, Math.min(...xs) - 540), x1 = Math.min(WORLD, Math.max(...xs) + 540), y0 = Math.max(0, Math.min(...ys) - 540), y1 = Math.min(WORLD, Math.max(...ys) + 540);
    const pal = gp.kind === "water" ? ["#7a6440", "#6e5a3a", "#86704a"] : ["#7e6a58", "#6f5c4c", "#8c7764", "#5e4e42"];
    for (let y = y0; y < y1; y += 16) for (let x = x0; x < x1; x += 16) { const m = nearest(x + 8, y + 8); if (m.i < gp.a || m.i >= gp.b || m.d > 520) continue;   // (a full search: crossings can be long)
      for (let q = 0; q < 4; q++) { g.fillStyle = pal[((x * 7 + y * 13 + q * 5) >> 3) % pal.length] || pal[0]; g.fillRect(x + (q & 1) * 8, y + (q >> 1) * 8, 8.5, 8.5); } }
  }
  for (const h of HOLES) if (!h.lap && T.theme.space) {   // 🌌 a hole in a Rainbow Road: the starry void, with a glowing rim
    g.fillStyle = (T.theme.curb || ["#fff"])[1] || "#ff5ac8"; g.beginPath(); g.arc(h.x, h.y, h.r + 7, 0, 7); g.fill(); g.fillStyle = "#ffffff"; g.beginPath(); g.arc(h.x, h.y, h.r + 3, 0, 7); g.fill();
    g.fillStyle = "#05051a"; g.beginPath(); g.arc(h.x, h.y, h.r, 0, 7); g.fill(); g.fillStyle = "#ffffff"; for (let k = 0; k < 18; k++) { const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * h.r * .9; g.fillRect(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, 1.6, 1.6); } }
  for (const h of HOLES) if (!h.lap && !T.theme.space) {   // 🕳️ a hole in the thin ice: dark water with a cracked rim of real MapleStory glacier ice
    g.fillStyle = "#e8f6ff"; g.beginPath(); g.arc(h.x, h.y, h.r + 12, 0, 7); g.fill();
    if (TILEPAT.glacierExplorer) { const pat = g.createPattern(TILEPAT.glacierExplorer, "repeat"); pat.setTransform(new DOMMatrix().scale(.75)); g.fillStyle = pat; g.beginPath(); g.arc(h.x, h.y, h.r + 22, 0, 7); g.fill(); } g.fillStyle = "#1e4f9a"; g.beginPath(); g.arc(h.x, h.y, h.r, 0, 7); g.fill();
    g.fillStyle = "#3a7ed8"; g.beginPath(); g.arc(h.x - 6, h.y - 6, h.r * .6, 0, 7); g.fill(); g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 2;
    for (let k = 0; k < 10; k++) { const a = k * .63, r1 = h.r + 10; g.beginPath(); g.moveTo(h.x + Math.cos(a) * r1, h.y + Math.sin(a) * r1); g.lineTo(h.x + Math.cos(a + .2) * (r1 + 22), h.y + Math.sin(a + .2) * (r1 + 22)); g.stroke(); } }
  // the starting grid (3D tracks): a painted bracket round each of the 8 spots, open towards the front, like Mario Kart Tour
  if (PTS[0].length > 2) for (let slot = 0; slot < 8; slot++) {
    const gs = gridSpot(slot), i = (gs.i + N) % N, a = tangent(i), [x, y] = at(i, gs.o);
    g.save(); g.translate(x, y); g.rotate(a); g.lineJoin = "round"; g.lineCap = "round";
    const br = () => { g.beginPath(); g.moveTo(1, -20); g.lineTo(-17, -20); g.lineTo(-17, 20); g.lineTo(1, 20); };   // a "[" round the spot, open towards the front
    br(); g.strokeStyle = "rgba(60,50,40,.25)"; g.lineWidth = 7; g.stroke();   // a soft edge so it reads on any road
    br(); g.strokeStyle = "#f6e7c4"; g.lineWidth = 4.5; g.stroke(); g.restore(); }
  // start line across the road at point 0
  for (const li of OPEN ? [START_I, N - FIN_OFF] : [0]) {
    const [sx, sy] = PTS[li], ta = tangent(li), nx = -Math.sin(ta), ny = Math.cos(ta), sq = 10;
    for (let r = 0; r < 2; r++) for (let c = -ROAD / 2; c < ROAD / 2; c += sq) {
      g.fillStyle = ((c / sq + r) & 1) ? (th.finish ? th.finish[0] : "#222") : (th.finish ? th.finish[1] : "#fff");
      g.save(); g.translate(sx + nx * (c + sq / 2) + Math.cos(ta) * (r - 1) * sq, sy + ny * (c + sq / 2) + Math.sin(ta) * (r - 1) * sq); g.rotate(ta);
      g.fillRect(-sq / 2, -sq / 2, sq + .5, sq + .5); g.restore();
    }
  }
  if (only) return;
  g.setTransform(1, 0, 0, 1, 0, 0); TEX = new Uint32Array(g.getImageData(0, 0, TW, TW).data.buffer);
  // minimap
  mini = document.createElement("canvas"); mini.width = mini.height = 128; const m = mini.getContext("2d"), k = 128 / WORLD;
  m.lineJoin = "round"; m.beginPath(); PTS.forEach(([x, y], i) => i ? m.lineTo(x * k, y * k) : m.moveTo(x * k, y * k)); if (!OPEN) m.closePath();
  m.strokeStyle = "rgba(0,0,0,.45)"; m.lineWidth = 9; m.stroke(); m.strokeStyle = "#f4e2b8"; m.lineWidth = 5; m.stroke();
  m.beginPath(); ALT.forEach(([x, y], i) => i ? m.lineTo(x * k, y * k) : m.moveTo(x * k, y * k));
  m.strokeStyle = "rgba(0,0,0,.4)"; m.lineWidth = 7; m.stroke(); m.strokeStyle = "#ffe28c"; m.lineWidth = 3.5; m.stroke();
}

// 🔥 Zakum: which track point every spot of the map belongs to (so the lava can flood everything behind its front), and a lava texture
function lavaMap() {
  const c = document.createElement("canvas"); c.width = c.height = TW; const g = c.getContext("2d"), R2 = 150; g.setTransform(TW / WORLD, 0, 0, TW / WORLD, 0, 0);
  for (let i = 0; i < N - 1; i++) {
    const a = at(i, -R2), b = at(i, R2), cc = at(i + 1.6, R2), d = at(i + 1.6, -R2);
    g.fillStyle = `rgb(${i >> 8},${i & 255},255)`; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.lineTo(d[0], d[1]); g.fill();
  }
  const px = g.getImageData(0, 0, TW, TW).data; PIDX = new Uint16Array(TW * TW);
  for (let p = 0, q = 0; p < PIDX.length; p++, q += 4) if (px[q + 2] >= 250) PIDX[p] = (px[q] << 8 | px[q + 1]) + 1;
  if (!LAVAT) { LAVAT = new Uint32Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = (Math.sin(x * .39 + Math.sin(y * .21) * 2) + Math.sin(y * .33 + Math.cos(x * .17) * 2)) * .25 + .5, r = 230 + v * 25 | 0, gg = 60 + v * 150 | 0, b = 10 + v * v * 60 | 0;
      LAVAT[y * 64 + x] = (0xff000000 | (b << 16) | (gg << 8) | r) >>> 0;
    } }
}
// roadside things: real Henesys props (trees, mushroom houses, market stalls, hay, sunflowers) and a few monsters.
// s = world units per picture pixel, r = how solid it is
const K3D = new Set(["gazebo", "hotair", "icicle", "snowman_big", "igloo", "enhouse"]);   // big things that are real 3D models in the 3D view (drawn flat only in the flat view)
const PROPS = { treehouse: [.62, 0], hospital: [.55, 40], tree: [.36, 16], bush: [.3, 12], redshrooms: [.42, 10], sunflower: [.45, 6], tallshroom: [.4, 9], stall: [.42, 18], stall2: [.42, 18],
  hay: [.42, 12], haypile: [.38, 16], shroomtower: [.48, 16], shroomhouse: [.5, 18], posts: [.42, 10],
  // Pets Park's little things: Henesys's own flowers and pet-park objects (maplestory.io, Map/Obj/acc1.img/grassySoil nature + pet)
  hp_violet: [.62, 0, "henesys"], hp_violet2: [.62, 0, "henesys"], hp_orange: [.55, 0, "henesys"], hp_orange2: [.55, 0, "henesys"], hp_clover: [.6, 0, "henesys"], hp_ball: [.42, 0, "henesys"], hp_ball2: [.45, 0, "henesys"],
  hp_cushion: [.6, 0, "henesys"], hp_doghouse: [.9, 16, "henesys"], hp_bath: [.75, 0, "henesys"], hp_bowl: [.5, 0, "henesys"], hp_catstatue: [.6, 10, "henesys"],
  // the new cups' scenery (from maplestory.io's map objects); the 3rd value is the folder, and these load only when a track uses them
  en_pine: [0.522, 14, "elnath"], en_pine2: [0.487, 16, "elnath"], en_tree3: [0.833, 16, "elnath"], en_pine3: [0.478, 12, "elnath"], en_bush: [0.408, 12, "elnath"], en_bush2: [0.512, 12, "elnath"], en_dead: [0.657, 8, "elnath"], en_hay: [0.303, 14, "elnath"], en_fence: [0.33, 0, "elnath"], en_lamp: [0.348, 6, "elnath"], en_sign: [0.538, 6, "elnath"], en_gate: [0.814, 0, "elnath"], en_bench: [0.638, 10, "elnath"], en_swing: [0.309, 14, "elnath"], en_mill: [0.522, 30, "elnath"], en_barrel: [0.419, 8, "elnath"], en_house1: [0.609, 40, "elnath"], en_house2: [0.696, 34, "elnath"], en_house3: [0.609, 40, "elnath"], en_house4: [0.565, 40, "elnath"], en_house5: [0.696, 40, "elnath"], en_tower: [0.957, 40, "elnath"], en_dhouse: [0.652, 40, "elnath"], en_dhouse2: [0.652, 40, "elnath"], en_dhouse3: [0.652, 40, "elnath"], en_snowpines: [1.169, 30, "elnath"],
  sw_ruin: [0.616, 26, "sleepy"], sw_ruin2: [0.654, 26, "sleepy"], sw_ruin3: [0.348, 26, "sleepy"], sw_head: [0.478, 18, "sleepy"], sw_temple: [0.522, 30, "sleepy"], sw_ring: [0.465, 0, "sleepy"], sw_lily: [0.341, 8, "sleepy"], sw_lily2: [0.424, 8, "sleepy"], sw_fern: [0.387, 6, "sleepy"], sw_flower: [0.318, 4, "sleepy"], sw_bell: [0.275, 4, "sleepy"], sw_bush: [0.597, 12, "sleepy"], sw_moss: [0.515, 14, "sleepy"], sw_leaf: [0.407, 6, "sleepy"], sw_puff: [0.38, 4, "sleepy"], sw_tree: [0.556, 10, "sleepy"], sw_vine: [0.348, 10, "sleepy"], sw_treehouse: [0.609, 40, "sleepy"], sw_hut: [0.442, 34, "sleepy"], sw_stump: [0.304, 30, "sleepy"], sw_stump2: [0.348, 30, "sleepy"], sw_shrooms: [0.594, 14, "sleepy"], sw_hotel: [0.485, 8, "sleepy"], sw_lamp: [0.588, 0, "sleepy"], sw_deadtree: [0.565, 14, "sleepy"], sw_deadtree2: [0.565, 14, "sleepy"], sw_boat: [0.336, 20, "sleepy"], sw_log: [0.229, 16, "sleepy"],
  zk_rubble: [0.833, 24, "zakum"], zk_rubble2: [0.735, 24, "zakum"], zk_skull: [0.882, 18, "zakum"], zk_skull2: [1.061, 18, "zakum"], zk_shell: [0.761, 18, "zakum"], zk_horn: [0.686, 10, "zakum"], zk_vase: [0.678, 10, "zakum"], zk_vase2: [0.714, 10, "zakum"], zk_gate: [0.652, 0, "zakum"], zk_idol: [0.35, 22, "zakum"], zk_volcano: [0.92, 40, "zakum"], zk_bones: [0.769, 24, "zakum"], zk_ruins: [0.806, 20, "zakum"], zk_crane: [0.592, 16, "zakum"], zk_logs: [0.488, 18, "zakum"], zk_board: [0.72, 20, "zakum"], zk_barrier: [0.365, 18, "zakum"], zk_rocks: [0.476, 24, "zakum"], zk_rocks2: [0.549, 22, "zakum"], zk_lantern: [0.498, 8, "zakum"], zk_crate: [0.732, 12, "zakum"], zk_rig: [0.591, 40, "zakum"],
  ld_lamp: [0.391, 5, "ludi"], ld_tree: [0.573, 12, "ludi"], ld_tree2: [0.581, 12, "ludi"], ld_tree3: [0.625, 14, "ludi"], ld_tree4: [0.673, 12, "ludi"], ld_flower: [0.583, 3, "ludi"], ld_flower2: [0.583, 3, "ludi"], ld_parasol: [0.559, 6, "ludi"], ld_ufo: [0.511, 6, "ludi"], ld_lolly: [0.595, 6, "ludi"], ld_blocks: [0.962, 20, "ludi"], ld_blocks2: [0.962, 20, "ludi"], ld_banner: [0.435, 6, "ludi"], ld_fan: [0.304, 8, "ludi"], ld_arch: [0.591, 0, "ludi"], ld_h1: [0.609, 34, "ludi"], ld_h2: [0.696, 34, "ludi"], ld_h3: [0.565, 36, "ludi"], ld_h4: [0.565, 34, "ludi"], ld_h5: [0.575, 30, "ludi"], ld_h8: [0.565, 30, "ludi"], ld_cone: [0.591, 14, "ludi"], ld_bear: [0.478, 24, "ludi"], ld_h6: [0.622, 30, "ludi"], ld_h7: [0.558, 34, "ludi"], ld_clock: [0.522, 10, "ludi"], ld_shop: [0.522, 36, "ludi"], ld_flag: [0.533, 4, "ludi"], ld_lego: [0.526, 20, "ludi"], ld_lego2: [0.277, 20, "ludi"],
};
const MOBS = ["orange_mushroom", "green_mushroom", "blue_mushroom", "horny_mushroom", "snail", "blue_snail", "red_snail", "slime", "pig", "ribbon_pig", "king_slime", "mushmom"];
const IMG = {};
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
function mesoFrames(strip) {   // the real gold meso from MapleStory (Item.wz 09000001), 4 spinning frames side by side
  return [0, 1, 2, 3].map(i => { const c = document.createElement("canvas"); c.width = 26; c.height = 24; c.getContext("2d").drawImage(strip, -i * 26, 0); c.px = true; return c; });
}
let OBJS = [], CROWD = [];
// 🎉 the FAMILY start arch (a banner on two posts) and balloons, drawn once into little pictures
function makeArchArt() {
  const mk = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; };
  IMG.arch_post = mk(18, 150, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#7a5200"); gr.addColorStop(.45, "#ffd75e"); gr.addColorStop(1, "#8a5a10");
    g.fillStyle = gr; g.fillRect(2, 0, w - 4, h); g.fillStyle = "#c8232c"; for (let y = 8; y < h; y += 26) g.fillRect(2, y, w - 4, 9); g.fillStyle = "#5a3a08"; g.fillRect(0, h - 10, w, 10); });
  IMG.arch_banner = mk(420, 70, (g, w, h) => {
    g.fillStyle = "#7a1418"; g.beginPath(); g.roundRect(0, 4, w, h - 8, 12); g.fill();
    g.fillStyle = "#c8232c"; g.beginPath(); g.roundRect(4, 8, w - 8, h - 16, 10); g.fill();
    g.strokeStyle = "#ffd75e"; g.lineWidth = 3; g.beginPath(); g.roundRect(9, 13, w - 18, h - 26, 8); g.stroke();
    g.font = "900 38px Ubuntu, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 6; g.strokeStyle = "#5a0d10";
    g.strokeText("👑 FAMILY KART 👑", w / 2, h / 2 + 2); g.fillStyle = "#ffe48a"; g.fillText("👑 FAMILY KART 👑", w / 2, h / 2 + 2); });
  // 🏪 the Henesys Market gate (Mushroom Park's start): wooden posts and a market sign under a striped awning
  IMG.mk_post = mk(18, 150, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#5a3416"); gr.addColorStop(.5, "#a8703a"); gr.addColorStop(1, "#5e3818");
    g.fillStyle = gr; g.fillRect(2, 0, w - 4, h); g.fillStyle = "rgba(40,20,8,.35)"; for (let y = 14; y < h; y += 30) g.fillRect(2, y, w - 4, 3); g.fillStyle = "#3e220c"; g.fillRect(0, h - 10, w, 10); });
  IMG.mk_banner = IMG.mp_sign ? mk(420, 200, (g, w, h) => {   // 🪧 MapleStory's own "Market Place" sign, hung from a beam under the striped awning
    for (let x = 0, n = 0; x < w; x += 30, n++) { g.fillStyle = n & 1 ? "#ffffff" : "#d8352d"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 30, 0); g.lineTo(x + 30, 22); g.quadraticCurveTo(x + 15, 32, x, 22); g.fill(); }   // the awning
    const gr = g.createLinearGradient(0, 30, 0, 52); gr.addColorStop(0, "#a8703a"); gr.addColorStop(1, "#5e3818"); g.fillStyle = gr; g.fillRect(0, 30, w, 20); g.fillStyle = "rgba(40,20,8,.4)"; g.fillRect(0, 48, w, 3);   // the beam
    g.strokeStyle = "#5a3a1a"; g.lineWidth = 3; for (const x of [140, 280]) { g.beginPath(); g.moveTo(x, 48); g.lineTo(x, 66); g.stroke(); }   // ropes
    const im = IMG.mp_sign, sw = 240, sh = sw * 150 / im.width; g.drawImage(im, 0, 0, im.width, 150, (w - sw) / 2, 54, sw, sh); })
  : mk(420, 96, (g, w, h) => {
    for (let x = 0, n = 0; x < w; x += 30, n++) { g.fillStyle = n & 1 ? "#ffffff" : "#d8352d"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 30, 0); g.lineTo(x + 30, 22); g.quadraticCurveTo(x + 15, 32, x, 22); g.fill(); }   // the awning
    g.fillStyle = "#6b4423"; g.beginPath(); g.roundRect(6, 30, w - 12, h - 34, 10); g.fill();
    g.fillStyle = "#c08a50"; g.beginPath(); g.roundRect(11, 35, w - 22, h - 44, 8); g.fill();
    g.strokeStyle = "rgba(90,52,22,.35)"; g.lineWidth = 2; for (let y = 47; y < h - 12; y += 12) { g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke(); }   // planks
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 6; g.strokeStyle = "#4a2a0e"; g.font = "900 31px Ubuntu, sans-serif";
    g.strokeText("🍄 HENESYS MARKET 🍄", w / 2, 55); g.fillStyle = "#fff4d0"; g.fillText("🍄 HENESYS MARKET 🍄", w / 2, 55);
    g.font = "900 15px Ubuntu, sans-serif"; g.lineWidth = 4; g.strokeText("👑 FAMILY KART 👑", w / 2, 79); g.fillStyle = "#ffd75e"; g.fillText("👑 FAMILY KART 👑", w / 2, 79); });
  // 🐾 the Pet Park gate (Pets Park's start): white posts with pink bands and a pink-and-cream sign with paw prints
  IMG.pp_post = mk(18, 150, (g, w, h) => { g.fillStyle = "#fbf7f2"; g.fillRect(2, 0, w - 4, h); g.fillStyle = "#f07ab0"; for (let y = 10; y < h; y += 28) g.fillRect(2, y, w - 4, 8); g.fillStyle = "#c8558a"; g.fillRect(0, h - 10, w, 10); });
  IMG.pp_banner = mk(420, 110, (g, w, h) => {
    for (let x = 0, n = 0; x < w; x += 30, n++) { g.fillStyle = n & 1 ? "#ffffff" : "#ff7ab8"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 30, 0); g.lineTo(x + 30, 22); g.quadraticCurveTo(x + 15, 32, x, 22); g.fill(); }   // the awning
    g.fillStyle = "#c8558a"; g.beginPath(); g.roundRect(6, 30, w - 12, h - 34, 14); g.fill(); g.fillStyle = "#fff4f8"; g.beginPath(); g.roundRect(12, 36, w - 24, h - 46, 10); g.fill();
    const paw = (x, y, s, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y + 4 * s, 7 * s, 6 * s, 0, 0, 7); g.fill(); for (const [dx, dy] of [[-7, -5], [-2.5, -9], [2.5, -9], [7, -5]]) { g.beginPath(); g.ellipse(x + dx * s, y + dy * s, 2.6 * s, 3.2 * s, 0, 0, 7); g.fill(); } };
    for (const [x, y] of [[40, 62], [380, 62], [70, 88], [350, 88]]) paw(x, y, 1.3, "#f7a8cc");
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 6; g.strokeStyle = "#a8306a"; g.font = "900 30px Ubuntu, sans-serif";
    g.strokeText("HENESYS PET PARK", w / 2, 62); g.fillStyle = "#ffffff"; g.fillText("HENESYS PET PARK", w / 2, 62);
    g.font = "900 15px Ubuntu, sans-serif"; g.lineWidth = 4; g.strokeStyle = "#a8306a"; g.strokeText("👑 FAMILY KART 👑", w / 2, 89); g.fillStyle = "#ffd75e"; g.fillText("👑 FAMILY KART 👑", w / 2, 89); });
  ["#ff5a5a", "#ffd23f", "#5ac8ff", "#ffffff", "#7ad06a", "#ff8fd0"].forEach((col, i) => IMG["balloon" + i] = mk(26, 60, (g) => {
    g.strokeStyle = "rgba(60,40,20,.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(13, 30); g.quadraticCurveTo(9, 45, 14, 60); g.stroke();
    g.fillStyle = col; g.beginPath(); g.ellipse(13, 15, 11, 14, 0, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.ellipse(9, 9, 3, 5, -.4, 0, 7); g.fill();
    g.fillStyle = col; g.beginPath(); g.moveTo(10, 29); g.lineTo(16, 29); g.lineTo(13, 33); g.fill(); }));
}
function makeFarmArt() {
  if (IMG.farm_barn) return;
  const mk = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; };
  IMG.farm_barn = mk(260, 190, g => {
    g.fillStyle = "#f4f1ea"; g.fillRect(20, 80, 220, 110); g.fillStyle = "#d9d3c6"; for (let x = 28; x < 240; x += 16) g.fillRect(x, 80, 2, 110);   // white boards
    g.fillStyle = "#2f63c8"; g.beginPath(); g.moveTo(5, 86); g.lineTo(60, 20); g.lineTo(200, 20); g.lineTo(255, 86); g.closePath(); g.fill();          // the blue roof
    g.fillStyle = "#4a82e8"; g.beginPath(); g.moveTo(22, 80); g.lineTo(64, 30); g.lineTo(196, 30); g.lineTo(238, 80); g.closePath(); g.fill();
    g.fillStyle = "#8a2a1e"; g.fillRect(100, 120, 60, 70); g.strokeStyle = "#f4f1ea"; g.lineWidth = 5; g.beginPath(); g.moveTo(100, 120); g.lineTo(160, 190); g.moveTo(160, 120); g.lineTo(100, 190); g.stroke(); g.strokeRect(100, 120, 60, 70);
    g.fillStyle = "#2f63c8"; g.fillRect(118, 50, 24, 22); g.fillStyle = "#fff"; g.fillRect(122, 54, 16, 14); });
  IMG.farm_silo = mk(70, 230, g => {
    const gr = g.createLinearGradient(5, 0, 65, 0); gr.addColorStop(0, "#b8c0c8"); gr.addColorStop(.45, "#f2f4f6"); gr.addColorStop(1, "#9aa4ae"); g.fillStyle = gr; g.fillRect(8, 40, 54, 190);
    g.fillStyle = "rgba(0,0,0,.08)"; for (let y = 60; y < 230; y += 22) g.fillRect(8, y, 54, 3);
    g.fillStyle = "#2f63c8"; g.beginPath(); g.ellipse(35, 42, 30, 32, 0, Math.PI, 0); g.fill(); });
  IMG.farm_mill = mk(200, 260, g => {
    g.fillStyle = "#8a5a2e"; g.beginPath(); g.moveTo(80, 260); g.lineTo(92, 90); g.lineTo(108, 90); g.lineTo(120, 260); g.fill();
    g.save(); g.translate(100, 90); g.fillStyle = "#f4f1ea"; g.strokeStyle = "#8a5a2e"; g.lineWidth = 3;
    for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.fillRect(4, -8, 86, 16); g.strokeRect(4, -8, 86, 16); } g.fillStyle = "#c8232c"; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); g.restore(); });
  IMG.farm_mound = mk(80, 34, g => { const gr = g.createRadialGradient(40, 26, 4, 40, 26, 40); gr.addColorStop(0, "#8a5a32"); gr.addColorStop(1, "#5e3c1e"); g.fillStyle = gr;
    g.beginPath(); g.ellipse(40, 30, 38, 22, 0, Math.PI, 0); g.fill(); g.fillStyle = "#a8743e"; for (const [x, y] of [[22, 22], [50, 18], [62, 26], [34, 14]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } });
}
function makeSnowArt() {
  if (IMG.snowman_big) return;
  const mk = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; };
  IMG.snowman_big = mk(80, 120, g => {
    const ball = (x, y, r) => { const gr = g.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r); gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#c8d8ee"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    ball(40, 92, 27); ball(40, 50, 20);
    g.fillStyle = "#d8352d"; g.fillRect(20, 62, 40, 9); g.fillRect(44, 66, 9, 22);   // the red scarf
    g.fillStyle = "#d8352d"; g.beginPath(); g.moveTo(22, 34); g.lineTo(58, 34); g.lineTo(44, 6); g.closePath(); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(44, 6, 5, 0, 7); g.fill();   // the bobble hat
    g.fillStyle = "#222"; g.beginPath(); g.arc(33, 46, 2.6, 0, 7); g.arc(47, 46, 2.6, 0, 7); g.fill(); g.fillStyle = "#ff8a2a"; g.beginPath(); g.moveTo(40, 51); g.lineTo(55, 54); g.lineTo(40, 56); g.fill(); });
  IMG.icicle = mk(140, 260, g => {
    for (const [x, w, h, c] of [[70, 34, 250, "#c9b8ff"], [38, 24, 170, "#b8d8ff"], [104, 26, 190, "#d8c8ff"], [20, 16, 110, "#cfe8ff"], [122, 16, 120, "#c0d0ff"]]) {
      const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, c); gr.addColorStop(.5, "#ffffff"); gr.addColorStop(1, c); g.fillStyle = gr;
      g.beginPath(); g.moveTo(x, 260 - h); g.lineTo(x + w / 2, 260 - h * .25); g.lineTo(x + w / 3, 260); g.lineTo(x - w / 3, 260); g.lineTo(x - w / 2, 260 - h * .25); g.closePath(); g.fill(); } });
  IMG.freezie = mk(110, 130, g => {   // 🧊 a Freezie: a crystal ice block with a jagged top, big eyes and a zig-zag grin
    const body = new Path2D(); body.moveTo(8, 126); body.lineTo(4, 50); body.lineTo(22, 30); body.lineTo(30, 44); body.lineTo(46, 6); body.lineTo(60, 34); body.lineTo(74, 14); body.lineTo(84, 40); body.lineTo(104, 46); body.lineTo(102, 126); body.closePath();
    const gr = g.createLinearGradient(0, 0, 110, 130); gr.addColorStop(0, "#e8f8ff"); gr.addColorStop(.45, "#9ad8fb"); gr.addColorStop(1, "#5aa6e0"); g.fillStyle = gr; g.fill(body);
    g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 3; g.stroke(body);
    g.fillStyle = "rgba(255,255,255,.45)"; g.beginPath(); g.moveTo(14, 60); g.lineTo(26, 46); g.lineTo(24, 110); g.lineTo(14, 116); g.closePath(); g.fill();
    g.fillStyle = "#16345a"; for (const x of [40, 70]) { g.beginPath(); g.ellipse(x, 66, 7, 11, 0, 0, 7); g.fill(); }
    g.fillStyle = "#16345a"; g.beginPath(); g.moveTo(26, 90); for (let k = 0; k <= 8; k++) g.lineTo(26 + k * 7.5, k & 1 ? 104 : 92); g.lineTo(86, 110); g.lineTo(26, 110); g.closePath(); g.fill();
    g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(28, 93); for (let k = 0; k <= 8; k++) g.lineTo(28 + k * 7, k & 1 ? 102 : 94); g.lineTo(84, 98); g.closePath(); g.fill(); });
  IMG.ice_rock = mk(120, 80, g => {   // a little island of ice-crusted rock on the rink
    g.fillStyle = "#7d8fb0"; g.beginPath(); g.moveTo(4, 78); g.lineTo(14, 38); g.lineTo(38, 18); g.lineTo(62, 26); g.lineTo(84, 8); g.lineTo(108, 34); g.lineTo(116, 78); g.closePath(); g.fill();
    g.fillStyle = "#f2f8ff"; g.beginPath(); g.moveTo(14, 38); g.lineTo(38, 18); g.lineTo(62, 26); g.lineTo(84, 8); g.lineTo(108, 34); g.lineTo(96, 42); g.lineTo(80, 30); g.lineTo(60, 40); g.lineTo(40, 32); g.lineTo(22, 48); g.closePath(); g.fill();
    g.fillStyle = "rgba(60,80,120,.35)"; g.fillRect(60, 46, 50, 30); });
  for (const [k, col] of [["flag_r", "#e8322c"], ["flag_b", "#2f6fe8"]]) IMG[k] = mk(40, 120, g => {   // ⛷ a slalom gate flag
    g.fillStyle = "#3a3a44"; g.fillRect(4, 4, 4, 116); g.fillStyle = col; g.beginPath(); g.moveTo(8, 8); g.lineTo(38, 22); g.lineTo(8, 38); g.closePath(); g.fill(); g.fillStyle = "rgba(255,255,255,.5)"; g.fillRect(8, 14, 14, 3); });
  IMG.fishbone = mk(120, 70, g => {   // 🐟 a Fish Bone: a skeleton fish with big glowing eyes
    g.strokeStyle = "#e8eef8"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(30, 36); g.lineTo(104, 36); g.stroke();
    g.lineWidth = 3.5; for (let x = 44; x <= 92; x += 12) { g.beginPath(); g.moveTo(x, 36); g.quadraticCurveTo(x + 4, 18, x + 8, 12); g.moveTo(x, 36); g.quadraticCurveTo(x + 4, 54, x + 8, 60); g.stroke(); }
    g.fillStyle = "#e8eef8"; g.beginPath(); g.moveTo(104, 36); g.lineTo(118, 22); g.lineTo(114, 36); g.lineTo(118, 50); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(26, 36, 22, 20, 0, 0, 7); g.fill(); g.fillStyle = "#1a2a3a"; g.beginPath(); g.ellipse(22, 30, 9, 9, 0, 0, 7); g.fill(); g.fillStyle = "#d8ff4a"; g.beginPath(); g.arc(22, 30, 5, 0, 7); g.fill();
    g.fillStyle = "#1a2a3a"; g.beginPath(); g.moveTo(6, 44); for (let k = 0; k < 5; k++) g.lineTo(8 + k * 6, k & 1 ? 52 : 44); g.lineTo(36, 46); g.closePath(); g.fill(); });
  IMG.roller = mk(90, 90, g => {   // 🪨 a Roller: a spiked stone ball
    g.fillStyle = "#5a5560"; for (let k = 0; k < 10; k++) { const a = k / 10 * 6.28; g.beginPath(); g.moveTo(45 + Math.cos(a - .18) * 34, 45 + Math.sin(a - .18) * 34); g.lineTo(45 + Math.cos(a) * 45, 45 + Math.sin(a) * 45); g.lineTo(45 + Math.cos(a + .18) * 34, 45 + Math.sin(a + .18) * 34); g.fill(); }
    const gr = g.createRadialGradient(36, 34, 4, 45, 45, 36); gr.addColorStop(0, "#b8b0a8"); gr.addColorStop(1, "#6a6260"); g.fillStyle = gr; g.beginPath(); g.arc(45, 45, 35, 0, 7); g.fill();
    g.strokeStyle = "rgba(60,50,45,.6)"; g.lineWidth = 2.5; for (const [x0, y0, x1, y1] of [[22, 40, 40, 30], [50, 58, 66, 50], [34, 62, 44, 70]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); } });
  IMG.bat = mk(110, 60, g => {   // 🦇 a bat (the Swoopers)
    g.fillStyle = "#3a2a4a"; g.beginPath(); g.moveTo(55, 30); g.quadraticCurveTo(30, 0, 4, 14); g.quadraticCurveTo(16, 22, 12, 34); g.quadraticCurveTo(26, 28, 34, 40); g.quadraticCurveTo(44, 32, 55, 38);
    g.quadraticCurveTo(66, 32, 76, 40); g.quadraticCurveTo(84, 28, 98, 34); g.quadraticCurveTo(94, 22, 106, 14); g.quadraticCurveTo(80, 0, 55, 30); g.fill();
    g.beginPath(); g.ellipse(55, 34, 10, 12, 0, 0, 7); g.fill(); g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(51, 31, 2.5, 0, 7); g.arc(59, 31, 2.5, 0, 7); g.fill(); });
  IMG.ice_post = mk(18, 150, g => { const gr = g.createLinearGradient(0, 0, 18, 0); gr.addColorStop(0, "#8fc8f0"); gr.addColorStop(.5, "#f4fbff"); gr.addColorStop(1, "#7ab8e8"); g.fillStyle = gr; g.fillRect(1, 0, 16, 150);
    g.strokeStyle = "rgba(90,150,210,.5)"; for (let y = 18; y < 150; y += 22) { g.beginPath(); g.moveTo(1, y); g.lineTo(17, y); g.stroke(); } });
  IMG.ice_banner = mk(420, 80, g => { g.fillStyle = "#bfe4ff"; g.beginPath(); g.roundRect(0, 4, 420, 72, 10); g.fill(); g.strokeStyle = "#ffffff"; g.lineWidth = 3;
    for (let x = 0; x < 420; x += 42) for (let y = 6; y < 76; y += 24) g.strokeRect(x + ((y / 24 | 0) % 2) * 21, y, 42, 24);   // ice blocks
    g.font = "900 36px Ubuntu, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 6; g.strokeStyle = "#2f6fb8"; g.strokeText("❄ FAMILY KART ❄", 210, 42); g.fillStyle = "#ffffff"; g.fillText("❄ FAMILY KART ❄", 210, 42); });
}
function makePetsArt() {
  if (IMG.fountain) return;
  const mk = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; };
  IMG.fountain = mk(200, 210, g => {
    g.fillStyle = "#d8d2c8"; g.beginPath(); g.ellipse(100, 190, 96, 18, 0, 0, 7); g.fill(); g.fillStyle = "#bfb7aa"; g.fillRect(4, 160, 192, 30); g.fillStyle = "#e8e2d8"; g.beginPath(); g.ellipse(100, 160, 96, 18, 0, 0, 7); g.fill();
    g.fillStyle = "#6ab8ff"; g.beginPath(); g.ellipse(100, 160, 84, 13, 0, 0, 7); g.fill();
    g.fillStyle = "#d8d2c8"; g.fillRect(88, 70, 24, 92); g.beginPath(); g.ellipse(100, 72, 46, 10, 0, 0, 7); g.fill();
    g.strokeStyle = "rgba(200,235,255,.9)"; g.lineWidth = 4; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(100, 40); g.quadraticCurveTo(100 + sd * 60, 0, 100 + sd * 80, 150); g.stroke(); }
    g.fillStyle = "rgba(220,245,255,.95)"; g.beginPath(); g.ellipse(100, 36, 10, 26, 0, 0, 7); g.fill(); });
  IMG.mansion = mk(640, 330, g => {
    g.fillStyle = "#fbf7f2"; g.fillRect(40, 120, 560, 210); g.fillStyle = "#efe7de"; g.fillRect(250, 90, 140, 240);
    g.fillStyle = "#f07ab0"; g.beginPath(); g.moveTo(20, 128); g.lineTo(120, 40); g.lineTo(520, 40); g.lineTo(620, 128); g.closePath(); g.fill();   // the pink roof
    g.fillStyle = "#e0559a"; g.beginPath(); g.moveTo(230, 96); g.lineTo(320, 6); g.lineTo(410, 96); g.closePath(); g.fill();
    g.fillStyle = "#ffd75e"; g.beginPath(); g.arc(320, 60, 14, 0, 7); g.fill();
    g.fillStyle = "#8fd0ff"; for (const x of [70, 140, 450, 520]) for (const y of [160, 240]) { g.fillRect(x, y, 44, 52); g.fillStyle = "#fbf7f2"; g.fillRect(x + 20, y, 4, 52); g.fillStyle = "#8fd0ff"; }
    g.fillStyle = "#c9a07a"; g.beginPath(); g.moveTo(290, 330); g.lineTo(290, 250); g.arc(320, 250, 30, Math.PI, 0); g.lineTo(350, 330); g.fill();
    g.fillStyle = "#ffffff"; for (const x of [240, 392]) g.fillRect(x, 140, 14, 190); });
  IMG.gazebo = mk(180, 190, g => {
    g.fillStyle = "#f6f2ec"; for (const x of [20, 60, 112, 152]) g.fillRect(x, 70, 8, 110); g.fillRect(10, 176, 160, 12);
    g.fillStyle = "#f07ab0"; g.beginPath(); g.moveTo(0, 74); g.quadraticCurveTo(90, -20, 180, 74); g.closePath(); g.fill(); g.fillStyle = "#ffd75e"; g.beginPath(); g.arc(90, 14, 7, 0, 7); g.fill(); });
  IMG.hotair = mk(120, 170, g => {
    const cols = ["#ff7ab8", "#ffffff", "#ffd23f", "#ffffff"]; for (let k = 0; k < 6; k++) { g.fillStyle = cols[k % 4]; g.beginPath(); g.moveTo(60, 120); g.ellipse(60, 58, 56, 58, 0, Math.PI + k * Math.PI / 6, Math.PI + (k + 1) * Math.PI / 6); g.lineTo(60, 120); g.fill(); }
    g.fillStyle = "#ff7ab8"; g.beginPath(); g.ellipse(60, 58, 56, 58, 0, 0, Math.PI); g.fill(); g.strokeStyle = "#7a5a3a"; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 105); g.lineTo(48, 145); g.moveTo(90, 105); g.lineTo(72, 145); g.stroke();
    g.fillStyle = "#a0703c"; g.fillRect(44, 142, 32, 24); });
  IMG.chain_post = mk(20, 44, g => { g.fillStyle = "#6b4426"; g.fillRect(6, 4, 8, 40); g.fillStyle = "#8a8d96"; g.beginPath(); g.arc(10, 8, 6, 0, 7); g.fill(); });
}
function placeStart(push) {
  if (!IMG.arch_post || (T.gate === "market" && IMG.mp_sign && IMG.mk_banner && IMG.mk_banner.height !== 200)) makeArchArt();   // (again once the Market Place sign has loaded)
  const li = OPEN ? START_I : 0, half = ROAD / 2 + CURB + 10, [cx, cy] = at(li, 0), mk = T.gate === "market", pp = T.gate === "pets", ice = T.gate === "ice" && IMG.ice_post;
  for (const sd of [-1, 1]) { const [x, y] = at(li, sd * half); push(x, y, mk ? "mk_post" : pp ? "pp_post" : ice ? "ice_post" : "arch_post", mk && IMG.mp_sign ? 1.05 : pp ? .82 : .62, 0); }
  OBJS.push({ x: cx, y: cy, k: mk ? "mk_banner" : pp ? "pp_banner" : ice ? "ice_banner" : "arch_banner", s: (half * 2 + 14) / 420, r: 0, z: mk ? 36 : pp ? 58 : ice ? 40 : 70 });   // the market sign hangs low, right in view
  for (let n = 0; n < 10; n++) { const sd = n % 2 ? 1 : -1, [x, y] = at(li + (n >> 1) - 2, sd * (half + 6 + (n % 3) * 7));
    OBJS.push({ x, y, k: "balloon" + (n % 6), s: .7, r: 0, z: 78 + (n % 4) * 9, bob: 4 }); }
}
// Founders and Core Family cheering along the track
async function makeCrowd() {
  CROWD = [];
  const li = OPEN ? START_I : 0, idx = i => OPEN ? Math.max(0, Math.min(N - 1, i)) : ((i % N) + N) % N;
  const cheer = (name, i, sd, tag) => loadImg(spriteOf(name)).then(im => { if (!im) return; im.px = true;
    const [x, y] = at(idx(i), sd * (ROAD / 2 + CURB + 20));
    if (inLake(x, y)) return;
    CROWD.push({ x, y, img: im, s: .46, jump: 6 + Math.random() * 7, sp: 5 + Math.random() * 4, ph: Math.random() * 6, flip: sd > 0, tag });
  });
  const jobs = [];
  // 1 or 2 of the Founders and Core Family cheering somewhere along the track: different people, different spots every race
  const fam = (typeof D !== "undefined" ? D.founders : []).filter(p => p && p.name && !p.traitor && !p.grave).sort(() => Math.random() - .5).slice(0, Math.random() < .5 ? 1 : 2);
  fam.forEach((p, n) => { const span = OPEN ? N - FIN_OFF - START_I : N, i = li + Math.round(span * (.15 + (n + Math.random()) * .35));
    jobs.push(cheer(p.name, i, Math.random() < .5 ? -1 : 1, `${p.founder ? "👑" : "⭐"} ${p.name}`)); });
  await Promise.all(jobs);
}
function placeObjects() {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  OBJS = [];
  const push = (x, y, k, sc, r) => OBJS.push({ x, y, k, s: sc != null ? sc : PROPS[k][0], r: r != null ? r : PROPS[k][1] });
  const CLEAN = PTS[0].length > 2;
  for (let s = 20; s < N; s += CLEAN ? 46 : 16) {
    for (const side of [-1, 1]) {
      if (rnd() < (CLEAN ? .45 : .22)) continue;
      const a = tangent(s), off = ROAD / 2 + CURB + (CLEAN ? 70 + rnd() * 110 : 18 + rnd() * 60), x = PTS[s][0] - Math.sin(a) * off * side, y = PTS[s][1] + Math.cos(a) * off * side;
      if (roadDist(x, y) < ROAD / 2 + CURB + 16 || inLake(x, y) || x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) continue;
      if (rnd() < .18) { OBJS.push({ x, y, k: T.mobs[Math.floor(rnd() * T.mobs.length)], s: .42, r: 10, mob: true }); continue; }
      if (T.near.length) push(x, y, T.near[Math.floor(rnd() * T.near.length)]);   // (a track can have none: Boo Lake's road is a boardwalk over water)
    }
  }
  T.extraFn(push);
  placeStart(push);   // the FAMILY arch and balloons on every map
  { const li = OPEN ? START_I : 0, s0 = PTS[li];   // a map's own gate at the start line moves to halfway round, so the two arches don't stand together
    for (const o of OBJS) if (!o.r && !/^(arch|balloon|mk_|pp_|ice_)/.test(o.k) && Math.hypot(o.x - s0[0], o.y - s0[1]) < 140 && nearest(o.x, o.y).d < 30) {
      const [x, y] = at(OPEN ? Math.round(START_I + (N - FIN_OFF - START_I) * .5) : Math.round(N * .5), 0); o.x = x; o.y = y; } }
  // anything solid that touches the road is moved back off it (a haypile on the curb…); where the road doubles back there may be no room: then it goes
  const touching = o => { const m = nearest(o.x, o.y); if (m.d < ROAD / 2 + CURB + o.r + 5) return [m, ROAD / 2, PTS[m.i]];
    if (AN) { const a = nearAlt(o.x, o.y); if (a.d < ALT_ROAD / 2 + CURB + o.r + 5) return [a, ALT_ROAD / 2, ALT[a.j]]; } return null; };
  OBJS = OBJS.filter(o => {
    if (!(o.r > 0)) return true;
    for (let tries = 0; tries < 4; tries++) { const t = touching(o); if (!t) return true;
      const [m, half, p] = t, want = half + CURB + o.r + 6, dx = o.x - p[0], dy = o.y - p[1], len = Math.hypot(dx, dy) || 1; o.x = p[0] + dx / len * want; o.y = p[1] + dy / len * want; }
    return !touching(o);
  });
  if (GAPS.length) OBJS = OBJS.filter(o => { const m = nearest(o.x, o.y); return !(gapAt(m.i) && m.d < 520); });   // nothing stands over a gorge or pond
  if (T.far.length) for (let k = 0; k < Math.round((CLEAN ? 60 : 170) * WS * WS); k++) {   // woods and houses further out (as many per acre on a bigger map; none out in space)
    const x = 30 + rnd() * (WORLD - 60), y = 30 + rnd() * (WORLD - 60), d = roadDist(x, y);
    if (d < ROAD / 2 + (CLEAN ? 260 : 130) || inLake(x, y) || (GAPS.length && d < 560 && gapAt(nearest(x, y).i))) continue;
    const kk = T.far[Math.floor(rnd() * T.far.length)];
    push(x, y, kk, PROPS[kk][0] * 1.2);
  }
}

// ------------------------------------------------------------------ screen
// the world is laid out on a 320-unit-wide screen; the height follows the screen's shape (tall on phones), with the camera raised to match.
// The floor is drawn QUAL times sharper than that (2-3x on most screens), and steps down by itself if the device can't keep up.
const W = 320, FOCAL = 170, CAMD = 84;
let G3 = null, G3E = null, r3t = 0;   // the 3D engine (kart3d.js) once it's loaded; G3 is set while the current track is drawn in 3D
let H = 192, HOR = 58, CAMH = 30, floor = null, F32 = null, FOG = [], S = 1, FW = 320, FH = 134, QMAX = matchMedia("(pointer: coarse)").matches ? 2 : 3, floorMs = 0;   // phones start one step less sharp, so they never hitch stepping down mid-race
const cv = $k("#kCanvas"), bctx = cv.getContext("2d");
const fxc = $k("#kFx"), ctx = fxc.getContext("2d");   // sky, town, props, karts and the minimap, drawn sharp at screen resolution
function fit() {
  const el = $k(".kt-screen"), r = { width: el.offsetWidth, height: el.offsetHeight };   // layout size, not the on-screen box (the game may be turned sideways)
  const h = r.width > 0 ? Math.round(W * r.height / r.width) : 192;
  H = Math.max(130, Math.min(640, h)); HOR = Math.round(H * .27); CAMH = (H * .8 - HOR) * CAMD / FOCAL;
  const dpr = Math.min(2, window.devicePixelRatio || 1), pw = Math.min(1800, Math.round((r.width || W) * dpr));
  const fk = Math.max(1, Math.min(QMAX, Math.round(pw / W / 1.5))); FW = W * fk; FH = (H - HOR) * fk;
  cv.width = FW; cv.height = H * fk; bctx.imageSmoothingEnabled = false; cv.style.imageRendering = fk > 1 ? "auto" : "";
  floor = bctx.createImageData(FW, FH); F32 = new Uint32Array(floor.data.buffer);
  FOG = []; for (let y = 0; y < FH; y++) { const yl = y / fk; FOG[y] = yl < 8 ? Math.round(150 * (1 - yl / 8)) : 0; }   // only a thin blend into the horizon
  fxc.width = pw; fxc.height = Math.round(pw * H / W); S = pw / W;
  cv.style.display = G3 ? "none" : ""; $k("#k3d").style.display = G3 ? "" : "none"; if (G3) G3.resize(r.width || W, r.height || H);
}
fit();
addEventListener("resize", () => { if (state !== "menu") fit(); });
// close-up grain (multiplied into the nearest rows of the floor): soft speckles so the road and grass look like a surface, not blur
const DETAIL = new Uint16Array(64 * 64);
{ let sd = 3; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < DETAIL.length; i++) DETAIL[i] = 256 - Math.round(r() * 26);
  for (let k = 0; k < 120; k++) { const x = r() * 64 | 0, y = r() * 64 | 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) DETAIL[((y + dy) & 63) * 64 + ((x + dx) & 63)] = 205 + (r() * 20 | 0); } }
const OUT0 = 0xff2e7d32 >>> 0, HAZE0 = [214, 236, 255];   // beyond the map edge: dark forest (ABGR); the horizon haze
const hexABGR = h => { const n = parseInt(h.slice(1), 16); return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0; };
const FIN_OFF = 14;   // an open track's finish line, this many points before its end
let OUT = OUT0, HAZE = HAZE0, sky = null;
const GH3 = { top: { name: "ghost" }, me: { name: "ghost" } };
const trackData = () => ({ key: TRACK_KEY, PTS, N, OPEN, ALT, AN, FORK_A, FORK_B, SPC, ROAD, CURB, ALT_ROAD, ALT_STYLE, tex, theme: T.theme, cup: T.cup, sky, strip: IMG.strip, haze: HAZE,
  decal: () => { const c = document.createElement("canvas"); c.width = c.height = TW; paintTrack(c); return c; }, WORLD,
  gaps: GAPS, hedges: HEDGES, buildings: BUILDINGS, chutes: CHUTES, aurora: !!T.theme.aurora, fairy: T.theme.fairy && LAKE ? LAKE : null, peaks: !!T.theme.peaks, drifts: !!T.theme.drifts, props3d: [...OBJS.filter(o => (o.f3d || K3D.has(o.k)) && o.k !== "fountain"), ...HEDGES.filter(b => K3D.has(b.sprite)).map(b => ({ k: b.sprite, x: b.x, y: b.y, h: b.h * 1.25, s: 0 }))].map(o => o.fa != null ? o : { ...o, fa: (q => Math.atan2(q[1] - o.y, q[0] - o.x))(at(nearest(o.x, o.y).i, 0)) }), lake: LAKE, caves: CAVES, bare: BARE, rings: RINGS, plane: PLANE, tiles: TILEPAT, thwomps: THWOMPS, thz: thwompZ, carts: CARTS, cartAt, ledges: LEDGES, gears: GEARS, hands: HANDS, handAng, pends: PENDS, pendAt, hide: HIDE, fireballs: FIREBALLS, fireZ, holes: HOLES.filter(h => h.lap), lapNow: () => (K ? K.lap + 1 : 1), water: T.water ? { level: T.water.level * WS, bed: T.water.bed * WS } : null, sea: T.theme.sea != null ? T.theme.sea * WS : null,
  shrooms: PADS.filter(p => p.t === "shroom").map(p => { const [x, y] = at(p.i + p.len / 2, p.o); return { x, y, a: tangent(p.i), w: p.w, l: p.len * SPC + 8, col: p.col, pad: p }; }) });
async function load3d() {
  if (G3E || store.get("kart_3d") === "0") return;
  try { const m = await import("./kart3d.js?v=107"); G3E = m.create({ WORLD, canvas: $k("#k3d"), touch: matchMedia("(pointer: coarse)").matches }); }
  catch (e) { console.warn("Family Kart: 3D unavailable, using the flat view", e); G3E = null; }
}

// ------------------------------------------------------------------ rivals and items
// 7 computer racers (real guild members), rows of item boxes, and all the Mario Kart 8 Deluxe items as MapleStory things (see ITEM_ICON)
// modes: a 3-race Grand Prix with points and a podium, a single race, or a Time Trial alone against your ghost (only Time Trial
// times go on the guild board, like Mario Kart's leaderboards, since races with rivals depend on luck)
const MODES = { gp: "🏆 Grand Prix", race: "🏁 Single race", tt: "⏱️ Time Trial", mp: "👥 Multiplayer" };
const SHOWN_MODES = ["tt", "mp"];   // Grand Prix and Race are hidden for now
let mode = SHOWN_MODES.includes(store.get("kart_mode")) ? store.get("kart_mode") : "tt";
let cup = CUPS[store.get("kart_cup")] ? store.get("kart_cup") : "henesys";   // picked cup (the Grand Prix races all 3 of its tracks)
let track = TRACKS[store.get("kart_track")] ? store.get("kart_track") : "henesys";   // picked track for Race and Time Trial
if (!CUPS[cup].tracks.includes(track)) track = CUPS[cup].tracks[0];
const GP_RACES = 3, GP_PTS = [10, 8, 6, 4, 3, 2, 1, 0];
let gp = null;   // { race, names, pts: { name: points } }
let ghost = null, ghostRec = [];   // your best Time Trial run, sampled 10 times a second: [t, x, y, a, z]
const ghostKey = () => `kart_ghost2:${ccId(TRACK_ID, raceCC)}:${me}`;
// difficulty, picked before the race: rival speed, how hard they catch up, how often they grab items
const DIFFS = { easy: { skill: .95, band: .07, pick: .55, drift: .3, label: "Easy" }, normal: { skill: 1.16, band: .15, pick: .85, drift: .65, label: "Normal" }, hard: { skill: 1.2, band: .18, pick: 1, drift: .9, label: "Hard" } };   // drift: how often a computer racer gets a mini-turbo out of a corner
let diff = DIFFS[store.get("kart_diff")] ? store.get("kart_diff") : "normal";
// speed classes like Mario Kart's: everything on the track moves slower (turning stays the same, so it's easier to steer)
const CCS = { 50: { spd: .7, label: "🐢 50cc" }, 100: { spd: .85, label: "🏎️ 100cc" }, 150: { spd: 1, label: "🔥 150cc" } };
let cc = CCS[store.get("kart_cc")] ? +store.get("kart_cc") : 100, SPD = 1;   // 100cc unless you picked another class   // SPD: the class of the race being driven right now
const ccId = (id, c) => c === 150 ? id : `${id}_${c}`;   // board / ghost / best ids: 150cc keeps the plain track id
const DIFF = () => DIFFS[diff];
const RIVAL_COLORS = ["#6eaa64", "#4682be", "#8a6a4a", "#aa64b4", "#3ca0a0", "#e07a12", "#5a64a0"];   // red + gold is yours
// 🎁 the Mario Kart 8 Deluxe items, each turned into a MapleStory thing (icons from maplestory.io)
const IT = "media/kart/items/";
const ITEM_ICON = { slime: "media/mobs/slime.png", slime3: "media/mobs/slime.png", gshell: IT + "shell_green.png", gshell3: IT + "shell_green.png", rshell: IT + "shell_red.png", rshell3: IT + "shell_red.png",
  bshell: IT + "shell_blue.png", bomb: IT + "bomb0.png", elixir: "media/duel/elixir.png", triple: "media/duel/elixir.png", golden: IT + "power_elixir.png", rocket: IT + "rocket.png",
  splat: "media/mobs/octopus.png", thunder: "media/kart/thunder.png?v=2", hyper: "media/kart/hyperbody.png", fire: IT + "star_fire.png", boom: IT + "star_ilbi.png", piranha: IT + "nependeath.gif",
  horn: IT + "megaphone.png", eight: IT + "gachapon.png", coin: "media/kart/meso1.png", boo: IT + "jrwraith.gif", arrow: IT + "arrow_icon.png", arm: "media/duel/zarm_stand.gif" };
const ITEM_NAME = { slime: "Slime drop", slime3: "3 Slime drops", gshell: "Green Snail Shell", gshell3: "3 Green Snail Shells", rshell: "Red Snail Shell", rshell3: "3 Red Snail Shells",
  bshell: "Blue Snail Shell", bomb: "Pirate Bomb", elixir: "Elixir", triple: "3 Elixirs", golden: "Power Elixir", rocket: "Rocket Booster", splat: "Splat", thunder: "Thunder", hyper: "Hyper Body",
  fire: "Hwabi Fire Stars", boom: "Ilbi Throwing-Star", piranha: "Nependeath", horn: "Megaphone", eight: "Gachapon", coin: "Mesos", boo: "Jr. Wraith", arrow: "Arrow", arm: "Zakum's Arm" };
const ITEM_N = { triple: 3, slime3: 3, gshell3: 3, rshell3: 3, boom: 3, eight: 8 };   // used one at a time
const ITEM_ONE = { triple: "elixir", slime3: "slime", gshell3: "gshell", rshell3: "rshell" };   // what each use of a "3" item is
const EIGHT = ["coin", "rshell", "gshell", "bomb", "splat", "hyper", "elixir", "slime"];   // 🎰 Gachapon = Crazy Eight: these 8, one per press
// how likely each item is, by how far behind the leader you are (Mario Kart 8's own tables, version 4.1: Grand Prix, people and computer racers;
// the numbers are % x 2). Deluxe added the Boo (here Jr. Wraith); it's mixed into the middle tables.
const MK = ["slime", "gshell", "rshell", "elixir", "bomb", "splat", "bshell", "triple", "hyper", "rocket", "thunder", "golden", "fire", "piranha", "horn", "boom", "coin", "slime3", "gshell3", "rshell3", "eight"];
const MK_P = [[400, "65,50,5,5,0,0,0,0,0,0,0,0,0,0,5,0,70,0,0,0,0"], [1000, "20,25,50,20,10,0,0,0,0,0,0,0,10,10,5,5,15,15,10,5,0"], [2000, "10,20,30,25,15,0,0,15,0,0,0,0,10,15,5,10,5,10,10,15,5"],
  [3300, "0,15,20,50,5,5,0,60,0,0,0,0,5,5,0,10,0,0,10,10,5"], [5500, "0,0,10,30,0,5,5,85,25,10,0,25,0,0,0,0,0,0,0,0,5"], [8000, "0,0,0,10,0,0,5,65,40,30,5,40,0,0,0,0,0,0,0,0,5"],
  [13000, "0,0,0,0,0,0,5,35,35,60,10,55,0,0,0,0,0,0,0,0,0"], [26000, "0,0,0,0,0,0,0,10,30,85,15,60,0,0,0,0,0,0,0,0,0"], [1e9, "0,0,0,0,0,0,0,30,40,70,0,60,0,0,0,0,0,0,0,0,0"]].map(([d, w]) => [d, w.split(",").map(Number)]);
const MK_B = [[300, "50,40,15,10,0,0,0,0,0,0,0,0,0,0,5,0,70,10,0,0,0"], [700, "25,30,60,15,5,0,0,0,0,0,0,0,5,10,5,5,20,10,10,0,0"], [1300, "30,35,30,25,10,0,0,10,0,0,0,0,10,5,0,10,15,10,10,0,0"],
  [2600, "30,35,15,45,10,5,0,25,0,0,0,0,5,5,0,5,5,0,15,0,0"], [4500, "30,35,5,50,0,5,3,47,10,0,0,10,0,0,0,0,0,0,5,0,0"], [7000, "15,20,0,50,0,0,4,58,20,10,3,20,0,0,0,0,0,0,0,0,0"],
  [13000, "10,10,0,30,0,0,0,57,30,30,3,30,0,0,0,0,0,0,0,0,0"], [26000, "10,10,0,10,0,0,0,42,30,55,3,40,0,0,0,0,0,0,0,0,0"], [1e9, "0,0,0,30,0,0,0,60,30,50,0,30,0,0,0,0,0,0,0,0,0"]].map(([d, w]) => [d, w.split(",").map(Number)]);
const ROLL_KEYS = [...MK, "boo"];
const HELD_IMG = it => it === "arrow" ? IMG.arrowIcon : /^gshell/.test(it) ? IMG.it_gshell : /^rshell/.test(it) ? IMG.it_rshell : IMG.slime;
let RIV = [], DROPS = [], SHOTS = [], ARMS = [], BOMBS = [], BOOMS = [], BSHELLS = [], HORNS = [];
const BOMB_R = 78;   // 💣 the Pirate Bomb's blast radius (world units; a kart is about 20 wide)
const progOf = r => (r.done ? 1e6 - r.finish : 0) + (r.remote && !liveOK(r) && r.srvProg != null ? r.srvProg * (OPEN ? N : LAPS * N) : (OPEN ? r.idx : r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx)));
const racers = () => [K, ...RIV];
function rankOf(r) { const p = progOf(r); return 1 + racers().filter(o => o !== r && progOf(o) > p).length; }
function gridSpot(slot) {
  if (PTS[0] && PTS[0].length > 2) { const row = Math.floor(slot / 2), col = slot % 2, sp = 66 / SPC, i = Math.round((OPEN ? START_I : N) - 105 / SPC - row * sp * 1.15 - col * sp * .5);   // 3D tracks: the pole spot 105 units behind the line, a roomy staggered grid
    return { i, o: (col ? 1 : -1) * ROAD * .24 }; }
  const row = Math.floor(slot / 2), col = slot % 2, i = (OPEN ? START_I - 6 : N - 6) - row * 9 - col * 3; return { i, o: col ? 24 : -24 }; }
// ------------------------------------------------------------------ multiplayer (rooms of 2-8, the first one in is the host)
// Everyone drives their own kart; positions go out ~12 times a second over Realtime broadcast, other players are drawn from those.
// Items reach other players as events; each player only ever decides hits on their OWN kart. The server keeps the room and scores it.
const MP = { tally: {}, tallied: null, pick: null, endAt: 0, firstName: null, code: null, token: null, me: null, host: null, players: [], status: null, track: "henesys", raceNo: 0, ch: null, poll: null, slot: 0, goAt: 0, sendAt: 0, results: null, finished: false };
const mpOn = () => mode === "mp" && !!MP.code;
// 🔒 Room messages are encrypted and signed (AES-GCM) with the room's secret, which the server only gives to players who joined.
// Someone who just knows the room code can't read them or fake them. The direct-connection setup is never sent without it.
const b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = s2 => Uint8Array.from(atob(s2), c => c.charCodeAt(0)), enc8 = new TextEncoder(), dec8 = new TextDecoder();
async function mpSetKey(hex) {
  if (!hex || hex === MP.keyHex || !(window.crypto && crypto.subtle)) return;
  MP.keyHex = hex; const raw = await crypto.subtle.digest("SHA-256", enc8.encode("family-kart-room:" + hex));
  MP.key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function mpSeal(event, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), ad = enc8.encode(event + "|" + MP.code);   // tied to this room and this kind of message
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad }, MP.key, enc8.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}
async function mpOpen(event, payload, secure) {
  if (payload && typeof payload.x === "string") {
    if (!MP.key) return null;
    try { const all = unb64(payload.x), pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12), additionalData: enc8.encode(event + "|" + MP.code) }, MP.key, all.slice(12));
      return JSON.parse(dec8.decode(pt)); } catch (e) { return null; }   // wrong key or tampered with: dropped
  }
  return secure ? null : payload;   // (games from before this update send plain messages; the connection setup must be sealed)
}
function mpSend(event, payload) {
  if (!MP.ch) return; const ch = MP.ch, obj = { n: MP.me, rc: MP.raceNo, ...payload };
  if (MP.key) mpSeal(event, obj).then(x => { if (MP.ch === ch) ch.send({ type: "broadcast", event, payload: { x } }); }).catch(() => {});
  else if (event !== "rtc") ch.send({ type: "broadcast", event, payload: obj });
}   // payload.n speaks for a bot
const nameOf = o => o === K ? MP.me : o && o.name;
// items used by you, or by one of the host's bots, are announced to the room
function mpItem(r, payload) { if ((r === K || r.bot) && mpOn()) mpSend("it", { ...payload, n: nameOf(r) }); }
function mpByName(n) { return n === MP.me ? K : RIV.find(r => r.name === n); }
// Every arrow, slime drop and bomb in a room has an id. Whoever threw it is the judge: if it hits another player's kart on the
// thrower's screen, the thrower tells that player's game ("hx") and they spin out, so a hit you see is a hit they get (once).
let itemSeq = 0; const HITS = new Set();
const itemId = r => mpOn() && (r === K || (r.bot && !r.remote)) ? `${MP.me}:${++itemSeq}` : null;
function hitBy(r, msg, o, kind) {
  if (r.remote) { if (o && o.id && o.own && mpOn() && !HITS.has(o.id + "|" + r.name)) { HITS.add(o.id + "|" + r.name); mpSend("hx", { id: o.id, v: r.name, m: msg, k: kind }); } return; }
  if (o && o.id) { if (HITS.has(o.id + "|" + nameOf(r))) return; HITS.add(o.id + "|" + nameOf(r)); if (!o.own && mpOn() && r === K) mpSend("hx", { id: o.id, v: MP.me, k: kind, seen: 1 }); }
  hit(r, msg);
}
function mpOnHit(p) {
  if (!p || p.rc !== MP.raceNo || !K || state === "menu" || !p.id) return;
  if (p.k === "shot") { const i = SHOTS.findIndex(o => o.id === p.id); if (i >= 0) SHOTS.splice(i, 1); }   // it's gone for everyone
  if (p.k === "drop") { const i = DROPS.findIndex(o => o.id === p.id); if (i >= 0) DROPS.splice(i, 1); }
  if (p.seen) return;
  const v = mpByName(p.v); if (!v || v.remote || HITS.has(p.id + "|" + p.v)) return;
  HITS.add(p.id + "|" + p.v); const was = v.spin; hit(v, String(p.m || "💥 Hit!").slice(0, 60));
  if (p.k === "bomb" && v.spin > 0 && !(was > 0)) { v.vz = 230; v.z = .1; v.v *= .3; }
}
function mpOnPos(p, lat) {
  if (!p || p.rc !== MP.raceNo || !K) return;
  const r = RIV.find(o => o.name === p.n); if (!r) return;
  if (DEV && p.wt) { const L = DEV.lat || (DEV.lat = { p2p: [], server: [] }); (lat != null ? L.p2p : L.server).push(Date.now() - p.wt); }   // (testing) how long each route took
  if (p.ts != null && r.net && r.net.ts != null && p.ts <= r.net.ts && p.ts > r.net.ts - 60000) return;   // an older message that arrived late: ignore it
  const t = performance.now(), had = !!r.net;
  r.net = { x: p.x, y: p.y, a: p.a, m: p.m != null ? p.m : p.a, v: p.v, u: p.u, w: p.w || 0, ts: p.ts, t, lat: Math.min(600, lat != null ? lat : (p.l != null ? p.l : 70) + (MP.ow || 70)) };   // lat: how old it already was on arrival
  r.drift = p.d || 0;
  if (had) { const [tx, ty, ta] = predictNet(r.net, t); r.off = { x: r.x - tx, y: r.y - ty, a: Math.atan2(Math.sin(r.a - ta), Math.cos(r.a - ta)) };   // keep drawing them where they are now; the difference fades away
    if (Math.hypot(r.off.x, r.off.y) > 140) r.off = { x: 0, y: 0, a: 0 }; }   // a respawn or a long gap: just put them there
  else { [r.x, r.y, r.a] = predictNet(r.net, t); r.off = { x: 0, y: 0, a: 0 }; }
  r.z = p.z || 0; r.steer = p.s || 0; r.spin = p.sp || 0; r.small = p.sm || 0; r.hyper = p.hy || 0; r.rocket = p.rk || 0; r.boo = p.bo || 0; r.piranha = p.pi || 0; r.extra = p.ex || 0; r.squash = p.sq || 0;
  r.lap = p.lap; r.cps = p.cps; r.idx = p.idx; r.holding = !!p.ho; r.item = p.it || null; r.ink = p.ik || 0;
  if (p.dn && !r.done) { r.done = true; r.finishT = p.ft; r.finish = ++finishers; if (!MP.endAt && !r.bot) { MP.endAt = performance.now() + 10000; MP.firstName = r.name; } }   // bots don't start the 10 s clock
}
function mpOnItem(p) {
  if (!p || p.rc !== MP.raceNo || !K || state === "menu") return;
  const by = RIV.find(o => o.name === p.n); if (!by) return;
  if (p.k === "drop") DROPS.push({ x: p.x, y: p.y, t: 40, by, grace: .3, id: p.id });
  if (p.k === "bomb") BOMBS.push({ x: p.x, y: p.y, z: 12, a: p.a, v: p.v, vz: 230, by, t: 0, id: p.id });
  if (p.k === "shot") { const sk = p.sk || "a"; SHOTS.push({ x: p.x, y: p.y, a: p.a, v: p.v, tgt: p.tgt ? mpByName(p.tgt) || null : null, by, k: sk, life: { g: 7, f: 1.8, b: 2.2 }[sk] || 4, bn: sk === "g" ? 5 : 1, out: .6, idx: p.i, grace: .5, id: p.id }); }
  if (p.k === "bshell") { const tgt = mpByName(p.tgt); if (tgt) { BSHELLS.push({ by, tgt, p: progOf(by), t: 0, id: p.id }); armCD = 20; if (tgt === K) flash(`💙 ${by.name}'s Blue Snail Shell is coming for you!`, 1200); } }
  if (p.k === "horn") { HORNS.push({ x: p.x, y: p.y, t: 0 }); hornAt(p.x, p.y, by, p.id, false); }
  if (p.k === "boo") { const v = mpByName(p.tgt); if (v && !v.remote && v.item && v.item !== "boo") { mpItem(v, { k: "booGive", tgt: by.name, it: v.item, nn: v.itemN || 0 }); if (v === K) flash(`👻 ${by.name} stole your ${ITEM_NAME[v.item]}!`, 1100); v.item = null; v.itemN = 0; v.holding = false; } }
  if (p.k === "booGive") { const r = mpByName(p.tgt); if (r && !r.remote) { booGive(r, p.it, p.nn); if (r === K) flash(`👻 Stole ${by.name}'s ${ITEM_NAME[p.it] || "item"}!`, 1100); } }
  if (p.k === "arm" && p.tgt === MP.me) { ARMS.push({ tgt: K, t: 2.6, by }); armCD = 20; }
  if (p.k === "thunder") {
    thunderCD = 25; thunderFx = .35; thunderSound();
    if (!K.done && !(K.rescue > 0) && !(K.hyper > 0)) { if (K.holding || HOLDABLE(K.item)) { K.item = null; K.holding = false; } K.small = 3.2; K.inv = 0; K.z = 0; K.vz = 0; spinOut(`⚡ Thunder from ${by.name}!`); K.shake = .3; }
  }
  if (p.k === "splat") { bloopCD = 14; if (!K.done && progOf(K) > p.p && !(K.bloopSafe > 0) && !(K.hyper > 0)) { K.ink = 4; K.bloopSafe = 12; makeInk(); flash(`🐙 Splat from ${by.name}!`, 1000); splatSound(); } }
}
// other players' karts. A message is already old when it arrives (the trip through the server), so it's moved on by its age:
// turning at the rate they were turning, at their speed (at most half a second ahead, so a lost message can't send them flying)
function predictNet(n, now) {
  const age = Math.min(.5, Math.max(0, (now - n.t + n.lat) / 1000)), steps = Math.max(1, Math.ceil(age / .04)), h = age / steps, sp = n.u != null ? n.u : n.v * SPD;
  let x = n.x, y = n.y, m = n.m;
  for (let i = 0; i < steps; i++) { m += n.w * h / 2; x += Math.cos(m) * sp * h; y += Math.sin(m) * sp * h; m += n.w * h / 2; }
  return [x, y, n.a + (m - n.m)];   // the nose keeps its angle to the direction of travel
}
const liveOK = r => r.net && performance.now() - r.net.t < 2500;   // fresh live position from this racer?
function remoteStep(r, dt) {
  if (!liveOK(r) && r.srvProg != null) {   // no live messages: follow the server's progress along the road (shown slightly see-through)
    const i = OPEN ? Math.round(START_I + r.srvProg * (N - FIN_OFF - START_I)) : Math.round((r.srvProg * LAPS % 1) * N) % N, [x, y] = at(i, 0), f = Math.min(1, dt * 3);
    r.x += (x - r.x) * f; r.y += (y - r.y) * f; r.a = tangent(i); r.idx = i; r.lap = OPEN ? 0 : Math.min(LAPS - 1, Math.floor(r.srvProg * LAPS)); r.cps = Math.floor((i / N) * 4) % 4; r.gone = false; r.ghost = true; return;
  }
  r.ghost = false;
  if (!r.net) return;
  if (DEV && DEV.oldNet) { const age = Math.min(.3, (performance.now() - r.net.t) / 1000), px = r.net.x + Math.cos(r.net.a) * r.net.v * SPD * age, py = r.net.y + Math.sin(r.net.a) * r.net.v * SPD * age;   // (testing) the old way, for comparison
    const f = Math.min(1, dt * 12); r.x += (px - r.x) * f; r.y += (py - r.y) * f; r.v = r.net.v; let d = r.net.a - r.a; d = Math.atan2(Math.sin(d), Math.cos(d)); r.a += d * f; return; }
  // where they are NOW: their last message, moved on by its full age along the curve they were driving, plus a fading correction
  const [px, py, pa] = predictNet(r.net, performance.now()), off = r.off || (r.off = { x: 0, y: 0, a: 0 }), k = Math.exp(-dt / .12);
  off.x *= k; off.y *= k; off.a *= k;
  r.x = px + off.x; r.y = py + off.y; r.a = pa + off.a; r.v = r.net.v;
  r.gone = performance.now() - r.net.t > 6000;
}
// 🤖 computer racers in rooms are MapleStory monsters in karts
const BOT_IMG = { "Orange Mushroom": "orange_mushroom", "Ribbon Pig": "ribbon_pig", "Blue Snail": "blue_snail", "Stump": "stump", "Green Mushroom": "green_mushroom", "Horny Mushroom": "horny_mushroom", "Pig": "pig" };
const botImg = name => `media/mobs/${BOT_IMG[name] || "orange_mushroom"}.png`;
function makeRivals(keep) {
  if (mode === "tt") { RIV = []; DROPS = []; SHOTS = []; ARMS = []; BSHELLS = []; HORNS = []; return; }
  if (mode === "mp") {   // the other players in the room, on the grid in the order they joined
    const order = MP.players.filter(p => !p.spec).map(p => p.name), others = MP.players.filter(p => p.name !== MP.me && !p.spec), host = MP.host === MP.me && !MP.watching;
    RIV = others.map((p, n) => {
      const name = p.name, g = gridSpot(order.indexOf(name)), [x, y] = at(g.i, g.o), img = new Image(); img.src = p.bot ? botImg(name) : spriteOf(name);
      const r = { name, img, color: RIVAL_COLORS[n % RIVAL_COLORS.length], x, y, a: tangent((g.i + N) % N), v: 0, idx: (g.i + N) % N, lap: 0, cps: 0, prog: 0, done: false, finish: 0, finishT: 0,
        remote: true, net: null, steer: 0, spin: 0, inv: 0, squash: 0, z: 0, vz: 0, boost: 0, extra: 0, item: null, itemN: 0, itemT: 0, skill: VMAX, lane: 0, laneT: 9, bot: !!p.bot };
      if (p.bot && host) Object.assign(r, { remote: false, lane: g.o, laneT: 1 + Math.random() * 2, skill: 235 + n * 1.2 + Math.random() * 4, lastPad: null, kingWas: 0 });   // 🤖 the host drives the bots
      return r;
    });
    DROPS = []; SHOTS = []; ARMS = []; BOMBS = []; BOOMS = []; BSHELLS = []; HORNS = []; BOXES.forEach(b => b.t = 0); return;
  }
  const pool = [...(typeof D !== "undefined" ? [...D.founders, ...D.members] : [])].map(p => p.name).filter((n, i, a) => n && /^[A-Za-z0-9]{2,13}$/.test(n) && n !== me && a.indexOf(n) === i);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const names = keep || pool.slice(0, 7); while (names.length < 7) names.push(["Orange Mushroom", "Blue Snail", "Slime", "Pig", "Stump", "Green Mushroom", "Ribbon Pig"][names.length]);
  const slots = [0, 1, 2, 3, 5, 6, 7];   // you start 5th on the grid
  RIV = names.map((name, n) => {   // (their skills are close together, so the pack stays bunched)
    const g = gridSpot(slots[n]), [x, y] = at(g.i, g.o), img = new Image(); img.src = spriteOf(name);
    return { name, img, color: RIVAL_COLORS[n], x, y, finishT: 0, a: tangent((g.i + N) % N), v: 0, idx: (g.i + N) % N, lap: 0, cps: 0, prog: 0, done: false, finish: 0,
      lane: g.o, laneT: 1 + Math.random() * 2, skill: 236 + n * 1.2 + Math.random() * 4, steer: 0, spin: 0, inv: 0, squash: 0, z: 0, vz: 0, boost: 0,
      item: null, itemN: 0, itemT: 0, lastPad: null, kingWas: 0 };
  });
  DROPS = []; SHOTS = []; ARMS = []; BOMBS = []; BOOMS = []; BSHELLS = []; HORNS = []; BOXES.forEach(b => b.t = 0);
}
let bloopCD = 0, armCD = 0, thunderCD = 0, thunderFx = 0;   // Zakum's Arm: at most one every 20 seconds   // Dizzy/Splat: only one in the whole race every 14 seconds, so they stay special
// items depend on how far behind the leader you are, like Mario Kart 8: the distance picks one of the tables above (MK8 measures it in
// its own units, about 2400 a second at top speed, so here it's seconds behind x 2400). Thunder, Splat and the Blue Snail Shell are
// locked for the first 30 seconds and have a cooldown; only one Blue Snail Shell flies at a time.
function rollItem(r, rival) {
  const live = racers().filter(o => !o.done), lead = (live.length ? live : racers()).reduce((a, b) => progOf(b) > progOf(a) ? b : a);
  const mk = Math.max(0, progOf(lead) - progOf(r)) * SPC / (VMAX * SPD) * 2400, T = rival ? MK_B : MK_P, row = (T.find(t => mk < t[0]) || T[T.length - 1])[1];
  const early = K.t < 30000, cap = { splat: bloopCD > 0 || early ? 0 : rival ? .25 : 1, thunder: thunderCD > 0 || early ? 0 : rival ? .3 : 1, bshell: armCD > 0 || early || BSHELLS.length ? 0 : 1 };
  const t = MK.map((k, i) => [k, row[i] * (cap[k] != null ? cap[k] : 1)]);
  const ri = T.findIndex(x => x[1] === row); if (ri >= 1 && ri <= 3) t.push(["boo", 8]);   // 👻 Deluxe's Boo
  const w = t.filter(x => x[1] > 0); let x = Math.random() * w.reduce((a, c) => a + c[1], 0);
  for (const [k, v] of w) { if ((x -= v) < 0) return k; }
  return "elixir";
}
// a new item in the slot: how many uses it has, and Gachapon's eight
function setItem(r, it) { r.item = it; r.itemN = ITEM_N[it] || 0; r.eight = it === "eight" ? [...EIGHT] : null; }
const HOLDABLE = it => it === "slime" || it === "arrow" || it === "gshell" || it === "rshell" || it === "slime3" || it === "gshell3" || it === "rshell3";   // held behind you, they block a shot
const STRONG = r => r.hyper > 0 || r.rocket > 0;   // nothing hurts you, and you knock others over
// boosts (like SRB2Kart / SuperTuxKart): the speed jumps up at once, the strongest active boost wins, and when it ends the extra
// speed fades out over ~0.8 s instead of stopping dead. Also a camera kick for you.
function giveBoost(r, dur, pow) {
  r.boostPow = r.boost > 0 ? Math.max(r.boostPow || 0, pow) : pow;
  r.boost = Math.max(r.boost || 0, dur); r.extra = Math.max(r.extra || 0, r.boostPow);
  r.v = Math.max(r.v, (r === K ? VMAX : r.skill * DIFF().skill) + pow * .6);
  if (r === K) { K.kick = Math.max(K.kick || 0, Math.min(1, pow / 110)); burstSound(pow); buzz(20); }
}
function boostTick(r, dt) {
  if (r.boost > 0) r.extra = Math.max(r.extra || 0, r.boostPow || 0);
  else { r.extra = (r.extra || 0) * Math.pow(.94, dt * 60); if (r.extra < 2) r.extra = 0; r.boostPow = 0; }
}
function hit(r, msg) {
  if (r.remote) return;   // another player's own game decides their hits
  if (r.hyper > 0 || r.rocket > 0 || r.boo > 0) return;   // 💪 Hyper Body, 🚀 Rocket Booster, 👻 Jr. Wraith: nothing can hurt you
  if (r === K) { spinOut(msg); return; }
  if (r.spin <= 0 && r.inv <= 0 && r.z <= 0) { r.spin = .9; r.inv = 1.6; r.boost = 0; r.extra = 0; if (r.holding) { r.item = null; r.holding = false; } }
}
function useItem(r) {
  const it = r.item; if (!it) return;
  r.holding = false;
  if (it === "eight") { if (!r.eight || !r.eight.length) r.eight = [...EIGHT]; const one = r.eight.shift(); r.itemN = r.eight.length; if (!r.eight.length) r.item = null; fireItem(r, one); if (r === K) flash(`🎰 ${ITEM_NAME[one]}!`, 600); return; }
  if (it === "golden") { if (!(r.goldT > 0)) r.goldT = 7.5; giveBoost(r, 1, 125); if (r === K) itemSound(); return; }   // 🧪 boost as often as you like for 7.5 s
  if (it === "fire") { if (!(r.fireT > 0)) r.fireT = 8; if (!(r.fireCD > 0)) { r.fireCD = .3; fireItem(r, "fireball"); } return; }   // 🔥 throw for 8 s
  if (it === "piranha") { if (!(r.piranha > 0)) { r.piranha = 8; r.pirCD = .6; if (r === K) { flash("🌱 Nependeath bites for you!", 900); itemSound(); } } else lunge(r); return; }
  if (ITEM_N[it]) { if (--r.itemN <= 0) r.item = null; fireItem(r, ITEM_ONE[it] || it); return; }
  r.item = null; fireItem(r, it);
}
function fireItem(r, it) {
  if (it === "elixir" || it === "triple") giveBoost(r, it === "triple" ? 1.2 : 1.5, 120);
  if (it === "hyper") { r.hyper = 7; r.spin = 0; r.small = 0; r.ink = 0; if (r === K) { flash("💪 HYPER BODY!", 1000); hyperSound(); } }
  if (it === "slime") { const d = { x: r.x - Math.cos(r.a) * 24, y: r.y - Math.sin(r.a) * 24, t: 40, by: r, grace: .5, id: itemId(r), own: true }; DROPS.push(d); mpItem(r, { k: "drop", x: d.x, y: d.y, id: d.id }); }
  if (it === "gshell" || it === "fireball") {   // 🐌 a Green Snail Shell (or a Hwabi fire star): straight ahead, bouncing off the walls
    const f = it === "fireball", sh = { x: r.x + Math.cos(r.a) * 18, y: r.y + Math.sin(r.a) * 18, a: r.a + (f ? (Math.random() - .5) * .12 : 0), v: f ? Math.max(330, r.v + 90) : Math.max(360, r.v + 120), tgt: null, by: r, life: f ? 1.8 : 7, k: f ? "f" : "g", bn: f ? 1 : 5, idx: r.idx, grace: .5, id: itemId(r), own: true };
    SHOTS.push(sh); mpItem(r, { k: "shot", sk: sh.k, x: sh.x, y: sh.y, a: sh.a, v: sh.v, id: sh.id, i: r.idx });
  }
  if (it === "boom") {   // 🌀 the Ilbi Throwing-Star flies out and comes back, cutting through everyone on the way
    const sh = { x: r.x + Math.cos(r.a) * 18, y: r.y + Math.sin(r.a) * 18, a: r.a, v: Math.max(380, r.v + 140), tgt: null, by: r, life: 2.2, k: "b", out: .6, idx: r.idx, id: itemId(r), own: true };
    SHOTS.push(sh); mpItem(r, { k: "shot", sk: "b", x: sh.x, y: sh.y, a: sh.a, v: sh.v, id: sh.id, i: r.idx });
  }
  if (it === "bshell") {   // 💙 the Blue Snail Shell flies up the track to whoever's 1st and blows up on them
    const leader = racers().filter(o => !o.done).sort((a, b) => progOf(b) - progOf(a))[0];
    if (leader) { const b = { by: r, tgt: leader, p: progOf(r), t: 0, id: itemId(r), own: true }; BSHELLS.push(b); armCD = 20; mpItem(r, { k: "bshell", tgt: nameOf(leader), id: b.id }); if (r === K) flash(leader === K ? "💙 Blue Snail Shell… it's coming for YOU!" : `💙 Blue Snail Shell → ${leader.name}!`, 1000); }
  }
  if (it === "rocket") { r.rocket = 5; r.spin = 0; r.small = 0; r.ink = 0; giveBoost(r, .5, 170); if (r === K) { flash("🚀 ROCKET BOOSTER!", 1000); hyperSound(); } }   // 🚀 Bullet Bill: drives itself, fast, and knocks everyone over
  if (it === "horn") horn(r);
  if (it === "coin") { if (r === K) { const add = Math.min(2, 10 - K.mesos); K.mesos += add; K.mesoTotal = (K.mesoTotal || 0) + 2; flash("💰 +2 mesos", 700); } giveBoost(r, .4, 60); }
  if (it === "boo") boo(r);
  if (it === "arrow" || it === "rshell") {   // 🔴 a Red Snail Shell homes in on the racer just ahead
    const p = progOf(r), ahead = racers().filter(o => o !== r && progOf(o) > p && progOf(o) - p < N * .5).sort((a, b) => progOf(a) - progOf(b))[0];
    const sh = { x: r.x + Math.cos(r.a) * 16, y: r.y + Math.sin(r.a) * 16, a: r.a, v: Math.max(370, r.v + 130), tgt: ahead || null, by: r, life: 4, k: it === "arrow" ? "a" : "r", id: itemId(r), own: true }; SHOTS.push(sh);
    mpItem(r, { k: "shot", sk: sh.k, x: sh.x, y: sh.y, a: sh.a, v: sh.v, tgt: ahead ? nameOf(ahead) : null, id: sh.id });
  }
  if (it === "bomb") {   // 💣 lobbed forward in an arc; explodes where it lands (or on whoever it hits on the way)
    const b = { x: r.x + Math.cos(r.a) * 18, y: r.y + Math.sin(r.a) * 18, z: 12, a: r.a, v: Math.max(250, Math.abs(r.v) + 120), vz: 230, by: r, t: 0, id: itemId(r), own: true }; BOMBS.push(b);
    mpItem(r, { k: "bomb", x: Math.round(b.x), y: Math.round(b.y), a: +b.a.toFixed(3), v: Math.round(b.v), id: b.id });
    if (r === K) flash("💣 Bombs away!", 700);
  }
  if (it === "splat") {   // like the Blooper: inks everyone ahead of whoever uses it
    bloopCD = 14; mpItem(r, { k: "splat", p: progOf(r) });
    const p = progOf(r), from = r === K ? "" : ` from ${r.name}`;
    const hitList = racers().filter(o => o !== r && !o.done && progOf(o) > p && !(o.rescue > 0) && !(o.bloopSafe > 0) && !(o.ink > 0) && !(o.hyper > 0) && !(o.rocket > 0) && !(o.boo > 0));
    for (const o of hitList) {
      o.ink = 4; o.bloopSafe = 12;   // 4s of ink + 8s safe afterwards
      if (o === K) { makeInk(); flash(`🐙 Splat${from}!`, 1000); splatSound(); }
    }
    if (r === K) flash(hitList.length ? `🐙 Inked ${hitList.length} racer${hitList.length > 1 ? "s" : ""} ahead!` : "Nobody ahead of you!", 1000);
  }
  if (it === "thunder") {   // ⚡ like Mario Kart's Lightning: strikes every other racer; they spin, shrink and drop what they hold. Nothing blocks it.
    thunderCD = 25; thunderFx = .35; thunderSound(); mpItem(r, { k: "thunder" });
    const from = r === K ? "" : ` from ${r.name}`;
    for (const o of racers()) {
      if (o === r || o.done || o.rescue > 0 || o.hyper > 0 || o.rocket > 0 || o.boo > 0) continue;
      if (o.holding || HOLDABLE(o.item)) { o.item = null; o.holding = false; }
      o.small = 3.2; o.inv = 0; o.z = 0; o.vz = 0;
      if (o === K) { spinOut(`⚡ Thunder${from}!`); K.shake = .3; } else hit(o);
    }
    if (r === K) flash("⚡ Thunder! Everyone else shrinks!", 1100);
  }
  if (it === "arm") {
    const leader = racers().filter(o => o !== r && !o.done).sort((a, b) => progOf(b) - progOf(a))[0];
    if (leader) { ARMS.push({ tgt: leader, t: 2.6, by: r }); armCD = 20; mpItem(r, { k: "arm", tgt: nameOf(leader) }); }
  }
  if (r === K) itemSound();
}
// 🌱 Nependeath (the Piranha Plant): bites whoever's close in front every so often (and eats slime drops and shells), each bite a little lunge
function lunge(r) { if (r.pirCD > .3) return; chomp(r, true); }
function chomp(r, forced) {
  r.pirCD = forced ? .8 : 1.3;
  const fx = Math.cos(r.a), fy = Math.sin(r.a);
  const v = racers().filter(o => o !== r && !o.done && !(o.rescue > 0) && Math.abs((o.z || 0) - (r.z || 0)) < 20 && Math.hypot(o.x - r.x, o.y - r.y) < 70 && (o.x - r.x) * fx + (o.y - r.y) * fy > -8)
    .sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y))[0];
  for (const L of [DROPS, SHOTS]) for (let i = L.length - 1; i >= 0; i--) if (L[i].by !== r && Math.hypot(L[i].x - r.x, L[i].y - r.y) < 55) L.splice(i, 1);
  if (v) { hitBy(v, `🌱 Chomped by ${nameOf(r) || "Nependeath"}!`, { id: itemId(r), own: true }, "pir"); if (r === K && v !== K) flash(`🌱 Chomp! ${v.name}`, 700); }
  if (v || forced) { giveBoost(r, .5, 95); r.bite = .25; if (r === K) tone(180, .12, "square", .06, 90); }
}
// 📣 Megaphone (the Super Horn): a shout that spins out everyone close and wipes away slime drops, shells and bombs, even a Blue Snail Shell about to land on you
const HORN_R = 110;
function horn(r) { const id = itemId(r); HORNS.push({ x: r.x, y: r.y, t: 0 }); mpItem(r, { k: "horn", x: Math.round(r.x), y: Math.round(r.y), id }); hornAt(r.x, r.y, r, id, true); if (r === K) { flash("📣 MEGAPHONE!", 800); tone(330, .35, "sawtooth", .08, 520); } }
function hornAt(x, y, by, id, own) {
  for (const o of racers()) if (o !== by && !o.done && !(o.rescue > 0) && Math.hypot(o.x - x, o.y - y) < HORN_R && (own || o === K)) hitBy(o, `📣 Megaphone blast from ${nameOf(by) || "someone"}!`, { id, own }, "horn");
  for (const L of [DROPS, SHOTS, BOMBS]) for (let i = L.length - 1; i >= 0; i--) if (L[i].by !== by && Math.hypot(L[i].x - x, L[i].y - y) < HORN_R) L.splice(i, 1);
  for (let i = BSHELLS.length - 1; i >= 0; i--) { const b = BSHELLS[i]; if (b.tgt === by && b.x != null && Math.hypot(b.x - x, b.y - y) < 260) { BSHELLS.splice(i, 1); if (by === K) flash("📣 Blasted the Blue Snail Shell away!", 1100); } }
}
// 👻 Jr. Wraith (the Boo): you turn see-through for a few seconds (nothing can hit you) and it steals someone's item for you
function boo(r) {
  r.boo = 5; if (r === K) { flash("👻 Jr. Wraith! You're invisible", 1000); tone(520, .4, "sine", .06, 260); }
  const local = racers().filter(o => o !== r && !o.done && !o.remote && o.item && o.item !== "boo");
  const v = local.length ? local[Math.floor(Math.random() * local.length)] : null;
  if (v) { booGive(r, v.item, v.itemN, v.eight); if (v === K) flash(`👻 ${nameOf(r)} stole your ${ITEM_NAME[v.item]}!`, 1100); else if (r === K) flash(`👻 Stole ${v.name}'s ${ITEM_NAME[v.item]}!`, 1100); v.item = null; v.itemN = 0; v.holding = false; return; }
  const far = RIV.filter(o => o.remote && !o.bot && !o.done); if (far.length && mpOn()) mpItem(r, { k: "boo", tgt: far[Math.floor(Math.random() * far.length)].name, id: itemId(r) });   // another player: their game hands it over
}
function booGive(r, it, n, eight) {
  if (!it || !ITEM_NAME[it]) return;
  if (r === K) { if (!K.item && !(K.roll > 0)) { setItem(K, it); if (n) K.itemN = n; if (eight) K.eight = [...eight]; } else if (!K.item2) K.item2 = it; return; }
  if (!r.item) { setItem(r, it); if (n) r.itemN = n; if (eight) r.eight = [...eight]; r.itemT = 1 + Math.random() * 2; r.holding = HOLDABLE(it); }
}
// the items that last a while: Power Elixir, fire stars, Nependeath (they leave the slot when time's up), the Rocket Booster and Jr. Wraith
function timedTick(r, dt) {
  for (const [key, it] of [["goldT", "golden"], ["fireT", "fire"], ["piranha", "piranha"]]) if (r[key] > 0) { r[key] -= dt; if (r[key] <= 0) { r[key] = 0; if (r.item === it) { r.item = null; r.itemN = 0; } } }
  for (const key of ["fireCD", "pirCD", "bite", "boo"]) if (r[key] > 0) r[key] -= dt;
  if (r.rocket > 0) { r.rocket -= dt; r.spin = 0; giveBoost(r, .25, 170); }
  if (r.piranha > 0 && !(r.pirCD > 0) && state === "race") chomp(r, false);
}
// 💥 a Pirate Bomb goes off: everyone in the blast spins out and is thrown into the air (the closer, the higher); the screen shakes with distance
function explode(b, all) {
  BOOMS.push({ x: b.x, y: b.y, t: 0, debris: Array.from({ length: 14 }, () => ({ a: Math.random() * 6.28, v: 60 + Math.random() * 90, vz: 120 + Math.random() * 160, s: 2 + Math.random() * 3, c: ["#3a3236", "#6b4426", "#8a8d96", "#ffb02e"][Math.floor(Math.random() * 4)] })) });
  const dK = Math.hypot(K.x - b.x, K.y - b.y);
  boomSound(dK); if (dK < 520) K.shake = Math.max(K.shake, .55 * (1 - dK / 520));
  for (const r of all) {
    const d = Math.hypot(r.x - b.x, r.y - b.y); if (d > BOMB_R || r.z > 60 || r.done || r.rescue > 0) continue;
    const was = r.spin; hitBy(r, b.by === K ? "💣 Your own bomb!" : `💣 Boom from ${nameOf(b.by) || "someone"}!`, b, "bomb");
    if (r.spin > 0 && !(was > 0) && !r.remote) { r.vz = 150 + 160 * (1 - d / BOMB_R); r.z = .1; r.v *= .3; }
    if (r !== K && b.by === K && (r.remote || (r.spin > 0 && !(was > 0)))) flash(`💣 Blew up ${r.name}!`, 900);
  }
  if (dK < 140) K.hitFlash = Math.max(K.hitFlash || 0, .12 * (1 - dK / 140));
  if (b.by !== K && dK > BOMB_R && dK < BOMB_R * 1.5) closeCall();   // just outside the blast
}
// ================================================================ map hazards
// ❄️ El Nath: frost turrets beside the road fire an ice arrow straight across it every few seconds (a glint warns first); a hit freezes you for a moment.
// 🧸 Clocktower Night: Papulatus floats over the track, charges up and shocks everyone on the ground (be in the air to dodge it).
// 🔥 Zakum: boulders roll down the climb at you, and the road has no safe edge: drive off it and you fall into the lava.
const HAZ = { lanes: [], ice: [], rocks: [], rockT: 3, pap: null };
function setupHazards() {
  HAZ.lanes = []; HAZ.ice = []; HAZ.rocks = []; HAZ.rockT = 4; HAZ.pap = null;
  return;   // (the frost turrets, boulders and Papulatus are switched off: each new track brings its own course features instead)
  const F = f => OPEN ? Math.round(START_I + (N - FIN_OFF - START_I) * f) : Math.round(N * f) % N;
  if (T.cup === "elnath") [.24, .52, .79].forEach((f, n) => HAZ.lanes.push({ i: F(f), side: n % 2 ? 1 : -1, period: 5.5 + n * .4, phase: n * 1.9, shot: -1, warn: 0 }));
  if (T.cup === "elnath" && AN && HEAVY_CUTS.includes(TRACK_KEY)) HAZ.lanes.push({ alt: true, j: Math.round(AN * .5), side: 1, period: 4, phase: .7, shot: -1, warn: 0 });   // one guards the short cut
  if (TRACK_KEY === "ld3") HAZ.pap = { charge: 0, fx: 0, last: -1 };
}
const lanePos = (L, side) => L.alt ? altAt(L.j, side * (ALT_ROAD / 2 + CURB + 24)) : at(L.i, side * (ROAD / 2 + CURB + 34));   // a frost turret beside the road (or the short cut)
function freeze(r) {
  if (r.frozen > 0 || r.hyper > 0 || r.z > 20 || r.rescue > 0 || r.done) return;
  r.frozen = 1.1; r.v *= .45; r.drift = 0; r.charge = 0;
  if (r === K) { flash("🧊 Frozen!", 900); iceSound(); K.shake = Math.max(K.shake, .15); }
}
function hazardStep(dt, all) {
  const t = K.t / 1000;
  for (const r of all) if (r.frozen > 0) { r.frozen -= dt; if (r !== K) r.v = Math.min(r.v, 90); }
  // ❄️ ice arrows
  for (const L of HAZ.lanes) {
    const cyc = Math.floor((t + L.phase) / L.period), ph = (t + L.phase) % L.period;
    L.warn = t > 4 && ph > L.period - .8 ? 1 - (L.period - ph) / .8 : 0;
    if (t > 4 && cyc !== L.shot && L.shot !== -1) {
      const [x0, y0] = lanePos(L, L.side), [x1, y1] = lanePos(L, -L.side), d = Math.hypot(x1 - x0, y1 - y0);
      HAZ.ice.push({ x: x0, y: y0, a: Math.atan2(y1 - y0, x1 - x0), v: 430, life: d / 430 }); if (Math.hypot(K.x - x0, K.y - y0) < 500) tone(2400, .12, "triangle", .04, 1200);
    }
    L.shot = cyc;
  }
  for (let i = HAZ.ice.length - 1; i >= 0; i--) {
    const a = HAZ.ice[i]; a.life -= dt; a.x += Math.cos(a.a) * a.v * dt; a.y += Math.sin(a.a) * a.v * dt;
    let gone = a.life <= 0;
    for (const r of all) if (!gone && r.z < 22 && Math.hypot(r.x - a.x, r.y - a.y) < 15) { freeze(r); gone = true; }
    if (!gone && K.z < 22) nearMiss(a, Math.hypot(K.x - a.x, K.y - a.y), 34);
    if (gone) HAZ.ice.splice(i, 1);
  }
  // 🧸 Papulatus: every 24 s from 18 s in; 3.2 s of charging (the warning), then the shock
  if (HAZ.pap) {
    const P = HAZ.pap, c = t - 18, n = c >= 0 ? Math.floor(c / 24) : -1, ph = c >= 0 ? c % 24 : -1;
    P.charge = ph > 24 - 3.2 ? 1 - (24 - ph) / 3.2 : 0; if (P.fx > 0) P.fx -= dt;
    if (n > P.last && n >= 1) { P.fx = .7; papSound();
      for (const r of all) { if (r.z > 8 || r.hyper > 0 || r.rescue > 0 || r.done) continue; if (r === K) { spinOut("⚡ Shocked by Papulatus!"); K.shake = Math.max(K.shake, .3); } else hit(r); } }
    if (n > P.last) P.last = n;
  }
  // 🪨 Zakum boulders roll down the climb towards you
  if (MECH === "lava") {
    if ((HAZ.rockT -= dt) <= 0 && t > 5) { HAZ.rockT = 2.4 + Math.random() * 1.6;
      const i0 = Math.min(N - FIN_OFF - 2, K.idx + Math.round(420 / SPC)); if (i0 > K.idx + 20) HAZ.rocks.push({ i: i0, o: (Math.random() - .5) * ROAD * .8, v: 150 + Math.random() * 70, R: 13 + Math.random() * 5, roll: 0, x: 0, y: 0 }); }
    for (let j = HAZ.rocks.length - 1; j >= 0; j--) {
      const b = HAZ.rocks[j]; b.i -= b.v / SPC * dt; b.roll += b.v / b.R * dt;
      const i0 = Math.floor(b.i), f = b.i - i0, p = at(i0, b.o), q = at(i0 + 1, b.o); b.x = p[0] + (q[0] - p[0]) * f; b.y = p[1] + (q[1] - p[1]) * f;
      let gone = b.i < START_I || b.i < K.idx - 80 || (LAVA && b.i < LAVA.i);
      if (!gone) nearMiss(b, Math.hypot(K.x - b.x, K.y - b.y), b.R + 30);
      for (const r of all) if (!gone && r.z < 20 && Math.hypot(r.x - b.x, r.y - b.y) < b.R + 8) { const was = r.spin; hit(r, "🪨 Boulder!"); if (r === K && !(was > 0) && K.spin > 0) { K.v *= .3; K.shake = Math.max(K.shake, .25); bumpSound(); } gone = true; }
      if (gone) HAZ.rocks.splice(j, 1);
    }
    for (const r of all) if (!r.remote && r !== K && !r.done && !(r.rescue > 0) && r.z <= 0 && !r.onAlt && nearest(r.x, r.y, r.idx).d > ROAD / 2 + CURB + 10) rescue(r);   // rivals fall in too
  }
}
const iceSound = () => { tone(1900, .16, "triangle", .07, 900); noiseHit(5200, .3, .05, 4); };
const papSound = () => { thunderSound(); tone(90, .5, "sawtooth", .08, 40); for (let i = 0; i < 5; i++) setTimeout(() => noiseHit(3000 + Math.random() * 2000, .08, .06, 6), i * 70); };
// one computer racer: follows the road in its own lane, dodges slime puddles, keeps races close (rubber band), uses items
function rivalStep(r, dt, tt) {
  if (r.remote) { remoteStep(r, dt); return; }
  if (rescueStep(r, dt)) return;
  const near = nav(r.x, r.y, r.idx); r.idx = near.i; r.onAlt = near.alt; r.altJ = near.j; const off = near.d > near.half + CURB * .6, ground = under(near, r.x, r.y), L = ground.L;
  if (r.idx > FORK_A - 45 && r.idx < FORK_A - 5 && r.forkLap !== r.lap) { r.forkLap = r.lap; r.useAlt = Math.random() < .4; }   // pick a road at the fork
  if (r.z > 0 || r.vz > 0) { r.vz -= (r.glide ? 150 : 720) * dt; if (r.glide) { r.vz = Math.max(r.vz, -95); r.v = Math.max(r.v, 245); } r.z += r.vz * dt; if (r.glide && r.z < 14 && gapAt(r.idx)) r.z = 14; if (r.z <= 0) { r.z = 0; r.vz = 0; r.glide = 0; if (!(r.spin > 0) && Math.random() < .5) giveBoost(r, .8, 90); } }
  const air = r.z > 0;
  for (const key of ["spin", "inv", "squash", "boost", "itemT", "small", "ink", "bloopSafe", "noItem", "hyper"]) if (r[key] > 0) r[key] -= dt;
  timedTick(r, dt);
  const lost = (near.d > near.half + 110 && !onRink(r.x, r.y)) || (r.v < 20 && r.spin <= 0 && r.squash <= 0);
  r.lostT = lost ? (r.lostT || 0) + dt : 0; if (r.lostT > 2.5) { rescue(r); return; }
  if ((r.laneT -= dt) <= 0) { r.lane = (Math.random() - .5) * 100; r.laneT = 1.5 + Math.random() * 3; }
  if (!r.item && !(r.noItem > 0) && mode !== "tt") for (const b of BOXES) if (b.i != null && !(b.z > 0) && b.t <= 0) { const di = OPEN ? b.i - r.idx : (b.i - r.idx + N) % N; if (di > 4 && di < 45) { r.lane = b.o; break; } }   // 🎁 no item: head for a box (dodging below still wins)
  if (LEDGES.length && LEDGES.some(l => { const j = OPEN ? r.idx + 30 : (r.idx + 30) % N; return (r.idx >= l.a && r.idx <= l.b) || (j >= l.a && j <= l.b); })) r.lane = Math.max(-ROAD / 2 + 42, Math.min(ROAD / 2 - 42, r.lane));   // no railing here: stay off the edge (holes and hedges below still win)
  for (const p of PADS) if (p.t === "slime") { const di = (p.i - r.idx + N) % N; if (di < 45 && Math.abs(r.lane - p.o) < 34) r.lane = p.o > 0 ? p.o - 48 : p.o + 48; }
  for (const d of DROPS) { const dd = Math.hypot(d.x - r.x, d.y - r.y); if (dd < 90 && dd > 20 && Math.random() < .5) { const dl = lat(d.x, d.y, r.idx); if (Math.abs(dl - r.lane) < 26) r.lane = dl > 0 ? dl - 40 : dl + 40; } }
  for (const b of HEDGES) if (b.i != null) { const di = (b.i - r.idx + N) % N; if (di > 0 && di < 32 && Math.abs(r.lane - b.o) < b.w / 2 + 24) r.lane = b.o > 0 ? b.o - b.w / 2 - 40 : b.o < 0 ? b.o + b.w / 2 + 40 : (r.lane >= 0 ? b.w / 2 + 40 : -b.w / 2 - 40); }   // 🌿 round the hedges
  for (const t of THWOMPS) if (t.i != null) { const di = (t.i - r.idx + N) % N; if (di > 0 && di < 30 && Math.abs(r.lane - (t.o || 0)) < 60) r.lane = (t.o || 0) + (r.lane >= (t.o || 0) ? 1 : -1) * 75; }   // 🗿 the computer racers drive round the Thwomps
  for (const h of HOLES) if (!h.lap || r.lap + 1 >= h.lap) { const di = (h.i - r.idx + N) % N; if (di > 0 && di < 60 && Math.abs(r.lane - (h.o || 0)) < h.r + 22) { const ho = h.o || 0, sd = Math.abs(ho) > 20 ? -Math.sign(ho) : (r.lane >= ho ? 1 : -1); r.lane = ho + sd * (h.r + (Math.abs(ho) > 20 ? 30 : 20)); } }   // 🕳️ and round holes (always round the side that stays on the road)
  r.lane = Math.max(-ROAD / 2 + 14, Math.min(ROAD / 2 - 14, r.lane));
  const onFork = r.useAlt && r.idx >= FORK_A - 4 && r.idx < FORK_B - 6;
  const [tx, ty] = onFork ? altAt((near.alt ? near.j : nearAlt(r.x, r.y).j) + 12, Math.max(-ALT_ROAD / 2 + 12, Math.min(ALT_ROAD / 2 - 12, r.lane * .7))) : at(r.idx + 14, r.lane);
  let d = Math.atan2(ty - r.y, tx - r.x) - r.a; d = Math.atan2(Math.sin(d), Math.cos(d));
  // inked rivals don't swerve (like Mario Kart 8): they're a little slower and slippery, so they turn late
  if (!air && r.v > 150 && Math.abs(d) > .18) r.cornerT = (r.cornerT || 0) + dt;   // 💨 the computer racers drift too: a mini-turbo out of a long corner
  else if (Math.abs(d) < .08) { if (r.cornerT > .6 && !(r.spin > 0) && !r.done && Math.random() < DIFF().drift) { const i2 = OPEN ? Math.min(N - 1, r.idx + 30) : (r.idx + 30) % N; let ta = tangent(i2) - tangent(r.idx); ta = Math.atan2(Math.sin(ta), Math.cos(ta)); if (Math.abs(ta) < .3) giveBoost(r, Math.min(.8, .3 + r.cornerT * .3), 45); } r.cornerT = 0; }   // (only onto a straight, so it can't fling them off the next bend)
  const turn = Math.max(-2.6, Math.min(2.6, d * 4)); r.steer += (Math.sign(turn) * Math.min(1, Math.abs(turn) / 2) - r.steer) * Math.min(1, dt * 8);
  if (r.spin <= 0) r.a += turn * dt * Math.min(1, r.v / 80) * (r.ink > 0 ? .5 : 1);
  // 🧲 keep the race close (like Mario Kart): a computer racer behind every real player speeds up, one ahead of them all eases off
  let gap = 0; { const hp = [K, ...RIV.filter(o => o.remote && !o.bot)].filter(o => !o.done).map(progOf), p = progOf(r);
    if (hp.length) { const lo = Math.min(...hp), hi = Math.max(...hp); gap = p > hi ? (hi - p) / N : p < lo ? (lo - p) / N : 0; } }
  const band = 1 + Math.max(-.1, Math.min(DIFF().band, gap * 1.2));
  boostTick(r, dt);
  const top = r.done ? (OPEN ? 0 : 140) : r.hyper > 0 ? VMAX + 50 : (!air && inPen(r.idx, L) ? 80 : off && !air ? 110 : r.skill * DIFF().skill * band * (r.small > 0 ? .72 : 1) * (r.ink > 0 ? .95 : 1)) + (r.extra || 0);
  if (r.spin > 0) r.v *= Math.pow(.3, dt); else r.v += (r.v < top ? (r.extra > 5 ? 800 : r.v < 120 ? 190 : 110) : -220) * dt;
  const ricy = MECH === "ice" && !air && (ground.pad && ground.pad.t === "ice" || (LAKE && LAKE.kind === "ice" && inLake(r.x, r.y)));
  { const rg = MECH === "ice" ? (ricy ? 3 : 7.5) : 99; let dm = r.a - (r.ma == null ? r.a : r.ma); dm = Math.atan2(Math.sin(dm), Math.cos(dm)); r.ma = rg > 50 ? r.a : (r.ma == null ? r.a : r.ma) + dm * Math.min(1, rg * dt); }
  if (!air && ground.pad && (ground.pad.t === "mud" || ground.pad.t === "grass")) r.v = Math.min(r.v, 150);
  r.x += Math.cos(r.ma) * r.v * dt * SPD; r.y += Math.sin(r.ma) * r.v * dt * SPD;
  const pad = air ? null : ground.pad;
  if (pad && pad !== r.lastPad) {
    if (pad.t === "boost") giveBoost(r, 1, 110);
    if (pad.t === "ramp" && r.v > 60) { r.vz = (160 + r.v * .22) / SPD; r.z = .1; }
    if (pad.t === "bigramp" && r.v > 60) { r.vz = (300 + r.v * .3) / SPD; r.z = .1; }
    if (pad.t === "glide") { r.vz = 240; r.z = .1; r.glide = 1; r.v = Math.max(r.v, 230); }   // 🪁 a glider ramp
    if (pad.t === "hay") { r.vz = 230; r.z = .1; }
    if (pad.t === "shroom" && r.v > 30) { r.vz = (330 + r.v * .25) / SPD; r.z = .1; giveBoost(r, .5, 60); shroomHit(pad); }
    if (pad.t === "slime" || pad.t === "lava") hit(r);
  }
  r.lastPad = pad; gapStep(r, air); moleStep(r, air, tt); petStep(r, air, tt);
  for (const p of PIGS) { if (p.lap && lapNow() < p.lap) continue; const q = pigPos(p, tt); if (!air && q.z < 10 && Math.hypot(r.x - q.x, r.y - q.y) < 17) { if (p.soft) { if (!(r.bonk > 0)) { r.bonk = .8; r.v *= .6; r.vz = 120; r.z = .1; } } else hit(r); } }
  if (r.bonk > 0) r.bonk -= dt;
  if (KING) {
    const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0);
    if (r.kingWas < .55 && kp >= .55 && Math.hypot(r.x - kx, r.y - ky) < (KING.big ? 62 : 36) && !air) { hit(r); r.squash = 1.1; r.v = 0; }
    r.kingWas = kp;
  }
  if (LAKE && lakeFall() && !air && near.d > near.half + 4 && inLake(r.x, r.y)) rescue(r);   // fell off the bridge
  if (T.water && !air && near.d > near.half + CURB + 8) rescue(r);   // 🌊 off the boardwalk
  if (LEDGES.length && !air && !near.alt && near.d > near.half + CURB + 10 && offAlt(r.x, r.y, 10) && LEDGES.some(l => r.idx >= l.a && r.idx <= l.b)) rescue(r);
  // items: Elixirs and the Arm right away, a slime when someone is close behind, an arrow when someone is ahead
  if (r.item && r.itemT <= 0 && r.spin <= 0 && !r.done) {
    const p = progOf(r), others = racers().filter(o => o !== r);
    const behind = others.some(o => p - progOf(o) > 0 && p - progOf(o) < 30), ahead = others.some(o => progOf(o) - p > 0 && progOf(o) - p < 120);
    const it = r.item, near = others.some(o => Math.hypot(o.x - r.x, o.y - r.y) < 85), threat = SHOTS.some(sh => sh.tgt === r) || BSHELLS.some(b => b.tgt === r && b.hover);
    if (["elixir", "triple", "arm", "thunder", "hyper", "golden", "rocket", "bshell", "coin", "boo", "eight", "fire"].includes(it) || (it === "piranha" && !(r.piranha > 0)) || (it === "splat" && (ahead || progOf(K) > p || Math.random() < dt * .1))
      || ((it === "slime" || it === "slime3") && (behind || Math.random() < dt * .15)) || (["arrow", "rshell", "rshell3", "gshell", "gshell3", "boom", "bomb"].includes(it) && (ahead || Math.random() < dt * .1))
      || (it === "horn" && (threat || near || Math.random() < dt * .05))) {
      useItem(r); r.itemT = .6; if (!r.item) r.noItem = 2 + Math.random() * 3; else r.holding = HOLDABLE(r.item);
    }
  }
  lapTick(r);
}
// the race clock: your own time while you race, and it keeps running after you finish (for rivals and bots still out there)
const raceNow = () => K.doneAt ? K.t + (performance.now() - K.doneAt) : K.t;
function lapTick(r) {   // 4 checkpoints in order, then the start line; true when a lap is done
  if (OPEN) {   // one long run: done when you reach the finish line near the end
    if (r.lap === 0 && r.idx >= N - FIN_OFF) { r.lap = 1; if (r !== K && !r.done) { r.done = true; r.finish = ++finishers; r.finishT = raceNow(); } return true; }
    r.prog = r.idx / N; return false;
  }
  const prog = r.idx / N, cp = Math.floor(prog * 4);
  if (cp === (r.cps + 1) % 4 && r.cps < 3) r.cps = cp;
  let done = false;
  if (r.cps === 3 && r.prog > .9 && prog < .1) { r.lap++; r.cps = 0; done = true; if (r !== K && r.lap >= LAPS && !r.done) { r.done = true; r.finish = ++finishers; r.finishT = raceNow(); } }
  r.prog = prog; return done;
}
let finishers = 0;
// everything that moves besides you: rivals, item boxes, slime drops, arrows, Zakum's arm, karts bumping
function lavaStep(dt) {
  const L = LAVA; L.t += dt; if (L.t < 3) return;   // it starts moving 3 seconds after GO
  const lead = Math.max(...racers().filter(r => !r.done).map(r => r.idx), 0);
  // ~150 units/s at first, up to ~245 after 45 s; and faster if you're far ahead, so it never falls too far behind
  L.v = ((150 + Math.min(95, (L.t - 3) * 2.2)) * SPD + Math.max(0, (K.idx - L.i) * SPC - 900) * .35) / SPC;
  L.i = Math.min(N - FIN_OFF - 4, L.i + L.v * dt);
  for (const r of racers()) {
    if (r.done || r.remote || r.rescue > 0 || r.inv > 0 || r.z > 30) continue;
    if (r.idx <= L.i + 1) {
      if (r === K) { const lose = Math.min(3, K.mesos); K.mesos -= lose; K.shake = .35; rescue(K, `🔥 The lava got you!${lose ? ` −${lose} mesos` : ""}`, true); }
      else rescue(r, null, true);
    }
  }
  if (K && !K.done) { const gap = K.idx - L.i; B.musicRate(gap * SPC < 560 ? 1.15 : 1); if (gap * SPC < 360 && performance.now() - (L.rum || 0) > 600) { L.rum = performance.now(); noiseHit(90, .5, .06, 1); } }
}
function areaStep() {   // 🗺️ a new area: its name pops up
  if (!AREAS.length || !K || state !== "race") return; let cur = 0; for (let n = 0; n < AREAS.length; n++) if (K.idx >= AREAS[n].i) cur = n;
  if (areaAt < 0) { areaAt = cur; return; }   // (the grid sits in the last area: no shout at the start)
  if (cur !== areaAt) { pop(AREAS[cur].name, "#ffe9a8", true); areaAt = cur; }
}
function slideStep(tt) {   // 🐧 penguins sliding down the rims of the penguin slide, over and over
  for (const o of OBJS) if (o.slide) { const q = o.slide, f = (tt * q.sp + q.ph) % 1, [x, y] = at(Math.round(q.a + (q.b - q.a) * f), q.o); o.x = x; o.y = y; }
}
function stompStep(tt) {   // 🍄 the last lap: Mushmom leaps and lands every 3.4 s; the canyon shakes and every mushroom wobbles
  const m = OBJS.find(o => o.stomp); if (!m || !K) return;
  if (lapNow() < LAPS || state !== "race") { m.sz = null; return; }
  const ph = (tt % 3.4) / 3.4, was = m.ph0 || 0; m.ph0 = ph; m.sz = ph < .6 ? 260 * Math.sin(Math.PI * ph / .6) : Math.max(0, 12 * Math.sin((ph - .6) * 40) * (1 - (ph - .6) / .4));
  if (was < .6 && ph >= .6) { const d = Math.hypot(K.x - m.x, K.y - m.y);
    if (d < 2600) { K.shake = Math.max(K.shake, .55 * (1 - d / 2600)); boomSound(d * .4); buzz(60); if (d < 1800 && performance.now() - (m.popT || 0) > 6000) { m.popT = performance.now(); pop("💥 Mushmom STOMP!", "#ff9a3a", true); } }
    for (const g of GAPS) for (const c of g.caps) c.squash = Math.max(c.squash || 0, .7); }
}
function worldStep(dt, tt) {
  areaStep(); stompStep(tt); slideStep(tt);
  if (thunderFx > 0) thunderFx -= dt;
  if (LAVA && state === "race") lavaStep(dt);
  if (bloopCD > 0) bloopCD -= dt; if (armCD > 0) armCD -= dt; if (thunderCD > 0) thunderCD -= dt;
  for (const r of RIV) rivalStep(r, dt, tt);
  const all = racers();
  for (const b of BOXES) {
    if (mode === "tt") break;
    if (b.t > 0) { b.t -= dt; continue; }
    for (const r of all) if (Math.abs(r.z - (b.z || 0)) < 22 && !r.done && Math.hypot(r.x - b.x, r.y - b.y) < 15) {
      b.t = 2.5;
      if (r === K) {
        K.boxBurst = true;   // ✨ sparkles out of the box
        if (!K.item && K.roll <= 0) { K.roll = 1.1; K.pending = rollItem(K); boxSound(); }
        else if (!K.item2 && !(K.roll2 > 0)) { K.roll2 = 1.1; K.pending2 = rollItem(K); boxSound(); }   // a second item waits in the small slot
      }
      else if (!r.remote && !r.item && !(r.noItem > 0) && Math.random() < DIFF().pick) { setItem(r, rollItem(r, true)); r.itemT = 1.5 + Math.random() * 3; r.holding = HOLDABLE(r.item); }
      break;
    }
  }
  for (let i = DROPS.length - 1; i >= 0; i--) {
    const d = DROPS[i]; d.t -= dt; if (d.grace > 0) d.grace -= dt;
    let gone = d.t <= 0;
    for (const r of all) if (!gone && r.z <= 0 && Math.hypot(r.x - d.x, r.y - d.y) < 15 && !(r === d.by && d.grace > 0)) { hitBy(r, "🫧 Slimed!", d, "drop"); gone = true; }
    if (gone) DROPS.splice(i, 1);
  }
  for (let i = SHOTS.length - 1; i >= 0; i--) {
    const sh = SHOTS[i]; sh.life -= dt; if (sh.grace > 0) sh.grace -= dt;
    if (sh.k === "b") { sh.out -= dt; if (sh.out <= 0 && sh.by) { let d = Math.atan2(sh.by.y - sh.y, sh.by.x - sh.x) - sh.a; d = Math.atan2(Math.sin(d), Math.cos(d)); sh.a += Math.max(-9, Math.min(9, d * 12)) * dt; } }   // 🌀 on its way back
    else if (sh.tgt) { let d = Math.atan2(sh.tgt.y - sh.y, sh.tgt.x - sh.x) - sh.a; d = Math.atan2(Math.sin(d), Math.cos(d)); sh.a += Math.max(-7, Math.min(7, d * 9)) * dt; }
    sh.x += Math.cos(sh.a) * sh.v * dt * SPD; sh.y += Math.sin(sh.a) * sh.v * dt * SPD;
    let gone = sh.life <= 0 || (sh.k === "b" && sh.out < -.1 && sh.by && Math.hypot(sh.by.x - sh.x, sh.by.y - sh.y) < 22);
    if (!gone && (sh.k === "g" || sh.k === "f")) {   // bounce off the edge of the road
      const nv = nav(sh.x, sh.y, sh.idx != null ? sh.idx : nearest(sh.x, sh.y).i); sh.idx = nv.i;
      if (!nv.alt) { const L = lat(sh.x, sh.y, nv.i), lim = ROAD / 2 + CURB * .5;
        if (Math.abs(L) > lim) { const ta = tangent(nv.i), nx = -Math.sin(ta), ny = Math.cos(ta), sg = Math.sign(L); sh.a = 2 * ta - sh.a; sh.x -= nx * sg * (Math.abs(L) - lim + 2); sh.y -= ny * sg * (Math.abs(L) - lim + 2); if (--sh.bn < 0) gone = true; } }
    }
    for (const r of all) if (!gone && r !== sh.by && Math.hypot(r.x - sh.x, r.y - sh.y) < 16 && r.holding && HOLDABLE(r.item)
      && (sh.x - r.x) * Math.cos(r.a) + (sh.y - r.y) * Math.sin(r.a) < 0) {   // blocked by the item held behind
      if (ITEM_N[r.item] && --r.itemN > 0) {} else { r.item = null; r.holding = false; } gone = true; blockSound();
      if (r === K) flash("🛡️ Blocked!", 800); else if (sh.by === K) flash(`🛡️ ${r.name} blocked it`, 900);
    }
    if (!gone && sh.by !== K) nearMiss(sh, Math.hypot(K.x - sh.x, K.y - sh.y), 34);
    const what = { g: "🐌 Green Snail Shell", r: "🔴 Red Snail Shell", f: "🔥 Fire star", b: "🌀 Ilbi star" }[sh.k] || "🏹 Arrow";
    for (const r of all) if (!gone && (r !== sh.by || (sh.k === "g" && !(sh.grace > 0))) && Math.abs((r.z || 0)) < 24 && Math.hypot(r.x - sh.x, r.y - sh.y) < 16 && !(sh.k === "b" && r.spin > 0)) {
      hitBy(r, r === sh.by ? `${what}: your own!` : `${what} from ${nameOf(sh.by) || "someone"}!`, sh, "shot"); if (sh.k !== "b") gone = true; if (r !== K && sh.by === K) flash(`${what.split(" ")[0]} Got ${r.name}!`, 900); }
    if (gone) SHOTS.splice(i, 1);
  }
  if (state === "race") hazardStep(dt, all);
  for (let i = BOMBS.length - 1; i >= 0; i--) {
    const b = BOMBS[i]; b.t += dt; b.vz -= 560 * dt; b.z += b.vz * dt; b.x += Math.cos(b.a) * b.v * dt * SPD; b.y += Math.sin(b.a) * b.v * dt * SPD;
    let boom = b.z <= 0;
    if (!boom) for (const r of all) if (!(r === b.by && b.t < .35) && Math.abs(r.z - b.z) < 26 && Math.hypot(r.x - b.x, r.y - b.y) < 17) { boom = true; break; }   // a direct hit
    if (boom) { BOMBS.splice(i, 1); explode(b, all); }
  }
  for (let i = BOOMS.length - 1; i >= 0; i--) if (!BOOMS[i].frozen && (BOOMS[i].t += dt) > 1.6) BOOMS.splice(i, 1);
  for (let i = ARMS.length - 1; i >= 0; i--) {
    const a = ARMS[i]; a.t -= dt;
    if (a.t <= 0) {
      const was = a.tgt.spin; hit(a.tgt, "🖐️ Zakum's Arm!");
      if (a.tgt.spin > 0 && !(was > 0)) { a.tgt.squash = 1; if (a.tgt === K) { K.v = 0; K.shake = .4; } }   // only if it landed (not mid-air / protected)
      slamSound(0); ARMS.splice(i, 1);
    }
  }
  for (let i = BSHELLS.length - 1; i >= 0; i--) {   // 💙 flying up the track high over everyone, then down onto the leader
    const b = BSHELLS[i]; b.t += dt;
    if (!b.tgt || b.tgt.done) { const l = racers().filter(o => !o.done).sort((a, c) => progOf(c) - progOf(a))[0]; if (!l) { BSHELLS.splice(i, 1); continue; } b.tgt = l; }
    const tp = progOf(b.tgt);
    if (!b.hover && b.p < tp - 4 && b.t < 12) { b.p = Math.min(tp - 4, b.p + VMAX * 2.4 * SPD / SPC * dt); const ii = OPEN ? Math.max(0, Math.min(N - 1, Math.round(b.p))) : ((Math.round(b.p) % N) + N) % N; [b.x, b.y] = at(ii, 0); b.z = 46; }
    else { b.hover = (b.hover || 0) + dt; b.x = b.tgt.x; b.y = b.tgt.y; b.z = 46 * Math.max(0, 1 - b.hover / .7); if (b.tgt === K && b.hover < dt * 1.5) tone(1400, .25, "square", .05, 700);
      if (b.hover >= .7) { BSHELLS.splice(i, 1); explode({ x: b.tgt.x, y: b.tgt.y, by: b.by, id: b.id, own: b.own }, all); } }
  }
  for (let i = HORNS.length - 1; i >= 0; i--) if ((HORNS[i].t += dt) > .6) HORNS.splice(i, 1);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {   // karts bump each other
    const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), BR = PTS[0].length > 2 ? 21 : 15;   // 3D karts are bigger: they touch sooner
    if (d > 0 && d < BR && Math.abs(a.z - b.z) < 12) {
      const push = (BR - d) / 2, nx = dx / d, ny = dy / d;
      if ((a.remote && b.remote) || a.noBump || b.noBump) continue;   // two other players' karts (or the test copy)
      if (GAPS.length && ((a.hopUntil && performance.now() < a.hopUntil + 150) || (b.hopUntil && performance.now() < b.hopUntil + 150))) continue;   // nobody gets knocked off a mushroom bounce: their own games sort it out
      if (a.remote || b.remote) { const me2 = a.remote ? b : a, s2 = me2 === a ? -1 : 1; me2.x += nx * push * 2 * s2; me2.y += ny * push * 2 * s2; }   // only the kart this game drives is moved
      else { a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push; }
      const fast = a.v > b.v ? a : b; fast.v *= .9;
      if (STRONG(a) !== STRONG(b)) { const v = STRONG(a) ? b : a; hit(v, (STRONG(a) ? a : b).rocket > 0 ? "🚀 Run over by a Rocket Booster!" : "💪 Rammed by Hyper Body!"); if (v.spin > 0) { v.v *= .4; if (v === K || a === K || b === K) slamSound(0); } }
      else if ((a.small > 0) !== (b.small > 0)) { const tiny = a.small > 0 ? a : b; hit(tiny, "👟 Flattened!"); tiny.squash = .8; }
      if (a === K || b === K) { K.shake = Math.max(K.shake, .1); if (K.bump <= 0) { bumpSound(); K.bump = .3; } }
    }
  }
}

// ------------------------------------------------------------------ the race
let me = null, state = "menu", raf = 0, last = 0, keys = {}, touch = { x: 0, d: 0, b: 0, i: 0 };
let K = null, best = null, countAt = 0, rkCand = 0, rkSince = 0;
const DEV = location.hostname === "localhost" ? (window.__kart = { auto: false, get K() { return K; }, get PLANE() { return PLANE; }, get RINGS() { return RINGS; }, get RIV() { return RIV; }, get PEN() { return PEN; }, get N() { return N; }, get PADS() { return PADS; }, get POPS() { return POPS; }, get COINS() { return COINS; }, get G3() { return G3; }, get GAPS() { return GAPS; }, get ROAD() { return ROAD; }, mpTest: { hitBy: (...a) => hitBy(...a), mpOnHit: p => mpOnHit(p), HITS, get SHOTS() { return SHOTS; } }, get SPC() { return SPC; }, closeCall: () => closeCall(), shot: async name => { const c = document.createElement("canvas"), src = G3 ? G3.snap() : cv; c.width = fxc.width; c.height = fxc.height; const g = c.getContext("2d");
    g.drawImage(src, 0, 0, c.width, c.height); g.drawImage(fxc, 0, 0); const b = await new Promise(r => c.toBlob(r, "image/jpeg", .9)); return fetch("http://127.0.0.1:8799/" + name, { method: "POST", body: b }).then(r => r.status); },
  decal: () => trackData().decal(), get P2P() { return P2P; },
  echo: (delay = 150, jitter = 40) => {
    const r = { name: "ZzEcho", img: IMG.me, color: "#3a7bd5", x: K.x, y: K.y, a: K.a, v: 0, idx: K.idx, lap: 0, cps: 0, prog: 0, done: false, finish: 0, finishT: 0,
      remote: true, noBump: true, net: null, steer: 0, spin: 0, inv: 0, squash: 0, z: 0, vz: 0, boost: 0, extra: 0, item: null, itemN: 0, skill: VMAX, lane: 0 };
    RIV.push(r); const errs = [], rc = MP.raceNo;
    const iv = setInterval(() => { const p = { n: "ZzEcho", rc, ...posMsg(K, performance.now()) }; setTimeout(() => mpOnPos(p), delay + Math.random() * jitter); }, 100);
    const ev = setInterval(() => { if (r.net && state === "race") errs.push(Math.hypot(r.x - K.x, r.y - K.y)); }, 50);
    return { stop() { clearInterval(iv); clearInterval(ev); RIV.splice(RIV.indexOf(r), 1); const s2 = errs.slice().sort((a, b) => a - b), q = f => Math.round(s2[Math.floor(f * (s2.length - 1))] || 0);
      return { samples: s2.length, mean: Math.round(s2.reduce((a, b) => a + b, 0) / (s2.length || 1)), p50: q(.5), p90: q(.9), max: q(1) }; } };
  },
  park: (x, y) => { const i = I(x, y), a = tangent(i), [px, py] = at(i, 0); Object.assign(K, { x: px, y: py, a, idx: i, v: 0, z: 0, vz: 0, ma: a }); },
  get PIGS() { return PIGS; }, get KING() { return KING; }, get ALT() { return ALT; }, get AN() { return AN; }, get TRACK() { return TRACK_KEY; }, I, at, altAt, loadTrack,
  get tex() { return tex; }, get MP() { return MP; }, redrawNext: () => mpRedrawNext(), get IMG() { return IMG; }, get OBJS() { return OBJS; }, get LAVA() { return LAVA; }, get T() { return T; }, setTrack: k => { track = k; cup = cupOf(k); drawTrack(); }, setQ: q => { QMAX = q; fit(); }, get CROWD() { return CROWD; }, boomAt: (d, t) => { const e = { x: K.x + Math.cos(K.a) * d, y: K.y + Math.sin(K.a) * d, t, frozen: true, debris: Array.from({ length: 14 }, () => ({ a: Math.random() * 6.28, v: 60 + Math.random() * 90, vz: 120 + Math.random() * 160, s: 2 + Math.random() * 3, c: "#6b4426" })) }; BOOMS.push(e); return e; }, get BOOMS() { return BOOMS; }, get SHOTS() { return SHOTS; }, get HAZ() { return HAZ; }, get THWOMPS() { return THWOMPS; }, give: it => setItem(K, it), setMode: m => { mode = m; drawMode(); drawTrack(); }, use: (r, it) => { r = r || K; if (it) setItem(r, it); useItem(r); }, roll: (r, bot) => rollItem(r || K, bot), get SHOTS2() { return { SHOTS, BSHELLS, HORNS, DROPS, BOMBS }; }, nav: (...a) => nav(...a), nearest: (...a) => nearest(...a), get FORKS() { return { A: FORK_A, B: FORK_B, AN, ALT, PTS, LAPS, OPEN, START_I, FIN_OFF }; }, get FORK() { return { a: FORK_A, b: FORK_B, AN, N, SPC }; }, autoFork: f => autoFork(f || {}), findShape: (kind, w) => { shapeCut.search = true; let best = null; const lo = OPEN ? START_I + 30 : 25, hi = OPEN ? N - FIN_OFF - 30 : N - 25;
    for (let a = lo; a < hi; a += 3) for (let b = a + 24; b < Math.min(hi, a + Math.round(N * .45)); b += 3) {
      const A = PTS[a], Bp = PTS[b], dl = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), dt = (b - a) * SPC; if (dl < 260 || dl > 1100 || dt - dl < 450 || dt - dl > 1100) continue;
      const pts = shapeCut(a, b, [], w, kind); if (!pts) continue; const score = shapeCut.k * 2000 - Math.abs(dt - dl - 750); if (!best || score > best.score) best = { a, b, pts: pts.map(p => p.map(Math.round)), score, k: shapeCut.k }; }
    shapeCut.search = false; return best; }, get floorMs() { return floorMs; } }) : null;
function freshKart() {
  const g = gridSpot(mode === "mp" ? MP.slot : 4), i = (g.i + N) % N, a = tangent(i), [x, y] = at(i, g.o);
  return { x, y, a, item: null, itemN: 0, roll: 0, pending: null, v: 0, steer: 0, drift: 0, charge: 0, boost: 0, hop: 0, idx: i, lap: 0, cps: 0,
    t: 0, lapStart: 0, laps: [], wrong: 0, prog: 0, off: false, bump: 0, z: 0, vz: 0, trick: false, flip: 0, spin: 0, inv: 0, squash: 0,
    shake: 0, stall: 0, mesos: 0, held: null, lastPad: null, prevDrift: false, prevItem: false, kingWas: 0, ma: a, flipped: false, flipT: 15 + Math.random() * 15 };
}
const fmt = ms => ms == null ? "--" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
const bestKey = () => `kart_best2:${ccId(TRACK_ID, raceCC)}:${me}`;
let raceCC = 150;

function input() {
  if (K && K.rocket > 0 && state === "race") {   // 🚀 the Rocket Booster drives for you
    const tg = PTS[OPEN ? Math.min(N - 1, K.idx + 20) : (K.idx + 20) % N]; let d = Math.atan2(tg[1] - K.y, tg[0] - K.x) - K.a; d = Math.atan2(Math.sin(d), Math.cos(d));
    return { steer: Math.max(-1, Math.min(1, d * 3)), drift: false, brake: false, item: false };
  }
  if (DEV && DEV.auto && K) {   // local testing only: aim at a point further along the track
    let lo = 0; for (const h of HOLES) { const di = (h.i - K.idx + N) % N; if (di < 40 && Math.abs(h.o || 0) < h.r + 22) lo = (h.o || 0) + h.r + 34; }
    const tg = lo ? at((K.idx + 18) % N, lo) : PTS[(K.idx + 18) % N], want = Math.atan2(tg[1] - K.y, tg[0] - K.x);
    let d = want - K.a; d = Math.atan2(Math.sin(d), Math.cos(d));
    return { steer: d > .05 ? 1 : d < -.05 ? -1 : 0, drift: DEV.drift != null ? DEV.drift : false, brake: false, item: !!DEV.item };
  }
  const l = keys.ArrowLeft || keys.a, r = keys.ArrowRight || keys.d;
  return { steer: (r ? 1 : 0) - (l ? 1 : 0) || touch.x, drift: !!(keys[" "] || keys.Shift || touch.d), brake: !!(keys.ArrowDown || keys.s || touch.b),
    item: !!(keys.ArrowUp || keys.w || keys.e || touch.i) };
}
// ✨ little rewards: text that pops up by your kart, a buzz on phones, and "close call" boosts
let POPS = [], popT = 0, lastClose = 0;
function pop(text, col = "#ffe14a", big = false) { for (const q of POPS) q.t = Math.min(q.t, 1.1) - .28;   // older ones move up out of the way
  POPS.push({ text, col, big, t: 1.1, dx: Math.random() * 10 }); if (POPS.length > 5) POPS.shift(); }
const buzz = ms => { try { if (navigator.vibrate && matchMedia("(pointer: coarse)").matches) navigator.vibrate(ms); } catch (e) {} };
function closeCall() {
  const now = performance.now(); if (now - lastClose < 1500 || state !== "race" || K.spin > 0 || K.frozen > 0) return; lastClose = now;
  pop("😮 Close call!", "#7ad8ff", true); giveBoost(K, .4, 50); tone(1200, .1, "triangle", .05, 1800); buzz(12);
}
// something came within `r` of you and then went past without hitting you
function nearMiss(o, d, r) { if (d < r) o.near = 1; else if (o.near === 1 && d > r + 8) { o.near = 2; closeCall(); } }
function drawPops(x, y) {
  const now = performance.now() / 1000, dt = Math.min(.05, now - (popT || now)); popT = now;
  ctx.save(); ctx.textAlign = "left"; ctx.lineJoin = "round";
  for (let i = POPS.length - 1; i >= 0; i--) { const p = POPS[i]; p.t -= dt; if (p.t <= 0) { POPS.splice(i, 1); continue; }
    const a = Math.min(1, p.t * 3), rise = (1.1 - p.t) * 34, fs = p.big ? 13 : 10; ctx.globalAlpha = a; ctx.font = `900 ${fs}px Ubuntu, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(30,20,30,.85)"; ctx.strokeText(p.text, x + p.dx, y - rise); ctx.fillStyle = p.col; ctx.fillText(p.text, x + p.dx, y - rise); }
  ctx.restore();
}
function shroomHit(pad) { pad.squash = 1; }   // the cap squashes down and springs back (3D)
// 🌳 a stump digging about: where it is, and how far it's up out of the ground (0 = just its dirt mound)
function molePos(m, tt) {
  const f = (((tt * (m.sp || 1) + m.ph) % 3.4) + 3.4) % 3.4 / 3.4, up = f < .55 ? 0 : f < .63 ? (f - .55) / .08 : f < .86 ? 1 : f < .94 ? 1 - (f - .86) / .08 : 0;
  const [x, y] = at(m.i, m.o + Math.sin(tt * .35 + m.ph) * 40); return { x, y, up };
}
const wanderPos = (w, tt) => { const a = tt * w.sp + w.ph; return { x: w.x + Math.cos(a) * w.rx, y: w.y + Math.sin(a) * w.ry, dx: -Math.sin(a) * w.rx }; };
// a giant pet on its chain: it bounds about its post and lunges out to the end of the chain, every few seconds
function chompPos(c, tt) {
  const t = tt + c.ph, cyc = t % 3.2, ang = Math.sin(t * .7 + c.ph) * 1.2 + Math.atan2(c.ay - WORLD / 2, c.ax - WORLD / 2) + Math.PI, lunge = cyc > 2.2 ? Math.sin((cyc - 2.2) / 1 * Math.PI) : 0;
  const R = c.R * (.45 + .55 * lunge), x = c.ax + Math.cos(ang) * R, y = c.ay + Math.sin(ang) * R;
  return { x, y, z: Math.abs(Math.sin(t * 5)) * (lunge > .2 ? 26 : 8), dx: Math.cos(ang) };
}
function petStep(r, air, tt) {
  if (!air) for (const h of HOLES) if ((!h.lap || r.lap + 1 >= h.lap) && Math.hypot(r.x - h.x, r.y - h.y) < h.r) { rescue(r, h.lap ? "🔥 The road gave way!" : "💦 Through the ice!"); r.rescueAt = (h.i + Math.round((h.r + 70) / SPC)) % N; return; }   // fished out just past the hole, so you never drive straight back into it
  for (const b of HEDGES) { const dx = r.x - b.x, dy = r.y - b.y, d = Math.hypot(dx, dy), R = b.w / 2 + 11;   // 🌿 hedges are solid: you slide off them
    if (d < R && d > 0 && r.z < b.h) { const nx = dx / d, ny = dy / d; r.x = b.x + nx * R; r.y = b.y + ny * R;
      const m = r.ma != null ? r.ma : r.a, hx = Math.cos(m), hy = Math.sin(m), into = hx * nx + hy * ny;
      if (into < 0) { const tx = hx - nx * into, ty = hy - ny * into; if (Math.hypot(tx, ty) > .05) { const na = Math.atan2(ty, tx); r.a = r.ma = na; } }   // turned along the hedge
      if (!(r.hedgeT > performance.now())) { r.hedgeT = performance.now() + 500; r.v = Math.min(r.v, 190); if (r === K) { bumpSound(); K.shake = Math.max(K.shake, .15); } } } }
  for (const b of BUILDINGS) { const c = Math.cos(b.a || 0), sn = Math.sin(b.a || 0), dx = r.x - b.x, dy = r.y - b.y, u = dx * c + dy * sn, v = -dx * sn + dy * c, hw = b.w / 2 + 10, hd = b.d / 2 + 10;   // 🧊 walls are solid too
    if (Math.abs(u) < hw && Math.abs(v) < hd && r.z < b.h) { const pu = hw - Math.abs(u), pv = hd - Math.abs(v), nu = pu < pv ? Math.sign(u) || 1 : 0, nv = pu < pv ? 0 : Math.sign(v) || 1;
      const nx = nu * c - nv * sn, ny = nu * sn + nv * c; r.x += nx * Math.min(pu, pv); r.y += ny * Math.min(pu, pv);
      const m = r.ma != null ? r.ma : r.a, hx = Math.cos(m), hy = Math.sin(m), into = hx * nx + hy * ny;
      if (into < 0) { const tx = hx - nx * into, ty = hy - ny * into; if (Math.hypot(tx, ty) > .05) r.a = r.ma = Math.atan2(ty, tx); }
      if (!(r.hedgeT > performance.now())) { r.hedgeT = performance.now() + 500; r.v = Math.min(r.v, 160); if (r === K) { bumpSound(); K.shake = Math.max(K.shake, .15); } } } }
  { const now = performance.now() / 1000;
    for (const t of THWOMPS) { const d = Math.hypot(r.x - t.x, r.y - t.y), z = thwompZ(t, now), R0 = 38, ph = ((now + t.ph) % t.T) / t.T, slam = Math.floor((now + t.ph) / t.T);
      if (d < R0 && ph >= .55 && ph < .66 && z < 30 && r.z < 30 && r.thwSlam !== slam) { r.thwSlam = slam; r.squash = 1.1; r.v = 0; if (r === K) { spinOut("🗿 Squashed by a Block Golem!"); K.shake = .4; } else hit(r); }   // 💥 caught under it as it lands (any frame rate)
      else if (d < R0 + 10 && ph >= .66 && z === 0 && d > 0) { const nx = (r.x - t.x) / d, ny = (r.y - t.y) / d; r.x = t.x + nx * (R0 + 10); r.y = t.y + ny * (R0 + 10); r.v = Math.min(r.v, 150); } } }   // a Thwomp on the ground is a solid block
  { const now = performance.now() / 1000;
    for (const c of CARTS) { const q = cartAt(c, now); if (Math.abs(r.z) < 20 && Math.hypot(r.x - q.x, r.y - q.y) < 24 && !(r.cartT > now)) { r.cartT = now + 1; giveBoost(r, .7, 100); if (r === K) { flash("🛒 Cart boost!", 700); padSound(); } } } }   // 🛒 bump a mine cart: it shoves you on (like Mario Kart 8's)
  { const now = performance.now() / 1000;
    for (const b of FIREBALLS) { const z = fireZ(b, now), z0 = fireZ(b, now - .06); if (z0 > 0 && z0 < 60 && (z < 0 || z < 12) && Math.hypot(r.x - b.x, r.y - b.y) < 42 && r.z < 40) { if (r === K) spinOut("🔥 Hit by a fireball!"); else hit(r); } } }   // 🔥 caught where a fireball lands
  { const now = performance.now() / 1000;
    if (!air) for (const g of GEARS) { const dx = r.x - g.x, dy = r.y - g.y; if (dx * dx + dy * dy < g.r * g.r) { r.x += -g.w * dy * (1 / 60); r.y += g.w * dx * (1 / 60); } }   // ⚙️ a turning gear carries you round with it
    if (!air && LAKE) for (const h of HANDS) { const a = handAng(h, now), ux = Math.cos(a), uy = Math.sin(a), dx = r.x - LAKE.cx, dy = r.y - LAKE.cy, t = Math.max(0, Math.min(h.len, dx * ux + dy * uy)), d = Math.hypot(dx - ux * t, dy - uy * t);
      if (d < h.w / 2 + 9 && !(r.handT > now) && d > 0) { r.handT = now + 1; const px = dx - ux * t, py = dy - uy * t; r.x += px / d * 14; r.y += py / d * 14; r.v *= .8; if (r === K) { bumpSound(); pop("🕰️ Clock hand!", "#ffb347", true); } } }   // (a nudge, not a spin: in Mario Kart 8 you can even drive on them)
    for (const p of PENDS) { const q = pendAt(p, now); if (r.z < 30 && Math.hypot(r.x - q.x, r.y - q.y) < 28 && !(r.pendT > now)) { r.pendT = now + 1.2; if (r === K) spinOut("🕰️ Bonked by the pendulum!"); else hit(r); } } }
  if (air) for (const g of RINGS) if (Math.hypot(r.x - g.x, r.y - g.y) < 30 && Math.abs(r.z - g.z) < (g.r || 40) && r.ringT !== g) {   // ⭕ through a boost ring
    r.ringT = g; giveBoost(r, 1.2, 130); if (r === K) { padSound(); flash("⭕ Boost ring!", 700); } }
  if (air) return;
  for (const c of CHOMPS) { const q = chompPos(c, tt); if (q.z < 14 && Math.hypot(r.x - q.x, r.y - q.y) < 24 * c.s) hit(r, `🐾 Chomped by the ${c.k === "jrbalrog" ? "Jr. Balrog" : c.k === "blackpig" ? "Black Pig" : "Husky"}!`); }
}
function softBump(r, msg) {   // knocked about and slowed, but no spin (beginner tracks)
  if (r.bonk > 0) return; r.bonk = .8; r.v *= .55; r.vz = 120; r.z = .1;
  if (r === K) { bumpSound(); pop(msg, "#ffb347", true); buzz(20); }
}
function moleStep(r, air, tt) {
  if (!MOLES.length || air) return;
  for (const m of MOLES) { const q = molePos(m, tt), d = Math.hypot(r.x - q.x, r.y - q.y);
    if (q.up > .5 && d < 22) softBump(r, m.msg || "🌳 Stump!"); else if (d < 20) r.v = Math.min(r.v, 175); }   // its dirt slows you a little
}
const gapAt = idx => { for (const g of GAPS) if (idx >= g.a && idx <= g.b) return g; return null; };
const capAt = (x, y) => { for (const g of GAPS) for (const c of g.caps) if (Math.hypot(x - c.x, y - c.y) < c.r) return c; return null; };
const HOP = 200;   // every bounce carries you this far forward (any speed class); you steer in the air to land on the next mushroom
function gapStep(r, air) {
  if (!GAPS.length || r.rescue > 0) return;
  const c = capAt(r.x, r.y);
  if (air) {
    if (r.hopUntil && performance.now() < r.hopUntil + 400) { r.v = r.hopV || 250; r.boost = 0; r.extra = 0; }   // a bounce is always the same hop: no speeding up in the air
    if (r.hopUntil && performance.now() < r.hopUntil && (r !== K || (DEV && DEV.aimK))) r.a = r.ma = r.hopA;   // (the computer racers get a little aim)
    if (c && c !== r.lastCap && r.vz < 0 && r.z <= (c.top || 0) + 1) bounce(r, c);   // coming down onto a raised mushroom
    else if (!c) r.lastCap = null;
    return;
  }
  if (c) { if (c !== r.lastCap) bounce(r, c); return; }
  r.lastCap = null;
  const m = nearest(r.x, r.y, r.idx), g = gapAt(m.i); if (g && m.i < g.b - 2 && m.i > g.a + 1) rescue(r, g.kind === "water" ? "💦 Splash! Into the pond" : g.kind === "chasm" ? "🏔️ Down the mountain!" : "🍄 Missed! Into the gorge");
}
function bounce(r, c) {
  r.lastCap = c; c.squash = 1;
  if ((r !== K || (DEV && DEV.aimK)) && !r.remote) {   // computer racers aim at the next mushroom ahead on their side
    const g = c.g, myL = lat(r.x, r.y, r.idx); let tgt = null, best = 1e9;
    const hp = c.hop || HOP; for (const d of g.caps) { const ahead = (d.i - r.idx) * SPC; if (d === c || d.gold || ahead < 80 || ahead > hp + 100) continue; const sc = Math.abs((d.o || 0) - myL) + Math.abs(ahead - hp) * .5; if (sc < best) { best = sc; tgt = d; } }
    const [tx, ty] = tgt ? [tgt.x, tgt.y] : at(Math.min(N - 1, r.idx + Math.round(HOP / SPC)), Math.max(-25, Math.min(25, myL)));   // off the last one: back to the middle of the road
    r.a = r.ma = r.hopA = Math.atan2(ty - r.y, tx - r.x);
  }
  r.hopV = c.gold ? 400 : 250; const t = (c.hop || HOP) / (r.hopV * SPD); r.hopUntil = performance.now() + t * 1000;
  r.v = r.hopV; r.boost = 0; r.extra = 0; r.vz = 360 * t; r.z = Math.max(.1, c.top || 0); r.drift = 0; r.spin = 0;
  if (r === K && c.gold) { boingSound(); setTimeout(boingSound, 90); buzz([30, 30, 60]); pop("✨ SUPER BOUNCE!", "#ffe14a", true); K.kick = 1; }
  else if (r === K) { boingSound(); buzz(25); pop(c.r < 70 ? "🍄 Nice landing!" : "🍄 Boing!", { g: "#7ad06a", b: "#6ab8ff", o: "#ffb04a", n: "#d8a46a" }[c.col] || "#ff8a6a", true); }
}
function spinOut(msg) {
  const k = K; if (k.spin > 0 || k.inv > 0 || k.z > 0 || k.rescue > 0 || k.hyper > 0) return;
  buzz([50, 40, 70]);
  k.spin = .9; k.inv = 1.9; k.drift = 0; k.charge = 0; k.boost = 0; k.extra = 0; k.hitFlash = .09; k.shake = Math.max(k.shake, .25); spinSound();
  if (k.holding) { k.item = null; k.holding = false; }   // you drop what you were holding
  const lose = Math.min(3, k.mesos); k.mesos -= lose;   // getting hit drops mesos, like coins in Mario Kart
  for (let i = 0; i < lose; i++) COINFX.push({ x: (Math.random() - .5) * 10, y: 0, vx: (Math.random() - .5) * 90, vy: -120 - Math.random() * 60, t: 1 });
  flash(lose ? `${msg} −${lose} mesos` : msg, 1000);
}
const COINFX = [];
// screen-space effects around your kart (sparks, streaks, dust, sparkles) and fire trails left on the road (world space)
let PFX = [], FIRE = [], fxClock = 0, fxSpawn = 0, fireSpawn = 0;
const sparkCol = (c, t) => c > 2.4 ? `hsl(${(t * 900) % 360},100%,65%)` : c > 1.5 ? (Math.random() < .5 ? "#ff5a2e" : "#ffb02e") : c > .7 ? (Math.random() < .5 ? "#4aa8ff" : "#c8ecff") : "#ffffff";
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
function rescue(r, msg, lava) {
  if (r.rescue > 0) return;
  r.glide = 0; r.rescue = 1.4; r.rescueAt = OPEN ? Math.max(START_I, r.idx - 4) : (r.idx - 4 + N) % N;
  { const g = gapAt(r.rescueAt) || gapAt(r.idx); if (g) r.rescueAt = Math.max(0, g.a - Math.round(60 / SPC)); }   // fell in: you're put back just before the gap, to bounce across again
  r.rescueLava = !!lava; r.rescueAlt = r.onAlt ? Math.max(1, (r.altJ || 0) - 5) : null; r.drift = 0; r.charge = 0; r.boost = 0; r.extra = 0; r.spin = 0;
  if (r === K) { flash(msg || "📜 Return Scroll!", 1200); msg ? splatSound() : scrollSound(); }
}
function rescueStep(r, dt) {   // true while being rescued (no driving)
  if (!(r.rescue > 0)) return false;
  const before = r.rescue; r.rescue -= dt; r.v = 0;
  if (before > .7 && r.rescue <= .7) {   // halfway: move to the road
    if (r.rescueLava && LAVA) { r.rescueAt = Math.min(N - FIN_OFF - 2, Math.ceil(LAVA.i + LAVA.v * .7 + 90 / SPC)); r.rescueAlt = null; }   // just ahead of the lava: no free ride
    if (r.rescueAlt != null) { const [x, y] = altAt(r.rescueAlt, 0); r.x = x; r.y = y; r.a = altTan(r.rescueAlt); r.idx = altIdx(r.rescueAlt); }
    else { const [x, y] = at(r.rescueAt, 0); r.x = x; r.y = y; r.a = tangent(r.rescueAt); r.idx = r.rescueAt; }
    r.z = 0; r.vz = 0; r.ma = r.a;
    r.lostT = 0; r.wrong = 0;
  }
  if (r.rescue <= 0) { r.rescue = 0; r.inv = 1; }
  return true;
}
function step(dt) {
  const k = K, inp = input(), racing = state === "race", tt = performance.now() / 1000;
  for (let i = FIRE.length - 1; i >= 0; i--) if ((FIRE[i].t -= dt) <= 0) FIRE.splice(i, 1);
  if (k.extra > 20 && k.z <= 0 && state === "race" && (fireSpawn -= dt) <= 0) {   // fire left on the road behind a boost
    fireSpawn = .03; for (const side of [-1, 1]) FIRE.push({ x: k.x - Math.cos(k.a) * 12 - Math.sin(k.a) * 7 * side, y: k.y - Math.sin(k.a) * 12 + Math.cos(k.a) * 7 * side, t: .4 });
  }
  if (k.hitFlash > 0) k.hitFlash -= dt;
  for (let i = COINFX.length - 1; i >= 0; i--) { const c = COINFX[i]; c.t -= dt; c.vy += 320 * dt; c.x += c.vx * dt; c.y += c.vy * dt; if (c.t <= 0) COINFX.splice(i, 1); }
  if (rescueStep(k, dt)) { if (racing) { k.t += dt * 1000; worldStep(dt, tt); } return; }
  const near = nav(k.x, k.y, k.idx); k.idx = near.i; k.off = near.d > near.half + CURB * .6 && !onRink(k.x, k.y); k.onAlt = near.alt; k.altJ = near.j;
  if (racing) {
    const lost = (near.d > near.half + 150 && !onRink(k.x, k.y)) || (k.v < 25 && !inp.brake && k.spin <= 0 && k.stall <= 0 && k.squash <= 0);
    k.lostT = lost ? (k.lostT || 0) + dt : Math.max(0, (k.lostT || 0) - dt);
    if (k.lostT > 2.6 || k.wrong > 3) { rescue(k); return; }
  }
  const ground = under(near, k.x, k.y), L = ground.L;
  if (racing && near.alt && k.z <= 0 && near.d > near.half + CURB + 4 && SHORTCUTS[TRACK_KEY] && T.cup !== "zakum") {   // 🔀 off a short cut: you just bog down (Zakum's is lava)
    if (!(k.deepSnow > 0)) flash({ elnath: "❄️ Deep snow!", sleepy: "💦 Shallow water!", ludi: "🧸 Squishy floor!" }[T.cup] || "Slow!", 700); k.deepSnow = .25;
  }
  if (MECH === "lava" && racing && k.z <= 0 && near.d > near.half + CURB + 8) {   // (on the plank bridge too: off its sides is lava)   // 🔥 Zakum: there's no safe edge, off the road is lava
    k.fallT = (k.fallT || 0) + dt; if (k.fallT > .12) { k.fallT = 0; rescue(k, "🔥 Fell into the lava!"); return; }
  } else k.fallT = 0;
  // in the air (ramps): gravity, and a trick on the way up/down gives a boost when you land
  if (k.z > 0 || k.vz > 0) {
    k.vz -= (k.glide ? 150 : 720) * dt; if (k.glide) { k.vz = Math.max(k.vz, -95); k.v = Math.max(k.v, 245); } k.z += k.vz * dt;   // 🪁 a glider floats down slowly
    if (k.glide && k.z < 14 && gapAt(k.idx)) k.z = 14;   // …and holds you up over a ravine, so a long glide never drops you into the next gap
    if (k.z <= 0) { k.z = 0; k.vz = 0; k.hop = .14; k.glide = 0; if (k.trick) { giveBoost(k, .9, 95); flash("✨ Trick boost!", 700); } else bumpSound(); k.trick = false; }
  }
  const air = k.z > 0;
  if (air && inp.drift && !k.prevDrift && !k.trick) { k.trick = true; k.flip = .4; hopSound(); }
  k.prevDrift = inp.drift;
  // countdown: hold Drift when the "2" shows for a rocket start (from the "3" is too early)
  if (state === "count") { if (inp.drift) { if (k.held == null) k.held = performance.now() - countAt; } else k.held = null; }
  // 🧸 Ludibrium: every 15-30 seconds left and right swap (and swap back after another 15-30); a ⚠️ warning counts down 3 seconds before each
  if (MECH === "flip" && racing) { k.flipT -= dt; if (k.flipT <= 0) { k.flipped = !k.flipped; k.flipT = 15 + Math.random() * 15;
    flash(k.flipped ? "🔀 Controls swapped!" : "✅ Controls back to normal", 1200); tone(k.flipped ? 330 : 660, .25, "square", .07, k.flipped ? 165 : 990); } }
  if (k.flipped && !(DEV && DEV.auto)) inp.steer = -inp.steer;
  if (k.frozen > 0) { inp.steer = 0; inp.drift = false; }   // 🧊 frozen solid: no steering for a moment
  k.steer += ((k.spin > 0 ? 0 : inp.steer) - k.steer) * Math.min(1, dt * 10);
  // what's under the wheels
  const pad = air ? null : ground.pad;
  if (pad && pad !== k.lastPad) {
    if (pad.t === "boost") { giveBoost(k, 1, 110); padSound(); }
    if (pad.t === "ramp" && k.v > 60) { k.vz = (160 + k.v * .22) / SPD; k.z = .1; k.drift = 0; jumpSound(); if (!k.tricked) { k.tricked = true; flash("Tap Drift in the air! ✨", 900); } }
    if (pad.t === "bigramp" && k.v > 60) { k.vz = (300 + k.v * .3) / SPD; k.z = .1; k.drift = 0; jumpSound(); setTimeout(jumpSound, 120); flash(PEN ? (k.v > 200 ? "🐷 Fly over the pig farm!" : "Uh oh… 🐷") : "🚀 Big jump!", 900); }
    if (pad.t === "glide") { k.vz = 240; k.z = .1; k.glide = 1; k.drift = 0; k.v = Math.max(k.v, 230); jumpSound(); flash("🪁 Glide!", 900); }
    if (pad.t === "hay") { k.vz = 230; k.z = .1; k.mesos = Math.min(10, k.mesos + 2); flash("🌾 Boing! +2 mesos", 900); hopSound(); coinSound(); }
    if (pad.t === "shroom" && k.v > 30) { k.vz = (330 + k.v * .25) / SPD; k.z = .1; k.drift = 0; giveBoost(k, .5, 60); boingSound(); buzz(25); pop("🍄 Boing!", { o: "#ff9a3a", g: "#7ad06a", b: "#5ac8ff" }[pad.col] || "#ffd23f", true); shroomHit(pad); }
    if (pad.t === "slime") spinOut("🫧 Slimed!");
    if (pad.t === "lava") { spinOut("🔥 Lava! Hot hot hot!"); k.shake = .3; }
  }
  k.lastPad = pad; gapStep(k, air); moleStep(k, air, performance.now() / 1000); petStep(k, air, performance.now() / 1000);
  const icy = MECH === "ice" && !air && (pad && pad.t === "ice" || (LAKE && LAKE.kind === "ice" && inLake(k.x, k.y)));
  const muddy = !air && pad && (pad.t === "mud" || pad.t === "grass");   // (grass patches on the road: you can't speed up on them)
  if (icy && !k.wasIcy && k.v > 120) flash("🧊 Ice!", 500);
  k.wasIcy = icy;
  const rocky = pad && pad.t === "rock" && k.v > 60;
  const mud = !air && inPen(k.idx, L);   // landed in the pig pen
  if (mud && !k.wasMud) { flash("🐷 Mud bath!", 1100); oinkSound(); k.shake = .2; }
  k.wasMud = mud;
  if (rocky) { k.shake = Math.max(k.shake, .12); if (Math.random() < dt * 9) k.hop = .1; }
  if (!air && !k.off && Math.abs(L) > near.half - 2 && k.v > 100) k.shake = Math.max(k.shake, .04);   // rumble on the curbs
  // speed: always accelerating (phone friendly), the brake slows / reverses; mesos raise the top speed a little
  const hb = k.hyper > 0;
  boostTick(k, dt);
  if (k.deepSnow > 0) k.deepSnow -= dt;
  const top = k.frozen > 0 ? 90 : k.deepSnow > 0 ? 120 : hb ? VMAX + 60 + k.mesos * 3 : ((mud ? 80 : muddy ? 150 : k.off && !air ? 113 : rocky && k.boost <= 0 ? 200 : VMAX + k.mesos * 3) + (k.extra || 0)) * (k.small > 0 ? .72 : 1);
  if (!racing || k.spin > 0 || k.stall > 0) k.v *= Math.pow(k.spin > 0 ? .3 : .2, dt);
  else if (inp.brake) k.v = Math.max(-60, k.v - 380 * dt);
  else k.v += (k.v < top ? (k.extra > 5 ? 900 : k.v < 120 ? 210 : 120) : -260) * dt;   // boosts reach their speed almost at once
  if (k.kick > 0) k.kick = Math.max(0, k.kick - dt * 1.4);
  for (const key of ["boost", "spin", "inv", "squash", "shake", "stall", "flip", "small", "ink", "bloopSafe", "hyper", "roll2"]) if (k[key] > 0) k[key] -= dt;
  timedTick(k, dt);
  // items from the boxes: the slot spins like a slot machine for a second, then it's yours to use
  if (k.roll > 0) { k.roll -= dt; if (k.roll <= 0) { setItem(k, k.pending); flash(`${ITEM_NAME[k.item]}!`, 700); } }
  if (k.pending2 && !(k.roll2 > 0)) { k.item2 = k.pending2; k.pending2 = null; }
  if (!k.item && k.roll <= 0 && k.item2) { setItem(k, k.item2); k.item2 = null; }   // the second item moves up
  // Slime drop and Arrow can be held behind you as a shield (keep the button pressed), and are used when you let go
  if (racing && k.item && k.roll <= 0) {
    if (inp.item && !k.prevItem) { if (HOLDABLE(k.item)) k.holding = true; else if (k.spin <= 0) useItem(k); }
    if (k.holding && !inp.item) { k.holding = false; if (k.spin <= 0) useItem(k); }
  }
  if (!k.item) k.holding = false;
  k.prevItem = inp.item;
  // drifting: hold drift while turning, the longer you hold the bigger the boost when you let go
  if (racing && !air && k.spin <= 0 && inp.drift && !k.drift && Math.abs(inp.steer) > .25 && k.v > 140) { k.drift = Math.sign(inp.steer); k.charge = 0; k.hop = .18; hopSound(); }
  if (k.drift && (!inp.drift || k.v < 90)) {
    // 💨 mini-turbos, named like Mario Kart's: the longer the drift, the bigger (and the bigger the shout)
    if (k.charge > 2.4) { giveBoost(k, 2.2, 110); pop("🌈 ULTRA MINI-TURBO!", "#ff7ad9", true); K.shake = Math.max(K.shake, .12); buzz([20, 30, 40]); }
    else if (k.charge > 1.5) { giveBoost(k, 1.3, 90); pop("🔥 SUPER MINI-TURBO!", "#ffa33a", true); buzz(25); }
    else if (k.charge > .7) { giveBoost(k, .7, 72); pop("💨 Mini-Turbo!", "#8fd3ff"); }
    if (k.charge > .7) { whooshSound(); k.mtN = (k.mtN || 0) + 1; }
    k.drift = 0; k.charge = 0;
  }
  let turn = k.steer * 2.1 * Math.min(1, Math.abs(k.v) / 110) * (k.v < 0 ? -1 : 1) * (air ? (k.glide ? .8 : .5) : 1);
  if (k.drift) { turn = (k.drift * 1.55 + k.steer * .9) * Math.min(1, k.v / 110); if (!k.off) { const before = k.charge; k.charge += dt * Math.max(.4, 1 + .7 * k.steer * k.drift);   // steering into the turn charges faster
    if ([.7, 1.5, 2.4].some(th => before < th && k.charge >= th)) tone(k.charge > 2.4 ? 1320 : k.charge > 1.5 ? 990 : 740, .1, "triangle", .06); } }
  k.a += turn * dt;
  // ❄️ El Nath: on ice the kart keeps going the way it was moving and only slowly follows where it's pointing
  const grip = MECH === "ice" ? (icy ? 1.7 : k.off ? 5 : 4) : 99;   // El Nath: slippery, but a turn can still be held
  { let dm = k.a - k.ma; dm = Math.atan2(Math.sin(dm), Math.cos(dm)); k.ma = grip > 50 ? k.a : k.ma + dm * Math.min(1, grip * dt); }
  let mx = Math.cos(k.ma) * k.v, my = Math.sin(k.ma) * k.v;
  if (k.drift) { mx += -Math.sin(k.a) * -k.drift * k.v * .16; my += Math.cos(k.a) * -k.drift * k.v * .16; }   // slide outwards a bit
  k.x += mx * dt * SPD; k.y += my * dt * SPD;
  if (k.hop > 0) k.hop -= dt;
  // the map edge and roadside things push you back
  if (k.x < 20 || k.y < 20 || k.x > WORLD - 20 || k.y > WORLD - 20) { k.x = Math.min(WORLD - 20, Math.max(20, k.x)); k.y = Math.min(WORLD - 20, Math.max(20, k.y)); k.v *= .5; }
  const solid = (ox, oy, r) => {
    const dx = k.x - ox, dy = k.y - oy, d = Math.hypot(dx, dy);
    if (d < r + 7 && d > 0) { k.x = ox + dx / d * (r + 7); k.y = oy + dy / d * (r + 7); if (k.bump <= 0) { k.v *= .35; k.bump = .4; bumpSound(); k.shake = .15; } k.drift = 0; }
  };
  for (const o of OBJS) if (o.r) solid(o.x, o.y, o.r);
  if (k.bump > 0) k.bump -= dt;
  // slipstream: right behind another kart for about a second gives a short boost to pass them
  let tuck = false;
  if (racing && !air && k.v > 150) for (const r of RIV) {
    const dx = r.x - k.x, dy = r.y - k.y, fwd = dx * Math.cos(k.a) + dy * Math.sin(k.a), side = -dx * Math.sin(k.a) + dy * Math.cos(k.a);
    if (fwd > 12 && fwd < 110 && Math.abs(side) < 20) { tuck = true; break; }
  }
  k.slip = tuck ? (k.slip || 0) + dt : Math.max(0, (k.slip || 0) - dt * 2);
  if (k.slip > .9) { k.slip = 0; giveBoost(k, .8, 80); flash("💨 Slipstream!", 600); }
  // mesos, pigs and the King Slime
  for (const c of COINS) if (!c.got && Math.abs(k.z - (c.z || 0)) < 30 && Math.hypot(k.x - c.x, k.y - c.y) < 18) {
    c.got = true; const was = k.mesos; k.mesos = Math.min(10, k.mesos + 1); k.mesoTotal = (k.mesoTotal || 0) + 1; k.v = Math.min(k.v + 22, 360); coinSound();
    const now = performance.now(); k.comboN = now - (k.comboT || 0) < 1300 ? (k.comboN || 0) + 1 : 1; k.comboT = now;   // 💰 a chain of quick pick-ups climbs in pitch
    if (k.comboN > 1) tone(1320 + k.comboN * 110, .06, "square", .04); pop(k.comboN > 1 ? `+1 ×${k.comboN}` : "+1", "#ffd23f"); buzz(6);
    if (k.comboN === 5 || k.comboN === 10) pop(`💰 Meso streak ×${k.comboN}!`, "#ffe14a", true);
    if (was < 10 && k.mesos === 10) { flash("💰 MAX MESOS!", 900); [988, 1319, 1568].forEach((f, i) => setTimeout(() => tone(f, .12, "square", .05), i * 80)); }
  }
  if (k.bonk > 0) k.bonk -= dt;
  for (const p of PIGS) { if (p.lap && lapNow() < p.lap) continue; const q = pigPos(p, tt); if (!air && q.z < 10 && Math.hypot(k.x - q.x, k.y - q.y) < (p.soft ? 20 : 17)) {
    if (p.soft) { if (!(k.bonk > 0)) { k.bonk = .8; k.v *= p.herd ? .5 : .6; k.vz = 120; k.z = .1; bumpSound(); if (p.k.includes("pig")) oinkSound(); pop(p.k.includes("pig") ? "🐷 Oink!" : p.k === "pepe" ? "🐧 Waddle!" : "🍄 Bonk!", "#ffb347", true); buzz(20); } continue; }
    spinOut(p.k.includes("pig") ? "🐷 Oink!" : p.k.includes("snail") ? "🐌 Snail!" : p.k === "freezie" ? "🧊 Ice block!" : p.k === "fishbone" ? "🐟 Bone Fish!" : p.k === "roller" ? "🪨 Boulder!" : p.k === "fire_boar" ? "🔥 Fire Boar!" : p.k === "firebomb" ? "💥 Firebomb!" : p.k === "jr_yeti" ? "⛸ Skater!" : "🍄 Bonk!"); } }
  for (const c of CHUTES) if (!air && k.idx >= c.a && k.idx <= c.b && near.d > near.half + CURB - 6) {   // 🐧 the penguin slide's ice walls keep you in
    const [cx, cy] = at(near.i, 0), dx = k.x - cx, dy = k.y - cy, d = Math.hypot(dx, dy) || 1, lim = near.half + CURB - 6; k.x = cx + dx / d * lim; k.y = cy + dy / d * lim; k.v *= .97; k.drift = 0; }
  if (T.water && racing && !air && near.d > near.half + CURB + 8 && !(k.rescue > 0)) { rescue(k, "💦 Splash! Into the lake"); return; }
  if (LEDGES.length && racing && !air && !near.alt && near.d > near.half + CURB + 10 && offAlt(k.x, k.y, 10) && LEDGES.some(l => k.idx >= l.a && k.idx <= l.b) && !(k.rescue > 0)) { rescue(k, T.fall || (T.theme.lava ? "🔥 Into the lava!" : "⛏️ Down into the dark!")); return; }   // no railings: off the edge you fall   // 🌊 off the boardwalk: into the lake
  if (LAKE && lakeFall() && !air && k.off && inLake(k.x, k.y)) { rescue(k, LAKE.kind === "swamp" ? "🐊 Into the swamp!" : "💦 Splash!"); return; }   // fell off the bridge into the lake
  for (const p of PENPIGS) {
    p.dx *= Math.pow(.6, dt); p.dy *= Math.pow(.6, dt);
    for (const r of racers()) { if (r.z > 8) continue; const q = penPigPos(p, tt), dx = q.x - r.x, dy = q.y - r.y, d = Math.hypot(dx, dy);
      if (d < 32 && d > 0) { p.dx += dx / d * 140 * dt; p.dy += dy / d * 140 * dt; if (r === K && d < 18 && !(p.oink > 0)) { oinkSound(); p.oink = 1; } } }
    if (p.oink > 0) p.oink -= dt;
  }
  if (KING) {
    const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0), kd = Math.hypot(k.x - kx, k.y - ky);
    if (k.kingWas < .55 && kp >= .55) {   // SLAM
      if (kd < 300) { k.shake = Math.max(k.shake, kd < 120 ? .35 : .15); slamSound(kd); }
      if (kd < (KING.big ? 62 : 36) && !air && k.inv <= 0) { k.squash = 1.1; k.inv = 0; spinOut(KING.big ? `💥 Stomped by the ${KING.name}!` : "💥 SQUASHED!"); k.v = 0; }
    }
    k.kingWas = kp;
    if (kp >= .55) solid(kx, ky, KING.big ? 44 : 26);
  }
  if (!racing) { if (mpOn() && state === "done" && MP.host === MP.me && RIV.some(r => r.bot && !r.remote && !r.done)) worldStep(dt, tt); return; }   // 🤖 bots race on after you finish
  worldStep(dt, tt);
  // laps: 4 checkpoints in order, then crossing the start line
  k.t += dt * 1000;
  if (mode === "tt" && (!ghostRec.length || k.t - ghostRec[ghostRec.length - 1][0] >= 100)) ghostRec.push([Math.round(k.t), Math.round(k.x), Math.round(k.y), +k.a.toFixed(2), Math.round(k.z)]);
  if (lapTick(k)) {
    k.laps.push(k.t - k.lapStart); k.lapStart = k.t; lapSound(); cheerSound();
    { const lt = k.laps[k.laps.length - 1], key = `kart_bl:${ccId(TRACK_ID, raceCC)}:${me}`, pb = +store.get(key) || 0;   // ⚡ your best lap ever on this track, in any mode
      if (lt > 5000 && (!pb || lt < pb)) { store.set(key, String(Math.round(lt))); if (pb) { setTimeout(() => { if (state === "race" || state === "done") { pop(`⚡ NEW BEST LAP!  −${((pb - lt) / 1000).toFixed(2)}s`, "#ffe14a", true); [880, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, .12, "square", .05), i * 90)); buzz([20, 40, 20]); } }, 700); } } }
    COINS.forEach(c => c.got = false);   // mesos come back every lap (the 10 max stays)
    if (k.lap >= LAPS) finish();
    else if (k.lap === LAPS - 1) { flash(FINALMSG ? `🏁 FINAL LAP!\n${FINALMSG}` : "🏁 FINAL LAP!", 1800); finalSound(); B.musicRate(1.15); fireworks(3); }   // fanfare, and the music speeds up
    else flash(`Lap ${k.lap + 1}`, 1300);
    if (k.lap < LAPS) { const lt = k.laps[k.laps.length - 1], pv = k.laps[k.laps.length - 2];   // ⏱️ this lap's time, and how it compares with the last one
      pop(pv ? `${(lt / 1000).toFixed(2)}s  ${lt < pv ? "▼" : "▲"}${Math.abs((lt - pv) / 1000).toFixed(2)}` : `${(lt / 1000).toFixed(2)}s`, !pv ? "#ffffff" : lt < pv ? "#7dff8a" : "#ff9a9a", true); }
  }
  // wrong way: moving against the track direction for a moment
  const along = Math.cos(k.a - (k.onAlt && k.altJ != null ? altTan(k.altJ) : tangent(k.idx))) * k.v;   // on a short cut, "forward" is along the short cut
  k.wrong = along < -20 ? k.wrong + dt : Math.max(0, k.wrong - dt * 2);
}

// ------------------------------------------------------------------ drawing
let CD = CAMD;   // camera distance behind you (eased)
function render() {
  const k = K, ca = Math.cos(k.a), sa = Math.sin(k.a);
  const over = Math.max(0, Math.min(1, (k.v - VMAX) / 110));
  CD += (CAMD * (1 + .28 * over + .22 * (k.kick || 0)) - CD) * .1;
  // boosts widen the view a little (the camera "pulls back"), which makes the speed feel bigger
  k.fov = (k.fov || 0) + (((k.boost > 0 || k.hyper > 0 || k.rocket > 0) ? 1 : Math.max(0, Math.min(.45, (k.v - 200) / 160))) - (k.fov || 0)) * .12;   // the view widens with speed (a lot more on a boost)
  const FO = FOCAL * (1 - .19 * k.fov);
  const cx = k.x - ca * CD, cy = k.y - sa * CD;
  const now3 = performance.now(), dt3 = Math.min(.05, (now3 - (r3t || now3)) / 1000); r3t = now3;
  if (G3) {   // 🎮 real 3D: three.js draws the ground, hills, sky, karts and scenery; this canvas only gets the effects and the HUD on top
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fxc.width, fxc.height); ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = true;
    const gc = gridSpot(3), gi = (gc.i + N) % N, intro = state === "wait" ? 0 : state === "count" ? Math.max(0, Math.min(1, 1 - (countAt + 2100 - now3) / 3200)) : 1;
    G3.sync(trackData()); G3.begin(k, { W, H, dt: dt3, fov: k.fov, roll: state === "race" ? -((k.drift || 0) * .045 + (k.steer || 0) * .015) : 0, shake: k.shake, snap: state === "wait", intro, grid: [...at(gi, 0), tangent(gi)] });
  }
  const CH = CAMH + Math.min(k.z, 130) * .35;
  if (!G3) {
  // sky: Henesys hills and clouds, then the town panorama on the horizon, scrolling as you turn (sharp layer)
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fxc.width, fxc.height); ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = T.theme.sky || "#8fd0ff"; ctx.fillRect(0, 0, W, HOR + 1);
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
  skyFireworks();
  // floor, one row at a time (the camera rises a little when you jump, so big jumps feel like flying)
  const fk = FW / W, LV = MECH === "lava" && LAVA && PIDX ? Math.floor(LAVA.i) + 1 : 0, lvs = Math.floor(performance.now() / 70), f0 = performance.now();
  for (let y = 0; y < FH; y++) {
    const yl = (y + .5) / fk, z = CH * FO / (yl + .5), half = z * (W / 2) / FO;
    const ts = TW / WORLD; let wx = (cx + ca * z + sa * half) * ts, wy = (cy + sa * z - ca * half) * ts;   // left end of the row (in texture pixels)
    const stx = -sa * 2 * half / FW * ts, sty = ca * 2 * half / FW * ts, f = FOG[y], nf = 256 - f;
    const hr = HAZE[0] * f, hg = HAZE[1] * f, hb = HAZE[2] * f;
    let o = y * FW;
    if (LV > 0) for (let x = 0; x < FW; x++, wx += stx, wy += sty, o++) {   // 🔥 the Zakum runs: everything behind the lava front is lava
      const ix = wx | 0, iy = wy | 0, inside = ix >= 0 && iy >= 0 && ix < TW && iy < TW;
      let c = inside ? TEX[iy * TW + ix] : OUT;
      if (inside) { const pi = PIDX[iy * TW + ix]; if (pi && pi < LV) c = pi > LV - 7 ? 0xff7ee8ff : LAVAT[((iy + lvs) & 63) * 64 + ((ix + (lvs >> 1)) & 63)]; }
      if (f) c = 0xff000000 | ((((c >>> 16) & 255) * nf + hb) >> 8) << 16 | ((((c >>> 8) & 255) * nf + hg) >> 8) << 8 | (((c & 255) * nf + hr) >> 8);
      F32[o] = c >>> 0;
    }
    else if (stx * stx + sty * sty < .36) for (let x = 0; x < FW; x++, wx += stx, wy += sty, o++) {   // close up: blend the 4 nearest texture pixels (smooth, not blocky)
      const fx = wx - .5, fy = wy - .5, ix = Math.floor(fx), iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= TW - 1 || iy >= TW - 1) { F32[o] = OUT; continue; }
      const ax = fx - ix, ay = fy - iy, p = iy * TW + ix, c00 = TEX[p], c10 = TEX[p + 1], c01 = TEX[p + TW], c11 = TEX[p + TW + 1];
      const w00 = (1 - ax) * (1 - ay) * 256 | 0, w10 = ax * (1 - ay) * 256 | 0, w01 = (1 - ax) * ay * 256 | 0, w11 = 256 - w00 - w10 - w01;
      const r = ((c00 & 255) * w00 + (c10 & 255) * w10 + (c01 & 255) * w01 + (c11 & 255) * w11) >> 8,
        g = (((c00 >>> 8) & 255) * w00 + ((c10 >>> 8) & 255) * w10 + ((c01 >>> 8) & 255) * w01 + ((c11 >>> 8) & 255) * w11) >> 8,
        b = (((c00 >>> 16) & 255) * w00 + ((c10 >>> 16) & 255) * w10 + ((c01 >>> 16) & 255) * w01 + ((c11 >>> 16) & 255) * w11) >> 8;
      const dt2 = DETAIL[(((fy * 3) | 0) & 63) * 64 + (((fx * 3) | 0) & 63)];
      F32[o] = (0xff000000 | ((b * dt2) >> 8) << 16 | ((g * dt2) >> 8) << 8 | ((r * dt2) >> 8)) >>> 0;
    }
    else for (let x = 0; x < FW; x++, wx += stx, wy += sty, o++) {
      const ix = wx | 0, iy = wy | 0;
      let c = (ix >= 0 && iy >= 0 && ix < TW && iy < TW) ? TEX[iy * TW + ix] : OUT;
      if (f) c = 0xff000000 | ((((c >>> 16) & 255) * nf + hb) >> 8) << 16 | ((((c >>> 8) & 255) * nf + hg) >> 8) << 8 | (((c & 255) * nf + hr) >> 8);
      F32[o] = c >>> 0;
    }
  }
  bctx.putImageData(floor, 0, Math.round(HOR * fk));
  floorMs += (performance.now() - f0 - floorMs) * .05;   // too slow for this device? draw the floor less sharp
  if (floorMs > 11 && fk > 1 && state === "race") { QMAX = fk - 1; floorMs = 6; fit(); }
  }
  if (T.theme.night && !G3) { ctx.fillStyle = `rgba(8,10,40,${T.theme.night})`; ctx.fillRect(0, 0, W, H); }
  // billboards, far to near: scenery, mesos, pigs and the King Slime (with a shadow when it's up in the air)
  const tt = performance.now() / 1000, vis = [];
  const add = G3 ? (x, y, im, sc, z, flip) => G3.spr(im, x, y, z, sc, flip) : (x, y, im, sc, z, flip, shadow) => {
    const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa;
    if (fz < 8 || fz > 1400 || !im) return;
    const sx = W / 2 + (-rx * sa + ry * ca) * FO / fz;
    if (sx < -120 || sx > W + 120) return;
    vis.push({ im, fz, sx, sc, z, flip, shadow, px: im.px });
  };
  const addDraw = G3 ? (x, y, draw, lift = 0) => { const p = G3.proj(x, y, 0, lift); if (!p || p.d > 1500 || p.sx < -80 || p.sx > W + 80 || G3.hidden(x, y, 4 + lift)) return; vis.push({ fz: p.d, sx: p.sx, gy: p.sy, sc: p.sc, draw }); } : (x, y, draw) => {
    const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa;
    if (fz < 6 || fz > 1300) return;
    const sx = W / 2 + (-rx * sa + ry * ca) * FO / fz;
    if (sx < -80 || sx > W + 80) return;
    vis.push({ fz, sx, draw });
  };
  if (G3) {   // 3D karts (with a name tag, stars and ink drawn on top), 3D item boxes
    for (const r of RIV) if (!r.gone) { G3.kart(r, { color: r.color, img: r.img, dt: dt3, boo: r.boo > 0 }); addDraw(r.x, r.y, (sx, gy, sc, fz) => rivalTag(r, sx, gy, sc, fz), G3.liftOf(r)); }
    if (mode !== "tt") BOXES.forEach((b, i) => { if (b.t <= 0) G3.box(b.x, b.y, tt, i, b.z || 0); });
    if (mode === "tt" && state !== "menu") for (const [g, gd, col, img, skip] of [[GH3.top, topGhost && topGhost.data, "#e8b43a", topGhost && topGhost.img], [GH3.me, ghost, "#c8232c", IMG.me, topGhost && topGhost.name === me]]) {
      const gs = gd && !skip ? ghostAt(K.t, gd) : null; if (gs) { Object.assign(g, { x: gs.x, y: gs.y, a: gs.a, z: gs.z, v: 200 }); G3.kart(g, { color: col, img, ghost: true, dt: dt3 }); } }
    if (!k.watch) G3.kart(k, { color: "#c8232c", family: true, img: IMG.me, dt: dt3, me: true, boo: k.boo > 0 });
  }
  else {
  for (const r of RIV) if (!r.gone) addDraw(r.x, r.y, (sx, gy, sc, fz) => drawRival(r, sx, gy, sc, fz));
  if (mode !== "tt") for (const b of BOXES) if (b.t <= 0) addDraw(b.x, b.y, (sx, gy, sc) => drawBox(sx, gy, sc, tt));
  if (mode === "tt" && topGhost && state !== "menu") {   // 🏆 the guild's #1, see-through and gold
    const gs = ghostAt(K.t, topGhost.data);
    if (gs) addDraw(gs.x, gs.y, (sx, gy, sc, fz) => drawRival({ name: `🏆 ${topGhost.name}`, img: topGhost.img, color: "#e8b43a", steer: 0, z: gs.z, spin: 0, squash: 0, inv: 0, ghost: true }, sx, gy, sc, fz));
  }
  if (mode === "tt" && ghost && state !== "menu" && !(topGhost && topGhost.name === me)) {   // 👻 your best run, see-through
    const gs = ghostAt(K.t); if (gs) addDraw(gs.x, gs.y, (sx, gy, sc, fz) => drawRival({ name: "👻 Your best", img: IMG.me, color: "#c8232c", steer: 0, z: gs.z, spin: 0, squash: 0, inv: 0, ghost: true }, sx, gy, sc, fz));
  }
  }
  for (const d of DROPS) add(d.x, d.y, IMG.slime, .32, 0, false, .5);
  for (const f of FIRE) addDraw(f.x, f.y, (sx, gy, sc) => { const a = f.t / .4, h = 5.5 * sc * (.5 + a * .7) * (.85 + Math.random() * .3), w2 = 2.2 * sc;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * .75;
    const g3 = ctx.createLinearGradient(0, gy - h, 0, gy); g3.addColorStop(0, "rgba(255,80,20,0)"); g3.addColorStop(.5, "#ff7a1e"); g3.addColorStop(1, "#ffe08a");
    ctx.fillStyle = g3; ctx.beginPath(); ctx.ellipse(sx, gy - h / 2, w2, h / 2, 0, 0, 7); ctx.fill(); ctx.restore(); });
  const proj = G3 ? (x, y) => { const p = G3.proj(x, y); return p ? [p.sx, p.sy, p.sc] : null; } : (x, y) => { const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa; return fz < 4 ? null : [W / 2 + (-rx * sa + ry * ca) * FO / fz, HOR + CH * FO / fz, FO / fz]; };
  // 🏹 a real MapleStory arrow in flight, pointing where it's going, with a glowing streak behind it
  for (const sh of SHOTS) if (sh.k && sh.k !== "a") addDraw(sh.x, sh.y, (sx, gy, sc) => {   // 🐌🔴 snail shells sliding along, 🔥 fire stars, 🌀 the Ilbi star spinning
    const im = { g: IMG.it_gshell, r: IMG.it_rshell, f: IMG.it_fire, b: IMG.it_boom }[sh.k], w = (sh.k === "f" ? 13 : sh.k === "b" ? 17 : 15) * sc, y = gy - (sh.k === "b" ? 12 : 5) * sc - w / 2;
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(sx, gy, w * .45, w * .14, 0, 0, 7); ctx.fill();
    const glow = { g: "120,230,120", r: "255,90,80", f: "255,150,40", b: "255,240,160" }[sh.k];
    ctx.globalCompositeOperation = "lighter"; const gr = ctx.createRadialGradient(sx, y, 0, sx, y, w); gr.addColorStop(0, `rgba(${glow},.65)`); gr.addColorStop(1, `rgba(${glow},0)`); ctx.fillStyle = gr; ctx.fillRect(sx - w, y - w, w * 2, w * 2);
    ctx.globalCompositeOperation = "source-over"; ctx.imageSmoothingEnabled = false;
    if (im) { ctx.translate(sx, y); if (sh.k === "f" || sh.k === "b") ctx.rotate(tt * 18); ctx.drawImage(im, -w / 2, -w / 2, w, w * im.height / im.width); }
    ctx.restore(); });
  for (const sh of SHOTS) if (!sh.k || sh.k === "a") addDraw(sh.x, sh.y, (sx, gy, sc) => {
    const im = IMG.arrowShot, tail = proj(sh.x - Math.cos(sh.a) * 46, sh.y - Math.sin(sh.a) * 46), head = proj(sh.x + Math.cos(sh.a) * 10, sh.y + Math.sin(sh.a) * 10), y = gy - 11 * sc;
    const ang = head ? Math.atan2((head[1] - 11 * head[2]) - y, head[0] - sx) : 0;
    if (tail) { const ty = tail[1] - 11 * tail[2], g = ctx.createLinearGradient(tail[0], ty, sx, y); g.addColorStop(0, "rgba(255,240,160,0)"); g.addColorStop(1, "rgba(255,250,210,.85)");
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, 3 * sc); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(tail[0], ty); ctx.lineTo(sx, y); ctx.stroke(); ctx.restore(); }
    if (!im) return; const w = Math.max(6, 34 * sc), h = w * im.height / im.width * 1.6;
    ctx.save(); ctx.translate(sx, y); ctx.rotate(ang); ctx.imageSmoothingEnabled = false; ctx.shadowColor = "rgba(255,230,120,.9)"; ctx.shadowBlur = 6; ctx.drawImage(im, -w * .8, -h / 2, w, h); ctx.restore(); });
  // 🔥 lava pools bubble and glow
  for (const p of PADS) if (p.t === "lava") { const [lx, ly] = at(p.i + p.len / 2, p.o); addDraw(lx, ly, (sx, gy, sc) => {
    const rx = (p.w / 2 + 4) * sc, pulse = .55 + .25 * Math.sin(tt * 3 + p.i);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(sx, gy, 0, sx, gy, rx * 1.4); g.addColorStop(0, `rgba(255,170,40,${pulse})`); g.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, gy, rx * 1.4, rx * .45, 0, 0, 7); ctx.fill();
    for (let b = 0; b < 4; b++) { const ph = (tt * .9 + b * .27 + p.i * .1) % 1, bx = sx + Math.sin(b * 2.3 + p.i) * rx * .6, by = gy - ph * 10 * sc; ctx.globalAlpha = 1 - ph; ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.arc(bx, by, Math.max(.6, (1.2 + ph * 2) * sc), 0, 7); ctx.fill(); }
    ctx.restore(); }); }
  // ❄️ frost turrets (an ice crystal that glints before it fires) and their ice arrows
  for (const L of HAZ.lanes) { const [lx, ly] = lanePos(L, L.side); addDraw(lx, ly, (sx, gy, sc) => {
    const h = 26 * sc, w = 11 * sc; ctx.save(); ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(sx, gy, w * .9, w * .25, 0, 0, 7); ctx.fill();
    const g = ctx.createLinearGradient(sx - w, 0, sx + w, 0); g.addColorStop(0, "#9ad4ff"); g.addColorStop(.5, "#ffffff"); g.addColorStop(1, "#5aa8e8");
    ctx.fillStyle = g; ctx.strokeStyle = "#2e6fb0"; ctx.lineWidth = Math.max(.6, sc * .8); ctx.beginPath(); ctx.moveTo(sx, gy - h); ctx.lineTo(sx + w, gy - h * .45); ctx.lineTo(sx + w * .5, gy); ctx.lineTo(sx - w * .5, gy); ctx.lineTo(sx - w, gy - h * .45); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (L.warn > 0) { ctx.globalCompositeOperation = "lighter"; const gr = ctx.createRadialGradient(sx, gy - h * .6, 0, sx, gy - h * .6, w * 2.4); gr.addColorStop(0, `rgba(200,240,255,${L.warn})`); gr.addColorStop(1, "rgba(120,200,255,0)");
      ctx.fillStyle = gr; ctx.fillRect(sx - w * 2.4, gy - h * .6 - w * 2.4, w * 4.8, w * 4.8); }
    ctx.restore(); }); }
  for (const a of HAZ.ice) addDraw(a.x, a.y, (sx, gy, sc) => {
    const im = IMG.iceArrow, head = proj(a.x + Math.cos(a.a) * 12, a.y + Math.sin(a.a) * 12), tail = proj(a.x - Math.cos(a.a) * 50, a.y - Math.sin(a.a) * 50), y = gy - 12 * sc;
    const ang = head ? Math.atan2((head[1] - 12 * head[2]) - y, head[0] - sx) : 0;
    if (tail) { const ty = tail[1] - 12 * tail[2], g = ctx.createLinearGradient(tail[0], ty, sx, y); g.addColorStop(0, "rgba(140,210,255,0)"); g.addColorStop(1, "rgba(220,245,255,.9)");
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, 3.5 * sc); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(tail[0], ty); ctx.lineTo(sx, y); ctx.stroke(); ctx.restore(); }
    if (!im) return; const w = Math.max(6, 36 * sc), h = w * im.height / im.width * 1.8;
    ctx.save(); ctx.translate(sx, y); ctx.rotate(ang); ctx.imageSmoothingEnabled = false; ctx.shadowColor = "rgba(150,220,255,1)"; ctx.shadowBlur = 8; ctx.drawImage(im, -w * .8, -h / 2, w, h); ctx.restore(); });
  // 🪨 boulders rolling down at you
  for (const b of HAZ.rocks) addDraw(b.x, b.y, (sx, gy, sc) => {
    const R = b.R * sc, y = gy - R - Math.abs(Math.sin(b.roll * .5)) * 3 * sc;
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(sx, gy, R * 1.05, R * .28, 0, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(sx - R * .35, y - R * .4, R * .1, sx, y, R * 1.05); g.addColorStop(0, "#9a8c80"); g.addColorStop(.6, "#5e5048"); g.addColorStop(1, "#2a201c");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, y, R, 0, 7); ctx.fill();
    ctx.translate(sx, y); ctx.rotate(-b.roll); ctx.strokeStyle = "rgba(30,20,16,.75)"; ctx.lineWidth = Math.max(.8, R * .09);
    ctx.beginPath(); ctx.moveTo(-R * .6, -R * .2); ctx.lineTo(-R * .1, R * .1); ctx.lineTo(R * .5, -R * .3); ctx.moveTo(-R * .1, R * .1); ctx.lineTo(R * .1, R * .7); ctx.moveTo(R * .2, -R * .75); ctx.lineTo(R * .35, -R * .35); ctx.stroke();
    ctx.restore(); });
  // 💣 Pirate Bombs: the spinning skull bomb up in the air with its shadow on the road and a fizzing fuse
  for (const b of BOMBS) addDraw(b.x, b.y, (sx, gy, sc) => {
    const F = IMG.bombF; if (!F) return; const im = F[Math.floor(tt * 18) % 8], w = 20 * sc, y = gy - b.z * sc - w * .55;
    ctx.fillStyle = `rgba(0,0,0,${.35 - Math.min(.2, b.z / 600)})`; ctx.beginPath(); ctx.ellipse(sx, gy, w * .45, w * .14, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, sx - w / 2, y - w / 2, w, w); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = "lighter"; for (let n = 0; n < 3; n++) { ctx.fillStyle = ["#fff6c0", "#ffb02e", "#ff5a1e"][n]; ctx.beginPath(); ctx.arc(sx + w * .3 + (Math.random() - .5) * w * .25, y - w * .45 + (Math.random() - .5) * w * .25, Math.max(.6, w * (.09 - n * .02)), 0, 7); ctx.fill(); } ctx.restore(); });
  // 💥 explosions: a flash, a ring racing across the road, the MapleStory Grenade blast (fire, then smoke) and flying debris
  for (const e of BOOMS) addDraw(e.x, e.y, (sx, gy, sc) => {
    const t = e.t, R = BOMB_R * sc, F = IMG.boomF;
    if (t < .5) { ctx.save(); ctx.globalAlpha = (1 - t / .5) * .9; ctx.strokeStyle = "#fff4c8"; ctx.lineWidth = Math.max(1, 5 * sc * (1 - t / .5)); const rr2 = R * (.25 + 1.15 * t / .5);
      ctx.beginPath(); ctx.ellipse(sx, gy, rr2, rr2 * .28, 0, 0, 7); ctx.stroke(); ctx.restore(); }
    if (t < .7) { ctx.save(); ctx.globalAlpha = .55 * (1 - t / .7); ctx.fillStyle = "#3a2010"; ctx.beginPath(); ctx.ellipse(sx, gy, R * .7, R * .2, 0, 0, 7); ctx.fill(); ctx.restore(); }   // scorch
    if (t < .18) { ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(sx, gy - R * .3, 0, sx, gy - R * .3, R * 1.4);
      g.addColorStop(0, `rgba(255,250,220,${1 - t / .18})`); g.addColorStop(.4, `rgba(255,170,60,${.7 * (1 - t / .18)})`); g.addColorStop(1, "rgba(255,90,20,0)"); ctx.fillStyle = g; ctx.fillRect(sx - R * 1.4, gy - R * 1.7, R * 2.8, R * 2.8); ctx.restore(); }
    if (F) { const fr = Math.min(6, Math.floor(t * 13)), im = F[fr], w = R * 2.3 * im.width / 94, h = w * im.height / im.width;
      ctx.save(); ctx.globalAlpha = fr === 6 ? Math.max(0, 1 - (t - 6 / 13) / 1.1) : 1; ctx.imageSmoothingEnabled = false; ctx.drawImage(im, sx - w / 2, gy - h * .8 - R * .1, w, h); ctx.restore(); }
    for (const d of e.debris) { const z = d.vz * t - 360 * t * t; if (z < 0 && t > .2) continue; const dx = Math.cos(d.a) * d.v * t * sc, dz = Math.max(0, z) * sc;
      ctx.fillStyle = d.c; ctx.fillRect(sx + dx - d.s * sc / 2, gy - dz - d.s * sc / 2 + Math.sin(d.a) * d.v * t * sc * .25, d.s * sc, d.s * sc); } });
  for (const b of BSHELLS) if (b.x != null) addDraw(b.x, b.y, (sx, gy, sc) => {   // 💙 high over the track, a blue glow and its shadow
    const im = IMG.it_bshell, w = 22 * sc, y = gy - b.z * sc - w / 2; ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(sx, gy, w * .5, w * .15, 0, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = "lighter"; const gr = ctx.createRadialGradient(sx, y, 0, sx, y, w * 1.4); gr.addColorStop(0, "rgba(90,170,255,.9)"); gr.addColorStop(1, "rgba(40,100,255,0)"); ctx.fillStyle = gr; ctx.fillRect(sx - w * 1.4, y - w * 1.4, w * 2.8, w * 2.8);
    ctx.globalCompositeOperation = "source-over"; ctx.imageSmoothingEnabled = false; if (im) { ctx.translate(sx, y); ctx.rotate(Math.sin(tt * 9) * .3); ctx.drawImage(im, -w / 2, -w / 2, w, w); } ctx.restore(); });
  for (const sp of SPORES) {   // ✨ spores drifting up out of the gorges: soft glowing puffs that rise, sway and fade
    const f = (tt * sp.sp + sp.ph) % 1, z = (sp.low ? 10 : 30) + f * (sp.low ? 170 : 320), fade = Math.min(1, f * 5, (1 - f) * 4), wob = Math.sin(tt * .9 + sp.sw) * 18;
    addDraw(sp.x + wob, sp.y + Math.cos(tt * .7 + sp.sw) * 12, (sx, gy0, sc) => { const r = Math.max(2, 10 * sc * sp.s), gy = G3 ? gy0 : gy0 - z * sc;
      ctx.save(); ctx.globalAlpha = fade * .9; ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(sx, gy, 0, sx, gy, r * 2.6); g.addColorStop(0, "rgba(255,250,215,.95)"); g.addColorStop(.35, "rgba(255,236,150,.55)"); g.addColorStop(1, "rgba(255,210,120,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, gy, r * 2.6, 0, 7); ctx.fill(); ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "rgba(255,255,240,.95)"; ctx.beginPath(); ctx.arc(sx, gy, r * .55, 0, 7); ctx.fill(); ctx.restore(); }, G3 ? z : 0);
  }
  for (const h of HORNS) addDraw(h.x, h.y, (sx, gy, sc) => {   // 📣 the shout: two rings racing out
    ctx.save(); for (const f of [1, .7]) { const t = Math.min(1, h.t / .6 * f + (1 - f) * .2), R = HORN_R * sc * t; ctx.globalAlpha = (1 - t) * .9; ctx.strokeStyle = f === 1 ? "#fff3a0" : "#ffb02e"; ctx.lineWidth = Math.max(1, 5 * sc * (1 - t));
      ctx.beginPath(); ctx.ellipse(sx, gy - 6 * sc, R, R * .3, 0, 0, 7); ctx.stroke(); } ctx.restore(); });
  for (const r of racers()) if (!r.gone && (r.rocket > 0 || r.piranha > 0)) addDraw(r.x, r.y, (sx, gy, sc) => {   // 🚀 the Rocket Booster on your back, 🌱 Nependeath on the front
    ctx.save(); ctx.imageSmoothingEnabled = false;
    if (r.rocket > 0 && IMG.it_rocket) { const im = IMG.it_rocket, w = 30 * sc, y = gy - (r.z || 0) * sc - 30 * sc;
      ctx.globalCompositeOperation = "lighter"; for (let n = 0; n < 3; n++) { ctx.fillStyle = ["#fff6c0", "#ffb02e", "#ff5a1e"][n]; ctx.beginPath(); ctx.arc(sx + (Math.random() - .5) * 4 * sc, y + w * .55 + n * 4 * sc, Math.max(1, (6 - n * 1.5) * sc), 0, 7); ctx.fill(); }
      ctx.globalCompositeOperation = "source-over"; ctx.drawImage(im, sx - w / 2, y - w / 2, w, w * im.height / im.width); }
    if (r.piranha > 0 && IMG.it_piranha) { const im = IMG.it_piranha, bite = r.bite > 0 ? 1 + r.bite * 1.6 : 1, h = 24 * sc * bite, w = h * im.width / im.height, fx = r.x + Math.cos(r.a) * 14, fy = r.y + Math.sin(r.a) * 14, p = G3 ? (q => q && [q.sx, q.sy, q.sc])(G3.proj(fx, fy, 0, G3.liftOf(r))) : proj(fx, fy);
      const px = p ? p[0] : sx, py = p ? p[1] : gy; ctx.drawImage(im, px - w / 2, py - (r.z || 0) * sc - h, w, h); }
    ctx.restore(); }, G3 ? G3.liftOf(r) : 0);
  for (const a of ARMS) addDraw(a.tgt.x, a.tgt.y, (sx, gy, sc) => { const im = IMG.arm; if (!im) return; const h = 70 * sc, w = h * im.width / im.height, drop = Math.max(0, a.t - .3) / 2.3;
    ctx.drawImage(im, sx - w / 2, gy - h - drop * 160 * sc, w, h); });
  for (const ob of OBJS) if (!(G3 && (ob.f3d || K3D.has(ob.k)))) add(ob.x, ob.y, IMG[ob.k], ob.s, ob.sz != null ? ob.sz : ob.bob ? (ob.z || 0) + (ob.mob ? Math.abs(Math.sin(tt * 2.6 + ob.x)) : Math.sin(tt * 2 + ob.x)) * ob.bob : ob.z || 0);   // monsters bounce, balloons sway
  if (G3) for (const c of CROWD) { if (!c.img) continue; const jz = Math.max(0, Math.sin(tt * c.sp + c.ph)) * c.jump; G3.spr(c.img, c.x, c.y, jz, c.s, c.flip);
    if (c.tag) addDraw(c.x, c.y, (sx, gy, sc) => { if (sc < .35) return; const top = gy - (c.img.height * c.s + jz) * sc, fs = Math.max(5, Math.min(10, 6 * sc)); ctx.font = `900 ${fs}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = Math.max(1.5, fs / 4);
      ctx.strokeStyle = "#5a0d10"; ctx.strokeText(c.tag, sx, top - 2); ctx.fillStyle = "#ffd75e"; ctx.fillText(c.tag, sx, top - 2); }); }
  else for (const c of CROWD) if (c.img) addDraw(c.x, c.y, (sx, gy, sc) => {   // cheering (jumping) fans; founders get a name tag with a crown
    const im = c.img, w = im.width * sc * c.s, h = im.height * sc * c.s, top = gy - h - Math.max(0, Math.sin(tt * c.sp + c.ph)) * c.jump * sc;
    if (w < .6) return;
    ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.beginPath(); ctx.ellipse(sx, gy, w * .35, h * .06 + .5, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.imageSmoothingEnabled = false; if (c.flip) { ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(im, -w / 2, top, w, h); } else ctx.drawImage(im, sx - w / 2, top, w, h); ctx.restore();
    if (c.tag && sc > .35) { const fs = Math.max(5, Math.min(10, 6 * sc)); ctx.font = `900 ${fs}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = Math.max(1.5, fs / 4);
      ctx.strokeStyle = "#5a0d10"; ctx.strokeText(c.tag, sx, top - 2); ctx.fillStyle = "#ffd75e"; ctx.fillText(c.tag, sx, top - 2); }
  });
  for (const p of PENPIGS) { const q = penPigPos(p, tt); add(q.x, q.y, IMG[p.k], .45, 0, q.dir > 0); }
  if (IMG.meso) for (const c of COINS) if (!c.got && (G3 ? (c.x - k.x) * ca + (c.y - k.y) * sa > -12 : (c.x - cx) * ca + (c.y - cy) * sa > CD * 1.05)) add(c.x, c.y, IMG.meso[Math.floor(tt * 8 + c.x * .05) % 4], .55, (c.z || 0) + 6 + Math.sin(tt * 4 + c.x) * 2);
  for (const p of PIGS) { if (p.lap && lapNow() < p.lap) continue; const q = pigPos(p, tt); if (G3 && G3.mdl && p.k === "freezie") G3.mdl("freezie", q.x, q.y, q.z, tangent(p.i) + Math.PI, tt); else add(q.x, q.y, IMG[p.k], p.s || .45, q.z, q.dir > 0, q.z > 2 ? .5 : 0); }
  for (const m of MOLES) { const q = molePos(m, tt), im = IMG[m.img || "stump"]; add(q.x, q.y, IMG.farm_mound, .42, 0); if (q.up > 0 && im) add(q.x, q.y, im, m.img ? .75 : .5, -34 * (1 - q.up)); }   // 🌳 mounds, and stumps (or bunnies) popping out
  // 🐾 pets wandering the gardens, and the giant pets on their chains (with the chain drawn from its post)
  for (const w of WANDER) { const q = wanderPos(w, tt), im = petFrame(w.k, "move", tt + w.ph); if (im) add(q.x, q.y, im, w.s, 0, q.dx > 0); }
  for (const b of HEDGES) if (b.sprite && IMG[b.sprite] && !(G3 && K3D.has(b.sprite))) add(b.x, b.y, IMG[b.sprite], b.h / IMG[b.sprite].height, 0);
  for (const c of CHOMPS) { const q = chompPos(c, tt), im = q.z > 4 ? (IMG[`pet_${c.k}_jump0`] || petFrame(c.k, "move", tt)) : petFrame(c.k, "move", tt); if (im) add(q.x, q.y, im, c.s, q.z, q.dx > 0);
    if (IMG.chain_post) add(c.ax, c.ay, IMG.chain_post, .5, 0);
    addDraw(c.ax, c.ay, (sx, gy, sc) => { const pp = G3 ? G3.proj(q.x, q.y, q.z + 14) : proj(q.x, q.y); if (!pp) return; const px = G3 ? pp.sx : pp[0], py = G3 ? pp.sy : pp[1] - (q.z + 14) * pp[2];
      ctx.save(); ctx.strokeStyle = "#5a5a64"; ctx.lineWidth = Math.max(1, 2 * sc); ctx.setLineDash([Math.max(2, 4 * sc), Math.max(1, 2 * sc)]); ctx.beginPath(); ctx.moveTo(sx, gy - 10 * sc); ctx.lineTo(px, py); ctx.stroke(); ctx.restore(); }); }
  if (KING) { const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0), kz = kingZ(kp); add(kx, ky, IMG[KING.k], KING.s, kz, false, kz > 0 ? 1 - kz / 170 : 0); }
  vis.sort((a, b) => b.fz - a.fz);
  if (G3) { G3.end(); skyFireworks(); }
  let kartDrawn = !!G3;
  const dk = darkness(); let darkDone = false;
  const lightsOut = () => { if (darkDone || dk <= 0) return; darkDone = true; ctx.globalAlpha = 1; ctx.fillStyle = `rgba(2,3,8,${dk * .97})`; ctx.fillRect(0, 0, W, H);
    const gl = ctx.createRadialGradient(W / 2, H * .78, 4, W / 2, H * .78, W * .28); gl.addColorStop(0, `rgba(255,230,160,${.12 * dk})`); gl.addColorStop(1, "rgba(255,230,160,0)"); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); };
  for (const v of vis) {
    if (!kartDrawn && v.fz < CD) { lightsOut(); ctx.globalAlpha = 1; drawKart(k); kartDrawn = true; }   // things between the camera and you go in front of your kart
    if (v.draw) { ctx.globalAlpha = 1; if (G3) v.draw(v.sx, v.gy, v.sc, v.fz); else v.draw(v.sx, HOR + CH * FO / v.fz, FO / v.fz, v.fz); continue; }
    const { im, fz, sx, z, flip, shadow } = v, sc = FO / fz * v.sc, w = im.width * sc, h = im.height * sc, gy = HOR + CH * FO / fz;
    if (w < .6) continue;
    ctx.globalAlpha = fz > 1000 ? Math.max(0, (1400 - fz) / 400) : 1; ctx.imageSmoothingEnabled = !v.px;
    if (h > H * .7) ctx.globalAlpha *= Math.max(.12, Math.min(1, (H * 1.25 - h) / (H * .55)));   // filling the screen: fade to see-through
    if (shadow) { ctx.fillStyle = `rgba(0,0,0,${.15 + shadow * .3})`; ctx.beginPath(); ctx.ellipse(sx, gy, w * .45 * (.4 + shadow * .6), h * .08 + 1, 0, 0, 7); ctx.fill(); }
    const top = gy - h - z * FO / fz;
    if (flip) { ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(im, -w / 2, top, w, h); ctx.restore(); }
    else ctx.drawImage(im, sx - w / 2, top, w, h);
  }
  ctx.globalAlpha = 1;
  if (G3) { if (dk > 0) lightsOut(); drawKart(k); }
  if (!kartDrawn) { lightsOut(); drawKart(k); }
  if (T.theme.snow) snowfall(T.theme.snow);
  if (HAZ.pap && IMG.papStand) drawPapulatus(k, tt);
  if (!T.theme.snow && !G3) petals(T.cup);   // petals in Henesys, fireflies in Sleepywood, embers at Zakum, confetti in Ludibrium (El Nath has its snow)
  if (LAVA && state !== "menu" && !k.done) { const near = Math.max(0, 1 - (k.idx - LAVA.i) * SPC / 640); if (near > 0) {   // the screen glows red as the lava closes in
    const gr = ctx.createRadialGradient(W / 2, H * .6, H * .2, W / 2, H * .6, W * .75); gr.addColorStop(0, "rgba(255,60,0,0)"); gr.addColorStop(1, `rgba(255,60,0,${near * .5})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); } }
  if (k.hitFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(.7, k.hitFlash * 8)})`; ctx.fillRect(0, 0, W, H); }
  if (T.water && PTS[k.idx] && PTS[k.idx][2] + 30 < T.water.level * WS) {   // 🫧 under the lake: deep blue all round, light from above, bubbles drifting up
    const g2 = ctx.createLinearGradient(0, 0, 0, H); g2.addColorStop(0, "rgba(60,140,200,.28)"); g2.addColorStop(1, "rgba(5,25,60,.45)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(220,240,255,.55)"; const tb = performance.now() / 1000; for (let n = 0; n < 14; n++) { const x = (n * 53 + Math.sin(tb + n) * 6) % W, y = H - ((tb * 40 + n * 37) % H); ctx.beginPath(); ctx.arc(x, y, 1 + (n % 3) * .6, 0, 7); ctx.fill(); } }
  for (const cv of CAVES) if (k.idx >= cv.a && k.idx <= cv.b) {   // ❄ inside the ice cave: a cold blue gloom round the edges
    const g2 = ctx.createRadialGradient(W / 2, HOR + 10, 10, W / 2, HOR + 10, W * .75);
    g2.addColorStop(0, "rgba(160,220,255,0)"); g2.addColorStop(1, "rgba(10,40,90,.5)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); }
  // inside the tree house tunnel: dark, with a warm glow ahead
  if (TUNNEL && k.idx >= TUNNEL.a && k.idx <= TUNNEL.b) {
    const g2 = ctx.createRadialGradient(W / 2, HOR + 10, 10, W / 2, HOR + 10, W * .7);
    g2.addColorStop(0, "rgba(255,200,120,.08)"); g2.addColorStop(1, "rgba(18,10,4,.72)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  }
  // ⚡ Thunder: a white flash and lightning bolts
  if (thunderFx > 0) {
    ctx.fillStyle = `rgba(255,255,240,${Math.max(0, thunderFx) * 1.6})`; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(200,170,255,.95)"; ctx.lineWidth = 2.5;
    for (let b = 0; b < 3; b++) { let x = W * (.2 + .3 * b) + (Math.random() - .5) * 30, y = 0; ctx.beginPath(); ctx.moveTo(x, y);
      while (y < HOR + 30) { x += (Math.random() - .5) * 26; y += 10 + Math.random() * 10; ctx.lineTo(x, y); } ctx.stroke(); }
  }
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
  // minimap (Sleepywood has none: remember the road)
  if (mini && MECH !== "dark") {
    ctx.imageSmoothingEnabled = true;
    const side = TOUCH, mx = side ? 4 : W - 54, my = Math.round(H * (side ? .34 : .3)), s = 50 / 128;   // phones: left side, clear of the buttons
    ctx.globalAlpha = .85; ctx.drawImage(mini, mx, my, 50, 50); ctx.globalAlpha = 1;
    for (const sh of SHOTS) { ctx.fillStyle = sh.tgt === k ? "#ff2a2a" : "#ffe08a"; ctx.beginPath(); ctx.arc(mx + sh.x * 128 / WORLD * s, my + sh.y * 128 / WORLD * s, 2, 0, 7); ctx.fill(); }
    for (const r of RIV) { ctx.fillStyle = r.color; ctx.fillRect(mx + r.x * 128 / WORLD * s - 1.5, my + r.y * 128 / WORLD * s - 1.5, 3, 3); }
    ctx.fillStyle = "#fff"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 3, my + k.y * 128 / WORLD * s - 3, 6, 6);
    ctx.fillStyle = "#c8232c"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 2, my + k.y * 128 / WORLD * s - 2, 4, 4);
  }
}
// Sleepywood: the lights go out for 3 seconds every 15 seconds (fading in and out a little)
function darkness() {
  if (MECH !== "dark" || !K || state !== "race") return 0;
  const t = K.t / 1000; if (t < 15) return 0;
  const p = t % 15; return p < 3 ? Math.min(1, p / .25, (3 - p) / .4) : 0;
}
// 🧸 Papulatus hovering over the clocktower: idle, then charging (his own skill animation), then the shock (bolts down to the road)
function drawPapulatus(k, tt) {
  const P = HAZ.pap, charging = P.charge > 0, shocking = P.fx > 0, F = charging ? IMG.papSkill.slice(0, 7) : shocking ? IMG.papSkill.slice(7) : IMG.papStand;
  const im = F[Math.floor(tt * (charging ? 12 : shocking ? 10 : 6)) % F.length]; if (!im) return;
  const h = Math.min(H * .42, HOR * 1.5) * (1 + P.charge * .25), w = h * im.width / im.height, x = W * .74 + Math.sin(tt * .7) * W * .05, y = HOR * .1 + Math.sin(tt * 1.3) * 3;
  if (charging) { ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(x, y + h * .5, 0, x, y + h * .5, h * (.6 + P.charge * .5)); g.addColorStop(0, `rgba(170,220,255,${.5 * P.charge})`); g.addColorStop(1, "rgba(90,140,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - h, y - h * .2, h * 2, h * 1.6); ctx.restore(); }
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(im, x - w / 2, y, w, h); ctx.restore();
  if (shocking) {   // the shock: blue-white flash and bolts from him down onto the track
    ctx.fillStyle = `rgba(180,220,255,${P.fx * .5})`; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(220,240,255,.95)"; ctx.lineWidth = 2; ctx.shadowColor = "#7ab8ff"; ctx.shadowBlur = 8;
    for (let b = 0; b < 4; b++) { let bx = x + (Math.random() - .5) * w * .3, by = y + h * .6; ctx.beginPath(); ctx.moveTo(bx, by); const tx = W * (.15 + b * .23), ty = H * (.6 + Math.random() * .3);
      while (by < ty) { bx += (tx - bx) * .25 + (Math.random() - .5) * 16; by += 8 + Math.random() * 10; ctx.lineTo(bx, by); } ctx.stroke(); }
    ctx.shadowBlur = 0;
  }
}
// 🌸 Henesys: petals and leaves drifting past the camera
let PETALS = [];
const PART = {
  henesys: { cols: ["#ffc8de", "#ffffff", "#ff9fc4", "#ffe08a", "#8fd46a"], up: false, glow: false, shape: "petal" },
  sleepy: { cols: ["#d8ff7a", "#fff3a0", "#9fffd0"], up: false, glow: true, shape: "dot", slow: true, max: 12, small: true },
  zakum: { cols: ["#ff7a1e", "#ffb02e", "#ff4a1a", "#ffe08a"], up: true, glow: true, shape: "dot" },
  ludi: { cols: ["#ff5a8a", "#ffd23f", "#5ac8ff", "#8aff7a", "#c87aff"], up: false, glow: false, shape: "square" },
};
function petals(cup) {
  const P = PART[cup] || PART.henesys, t = performance.now() / 1000, sw = (K ? K.steer : 0) * 26 + (K ? K.v : 0) * .02;
  if (PETALS.length < (P.max || 26) && Math.random() < .3) PETALS.push({ x: Math.random() * W * 1.4 - W * .2, y: P.up ? H + 6 : -6, v: (P.slow ? 4 : 10) + Math.random() * (P.slow ? 6 : 16), r: Math.random() * 6, vr: (Math.random() - .5) * 4,
    ph: Math.random() * 6, s: 1.2 + Math.random() * 1.8, c: P.cols[Math.floor(Math.random() * P.cols.length)] });
  if (P.glow) { ctx.save(); ctx.globalCompositeOperation = "lighter"; }
  for (let i = PETALS.length - 1; i >= 0; i--) { const p = PETALS[i]; p.y += (P.up ? -p.v : p.v) / 60; p.x += (Math.sin(t * 1.3 + p.ph) * 9 - sw) / 60; p.r += p.vr / 60;
    if (p.y > H + 8 || p.y < -8 || p.x < -W * .3 || p.x > W * 1.3) { PETALS.splice(i, 1); continue; }
    ctx.fillStyle = p.c;
    if (P.shape === "dot") { ctx.globalAlpha = .55 + .45 * Math.sin(t * 5 + p.ph); ctx.beginPath(); ctx.arc(p.x, p.y, p.s * .7, 0, 7); ctx.fill(); ctx.globalAlpha *= .35; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (P.small ? 1.3 : 2), 0, 7); ctx.fill(); continue; }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.abs(Math.cos(t * 2 + p.ph)) * .8 + .2); ctx.globalAlpha = .9;
    if (P.shape === "square") ctx.fillRect(-p.s, -p.s * .6, p.s * 2, p.s * 1.2); else { ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * .6, 0, 0, 7); ctx.fill(); }
    ctx.restore(); }
  if (P.glow) ctx.restore();
  ctx.globalAlpha = 1;
}
// 🎆 fireworks over the horizon (final lap, finish line)
let FWK = [], fwkT = 0;
function fireworks(n) { for (let b = 0; b < n; b++) setTimeout(() => {
  const x = W * (.12 + Math.random() * .76), y = HOR * (.2 + Math.random() * .5), hue = Math.random() * 360;
  for (let i = 0; i < 34; i++) { const a = i / 34 * Math.PI * 2, sp = 26 + Math.random() * 22; FWK.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 1.3, c: `hsl(${hue + Math.random() * 40},100%,${60 + Math.random() * 20}%)` }); }
  if (state !== "menu") tone(140 + Math.random() * 60, .25, "sawtooth", .03, 60);
}, b * 380); }
function skyFireworks() {
  const now = performance.now() / 1000, dt = Math.min(.05, now - (fwkT || now)); fwkT = now; if (!FWK.length) return;
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.beginPath(); ctx.rect(0, 0, W, HOR + 2); ctx.clip();
  for (let i = FWK.length - 1; i >= 0; i--) { const p = FWK[i]; p.t -= dt; if (p.t <= 0) { FWK.splice(i, 1); continue; }
    p.vy += 22 * dt; p.vx *= .985; p.x += p.vx * dt; p.y += p.vy * dt; ctx.globalAlpha = Math.min(1, p.t); ctx.fillStyle = p.c; ctx.fillRect(p.x - .8, p.y - .8, 1.6, 1.6); }
  ctx.restore(); ctx.globalAlpha = 1;
}
const cheerSound = () => { noiseHit(1800, .9, .05, .6, 900); [784, 988, 1175].forEach((f, i) => setTimeout(() => tone(f, .12, "triangle", .05), 120 + i * 90)); };
// El Nath: snow falling past the camera
let FLAKES = [];
function snowfall(n) {
  if (FLAKES.length < 70 * n) for (let i = 0; i < 4; i++) FLAKES.push({ x: Math.random() * W * 1.4 - W * .2, y: -5, v: 14 + Math.random() * 26, s: .6 + Math.random() * 1.4, ph: Math.random() * 6 });
  const t = performance.now() / 1000, sw = (K ? K.steer : 0) * 18;
  ctx.fillStyle = "rgba(255,255,255,.85)";
  for (let i = FLAKES.length - 1; i >= 0; i--) { const f = FLAKES[i]; f.y += f.v / 60; f.x += (Math.sin(t + f.ph) * 6 - sw) / 60;
    if (f.y > H) { FLAKES.splice(i, 1); continue; } ctx.fillRect(f.x, f.y, f.s, f.s); }
}
function drawKart(k) { ctx.save(); if (k.boo > 0) ctx.globalAlpha = .35; drawKart0(k); ctx.restore(); }   // 👻 see-through while Jr. Wraith hides you
function drawKart0(k) {
  if (k.watch) return;   // watching: there's no kart of yours
  const CH = CAMH + Math.min(k.z, 130) * .35, kl = G3 ? G3.liftOf(k) : 0, p3 = G3 && G3.proj(k.x, k.y, 0, kl), p3z = G3 && G3.proj(k.x, k.y, Math.max(0, k.z) + 6, kl);
  if (G3 && !(p3 && p3z)) return;
  const gy = G3 ? p3.sy : HOR + CH * FOCAL / CD, gy0 = G3 ? p3z.sy + Math.min(k.z * p3.sc * .45, H * .2) : HOR + CAMH * FOCAL / CD, sc = G3 ? p3.sc : FOCAL / CD, x = G3 ? p3.sx : W / 2 + k.steer * 4;
  const hop = k.hop > 0 ? Math.sin((k.hop / .18) * Math.PI) * 6 : 0, rumble = k.off && k.v > 40 ? (Math.random() - .5) * 2 : 0;
  const jitter = k.v > 150 && k.z <= 0 ? (Math.random() - .5) * 1.3 * k.v / VMAX : 0;
  const y = gy0 - hop + rumble + jitter - Math.min(k.z * sc * .45, H * .2), tilt = (k.drift ? k.drift * .16 : 0) + k.steer * .06 + (k.flip > 0 ? (1 - k.flip / .4) * Math.PI * 2 : 0);
  const w = 20 * sc, t = performance.now() / 1000;
  if (!G3) { ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(x, gy + 2, w * .55 / (1 + k.z / 80), 4, 0, 0, 7); ctx.fill(); }
  if (!G3) cv.style.transform = fxc.style.transform = k.shake > 0 ? `translate(${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px, ${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px)` : "";
  // effects: spawn (about 60 a second), move and draw the screen-space particles
  const now = performance.now() / 1000, fdt = Math.min(.05, now - (fxClock || now)); fxClock = now;
  if ((fxSpawn -= fdt) <= 0) {
    fxSpawn = .02;
    if (k.drift && k.charge > .2) for (const side of [-1, 1]) for (let n = 0; n < 2; n++)   // drift sparks from the rear wheels
      PFX.push({ x: x + side * w * .42, y: y - 2, vx: side * (30 + Math.random() * 70) - k.drift * 20, vy: 20 + Math.random() * 70, t: .15, life: .15, size: 1.4 + Math.random() * 1.4, col: sparkCol(k.charge, now), kind: "spark" });
    const boosting = k.boost > 0 || k.hyper > 0 || k.rocket > 0, nStreak = state !== "race" ? 0 : boosting ? 3 : k.v > VMAX * .95 && Math.random() < .35 ? 1 : 0;
    for (let n = 0; n < nStreak; n++) {   // speed streaks rushing past (a few at top speed, a storm on a boost)
      const ang = Math.random() * Math.PI * 2, r0 = W * (boosting ? .22 + Math.random() * .25 : .34 + Math.random() * .2), cxs = W / 2, cys = HOR + (H - HOR) * .32;
      PFX.push({ x: cxs + Math.cos(ang) * r0, y: cys + Math.sin(ang) * r0 * .55, vx: Math.cos(ang) * 420, vy: Math.sin(ang) * 230, t: .14, life: .14, size: 1, col: "#ffffff", kind: "streak" });
    }
    if (k.off && k.v > 60 && k.z <= 0) { const side = Math.random() < .5 ? -1 : 1;   // dust off the road
      PFX.push({ x: x + side * w * .4 + (Math.random() - .5) * 6, y: y - 2, vx: side * 18 + (Math.random() - .5) * 20, vy: 25 + Math.random() * 25, t: .45, life: .45, size: 3 + Math.random() * 2, col: T.theme.dust || (T.theme.road === "dirt" ? "120,90,50" : "110,95,60"), kind: "dust" }); }
    if (k.slip > .25 && state === "race") for (let n = 0; n < 2; n++) { const sd = Math.random() < .5 ? -1 : 1;   // 💨 the draft charging: wind rushing past
      PFX.push({ x: W / 2 + sd * W * (.12 + Math.random() * .3), y: y - Math.random() * H * .35, vx: sd * 40, vy: 300, t: .13, life: .13, size: 1, col: "#e8f6ff", kind: "streak" }); }
    if (k.hyper > 0) PFX.push({ x: x + (Math.random() - .5) * w * 1.2, y: y - Math.random() * w * .8, vx: (Math.random() - .5) * 40, vy: 40, t: .35, life: .35, size: 2.5, col: `hsl(${Math.random() * 360},100%,65%)`, kind: "star" });
  }
  if (k.boxBurst) { k.boxBurst = false; tone(1568, .08, "triangle", .05, 2093);
    for (let n = 0; n < 20; n++) { const a = Math.random() * 6.28, v = 70 + Math.random() * 110; PFX.push({ x, y: y - w * .5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, t: .55, life: .55, size: 2 + Math.random() * 1.8, col: `hsl(${Math.random() * 360},100%,65%)`, kind: "star" }); } }
  for (let i = PFX.length - 1; i >= 0; i--) {
    const p = PFX[i]; p.t -= fdt; if (p.t <= 0) { PFX.splice(i, 1); continue; }
    p.x += p.vx * fdt; p.y += p.vy * fdt; const a = p.t / p.life;
    if (p.kind === "spark") { ctx.globalAlpha = a > .6 ? 1 : a > .3 ? .8 : .5; ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    else if (p.kind === "streak") { ctx.globalAlpha = a * .8; ctx.strokeStyle = p.col; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); ctx.stroke(); }
    else if (p.kind === "dust") { ctx.globalAlpha = a * .5; ctx.fillStyle = `rgb(${p.col})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a * .6), 0, 7); ctx.fill(); }
    else { ctx.globalAlpha = a; ctx.fillStyle = p.col; ctx.font = `${p.size * 3}px sans-serif`; ctx.textAlign = "center"; ctx.fillText("✦", p.x, p.y); }
  }
  ctx.globalAlpha = 1;
  // a coloured glow under the kart while a drift is charged or a boost is on
  const glow = k.drift && k.charge > .7 ? (k.charge > 2.4 ? `hsla(${(now * 900) % 360},100%,60%,` : k.charge > 1.5 ? "rgba(255,110,30," : "rgba(70,160,255,") : (k.extra || 0) > 20 ? "rgba(255,140,40," : null;
  if (glow && !G3) { const g4 = ctx.createRadialGradient(x, gy, 2, x, gy, w * .9); g4.addColorStop(0, glow + ".55)"); g4.addColorStop(1, glow + "0)"); ctx.fillStyle = g4; ctx.fillRect(x - w, gy - w * .5, w * 2, w); }
  if (IMG.meso) for (const c of COINFX) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(IMG.meso[Math.floor(c.t * 16) % 4], x + c.x - 6.5, y - 30 + c.y, 13, 12); ctx.restore(); }
  let lift = 0;
  if (k.rescue > 0) { const p = k.rescue > .7 ? (1.4 - k.rescue) / .7 : k.rescue / .7; lift = p * 40; ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("📜", x, y - 60 - lift); }
  if (!G3) {
  ctx.save(); ctx.translate(x, y - lift); ctx.rotate(tilt);
  if (k.small > 0) ctx.scale(.6, .6);   // shrunk by Thunder
  if (k.hyper > 0) { ctx.scale(1.3, 1.3); ctx.shadowColor = `hsl(${(t * 600) % 360},100%,60%)`; ctx.shadowBlur = 14; }   // 💪 Hyper Body
  if (k.spin > 0) ctx.scale(Math.cos((.9 - k.spin) * Math.PI * 4), 1);      // spinning out
  if (k.squash > 0) ctx.scale(1.35, .45);                                   // flattened by the King Slime
  if (k.inv > 0 && k.spin <= 0 && Math.floor(performance.now() / 90) % 2) ctx.globalAlpha = .55;
  const bw = w, bh = w * .42;
  if (k.holding && k.item) { const hi = HELD_IMG(k.item); if (hi) { const hs = 16; ctx.save(); ctx.imageSmoothingEnabled = k.item === "arrow"; ctx.drawImage(hi, -hs / 2, -2, hs, hs * hi.height / hi.width); ctx.restore(); } }
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
  if ((k.extra || 0) > 5) {   // boost flames out of the exhausts, as big as the kart and flickering
    const pw = Math.min(1, k.extra / 100); ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const sx of [-bw * .18, bw * .18]) {
      const fl = bw * (.45 + .35 * pw) * (.8 + Math.random() * .4), fw = bw * .16 * (.85 + Math.random() * .3);
      const g5 = ctx.createLinearGradient(0, -bh * .25, 0, -bh * .25 + fl); g5.addColorStop(0, "#fffbe0"); g5.addColorStop(.3, "#ffd23f"); g5.addColorStop(.7, "#ff6a1e"); g5.addColorStop(1, "rgba(255,40,20,0)");
      ctx.fillStyle = g5; ctx.beginPath(); ctx.moveTo(sx - fw, -bh * .25); ctx.quadraticCurveTo(sx - fw * 1.1, -bh * .25 + fl * .55, sx, -bh * .25 + fl); ctx.quadraticCurveTo(sx + fw * 1.1, -bh * .25 + fl * .55, sx + fw, -bh * .25); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore(); ctx.globalAlpha = 1;
  }
  if (G3 && glow) { const g4 = ctx.createRadialGradient(x, gy, 2, x, gy, w * 1.1); g4.addColorStop(0, glow + ".5)"); g4.addColorStop(1, glow + "0)"); ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g4; ctx.fillRect(x - w * 1.2, gy - w * .6, w * 2.4, w * 1.2); ctx.restore(); }
  if (k.spin > 0 || k.squash > 0) dizzy(x, y - lift - w * 1.55, w * .55, t);   // 💫 seeing stars after a hit
  if (POPS.length) drawPops(x + w * 1.25, y - lift - w * .5);   // beside the kart, clear of the big banner in the middle
  if (k.frozen > 0 && !G3) iceBlock(x, y - lift, w, Math.min(1, k.frozen / .3));
}
// 3D: a rival's name tag, the stars after a hit and the ink, over their 3D kart
function rivalTag(r, sx, gy, sc, fz) {
  const top = gy - (31 + Math.max(0, r.z || 0)) * sc, t = performance.now() / 1000;
  if ((r.spin > 0 || r.squash > 0) && fz < 600) dizzy(sx, top + 3 * sc, 8 * sc, t);
  if (r.ink > 0 && fz < 500) { ctx.fillStyle = "rgba(10,10,18,.75)"; ctx.beginPath(); ctx.arc(sx, top + 8 * sc, 4 * sc, 0, 7); ctx.fill(); }
  if (fz < 560) { const fs = Math.max(5, Math.min(9, 2.4 * sc + 3)); ctx.font = `bold ${fs}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.globalAlpha = r.ghost ? .6 : 1; ctx.strokeText(r.name, sx, top - 2); ctx.fillStyle = "#fff"; ctx.fillText(r.name, sx, top - 2); ctx.globalAlpha = 1; }
}
// 🧊 a block of ice over a frozen kart (melting away at the end)
function iceBlock(x, y, w, a) {
  const bw = w * 1.25, bh = w * 1.45; ctx.save(); ctx.globalAlpha = .55 * a;
  const g = ctx.createLinearGradient(x - bw / 2, y - bh, x + bw / 2, y); g.addColorStop(0, "#e8f7ff"); g.addColorStop(1, "#7cc4f4");
  ctx.fillStyle = g; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, w * .05); rr(x - bw / 2, y - bh, bw, bh, w * .12); ctx.fill(); ctx.globalAlpha = .9 * a; ctx.stroke();
  ctx.globalAlpha = .7 * a; ctx.fillStyle = "#ffffff"; ctx.fillRect(x - bw * .38, y - bh * .9, bw * .1, bh * .45); ctx.fillRect(x - bw * .22, y - bh * .9, bw * .05, bh * .25);
  ctx.restore();
}
// 💫 little stars circling over someone's head after they get hit
function dizzy(x, y, r, t) {
  ctx.save(); ctx.font = `${Math.max(5, r * .55)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let n = 0; n < 3; n++) { const a = t * 7 + n * 2.09, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * .3; ctx.globalAlpha = Math.sin(a) > 0 ? 1 : .55; ctx.fillStyle = "#ffe14a"; ctx.fillText("★", px, py); }
  ctx.restore();
}
// a rival's kart: same shape as yours in their colour, their character picture sharp when close, their name above
// 🏆 the #1 guild member's Time Trial ghost on this track: everyone races it (it comes from the guild board)
let topGhost = null;
async function fetchTop() {
  topGhost = null; const my = raceId;
  if (DEV && DEV.topGhost) { topGhost = DEV.topGhost; return; }
  const sb = await B.client(); if (!sb) return;
  const { data } = await sb.from("kart_times").select("player,race_ms,ghost").eq("track", ccId(TRACK_ID, raceCC)).not("ghost", "is", null).order("race_ms").limit(1);
  if (my !== raceId || !data || !data[0]) return;
  let g; try { g = JSON.parse(data[0].ghost); } catch (e) { return; }
  const img = new Image(); img.src = spriteOf(data[0].player);
  topGhost = { name: data[0].player, ms: data[0].race_ms, data: g, img };
}
function ghostAt(t, gh = ghost) {
  if (!gh || !gh.length) return null;
  let lo = 0, hi = gh.length - 1; if (t >= gh[hi][0]) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (gh[m][0] <= t) lo = m; else hi = m; }
  const a = gh[lo], b = gh[hi], f = (t - a[0]) / Math.max(1, b[0] - a[0]);
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, z: a[4] + (b[4] - a[4]) * f };
}
function drawRival(r, sx, gy, sc, fz) {
  if (r.ghost) ctx.globalAlpha = .45; if (r.boo > 0) ctx.globalAlpha = .25;
  const w = 17 * sc, bh = w * .42, y = gy - r.z * sc * .45, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(sx, gy + 1, w * .55, Math.max(1, 3 * sc / 2), 0, 0, 7); ctx.fill();
  if (r.rescue > 0) { const p = r.rescue > .7 ? (1.4 - r.rescue) / .7 : r.rescue / .7; ctx.globalAlpha = Math.max(0, 1 - p); }
  ctx.save(); ctx.translate(sx, y); ctx.rotate(r.steer * .06);
  if (r.small > 0) ctx.scale(.6, .6);
  if (r.hyper > 0) { ctx.scale(1.3, 1.3); ctx.shadowColor = "#ffd75e"; ctx.shadowBlur = 10; }
  if (r.spin > 0) ctx.scale(Math.cos((.9 - r.spin) * Math.PI * 4), 1);
  if (r.squash > 0) ctx.scale(1.35, .45);
  if (r.inv > 0 && r.spin <= 0 && Math.floor(t * 11) % 2) ctx.globalAlpha = .55;
  if (r.ghost) ctx.globalAlpha = .45; if (r.boo > 0) ctx.globalAlpha = .25;
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
  if ((r.extra || 0) > 5) { ctx.save(); ctx.globalCompositeOperation = "lighter"; for (const sx of [-w * .18, w * .18]) { ctx.fillStyle = Math.random() < .5 ? "#ffb02e" : "#ff5a2e";
    const fl = w * (.4 + Math.random() * .25); ctx.beginPath(); ctx.moveTo(sx - w * .1, -bh * .25); ctx.lineTo(sx + w * .1, -bh * .25); ctx.lineTo(sx, -bh * .25 + fl); ctx.fill(); } ctx.restore(); }
  if (r.holding && r.item) { const hi = HELD_IMG(r.item); if (hi) { const hs = 9 * sc; ctx.drawImage(hi, -hs / 2, -hs * .3, hs, hs * hi.height / hi.width); } }
  ctx.restore(); ctx.globalAlpha = 1;
  if (r.frozen > 0) iceBlock(sx, y, w, Math.min(1, r.frozen / .3));
  if ((r.spin > 0 || r.squash > 0) && fz < 600) dizzy(sx, y - bh * .45 - (H * .2 / (FOCAL / CAMD)) * sc - 3 * sc, w * .5, t);
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
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ------------------------------------------------------------------ HUD + flow
let wasDark = false;
function hud() {
  const k = K;
  const dkNow = darkness() > 0; if (dkNow && !wasDark) { tone(140, .6, "sine", .08, 50); noiseHit(400, .5, .03, .7, 120); } wasDark = dkNow;   // 🌙 lights out: a low whoom
  $k("#kLap").textContent = state === "menu" ? "" : OPEN ? (T.sections ? `SECTION ${Math.min(T.sections, 1 + Math.floor(Math.max(0, k.idx - START_I) / (N - FIN_OFF - START_I) * T.sections))}/${T.sections}` : `🏔️ ${Math.min(100, Math.round(Math.max(0, k.idx - START_I) / (N - FIN_OFF - START_I) * 100))}%`) : `LAP ${Math.min(k.lap + 1, LAPS)}/${LAPS}`;
  $k("#kTime").textContent = state === "menu" ? "" : fmt(k.t);
  const lavaGap = LAVA && state === "race" && !k.done ? Math.max(0, Math.round((k.idx - LAVA.i) * SPC / 10)) : null;
  $k("#kBest").textContent = lavaGap != null && LAVA.t > 1 ? `🔥 Lava ${lavaGap} m behind` : mode === "tt" ? (best && best.race ? `Best ${fmt(best.race)}` : "") : mode === "gp" && gp ? `Cup race ${gp.race}/${GP_RACES}` : T ? T.name : "";
  $k("#kBest").classList.toggle("hot", lavaGap != null && lavaGap < 50);
  $k("#kBest").classList.toggle("lava", lavaGap != null);
  $k("#kSpeed").textContent = state === "race" ? `${Math.max(0, Math.round(k.v * .5 * SPD))} km/h` : "";
  $k("#kWrong").hidden = !(state === "race" && k.wrong > .6);
  let cd = "";   // multiplayer: someone finished, the rest have 10 seconds
  if (mpOn() && MP.endAt && state === "race" && !MP.finished) {
    const left = Math.ceil((MP.endAt - performance.now()) / 1000);
    if (left <= 0) mpTimeUp();
    else { cd = `🏁 ${MP.firstName || "Someone"} finished! ⏱️ ${left}s left`; if ($k("#kWarn").textContent !== cd && left <= 5) beep(left <= 3 ? 880 : 660); }
  }
  const armIn = state === "race" && ARMS.some(a => a.tgt === k), shotIn = state === "race" && SHOTS.some(sh => sh.tgt === k);
  const flipIn = MECH === "flip" && state === "race" && k.flipT < 3 ? Math.ceil(k.flipT) : 0;   // 🧸 Ludibrium: a swap (or the swap back) is coming
  if (flipIn && flipIn !== flipWarnN) { flipWarnN = flipIn; tone(1040, .12, "square", .06); } if (!flipIn) flipWarnN = 0;
  const papIn = HAZ.pap && state === "race" && HAZ.pap.charge > 0;
  if (papIn && !wasPap) { tone(220, 1.2, "sawtooth", .05, 880); } wasPap = papIn;
  const warn = cd ? cd : papIn ? "⚡ Papulatus is charging… jump or brace!" : flipIn ? `⚠️ Left ↔ right ${k.flipped ? "back to normal" : "SWAP"} in ${flipIn}…` : armIn ? "🖐️ ZAKUM'S ARM IS COMING FOR YOU!" : shotIn ? (k.holding ? "⚠️🏹 Arrow behind you · your item will block it" : "⚠️🏹 Arrow behind you! Hold a Slime or Arrow to block") : "";
  if ($k("#kWarn").textContent !== warn) { $k("#kWarn").textContent = warn; $k("#kWarn").className = "kt-warn" + (armIn || cd || flipIn || papIn ? " arm" : ""); }
  $k("#kWarn").hidden = !warn;
  if (warn && !cd && !flipIn && performance.now() - warnAt > (armIn ? 300 : 420)) { warnAt = performance.now(); tone(armIn ? 880 : 1180, .12, "square", .05, armIn ? 620 : 0); }
  const bag = state === "menu" ? "" : `${k.mesos}/10 · ${k.mesoTotal || 0}`; if ($k("#kBag").dataset.v !== bag) { $k("#kBag").dataset.v = bag; $k("#kBag").innerHTML = bag ? `<img src="media/kart/meso1.png" alt="">${k.mesos}/10 <span class="kt-tot" title="mesos collected this race">💰${k.mesoTotal || 0}</span>` : ""; }
  if ((k.roll > 0 || k.roll2 > 0) && performance.now() - rollTick > 85) { rollTick = performance.now(); tone([660, 740, 830, 880, 990, 880, 830, 740][rollN++ % 8], .05, "square", .035); }
  const spinIcon = () => ITEM_ICON[ROLL_KEYS[Math.floor(performance.now() / 80) % ROLL_KEYS.length]];
  const icon = k.roll > 0 ? spinIcon() : k.item ? ITEM_ICON[k.item] : "";
  const icon2 = k.roll2 > 0 ? spinIcon() : k.item2 ? ITEM_ICON[k.item2] : "";
  const img2 = $k("#kItem2 img"); if (img2.dataset.src !== icon2) { img2.dataset.src = icon2; if (icon2) img2.src = icon2; img2.hidden = !icon2; }
  $k("#kItem2").hidden = !icon2;
  const img = $k("#kItemBox img"); if (img.dataset.src !== icon) { img.dataset.src = icon; if (icon) img.src = icon; img.hidden = !icon; }
  $k("#kItemBox").classList.toggle("empty", !k.item && k.roll <= 0);
  const tl = k.item === "golden" ? k.goldT : k.item === "fire" ? k.fireT : k.item === "piranha" ? k.piranha : 0, nTxt = ITEM_N[k.item] ? String(k.itemN) : tl > 0 ? `${Math.ceil(tl)}s` : "";   // uses left, or seconds left
  $k("#kItemBoxN").textContent = nTxt; $k("#kItemBoxN").hidden = !nTxt;
  const pb = $k("#kPad [data-k=i]"); pb.disabled = !k.item || k.roll > 0; const pi = pb.querySelector("img"); if (pi.dataset.src !== icon) { pi.dataset.src = icon; if (icon) pi.src = icon; pi.hidden = !icon; }
  // your place: a change only counts once it has held for a moment (two karts side by side would otherwise flicker 7th-8th-7th…)
  const rk0 = state === "menu" || mode === "tt" ? 0 : state === "done" ? K.place : rankOf(k), tNow = performance.now();
  if (rk0 !== rkCand) { rkCand = rk0; rkSince = tNow; }
  const rk = state !== "race" || !lastRk || tNow - rkSince > 350 ? rk0 : lastRk;
  if (state === "race" && rk && lastRk && rk !== lastRk) { posPop = { up: rk < lastRk, at: tNow };
    if (rk < lastRk) { tone(988, .09, "square", .05, 1320); buzz(10);
      if (tNow - (k.ovT || 0) > 6000) { k.ovN = 0; k.ovMin = lastRk; }   // a streak = new best places within a few seconds of each other
      if (rk < (k.ovMin || 99)) { k.ovN = (k.ovN || 0) + 1; k.ovMin = rk; k.ovT = tNow; if (k.ovN >= 2) pop(`🔥 ${k.ovN} overtakes!`, "#ff9a3a", true); } } }
  if (state !== "race") posPop = null; lastRk = rk;
  const posCls = posPop && performance.now() - posPop.at < 650 ? (posPop.up ? " up" : " down") : "";
  $k("#kPos").textContent = rk ? rk + (["", "st", "nd", "rd"][rk] || "th") : ""; $k("#kPos").className = "kt-pos p" + rk + (k.lap === LAPS - 1 && state === "race" ? " final" : "") + posCls;
}
let wasPap = false, flipWarnN = 0, flashT = null, warnAt = 0, lastRk = 0, posPop = null;
function flash(t, ms, kind) { const f = $k("#kFlash"); if (kind === "intro") f.innerHTML = `<img class="k-crown" src="media/crown.png" alt="">` + esc(t); else f.textContent = t; f.className = "k-flash" + (kind ? " " + kind : ""); void f.offsetWidth; f.className += " on"; clearTimeout(flashT); flashT = setTimeout(() => f.className = "k-flash" + (kind ? " " + kind : ""), ms); }
// phones race sideways: go fullscreen + lock to landscape where the browser allows it (Android), otherwise ask to rotate and pause
const TOUCH = matchMedia("(pointer: coarse)").matches;
// while racing on a phone, pinches and double taps must not zoom the page (Safari ignores the CSS for this, so stop the gestures here)
["gesturestart", "gesturechange", "dblclick"].forEach(ev => document.addEventListener(ev, e => { if (state !== "menu" && !$k("#kGame").hidden) e.preventDefault(); }, { passive: false }));
let lastTouchEnd = 0;
document.addEventListener("touchend", e => {
  if (state === "menu" || $k("#kGame").hidden || (e.target.closest && e.target.closest("input, textarea, button, a, select, [data-a], [data-ready]"))) return;
  const now = performance.now(); if (now - lastTouchEnd < 350) e.preventDefault(); lastTouchEnd = now;
}, { passive: false });
const upright = () => TOUCH && innerHeight > innerWidth;
// 🔍 while the game is on screen a phone can't zoom the page (an iPhone zooms in when you tap a small text box, and with pinches
// blocked you'd be stuck zoomed in for the next race); setting this also snaps an already zoomed page back to normal
const VP = document.querySelector('meta[name="viewport"]'), VP0 = VP ? VP.content : "";
let vpLocked = false;
function lockZoom(on) { if (!VP || on === vpLocked) return; vpLocked = on; VP.content = on ? VP0 + ", maximum-scale=1, user-scalable=no" : VP0; }
async function goLandscape() {
  if (!TOUCH) return;
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch (e) {}
  try { await screen.orientation.lock("landscape"); } catch (e) {}
}
function leaveLandscape() {
  try { screen.orientation.unlock(); } catch (e) {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
}
const waitLandscape = () => Promise.resolve();   // no "turn your phone" message any more: an upright phone shows the game turned sideways
// phones held upright: the race is drawn turned 90° (landscape), so people just turn the phone; if they do, it switches to the normal sideways view
let rotWas = null;
function syncRot() {
  const r = TOUCH && state !== "menu" && innerHeight > innerWidth;
  if (r !== rotWas) { rotWas = r; $k("#kart").classList.toggle("rot", r); requestAnimationFrame(() => { if (state !== "menu") fit(); }); }
  return r;
}
addEventListener("resize", () => { if (state !== "menu") syncRot(); });
// the frame loop: the next frame is always booked first, so a bug in one frame can never freeze the game
let loopErrs = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  try { frame(now); } catch (e) { if (loopErrs++ < 3) console.error("Family Kart frame error", e); }
}
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  syncRot(); lockZoom(TOUCH && state !== "menu" && !$k("#kGame").hidden); $k("#kFull").hidden = !wantFull();
  const t0 = performance.now();
  if (TEX && K && state !== "loading") { if (state === "watch") { watchStep(dt); render(); watchHud(); } else { step(dt); const t1 = performance.now(); render(); hud(); engine(); if (DEV) { DEV.stepMs = (DEV.stepMs || 0) * .95 + (t1 - t0) * .05; DEV.drawMs = (DEV.drawMs || 0) * .95 + (performance.now() - t1) * .05; } } }
  if (mpOn() && K && (state === "race" || state === "count" || state === "done") && now - MP.sendAt > 100) {
    MP.sendAt = now;
    const msg = posMsg(K, now), bl = RIV.filter(r => r.bot && !r.remote).map(r => ({ n: r.name, ...posMsg(r, now) }));
    p2pSend({ e: "p", p: { n: MP.me, rc: MP.raceNo, ...msg } }); if (bl.length) p2pSend({ e: "pb", rc: MP.raceNo, list: bl });
    if (!p2pAll() || now - (MP.bcAt || 0) > 300) {   // the server route: always for anyone not connected directly, else just as a backup
      MP.bcAt = now; mpSend("p", msg);
      if (bl.length) mpSend("pb", { list: bl });   // all the host's bots in one message
    }
  }
}
// ------------------------------------------------------------------ direct connections (private rooms)
// In a private room every pair of real players also connects straight to each other (WebRTC, like a video call), so positions
// skip the trip through the server: on the same wifi it's almost instant. The server route keeps running as a backup, and
// anyone a direct connection can't reach just uses it. Public rooms (strangers) never connect directly: that would show
// each player's internet address to the others.
const P2P = new Map(), P2P_ICE = new Map();   // name -> { pc, dc, open, ow, born, tries }; ICE candidates that came before their offer
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const p2pOK = () => mpOn() && !MP.pub && !!MP.key && typeof RTCPeerConnection !== "undefined" && store.get("kart_p2p") !== "0";   // private rooms, sealed setup, and you didn't switch it off
const p2pHumans = () => (MP.players || []).filter(p => !p.bot && p.name !== MP.me).map(p => p.name);
const p2pAll = () => { const h = p2pHumans(); return h.length > 0 && h.every(n => P2P.get(n) && P2P.get(n).open); };
function p2pSend(m) { if (!P2P.size) return; const s2 = JSON.stringify(m); for (const c of P2P.values()) if (c.open) try { c.dc.send(s2); } catch (e) {} }
function p2pDrop(n) { const c = P2P.get(n); if (!c) return; try { c.dc && c.dc.close(); c.pc.close(); } catch (e) {} P2P.delete(n); }
function p2pClose() { for (const n of [...P2P.keys()]) p2pDrop(n); P2P_ICE.clear(); }
function p2pSync() {
  if (!p2pOK()) { p2pClose(); return; }
  const want = new Set(p2pHumans()), now = performance.now();
  for (const n of [...P2P.keys()]) if (!want.has(n)) p2pDrop(n);
  for (const [n, c] of P2P) if (!c.open && now - c.born > 9000) { const t = c.tries; p2pDrop(n); if (t < 3 && MP.me < n) p2pStart(n, t + 1); }   // stuck: try again (a few times)
  for (const n of want) if (!P2P.has(n) && MP.me < n && !(MP.p2pGaveUp || {})[n]) p2pStart(n, 0);   // one side (the earlier name) makes the call
}
function p2pPeer(n, tries) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }), c = { pc, dc: null, open: false, ow: 0, born: performance.now(), tries: tries || 0 };
  P2P.set(n, c);
  pc.onicecandidate = e => { if (e.candidate) mpSend("rtc", { to: n, ice: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" && P2P.get(n) === c) { p2pDrop(n); if (c.tries >= 2) (MP.p2pGaveUp || (MP.p2pGaveUp = {}))[n] = 1; } };
  pc.ondatachannel = e => p2pWire(n, c, e.channel);
  return c;
}
function p2pWire(n, c, dc) {
  c.dc = dc; dc.onopen = () => { c.open = true; p2pPing(); }; dc.onclose = () => { c.open = false; };
  dc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.e === "p" && m.p && m.p.n === n) mpOnPos(m.p, c.ow || 30);
    else if (m.e === "pb" && Array.isArray(m.list) && MP.host === n) for (const q of m.list) mpOnPos({ ...q, rc: m.rc }, c.ow || 30);
    else if (m.e === "ping") { try { dc.send(JSON.stringify({ e: "pong", t: m.t })); } catch (x) {} }
    else if (m.e === "pong") { const ow = (performance.now() - m.t) / 2; if (ow >= 0 && ow < 2000) c.ow = c.ow ? c.ow * .7 + ow * .3 : ow; } };
}
function p2pPing() { const t = performance.now(); for (const c of P2P.values()) if (c.open) try { c.dc.send(JSON.stringify({ e: "ping", t })); } catch (e) {} }
async function p2pStart(n, tries) {
  const c = p2pPeer(n, tries);
  p2pWire(n, c, c.pc.createDataChannel("kart", { ordered: false, maxRetransmits: 0 }));   // positions: the newest one matters, a lost one is never resent
  try { await c.pc.setLocalDescription(await c.pc.createOffer()); mpSend("rtc", { to: n, sdp: c.pc.localDescription.toJSON() }); } catch (e) { p2pDrop(n); }
}
async function p2pOnSignal(p) {
  if (!p || p.to !== MP.me || !p.n || !p2pOK()) return;
  const n = p.n;
  try {
    if (p.sdp && p.sdp.type === "offer") { p2pDrop(n); const c = p2pPeer(n, 0); await c.pc.setRemoteDescription(p.sdp);
      await c.pc.setLocalDescription(await c.pc.createAnswer()); mpSend("rtc", { to: n, sdp: c.pc.localDescription.toJSON() });
      for (const ice of P2P_ICE.get(n) || []) await c.pc.addIceCandidate(ice).catch(() => {}); P2P_ICE.delete(n); }
    else if (p.sdp && p.sdp.type === "answer") { const c = P2P.get(n); if (c && !c.pc.remoteDescription) await c.pc.setRemoteDescription(p.sdp); }
    else if (p.ice) { const c = P2P.get(n); if (c && c.pc.remoteDescription) await c.pc.addIceCandidate(p.ice).catch(() => {}); else { const q = P2P_ICE.get(n) || []; q.push(p.ice); P2P_ICE.set(n, q.slice(-40)); } }
  } catch (e) {}
}
// one kart's state as it goes out to the room (your kart, or one of the host's bots)
function posMsg(r, now) {
  const me = r === K, done = me ? state === "done" && !!K.fin : r.done;   // (ran out of time: not "finished")
  const m = r.ma != null ? r.ma : r.a;   // the direction it's actually moving (differs from where the nose points in a drift)
  let w = 0; if (r._wt && now > r._wt) { let d = m - r._wa; d = Math.atan2(Math.sin(d), Math.cos(d)); w = d / ((now - r._wt) / 1000); } let u = null; if (r._ut && now - r._ut > 30) { u = Math.hypot(r.x - r._ux, r.y - r._uy) / ((now - r._ut) / 1000); if (u > 2000) u = null; } r._ux = r.x; r._uy = r.y; r._ut = now;   // how fast it really moves (world units/s, boosts and all)
  r._wa = m; r._wt = now;   // how fast it's turning (rad/s)
  return { ...(DEV ? { wt: Date.now() } : {}), m: +m.toFixed(3), u: u == null ? null : Math.round(u), ts: Math.round(now), l: Math.round(MP.ow || 70), w: +Math.max(-6, Math.min(6, w)).toFixed(2), d: r.drift ? Math.sign(r.drift) : 0, x: Math.round(r.x), y: Math.round(r.y), a: +r.a.toFixed(3), v: Math.round(r.v), z: Math.round(r.z || 0), s: +(r.steer || 0).toFixed(2), sp: r.spin > 0 ? +r.spin.toFixed(2) : 0,
    sm: r.small > 0 ? 1 : 0, hy: r.hyper > 0 ? 1 : 0, ex: Math.round(r.extra || 0), sq: r.squash > 0 ? 1 : 0, rk: r.rocket > 0 ? 1 : 0, bo: r.boo > 0 ? 1 : 0, pi: r.piranha > 0 ? 1 : 0, lap: r.lap, cps: r.cps, idx: r.idx, ho: r.holding ? 1 : 0, it: r.holding ? r.item : null,
    ik: r.ink > 0 ? 1 : 0, dn: done ? 1 : 0, ft: done ? Math.round(me ? r.laps.reduce((a, b) => a + b, 0) : r.finishT) : 0 };
}
let raceId = 0;   // bumps on every start and quit, so timers and loading from an old race can't touch the next one
async function start() {
  const my = ++raceId, alive = () => my === raceId && state !== "menu";
  const n = $k("#kName").value.trim().slice(0, 20);
  if (n.length < 2) { needName("👆 Type your character name first."); return; }
  $k("#kErr").textContent = "";
  const g = guildOf(n); me = g ? g.name : n; if (g) store.set("family_me", g.name);
  if (mode === "mp") { if (!MP.code) return; me = MP.me; MP.finished = false; MP.results = null; }
  raceCC = mode === "mp" ? (CCS[String(MP.track || "").split("@")[1]] ? +String(MP.track).split("@")[1] : 150) : cc;
  try { best = JSON.parse(store.get(bestKey())) || null; } catch (e) { best = null; }
  $k("#kMenu").hidden = true; $k("#kResult").hidden = true; $k("#kGame").hidden = false;
  $k("#kart").classList.add("racing"); document.body.classList.add("bd-playing");
  window.getAC && window.getAC(); fullTries = 0; goLandscape();
  state = "loading";
  if (mode === "gp" && (!gp || gp.over)) gp = { race: 1, names: null, pts: {}, cup };
  const [mk, mcc] = String(MP.track || "henesys").split("@");
  const key = mode === "gp" ? CUPS[gp.cup].tracks[gp.race - 1] : mode === "mp" ? (TRACKS[mk] ? mk : "henesys") : track;
  raceCC = mode === "mp" ? (CCS[mcc] ? +mcc : 150) : cc; SPD = CCS[raceCC].spd;
  if (!assetsReady || TRACK_KEY !== key) { $k("#kLoad").hidden = false; await new Promise(r => setTimeout(r, 30)); if (!assetsReady) await prepare(); loadTrack(key); await loadArt(); $k("#kLoad").hidden = true; }
  if (!alive()) return;
  IMG.me = await loadImg(spriteOf(me)); if (!alive()) return; fit();
  
  try { ghost = mode === "tt" ? JSON.parse(store.get(ghostKey())) : null; } catch (e) { ghost = null; }
  ghostRec = []; PFX = []; FIRE = [];
  K = freshKart(); setupHazards(); PETALS = []; POPS = []; HITS.clear(); if (G3E) G3E.clearKarts(); FWK = []; lastRk = 0; finishers = 0; bloopCD = 0; armCD = 0; thunderCD = 0; thunderFx = 0; FLAKES = [];
  LAVA = MECH === "lava" ? { i: START_I - 440 / SPC, v: 0, t: 0 } : null; makeRivals(mode === "gp" ? gp.names : null); if (mode === "gp") gp.names = RIV.map(r => r.name);
  if (mode === "tt") { K.item = "triple"; K.itemN = 3; }
  B.musicRate(1);
  state = "wait"; B.music(T.music); syncMusicBtn();
  if (mode === "tt") fetchTop();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  await waitLandscape(); if (!alive() || state !== "wait") return; fit(); state = "count";
  // the intro: "Family, are you Ready!", then 3, 2, 1 and "Go Family!!!" (a room race starts at the server's time)
  const goIn = mode === "mp" ? Math.max(0, MP.goAt - performance.now()) : 4600;
  countAt = performance.now() + goIn - 3000; COINS.forEach(c => c.got = false);
  const at = (ms, fn) => { if (ms >= -200) setTimeout(() => { if (alive() && state === "count") fn(); }, Math.max(0, ms)); };
  { const introAt = Math.max(0, goIn - 4600), room = goIn - 3000 - introAt;   // skipped if a slow load ate the time for it
    if (room >= 500) at(introAt, () => { flash("Family,\nare you Ready!", Math.min(1300, room - 100), "intro"); readySound(); say("Family, are you ready?", 1.15); }); }
  for (const [t, d, w] of [["3", 0, "Three"], ["2", 1000, "Two"], ["1", 2000, "One"]]) at(goIn - 3000 + d, () => { flash(t, 900, "num"); beep(440); say(w, 1.2); });
  setTimeout(() => {
    if (!alive() || state !== "count") return; state = "race"; whistle(); goSound(); setTimeout(() => say("Go Family!", 1.1), 150);
    const h = K.held;
    if (h != null && h >= 950) { giveBoost(K, 1.2, 110); flash("🚀 ROCKET START!\nGo Family!!!", 1300, "go"); }
    else if (h != null) { K.stall = .9; flash("💨 Too early!", 1000); bumpSound(); }
    else flash("Go Family!!!", 1300, "go");
    RIV.forEach(r => { if (!r.remote && Math.random() < .35) giveBoost(r, 1, 90); });
  }, goIn);
}
let assetsReady = false;
// 🧱 real MapleStory ground tiles (from maplestory.io) for the patches on the road: lava, ice, snow, swamp mud, mine rock
const TILESETS = ["moltenRock", "glacierExplorer", "snowyLightrock", "swamp", "deepMine", "slime"], TILEPAT = {};   // (slime: made here from the Slime monster's own green body, mirrored so it repeats)
async function loadTiles() {
  await Promise.all(TILESETS.map(async set => { const ims = await Promise.all([0, 1, 2, 3].map(k => loadImg(`media/kart/tiles/${set}${k}.png?v=1`))); if (ims.some(im => !im)) return;
    const w = ims[0].width, h = ims[0].height, c = document.createElement("canvas"); c.width = w * 2; c.height = h * 2; const g = c.getContext("2d"); ims.forEach((im, k) => g.drawImage(im, (k & 1) * w, (k >> 1) * h)); TILEPAT[set] = c; }));   // (the four tiles in a 2x2 block)
  TRACK_KEY = null; if (G3E && G3E.reset) G3E.reset();   // (anything painted before they arrived is painted again)
}
async function prepare() {
  await loadTiles();
  const mstrip = await loadImg("media/kart/meso.png?v=1"); IMG.meso = mstrip ? mesoFrames(mstrip) : null;
  IMG.mp_sign = await loadImg("media/kart/sign.webp?v=1");   // (the Market Place sign over Mushroom Canyon's start)
  [IMG.arrowIcon, IMG.arm, IMG.arrowShot] = await Promise.all([loadImg("media/kart/items/arrow_icon.png"), loadImg(B.M + "zarm_stand.gif"), loadImg("media/kart/items/arrow.png")]);   // the quiver (held as a shield) and the real arrow
  await Promise.all(["gshell", "rshell", "bshell", "rocket", "piranha", "fire", "boom", "horn"].map(async k => { IMG["it_" + k] = await loadImg(ITEM_ICON[k]); }));   // 🎁 the new items
  IMG.bombF = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => loadImg(`media/kart/items/bomb${i}.png`)));   // 💣 Gunslinger's Grenade (MapleStory)
  IMG.boomF = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(i => loadImg(`media/kart/items/boom${i}.png`)));
  if (IMG.arrowShot) { const c = document.createElement("canvas"); c.width = IMG.arrowShot.width; c.height = IMG.arrowShot.height; const g = c.getContext("2d");
    g.drawImage(IMG.arrowShot, 0, 0); g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(120,200,255,.75)"; g.fillRect(0, 0, c.width, c.height); IMG.iceArrow = c; }
  if (IMG.bombF.some(x => !x)) IMG.bombF = null; if (IMG.boomF.some(x => !x)) IMG.boomF = null;
  await Promise.all([...MOBS, "king_slime", "ribbon_pig"].map(async m => { IMG[m] = await loadImg(`media/mobs/${m}.png`); if (IMG[m]) IMG[m].px = true; })
    .concat(Object.keys(PROPS).filter(k => !PROPS[k][2]).map(async k => { IMG[k] = await loadImg(`media/kart/${k}.webp?v=1`); })));
  await load3d();
  assetsReady = true;
}
// a track's own sky, horizon strip, scenery and monsters, loaded the first time it's raced
const ART = {};
const artImg = src => ART[src] || (ART[src] = loadImg(src));
async function loadArt() {
  const want = new Set([...OBJS.map(o => o.k), ...PIGS.map(p => p.k), ...(KING ? [KING.k] : []), ...(T.mobs || [])]), jobs = [];
  for (const k of want) if (!(k in IMG) && !String(k).startsWith("pet_")) {   // (pet frames come from the pets folder below)
    IMG[k] = null; const p = PROPS[k];
    jobs.push(artImg(p ? (p[2] ? `media/kart/${p[2]}/${k}.webp?v=1` : `media/kart/${k}.webp?v=1`) : `media/mobs/${k}.png?v=1`).then(im => { IMG[k] = im; if (im && !p) im.px = true; }));
  }
  const art = T.art || HEN_ART;
  jobs.push(makeCrowd());
  if (TRACK_KEY === "ld3" && !IMG.papStand) jobs.push(Promise.all([...[0, 1, 2, 3, 4, 5].map(i => artImg(`media/kart/ludi/pap_stand${i}.webp`)), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => artImg(`media/kart/ludi/pap_skill${i}.webp`))])
    .then(a => { if (a.every(Boolean)) { IMG.papStand = a.slice(0, 6); IMG.papSkill = a.slice(6); } }));
  jobs.push(artImg(art.sky).then(im => { sky = im; }), (art.strip ? artImg(art.strip) : Promise.resolve(null)).then(im => { IMG.strip = im; }));   // (a track can go without a horizon strip)
  for (const n of T.pets || []) for (const [act, cnt] of Object.entries(PETF[n] || {})) for (let i = 0; i < cnt; i++) { const key = `pet_${n}_${act}${i}`;
    if (!IMG[key]) jobs.push(artImg(`media/kart/pets/${n}_${act}${i}.png?v=1`).then(im => { if (im) { im.px = true; IMG[key] = im; } })); }
  await Promise.all(jobs);
}
const ordinal = n => n + (["", "st", "nd", "rd"][n] || "th");
let TRACK_LEN = 0;
function finish() {
  if (mode === "mp") return mpFinish();
  const k = K; state = "done"; K.doneAt = performance.now(); B.musicRate(1); fireworks(6); buzz([40, 60, 120]);
  if (!TRACK_LEN) for (let i = 0; i < N; i++) TRACK_LEN += Math.hypot(PTS[(i + 1) % N][0] - PTS[i][0], PTS[(i + 1) % N][1] - PTS[i][1]);
  const total = k.laps.reduce((a, b) => a + b, 0), bl = Math.min(...k.laps);
  // everyone's time: rivals who finished have theirs, the rest are estimated from how far they still have to go
  const rows = [{ name: me, img: spriteOf(me), time: total, you: true }, ...RIV.map(r => {
    if (r.done) return { name: r.name, img: spriteOf(r.name), time: r.finishT };
    const left = OPEN ? Math.max(0, N - FIN_OFF - r.idx) : Math.max(0, LAPS * N - (r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx)));
    return { name: r.name, img: spriteOf(r.name), time: total + left * (TRACK_LEN / N) / (r.skill * DIFF().skill * .92) * 1000, est: true };
  })].sort((a, b) => a.time - b.time);
  k.place = rows.findIndex(r => r.you) + 1;
  if (mode === "gp") rows.forEach((r, i) => { r.add = GP_PTS[i] || 0; gp.pts[r.name] = (gp.pts[r.name] || 0) + r.add; });
  // Time Trial: personal best, ghost, guild board
  let newRace = false, newLap = false, sent = Promise.resolve(null);
  if (mode === "tt") {
    newRace = !best || !best.race || total < best.race; newLap = !best || !best.lap || bl < best.lap;
    best = { race: newRace ? total : best.race, lap: newLap ? bl : best.lap }; store.set(bestKey(), JSON.stringify(best));
    if (newRace) store.set(ghostKey(), JSON.stringify(ghostRec));
    if (guildOf(me)) sent = submit(k.laps);
  }
  B.sound(mode === "tt" ? (newRace ? "win" : "blip") : k.place <= 3 ? "win" : "lose");
  flash(mode === "tt" ? (newRace ? "⏱️ NEW RECORD!" : "🏁 FINISH!") : k.place === 1 ? "🏆 1st PLACE!" : "🏁 FINISH!", 1600);
  const my = raceId;
  setTimeout(() => {
    if (my !== raceId || state !== "done") return;
    const laps = `<div class="k-laps">${k.laps.map((l, i) => `<span class="${l === bl ? "b" : ""}">Lap ${i + 1}: ${fmt(l)}</span>`).join("")}</div><p class="k-mesos">💰 ${k.mesoTotal || 0} mesos collected</p>`;
    let html;
    if (mode === "tt") {
      html = `<h3>⏱️ ${fmt(total)}</h3>${laps}
        <p>${newRace ? "🎉 New personal best! Your ghost will race you next time 👻" : `Your best: ${fmt(best.race)}`}${newLap ? "<br>⚡ New best lap!" : ""}</p>
        ${topGhost ? `<p class="k-rank">${topGhost.name === me ? "🏆 You hold the guild record here" : total < topGhost.ms ? `👑 You beat ${esc(topGhost.name)}'s record (${fmt(topGhost.ms)})!` : `🏆 ${esc(topGhost.name)}: ${fmt(topGhost.ms)} · you +${((total - topGhost.ms) / 1000).toFixed(3)}s`}</p>` : ""}
        <p class="k-rank" id="kRank">${guildOf(me) ? "Saving your time…" : "Guests aren't on the guild board."}</p>
        <div class="row"><button class="sk-btn bd-play" data-a="again">Try again</button><button class="sk-btn sk-private" data-a="back">Back</button></div>`;
    } else {
      const head = mode === "gp" ? `<h3>${T.icon} ${T.name} · ${["", "🥇", "🥈", "🥉"][k.place] || "🏁"} ${ordinal(k.place)} place</h3>` : `<h3>${["", "🥇", "🥈", "🥉"][k.place] || "🏁"} ${ordinal(k.place)} place · ${fmt(total)}</h3>`;
      const table = `<table class="k-table">${rows.map((r, i) => `<tr class="${r.you ? "you" : ""}"><td>${ordinal(i + 1)}</td><td><img src="${r.img}" alt=""></td><td>${esc(r.name)}</td>
        <td>${r.est ? "~" : ""}${fmt(r.time)}</td>${mode === "gp" ? `<td class="pts">+${r.add}</td>` : ""}</tr>`).join("")}</table>`;
      const last = mode === "gp" && gp.race >= GP_RACES;
      const nx = mode === "gp" && !last ? TRACKS[CUPS[gp.cup].tracks[gp.race]] : null;
      html = `${head}<p class="k-mesos">💰 ${k.mesoTotal || 0} mesos collected</p><p class="k-diff">${DIFF().label}${mode === "gp" ? ` · ${CUPS[gp.cup].name} race ${gp.race}/${GP_RACES}` : ` · ${T.name}`}</p>${table}
        <div class="row">${mode === "gp" ? (last ? `<button class="sk-btn bd-play" data-a="podium">🏆 See the podium</button>` : `<button class="sk-btn bd-play" data-a="next">Next: ${nx.icon} ${nx.name} ▶</button>`)
          : `<button class="sk-btn bd-play" data-a="again">Race again</button>`}<button class="sk-btn sk-private" data-a="back">Back</button></div>`;
    }
    $k("#kResult").innerHTML = html; $k("#kResult").hidden = false; $k("#kResult").classList.toggle("wide", mode !== "tt");
    sent.then(r => { const el = $k("#kRank"); if (!el || !r) return;
      el.innerHTML = r.r === "ok" ? `🏆 You're <b>#${r.rank}</b> on the guild board` : r.r === "laps" ? "That time looks impossible, so it wasn't saved 🤔" : r.r === "dev" ? "(test race, not saved)" : "Couldn't save your time this time."; });
  }, 1400);
}
function mpFinish() {
  const k = K; state = "done"; K.doneAt = performance.now(); K.fin = true; B.musicRate(1); MP.finished = true; fireworks(6); buzz([40, 60, 120]); if (!MP.endAt) { MP.endAt = performance.now() + 10000; MP.firstName = MP.me; }
  const total = Math.round(k.laps.reduce((a, b) => a + b, 0)), place = rankOf(k);
  const sure = RIV.every(r => !r.remote || r.done || liveOK(r));   // not sure where someone is? don't claim a place: the results will say
  B.sound(place <= 3 ? "win" : "lose"); flash(sure && place === 1 ? "🏆 1st PLACE!" : sure ? `🏁 FINISH! ${ordinal(place)}` : "🏁 FINISH!", 1600);
  B.client().then(sb => sb && sb.rpc("kart_room_finish", { p_code: MP.code, p_tok: MP.token, p_ms: total })).then(() => mpPoll());
  const my = raceId;
  setTimeout(() => { if (my === raceId && state === "done" && !MP.results) mpShowWaiting(total); }, 1400);
}
function mpTimeUp() {
  if (state !== "race" || MP.finished) return;
  state = "done"; K.doneAt = performance.now(); MP.finished = true; B.musicRate(1); flash("⏱️ Time's up!", 1400); B.sound("lose"); mpPoll();
  const my = raceId; setTimeout(() => { if (my === raceId && state === "done" && !MP.results) mpShowWaiting(null); }, 1200);
}
function mpShowWaiting(total) {
  const rows = racers().slice().sort((a, b) => progOf(b) - progOf(a));
  $k("#kResult").innerHTML = `<h3>${total == null ? "⏱️ Time's up!" : "🏁 " + fmt(total)}</h3><p class="k-mesos">💰 ${K.mesoTotal || 0} mesos collected</p><p class="k-diff">${total == null ? "Your place is where you were on the track. Getting the results…" : "Everyone else has 10 seconds to finish…"}</p>
    <table class="k-table">${rows.map((r, i) => `<tr class="${r === K ? "you" : ""}"><td>${ordinal(i + 1)}</td><td><img src="${r !== K && r.bot ? botImg(r.name) : spriteOf(r === K ? me : r.name)}" alt=""></td><td>${esc(r === K ? me : r.name)}</td>
    <td>${r === K ? (total == null ? "—" : fmt(total)) : r.done ? fmt(r.finishT) : "racing…"}</td></tr>`).join("")}</table>`;
  $k("#kResult").hidden = false; $k("#kResult").classList.add("wide");
}
const TROPHY = [null, ["🏆", "Gold"], ["🥈", "Silver"], ["🥉", "Bronze"]];
const trophyHtml = t => `<div class="k-trophy r${t.rank}"><span>${TROPHY[t.rank][0]}</span><div><b>${TROPHY[t.rank][1]} Trophy!</b><small>${esc(CUPS[t.cup].name)}</small></div></div>`;
const trophyMark = c => { const r = +store.get("kart_trophy:" + c) || 0; return r >= 1 && r <= 3 ? `<i class="kt-tro" title="${TROPHY[r][1]} trophy">${TROPHY[r][0]}</i>` : ""; };   // the best trophy you've won in a cup, on its button
function mpShowResults(res) {
  if (state !== "done" || !res) return;
  const mine = res.find(r => r.name === MP.me);
  if (MP.tallied !== MP.raceNo) { MP.tallied = MP.raceNo; for (const r of res) { MP.tally[r.name] = (MP.tally[r.name] || 0) + (GP_PTS[r.place - 1] || 0); if (r.bot) (MP.tBots ||= {})[r.name] = 1; }   // this room's own standings, for everyone
    const rk = String(MP.track).split("@")[0], C = CUPS[cupOf(rk)], ci = C.tracks.indexOf(rk);   // 🏆 the cup goes on: 10 seconds to look at the results, then everyone is taken to the next track
    MP.next = TRACKS[rk] && ci >= 0 && ci < C.tracks.length - 1 ? { t: C.tracks[ci + 1], n: ci + 2, at: performance.now() + 10000, cc: roomCC(), cup: cupOf(rk), fails: 0 } : null;
    if (MP.next && MP.host === MP.me) { cup = MP.next.cup; track = MP.next.t; }
    MP.trophy = null;   // 🏆 the end of a cup: a trophy for the top 3 in the room's standings (and the best one you've won is kept)
    if (TRACKS[rk] && ci === C.tracks.length - 1) { const rank = Object.entries(MP.tally).sort((a, b) => b[1] - a[1]).findIndex(([n]) => n === MP.me) + 1;
      if (rank >= 1 && rank <= 3) { MP.trophy = { rank, cup: cupOf(rk) }; const key = "kart_trophy:" + MP.trophy.cup; if (rank < (+store.get(key) || 9)) store.set(key, String(rank));
        setTimeout(() => { finalSound(); confetti(); buzz([40, 60, 120]); }, 400); } }
    if (MP.next && MP.host !== MP.me) setTimeout(() => { if (MP.next && !mpReadyInfo().mine) mpReady(true); }, 600);   // (everyone's ready for the next race automatically)
  }
  $k("#kResult").innerHTML = `<h3>${mine ? (["", "🥇", "🥈", "🥉"][mine.place] || "🏁") + " " + ordinal(mine.place) + " place" : "🏁 Race over"}</h3>${MP.trophy ? trophyHtml(MP.trophy) : ""}
    <p class="k-mesos">💰 ${K.mesoTotal || 0} mesos collected</p><p class="k-diff">👥 Room ${MP.code} · ${(() => { const rk = String(MP.track).split("@")[0], C = CUPS[cupOf(rk)]; return TRACKS[rk] ? `${C.icon} ${esc(C.name)} race ${C.tracks.indexOf(rk) + 1}/3: ${esc(TRACKS[rk].name)}` : ""; })()} · ${CCS[raceCC].label}</p>
    <table class="k-table">${res.map(r => `<tr class="${r.name === MP.me ? "you" : ""}"><td>${ordinal(r.place)}</td><td><img src="${r.bot ? botImg(r.name) : spriteOf(r.name)}" alt=""></td><td>${r.bot ? "🤖 " : ""}${esc(r.name)}</td>
      <td>${r.ms ? fmt(r.ms) : `⏱️ ${Math.round((r.prog || 0) * 100)}%`}</td><td class="pts">+${r.pts}</td></tr>`).join("")}</table>
    <p class="k-rank">${res[0] && res[0].counted === false ? (res[0].humans != null && res[0].humans < 2 ? "⚠️ Races need at least 2 real players to count: no points or times this time." : `⚠️ Only races with 4 or more racers count: no points or times saved this time (${res[0].n} racers).`) : "🏆 Points and times saved (guild members only)."}</p>
    <div id="kNext">${mpNextHtml()}</div>`;
  $k("#kResult").hidden = false; $k("#kResult").classList.add("wide"); chatMount($k("#kResult"));
  if (mine && mine.place <= 3) confetti();
}
// after a room race: the host picks the next cup and track right here; everyone else watches the room standings (and a dancing Balrog)
function mpNextHtml() {
  const host = MP.host === MP.me, rk = roomTrack(), t = TRACKS[rk], here = new Set(MP.players.map(p => p.name)), R = mpReadyInfo();
  if (MP.next) {   // 🏆 in the middle of a cup: the standings, and a countdown to the next track
    const nt = TRACKS[MP.next.t], left = Math.max(0, Math.ceil((MP.next.at - performance.now()) / 1000));
    const order = Object.entries(MP.tally).sort((a, b) => b[1] - a[1]);   // (everyone who raced in this cup, even if they left)
    return `<div class="k-stand"><b>🏆 ${esc(CUPS[MP.next.cup].name)} standings</b>${order.map(([n, p], i) => `<span class="${n === MP.me ? "you" : ""}">${["🥇", "🥈", "🥉"][i] || ordinal(i + 1)} <img src="${(MP.tBots || {})[n] ? botImg(n) : spriteOf(n)}" alt="">${(MP.tBots || {})[n] ? "🤖 " : ""}${esc(n)}${!here.has(n) && !(MP.tBots || {})[n] ? " <small>(left)</small>" : ""} <em>${p}</em></span>`).join("")}</div>
      <div class="k-wait"><img class="k-dance" src="media/mobs/anim/jr_balrog.gif" alt=""><div><b>🏁 Race ${MP.next.n}/3: ${nt.icon} ${esc(nt.name)}</b><small id="kCupNext">${left > 0 ? `Starting in ${left}…` : "Starting…"}</small></div></div>
      <div class="row"><button class="sk-btn sk-private" data-a="lobby">🏠 Back to the lobby</button><button class="sk-btn sk-private" data-a="mpleave">🚪 Leave the room</button></div>`;
  }
  const order = Object.entries(MP.tally).sort((a, b) => b[1] - a[1]);   // (everyone who raced in this cup, even if they left)
  const stand = order.length ? `<div class="k-stand"><b>🏆 ${(() => { const lk = String(MP.track).split("@")[0], C = TRACKS[lk] && CUPS[cupOf(lk)]; return C && MP.results && C.tracks.indexOf(lk) === C.tracks.length - 1 ? `${esc(C.name)} final standings` : "Room standings"; })()}</b>${order.map(([n, p], i) => `<span class="${n === MP.me ? "you" : ""}">${["🥇", "🥈", "🥉"][i] || ordinal(i + 1)} <img src="${(MP.tBots || {})[n] ? botImg(n) : spriteOf(n)}" alt="">${(MP.tBots || {})[n] ? "🤖 " : ""}${esc(n)}${!here.has(n) && !(MP.tBots || {})[n] ? " <small>(left)</small>" : ""} <em>${p}</em></span>`).join("")}</div>` : "";
  const pick = host ? `<p class="kt-pickhead">👑 You're the host: pick the next race</p>
      <div class="kt-cuppick">${Object.entries(CUPS).map(([k, c]) => `<button type="button" data-c="${k}" class="${k === cup ? "on" : ""}"><span>${c.icon}</span>${c.name.replace(" Cup", "")}${trophyMark(k)}</button>`).join("")}</div>
      <p class="k-diff">${CUPS[cup].tracks.map(k => `${TRACKS[k].icon} ${TRACKS[k].name}`).join(" → ")}</p>
      <div class="kt-diff">${Object.entries(CCS).map(([k, c]) => `<button type="button" data-cc="${k}" class="${+k === cc ? "on" : ""}">${c.label}</button>`).join("")}</div>
      ${playerList()}${botPick()}<p class="k-diff">${countNote()}</p>
      <div class="row"><button class="sk-btn bd-play" data-a="mpgo" ${(humansIn() < 2 && !botsWant) || !R.all || MP.goBusy > performance.now() ? "disabled" : ""}>${R.all ? `🏁 Start the ${esc(CUPS[cup].name)} · ${CCS[cc].label.split(" ")[1]}!` : `⏳ Waiting for ${R.waiting.length} to be ready…`}</button></div>
      ${humansIn() < 2 && !botsWant ? `<p class="k-diff">Everyone else left… waiting for someone to join (or turn on 🤖).</p>` : !R.all ? `<p class="k-diff">Waiting for ${R.waiting.map(esc).join(", ")} to press Ready ✋</p>` : ""}`
    : `${readyBtn(R.mine)}${playerList()}<div class="k-wait"><img class="k-dance" src="media/mobs/anim/jr_balrog.gif" alt=""><div><b>⏳ ${esc(MP.host || "The host")} 👑 is picking the next race</b>
      <small>Next up: ${CUPS[cupOf(rk)].icon} ${esc(CUPS[cupOf(rk)].name)} (3 races) · ${CCS[roomCC()].label}${CUPS[cupOf(rk)].rule ? ` · ${CUPS[cupOf(rk)].rule}` : ""}</small></div></div>`;
  return `${stand}${pick}<div class="row"><button class="sk-btn sk-private" data-a="lobby">🏠 Back to the lobby</button><button class="sk-btn sk-private" data-a="mpleave">🚪 Leave the room</button></div>`;
}
setInterval(() => {
  if (!MP.next || !MP.code) return;
  if (state !== "done" || $k("#kResult").hidden) { if (state === "menu") MP.next = null; return; }   // (gone back to the lobby: the cup stops)
  const el = $k("#kCupNext"), left = Math.max(0, Math.ceil((MP.next.at - performance.now()) / 1000)); if (el) el.textContent = left > 0 ? `Starting in ${left}…` : "Starting…";
  if (MP.host === MP.me && left <= 0 && !MP.next.busy && !(MP.next.tryAt > performance.now())) {
    const nx = MP.next; nx.busy = true; track = nx.t; cup = nx.cup; if (nx.cc) cc = nx.cc;
    mpStart().then(r => { nx.busy = false; nx.tryAt = performance.now() + 2000; if (r !== "ok" && ++nx.fails >= 3 && MP.next === nx) { MP.next = null; mpRedrawNext(); } });   // (someone isn't ready: back to the start screen, which says who)
  }
  if (MP.host !== MP.me && MP.status !== "racing" && performance.now() > MP.next.at + 8000) { MP.next = null; mpRedrawNext(); }   // the host stopped the cup (or left)
}, 500);
function mpRedrawNext() { const el = $k("#kNext"); if (el && !$k("#kResult").hidden) el.innerHTML = mpNextHtml(); }
// ----- rooms: create / join / poll / start / leave
// no name yet: take them to the name box (scroll there, focus it, shake it) instead of just showing an error at the bottom
function needName(msg) {
  const i = $k("#kName"); $k("#kErr").textContent = msg; i.placeholder = "👆 Type your character name here";
  i.scrollIntoView({ behavior: "smooth", block: "center" }); try { i.focus({ preventScroll: true }); } catch (e) { i.focus(); }
  i.classList.remove("need"); void i.offsetWidth; i.classList.add("need");
}
$k("#kName").addEventListener("input", () => $k("#kName").classList.remove("need"));
const roomFromHash = () => { const m = location.hash.match(/^#kart\/([A-Z0-9]{4,8})$/); return m ? m[1] : null; };
async function mpJoin(code, pub) {
  const n = $k("#kName").value.trim().slice(0, 20);
  if (n.length < 2) { needName("👆 Type your character name first, then press Join again."); return; }
  const sb = await B.client(); if (!sb) { $k("#kErr").textContent = "Multiplayer needs the database connection."; return; }
  code = code.toUpperCase(); const g = guildOf(n), nm = g ? g.name : n;
  let tok = null; try { tok = store.get(tokKey(code)); } catch (e) {}
  const { data, error } = await sb.rpc("kart_room_join", { p_code: code, p_name: nm, p_tok: tok, p_public: !!pub });
  if (error || !data) { $k("#kErr").textContent = "Couldn't reach the room, try again."; return; }
  const why = { name: "Type your name first.", taken: "Someone in that room already has your name.", full: "That room is full (8 players).",
    running: "That room is racing right now. Try again when the race ends.", busy: "Too many rooms right now, try again soon.", code: "That room code doesn't look right." }[data.r];
  if (why) { $k("#kErr").textContent = why; return; }
  $k("#kErr").textContent = "";
  store.set(tokKey(code), data.token);
  Object.assign(MP, { code, token: data.token, me: data.name, raceNo: -1, results: null, pick: null, tally: {}, tallied: null, chat: [], watching: false }); chatDraw();
  mpChannel(sb, code);
  await mpJoinedTail(code);
}
// the live channel for positions and items; if it drops (a phone switching apps, a network blip) it rejoins by itself
function mpChannel(sb, code) {
  if (MP.ch) sb.removeChannel(MP.ch);
  const on = (ev, fn, secure) => ({ payload }) => { mpOpen(ev, payload, secure).then(p => { if (p) fn(p); }); };
  const ch = MP.ch = sb.channel("kartroom:" + code, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "pb" }, on("pb", payload => { if (payload && Array.isArray(payload.list)) for (const q of payload.list) mpOnPos({ ...q, rc: payload.rc }); }))
    .on("broadcast", { event: "p" }, on("p", mpOnPos))
    .on("broadcast", { event: "it" }, on("it", mpOnItem))
    .on("broadcast", { event: "hx" }, on("hx", mpOnHit))
    .on("broadcast", { event: "rtc" }, on("rtc", p2pOnSignal, true))
    .on("broadcast", { event: "go" }, () => mpPoll())
    .on("broadcast", { event: "rd" }, () => mpPoll())
    .on("broadcast", { event: "ch" }, on("ch", payload => { if (payload && chatAdd([{ id: payload.id, name: payload.name, msg: payload.msg }])) tone(880, .07, "triangle", .04); }))
    .on("broadcast", { event: "tr" }, on("tr", payload => { if (payload && TRACKS[payload.t] && (MP.pick !== payload.t || MP.pickCC !== payload.cc)) { MP.pick = payload.t; MP.pickCC = CCS[payload.cc] ? +payload.cc : 150; if (!$k("#kMenu").hidden) drawRoom(); else mpRedrawNext(); } }))
    .subscribe(st => { if ((st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") && MP.code === code && MP.ch === ch) setTimeout(() => { if (MP.code === code && MP.ch === ch) mpChannel(sb, code); }, 1500); });
}
async function mpJoinedTail(code) {
  if (location.hash !== "#kart/" + code) history.replaceState(null, "", "#kart/" + code);
  clearInterval(MP.poll); MP.poll = setInterval(mpPoll, 1500); await mpPoll(true);
}
async function mpPoll(first) {
  if (!MP.code || MP.polling) return; MP.polling = true;
  try {
    const racingNow = state === "race" && K && !MP.finished && MP.srvRace === MP.raceNo && performance.now() - (MP.srvAt || 0) < 4000;   // (a phone back from the background may still be in an old race)
    const prog = racingNow ? Math.max(0, Math.min(1, OPEN ? K.idx / N : (K.lap * N + (K.cps === 0 && K.idx > N * .75 ? K.idx - N : K.idx)) / (LAPS * N))) : K && !MP.finished && (state === "wait" || state === "count") ? 0 : null;   // (on the grid: 0, so the last race's spot isn't kept)
    const sb = await B.client(), q0 = performance.now(); const { data } = await sb.rpc("kart_room_state", { p_code: MP.code, p_tok: MP.token, p_prog: prog });
    { const ow = (performance.now() - q0) / 2; if (ow > 0 && ow < 1500) MP.ow = MP.ow ? (ow < MP.ow ? MP.ow * .5 + ow * .5 : MP.ow * .92 + ow * .08) : ow; }
    if (data) { MP.srvRace = data.status === "racing" ? data.race_no : null; MP.srvAt = performance.now(); }
    const bots = (state === "race" || state === "done") && K && MP.host === MP.me && data && data.status === "racing" && data.race_no === MP.raceNo ? RIV.filter(r => r.bot && !r.remote) : [];   // (not the last race's bots into a new race)
    if (bots.length) { const d = {}; for (const r of bots) d[r.name] = r.done ? { p: 1, f: Math.round(r.finishT) } : { p: +Math.max(0, Math.min(1, OPEN ? r.idx / N : (r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx)) / (LAPS * N))).toFixed(3) };
      sb.rpc("kart_room_bots", { p_code: MP.code, p_tok: MP.token, p_data: d }).then(() => {}); }   // (.then: the request is only sent once something listens)
    if (!data) return;
    if (data.r === "gone") { mpLeave(true); $k("#kErr").textContent = "You left that room."; return; }
    Object.assign(MP, { host: data.host, players: data.players || [], status: data.status, track: data.track, pub: !!data.public });
    if (data.key) await mpSetKey(data.key);
    p2pSync(); p2pPing();
    if (data.chat) chatAdd(data.chat);
    if (K && RIV.length && (state === "race" || state === "done" || state === "watch")) for (const p of MP.players) {   // the server's view of every racer (a fallback for live messages)
      const r = RIV.find(o => o.name === p.name && o.remote); if (!r) continue;
      if (p.prog != null) { r.srvProg = +p.prog; r.srvAt = performance.now(); }
      if (p.finish != null && !r.done) { r.done = true; r.finishT = p.finish; r.finish = ++finishers; }
    }
    MP.slot = Math.max(0, MP.players.findIndex(p => p.name === MP.me));
    if (data.status === "racing" && data.ends_in != null && data.race_no === MP.raceNo) MP.endAt = performance.now() + data.ends_in * 1000;
    if (first) MP.raceNo = data.status === "racing" ? data.race_no : data.race_no;   // don't jump into a race that's already running
    const meP = MP.players.find(p => p.name === MP.me), spec = !!(meP && meP.spec);
    if (data.status === "racing" && spec && !MP.watching && state === "menu") mpWatch(data);   // 👀 joined mid-race: watch it
    if (MP.watching && data.status !== "racing") stopWatch();
    if (data.status === "racing" && !spec && data.race_no > MP.raceNo && data.starts_in != null && data.starts_in > -4) {
      MP.raceNo = data.race_no; MP.goAt = performance.now() + data.starts_in * 1000; MP.results = null; MP.endAt = 0; MP.firstName = null; MP.next = null; MP.trophy = null;
      { const st = String(data.track || "").split("@")[0]; if (TRACKS[st] && CUPS[cupOf(st)].tracks.indexOf(st) === 0) { MP.tally = {}; MP.tBots = {}; } }   // 🏆 a cup's first race: fresh room standings
      if (mode !== "mp") { mode = "mp"; drawMode(); }
      start();
    }
    if (data.status === "lobby" && data.results && data.race_no === MP.raceNo && state === "race" && !MP.finished && !MP.watching) mpTimeUp();   // the race is already over on the server (you missed the 10 s clock): stop and see the results
    if (data.status === "lobby" && data.results && data.race_no === MP.raceNo && MP.finished && !MP.results) { MP.results = data.results; mpShowResults(data.results); loadBoard(); }
    if (!$k("#kMenu").hidden) drawRoom(); else if (MP.results) { mpRedrawNext(); if (MP.host === MP.me && MP.ch) mpSend("tr", { t: track, cc }); }
  } finally { MP.polling = false; }
}
async function mpStart() {
  const sb = await B.client(); const { data } = await sb.rpc("kart_room_start", { p_code: MP.code, p_tok: MP.token, p_track: cc === 150 ? track : `${track}@${cc}`, p_bots: botsWant });
  if (data && data.r === "running") return "ok";   // (already started: a double tap, or the other start got there first)
  if (!data || data.r !== "ok") { if (state === "done") { flash("Couldn't start, try again", 1200); const b = $k("[data-a=mpgo]"); if (b) b.disabled = false; } $k("#kErr").textContent = { few: "You need at least 2 players to start (or turn on 🤖 computer racers).", host: "Only the host can start.", running: "Already racing!", track: "That track isn't open for rooms yet. Pick a Henesys track.",
    notready: `Waiting for ${(data && data.who || []).join(", ")} to press Ready ✋` }[data && data.r] || "Couldn't start, try again.";
    if (data && data.r === "notready" && state === "done") flash("⏳ Not everyone is ready", 1200);
    return data && data.r === "running" ? "ok" : (data && data.r) || "err"; }
  mpSend("go", {});
  mpPoll(); return "ok";
}
const tokKey = code => "kart_room_tok:" + code + (location.hostname === "localhost" && new URLSearchParams(location.search).get("as") ? ":" + new URLSearchParams(location.search).get("as") : "");   // (testing: ?as=b is a second player)
async function mpLeave(silent) {
  const sb = await B.client();
  if (MP.code && !silent) { sb.rpc("kart_room_leave", { p_code: MP.code, p_tok: MP.token }).then(() => {}); try { store.del(tokKey(MP.code)); } catch (e) {} }
  clearInterval(MP.poll); if (MP.ch) sb.removeChannel(MP.ch); p2pClose();
  Object.assign(MP, { key: null, keyHex: null, code: null, token: null, ch: null, players: [], host: null, status: null, chat: [] });
  if (location.hash.startsWith("#kart/")) history.replaceState(null, "", "#kart");
  drawRoom();
}
function drawRoom() {
  const box = $k("#kRoomBox"); box.hidden = mode !== "mp";
  if (mode !== "mp") return;
  const host = MP.host === MP.me;
  $k("#kGo").hidden = !MP.code || !host;
  drawTrack(true);
  if (!MP.code) {
    box.innerHTML = `<div class="kt-create"><button class="sk-btn bd-play" id="kCreatePub">🌍 Public room</button><button class="sk-btn sk-private" id="kCreate">🔒 Private room</button></div>
      <div class="kt-open"><b>🌍 Open rooms</b><div id="kOpenRooms">${openRoomsHtml()}</div></div>
      <div class="kt-join"><input id="kCode" placeholder="Private room code" maxlength="8" autocapitalize="characters"><button class="sk-small" id="kJoin">Join</button></div>
      <p class="kt-modenote">Public rooms show up in the list for everyone, private rooms are joined with their link or code. 2–8 players; whoever enters first is the host 👑. Points and race times only count with 4 or more racers.</p>`;
    loadOpenRooms();
    return;
  }
  const link = location.href.split("#")[0] + "#kart/" + MP.code, R = mpReadyInfo();
  let main = box.querySelector("#kRoomMain"); if (!main) { box.innerHTML = `<div id="kRoomMain"></div>`; main = box.firstChild; }
  main.innerHTML = `<div class="kt-roomhead"><b>${MP.pub ? "🌍 Public" : "🔒 Private"} room ${MP.code}</b> · ${MP.players.length}/8 · ${TRACKS[roomTrack()].icon} ${esc(TRACKS[roomTrack()].name)} · ${CCS[roomCC()].label}</div>
    ${MP.pub ? `<p class="kt-modenote">Anyone can join from the Open rooms list on the Family Kart page.</p>` : `<p class="kt-modenote kt-p2p">🔒 This room's messages are encrypted: only players in it can read them.
      <button class="sk-small" id="kP2P">${store.get("kart_p2p") === "0" ? "⚡ Direct connection: Off" : "⚡ Direct connection: On"}</button>
      <small>${store.get("kart_p2p") === "0" ? "Everything goes through the server (a little more delay)." : "Faster: your game talks straight to your friends' games (encrypted). They can see your internet address, like in a video call."}</small></p>`}
    <div class="bd-inv"><input id="kInvite" readonly value="${esc(link)}"><button class="sk-small" id="kCopy">Copy</button></div>
    ${playerList()}
    ${!host && MP.status !== "racing" ? readyBtn(R.mine) : ""}
    ${!host && MP.status !== "racing" ? `<div class="k-wait"><img class="k-dance" src="media/mobs/anim/jr_balrog.gif" alt=""><div><b>⏳ ${esc(MP.host || "The host")} 👑 is picking the race</b>
      <small>Next up: ${TRACKS[roomTrack()].icon} ${esc(TRACKS[roomTrack()].name)} · ${CCS[roomCC()].label}</small></div></div>` : ""}
    ${host && MP.status !== "racing" ? botPick() : ""}
    ${MP.status !== "racing" && countNote() ? `<p class="kt-modenote">${countNote()}</p>` : ""}
    <p class="kt-modenote">${MP.status === "racing" ? "A race is on…" : host ? (humansIn() < 2 ? (botsWant ? "Race the 🤖 bots now, or wait for friends: " : "") + (MP.pub ? "others can join from the Open rooms list." : "share the link to invite others!") : R.all ? "Everyone's ready ✅ Pick a cup and track below, then start!" : `You're the host 👑: pick a cup and track below. Waiting for ${R.waiting.map(esc).join(", ")} to press Ready ✋`) : R.mine ? "You're ready ✅ The race starts when the host presses Start." : "Press ✋ Ready so the host can start the race."}</p>
    <button class="sk-small" id="kRoomLeave">🚪 Leave the room</button>`;
  chatMount(box);
  const solo = humansIn() < 2;
  $k("#kGo").textContent = solo ? (botsWant ? "🤖 Race the bots!" : "🏁 Start the race!") : R.all ? "🏁 Everyone's ready: Start!" : `⏳ Waiting for ${R.waiting.length} to be ready…`;
  $k("#kGo").disabled = (solo && !botsWant) || !R.all;
}
// 🤖 computer racers: the host fills empty seats up to 4 or 8 racers (or none)
let botsWant = store.get("kart_bots") != null && [0, 4, 8].includes(+store.get("kart_bots")) ? +store.get("kart_bots") : 4;   // "Fill to 4" unless you picked something else
const humansIn = () => (MP.players || []).filter(p => !p.bot).length;
const botPick = () => `<div class="kt-diff kt-bots"><span>🤖 Computer racers:</span>${[[0, "Off"], [4, "Fill to 4"], [8, "Fill to 8"]].map(([v, l]) => `<button type="button" data-bots="${v}" class="${botsWant === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
function countNote() {   // will this race count for points and times?
  const h = humansIn(), total = botsWant ? Math.max(h, botsWant) : h;
  if (h < 2) return botsWant ? "ℹ️ Just you: race the 🤖 bots for fun. Points and times need at least 2 real players." : "";
  return total < 4 ? `ℹ️ ${total} racers: this race won't count for points or times (needs 4+, turn on 🤖 to fill seats).` : "✅ This race counts for 🏆 points and 🏁 race times.";
}
function setBots(v) { botsWant = v; store.set("kart_bots", v); if (!$k("#kMenu").hidden) drawRoom(); else mpRedrawNext(); }
// ✋ Ready: everyone but the host has to press it before the host can start (the host's Start is their ready)
function mpReadyInfo() {
  const others = (MP.players || []).filter(p => p.name !== MP.host && !p.bot), waiting = others.filter(p => !p.ready).map(p => p.name), me = (MP.players || []).find(p => p.name === MP.me);
  return { all: !waiting.length, waiting, mine: !!(me && me.ready) };
}
const playerList = () => `<div class="kt-plist">${MP.players.filter(p => !p.bot).map(p => `<div class="kt-pl${p.name === MP.me ? " me" : ""}${p.name === MP.host || p.ready ? " rdy" : ""}"><img src="${spriteOf(p.name)}" alt=""><b>${esc(p.name)}</b>
  <em>${p.name === MP.host ? "👑 host" : p.ready ? "✅ ready" : "⏳ not ready"}</em></div>`).join("")}</div>`;
const readyBtn = mine => `<button type="button" class="sk-btn kt-readybtn${mine ? " on" : ""}" data-ready="${mine ? 0 : 1}">${mine ? "✅ I'm ready! <small>(tap to cancel)</small>" : "✋ Ready!"}</button>`;
async function mpReady(v) {
  if (!MP.code) return;
  if (v) askFull();   // a tap is the only moment phones allow fullscreen, and the race is about to start
  const p = MP.players.find(q => q.name === MP.me); if (p) p.ready = v;
  if (!$k("#kMenu").hidden) drawRoom(); else mpRedrawNext();
  const sb = await B.client(); await sb.rpc("kart_room_ready", { p_code: MP.code, p_tok: MP.token, p_ready: v });
  mpSend("rd", {}); mpPoll();
}
// 💬 room chat: one box that moves between the room menu and the results screen (so what you're typing never gets wiped)
const chatEl = document.createElement("div"); chatEl.className = "kt-chat";
chatEl.innerHTML = `<b class="kt-chathead">💬 Room chat</b><div class="kt-chatlog"></div><form class="kt-chatin"><input maxlength="120" placeholder="Say something to the room…" autocomplete="off" enterkeyhint="send"><button class="sk-small" type="submit">Send</button></form>`;
const chatLog = chatEl.querySelector(".kt-chatlog"), chatIn = chatEl.querySelector("input");
function chatAdd(list) {
  if (!MP.chat) MP.chat = [];
  let added = false; for (const m of list) if (m && m.id && !MP.chat.some(c => c.id === m.id)) { MP.chat.push(m); added = true; }
  if (added) { MP.chat.sort((a, b) => a.id - b.id); MP.chat = MP.chat.slice(-60); chatDraw(); }
  return added;
}
function chatDraw() {
  const end = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40, list = MP.chat || [];
  chatLog.innerHTML = list.length ? list.map(m => `<div class="${m.name === MP.me ? "me" : ""}"><img src="${spriteOf(m.name)}" alt=""><b>${esc(m.name)}</b><span>${esc(m.msg)}</span></div>`).join("")
    : `<p class="bd-none">No messages yet. Say hi! 👋</p>`;
  if (end) chatLog.scrollTop = chatLog.scrollHeight;
}
chatEl.querySelector("form").addEventListener("submit", async e => {
  e.preventDefault(); const m = chatIn.value.trim(); if (!m || !MP.code) return; chatIn.value = "";
  const sb = await B.client(); const { data } = await sb.rpc("kart_room_say", { p_code: MP.code, p_tok: MP.token, p_msg: m });
  if (data && data.r === "ok") { chatAdd([data]); mpSend("ch", { id: data.id, name: data.name, msg: data.msg }); } else chatIn.value = m;
});
const chatMount = parent => { if (chatEl.parentNode !== parent) { parent.appendChild(chatEl); chatDraw(); } };
function askFull() { if (!TOUCH) return; try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {}); } catch (e) {} }
$k("#kRoomBox").addEventListener("click", e => {
  const newCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  if (e.target.id === "kCreate") mpJoin(newCode());
  if (e.target.id === "kCreatePub") mpJoin(newCode(), true);
  const or = e.target.closest("[data-room]"); if (or && !or.disabled) mpJoin(or.dataset.room);
  if (e.target.id === "kJoin") { const c = ($k("#kCode").value || "").trim().toUpperCase(); if (c) mpJoin(c); }
  if (e.target.id === "kRoomLeave") mpLeave();
  if (e.target.id === "kP2P") { store.set("kart_p2p", store.get("kart_p2p") === "0" ? "1" : "0"); if (store.get("kart_p2p") === "0") p2pClose(); else { MP.p2pGaveUp = {}; p2pSync(); } drawRoom(); }
  const rb = e.target.closest("[data-ready]"); if (rb) mpReady(rb.dataset.ready === "1");
  const bb = e.target.closest("[data-bots]"); if (bb) setBots(+bb.dataset.bots);
  if (e.target.id === "kCopy") { const i = $k("#kInvite"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (er) { document.execCommand("copy"); } e.target.textContent = "Copied!"; setTimeout(() => e.target.textContent = "Copy", 1200); }
});
// 🌍 the open public rooms, refreshed every few seconds while you look at the multiplayer menu
let openRooms = null, openRoomsT = 0;
function openRoomsHtml() {
  if (!openRooms) return `<p class="bd-none">Looking for rooms…</p>`;
  if (!openRooms.length) return `<p class="bd-none">No open rooms right now. Make a public one and others can hop in!</p>`;
  return openRooms.map(r => `<button type="button" class="kt-oroom" data-room="${esc(r.code)}" ${r.n >= 8 ? "disabled" : ""}>
    <img src="${spriteOf(r.host)}" alt=""><span><b>${esc(r.host)}'s room</b><small>${r.status === "racing" && TRACKS[r.track.split("@")[0]] ? `${TRACKS[r.track.split("@")[0]].icon} ${esc(TRACKS[r.track.split("@")[0]].name)}` : "👥 in the lobby"} · ${r.n}/8</small></span>
    <em>${r.n >= 8 ? "full" : r.status === "racing" ? "👀 Watch" : "Join ▶"}</em></button>`).join("");
}
async function loadOpenRooms() {
  if (performance.now() - openRoomsT < 2500) return; openRoomsT = performance.now();
  const sb = await B.client(); if (!sb) return;
  const { data } = await sb.rpc("kart_room_list"); openRooms = Array.isArray(data) ? data : [];
  const el = $k("#kOpenRooms"); if (el) el.innerHTML = openRoomsHtml();
}
setInterval(() => { if (mode === "mp" && !MP.code && !$k("#kMenu").hidden && location.hash.startsWith("#kart") && !document.hidden) loadOpenRooms(); }, 4000);
function hashRoom() {
  const c = roomFromHash(); if (!c) return;
  document.querySelectorAll("section").forEach(sec => sec.classList.toggle("on", sec.id === "kart"));
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#kart"));
  if (mode !== "mp") { mode = "mp"; drawMode(); drawTrack(); }
  if (MP.code !== c) { if ($k("#kName").value.trim().length >= 2) mpJoin(c); else { drawRoom(); if ($k("#kCode")) $k("#kCode").value = c; needName(`👆 Type your name, then press Join to enter room ${c}.`); } }
}
addEventListener("hashchange", hashRoom);
setTimeout(hashRoom, 60);
// 👀 watching a room race you joined in the middle of: the camera follows one racer (tap or ← → to switch); you're in for the next race
async function mpWatch(data) {
  if (MP.watching) return; MP.watching = true; const my = ++raceId;
  const [mk, mcc] = String(MP.track || "henesys").split("@"), key = TRACKS[mk] ? mk : "henesys";
  raceCC = CCS[mcc] ? +mcc : 150; SPD = CCS[raceCC].spd; me = MP.me;
  $k("#kMenu").hidden = true; $k("#kResult").hidden = true; $k("#kGame").hidden = false; $k("#kart").classList.add("racing", "watching"); document.body.classList.add("bd-playing");
  state = "loading";
  if (!assetsReady || TRACK_KEY !== key) { $k("#kLoad").hidden = false; await new Promise(r => setTimeout(r, 30)); if (!assetsReady) await prepare(); loadTrack(key); await loadArt(); $k("#kLoad").hidden = true; }
  if (my !== raceId || !MP.watching) return;
  fit(); K = freshKart(); K.watch = true; setupHazards(); PETALS = []; FWK = []; LAVA = null; makeRivals(); MP.watchI = 0;
  MP.watchT0 = performance.now() + (data.starts_in || 0) * 1000;
  state = "watch"; B.music(T.music); syncMusicBtn();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}
function stopWatch() {
  if (!MP.watching) return; MP.watching = false; quit();
  $k("#kErr").textContent = "🏁 That race is over: you're in for the next one! Press ✋ Ready."; drawRoom();
}
const watchLive = () => RIV.filter(r => r.net && !r.gone);
function watchStep(dt) {
  for (const r of RIV) if (r.remote) remoteStep(r, dt);
  for (let i = SHOTS.length - 1; i >= 0; i--) { const sh = SHOTS[i]; sh.life -= dt; sh.x += Math.cos(sh.a) * sh.v * dt * SPD; sh.y += Math.sin(sh.a) * sh.v * dt * SPD; if (sh.life <= 0) SHOTS.splice(i, 1); }
  for (let i = BOMBS.length - 1; i >= 0; i--) { const b = BOMBS[i]; b.t += dt; b.vz -= 560 * dt; b.z += b.vz * dt; b.x += Math.cos(b.a) * b.v * dt * SPD; b.y += Math.sin(b.a) * b.v * dt * SPD;
    if (b.z <= 0) { BOMBS.splice(i, 1); BOOMS.push({ x: b.x, y: b.y, t: 0, debris: [] }); } }
  for (let i = BOOMS.length - 1; i >= 0; i--) if ((BOOMS[i].t += dt) > 1.6) BOOMS.splice(i, 1);
  for (let i = DROPS.length - 1; i >= 0; i--) if ((DROPS[i].t -= dt) <= 0) DROPS.splice(i, 1);
  const live = watchLive(); K.t = Math.max(0, performance.now() - MP.watchT0); if (!live.length) return;
  MP.watchI = ((MP.watchI % live.length) + live.length) % live.length;
  const t = live[MP.watchI]; Object.assign(K, { x: t.x, y: t.y, a: t.a, ma: t.a, v: t.v, z: t.z || 0, idx: t.idx || K.idx, steer: 0 });
}
function watchHud() {
  const live = watchLive(), t = live[MP.watchI], order = live.slice().sort((a, b) => progOf(b) - progOf(a)), rk = t ? order.indexOf(t) + 1 : 0;
  $k("#kLap").textContent = t ? (OPEN ? `🏔️ ${Math.min(100, Math.round(Math.max(0, (t.idx || 0) - START_I) / (N - FIN_OFF - START_I) * 100))}%` : `LAP ${Math.min((t.lap || 0) + 1, LAPS)}/${LAPS}`) : "";
  $k("#kTime").textContent = fmt(K.t); $k("#kBest").textContent = t ? `👀 ${t.bot ? "🤖 " : ""}${t.name}` : "👀 Waiting for the racers…";
  $k("#kPos").textContent = rk ? ordinal(rk) : ""; $k("#kPos").className = "kt-pos p" + rk;
  $k("#kSpeed").textContent = t ? `${Math.max(0, Math.round(t.v * .5 * SPD))} km/h` : ""; $k("#kWrong").hidden = true; $k("#kItem2").hidden = true;
  const w = "👀 Watching · tap the screen or ← → to switch racer · you're in for the next race";
  if ($k("#kWarn").textContent !== w) { $k("#kWarn").textContent = w; $k("#kWarn").className = "kt-warn"; } $k("#kWarn").hidden = false;
}
const watchNext = d => { if (state === "watch") { MP.watchI += d; tone(660, .05, "triangle", .04); } };
$k(".kt-screen").addEventListener("click", e => { if (state === "watch" && !e.target.closest("button, .kt-result")) watchNext(1); });
addEventListener("keydown", e => { if (state !== "watch") return; if (e.key === "ArrowRight") watchNext(1); if (e.key === "ArrowLeft") watchNext(-1); });
// the Grand Prix podium: top 3 on the steps, a trophy for you, confetti
function podium() {
  const order = Object.entries(gp.pts).sort((a, b) => b[1] - a[1]), myPlace = order.findIndex(([n]) => n === me) + 1;
  gp.over = true;
  const step = (i, h) => { const e = order[i]; if (!e) return ""; return `<div class="pd-step p${i + 1}"><img src="${spriteOf(e[0])}" alt=""><b>${esc(e[0])}</b><small>${e[1]} pts</small>
    <div class="pd-block" style="height:${h}px">${i + 1}</div></div>`; };
  const cn = CUPS[gp.cup].name, title = myPlace === 1 ? `🏆 You won the ${cn}!` : myPlace <= 3 ? `${["", "", "🥈", "🥉"][myPlace]} ${ordinal(myPlace)} in the ${cn}!` : `You finished ${ordinal(myPlace)} in the ${cn}`;
  $k("#kResult").innerHTML = `<h3>${title}</h3><div class="pd">${step(1, 56)}${step(0, 84)}${step(2, 40)}</div>
    <table class="k-table">${order.map(([n, p], i) => `<tr class="${n === me ? "you" : ""}"><td>${ordinal(i + 1)}</td><td><img src="${spriteOf(n)}" alt=""></td><td>${esc(n)}</td><td class="pts">${p} pts</td></tr>`).join("")}</table>
    <div class="row"><button class="sk-btn bd-play" data-a="again">New Grand Prix</button><button class="sk-btn sk-private" data-a="back">Back</button></div>`;
  if (myPlace <= 3) { confetti(); B.sound("win"); }
}
function confetti() {
  const box = $k(".kt-screen");
  for (let i = 0; i < 60; i++) { const c = document.createElement("i"); c.className = "k-conf"; c.style.left = Math.random() * 100 + "%";
    c.style.background = ["#c8232c", "#ffd75e", "#fff", "#4682be", "#6eaa64"][i % 5]; c.style.animationDelay = Math.random() * 1.2 + "s"; c.style.animationDuration = 2 + Math.random() * 1.5 + "s";
    box.appendChild(c); setTimeout(() => c.remove(), 4500); }
}
function quit() {
  raceId++; state = "menu"; $k("#kart").classList.remove("watching"); B.musicRate(1); leaveLandscape(); lockZoom(false); $k("#kRotate").hidden = true; $k("#kart").classList.remove("rot"); rotWas = null; cancelAnimationFrame(raf); raf = 0; stopEngine(); B.music(null);
  $k("#kGame").hidden = true; $k("#kMenu").hidden = false; $k("#kResult").hidden = true;
  $k("#kart").classList.remove("racing"); document.body.classList.remove("bd-playing"); showBest();
}
async function submit(laps) {
  if (DEV) return { r: "dev" };   // local test races never touch the real board
  const sb = await B.client(); if (!sb) return null;
  const { data } = await sb.rpc("kart_submit", { p_track: ccId(TRACK_ID, raceCC), p_name: me, p_laps: laps.map(Math.round), p_ghost: JSON.stringify(ghostRec) });
  loadBoard(); return data;
}
let boardView = "time";   // the guild board shows Time Trial times by default; Points (from multiplayer races) on request
async function loadBoard() {
  const sb = await B.client(); if (!sb) return;
  document.querySelectorAll("#kBoardTabs [data-b]").forEach(b => b.classList.toggle("on", b.dataset.b === boardView));
  if (boardView === "points") {
    $k("#kBoardHead").textContent = "🏆 Points · guild races with 4+ racers";
    const { data } = await sb.from("kart_points").select("player,points,races,wins").gt("races", 0).order("points", { ascending: false }).order("wins", { ascending: false }).limit(10);
    $k("#kBoard").innerHTML = (data || []).length ? data.map(r => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b>
      <span>${r.points} pts</span><small>${r.wins} 🥇 · ${r.races} races</small></li>`).join("") : `<p class="bd-none">No points yet. Win a multiplayer race to get on the board!</p>`;
    return;
  }
  if (boardView === "race") {   // 🏁 best finishing times from guild races (only races with 4+ racers count)
    const t = TRACKS[track];
    $k("#kBoardHead").textContent = `🏁 Race times · ${t.name} · ${CCS[cc].label} (guild races, 4+ racers)`;
    const { data } = await sb.from("kart_race_times").select("player,best_ms,races").eq("track", cc === 150 ? track : `${track}_${cc}`).order("best_ms").limit(10);
    $k("#kBoard").innerHTML = (data || []).length ? data.map(r => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b>
      <span>${fmt(r.best_ms)}</span><small>${r.races} race${r.races === 1 ? "" : "s"}</small></li>`).join("") : `<p class="bd-none">No race times here yet. Race it in a room with 4 or more players!</p>`;
    return;
  }
  const bt = TRACKS[mode === "gp" ? CUPS[cup].tracks[0] : track];
  $k("#kBoardHead").textContent = `⏱️ Times · ${bt.name} · ${CCS[cc].label} (Time Trial)`;
  const { data } = await sb.from("kart_times").select("player,race_ms,lap_ms").eq("track", ccId(bt.id, cc)).order("race_ms").limit(10);
  if (mode === "tt") $k("#kModeNote").textContent = data && data[0] ? `🔥 150cc. You'll race 🏆 ${data[0].player}'s ghost (${fmt(data[0].race_ms)}), the guild record. Only Time Trial times go on the board.`
    : "Alone at 🔥 150cc with 3 Elixirs. No guild record yet on this track: set the first one and everyone will race your ghost!";
  $k("#kBoard").innerHTML = (data || []).length ? data.map((r, i) => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b>
    <span>${fmt(r.race_ms)}</span><small>${bt.open ? "" : `lap ${fmt(r.lap_ms)}`}</small></li>`).join("") : `<p class="bd-none">No times yet. Be the first!</p>`;
}
if (location.hash === "#kart") loadBoard();
addEventListener("hashchange", () => { if (location.hash === "#kart") loadBoard(); });
function showBest() {
  const bt = TRACKS[mode === "gp" ? CUPS[cup].tracks[0] : track], n = ($k("#kName").value || "").trim(), g = n && guildOf(n), key = `kart_best2:${ccId(bt.id, cc)}:${g ? g.name : n}`;
  let b = null; try { b = JSON.parse(store.get(key)); } catch (e) {}
  $k("#kMine").innerHTML = b && b.race ? `🏆 Your best: ${bt.open ? "run" : "race"} <b>${fmt(b.race)}</b>${bt.open ? "" : ` · lap <b>${fmt(b.lap)}</b>`}` : "No time yet on this track. Go set one!";
}
$k("#kGo").onclick = () => { if (mode === "mp") { track = CUPS[cup].tracks[0]; MP.next = null; askFull(); mpStart(); } else start(); };
// the room's track as everyone should see it: the host's own pick, or what the host last told the room
const roomTrack = () => { const st = String(MP.track || "").split("@")[0]; return MP.host === MP.me ? track : TRACKS[MP.pick] ? MP.pick : TRACKS[st] ? st : "henesys"; };
const roomCC = () => { const sc = String(MP.track || "").split("@")[1]; return MP.host === MP.me ? cc : MP.pick ? (MP.pickCC || 150) : CCS[sc] ? +sc : 150; };
function drawTrack(light) {
  if (!CUPS[cup].tracks.includes(track)) track = CUPS[cup].tracks[0];
  const inRoom = mode === "mp" && !!MP.code, rk = inRoom ? roomTrack() : track, C = CUPS[inRoom ? cupOf(rk) : cup];
  const t = TRACKS[mode === "gp" ? C.tracks[0] : rk], pickHidden = mode === "mp" && !!MP.code && MP.host !== MP.me;
  $k("#kCupPick").innerHTML = Object.entries(CUPS).map(([k, c]) => `<button type="button" data-c="${k}" class="${k === cup ? "on" : ""}"><span>${c.icon}</span>${c.name.replace(" Cup", "")}${trophyMark(k)}</button>`).join("");
  $k("#kCupPick").hidden = pickHidden;
  $k("#kTrackPick").innerHTML = CUPS[cup].tracks.map(k => `<button type="button" data-t="${k}" class="${k === track ? "on" : ""}">${TRACKS[k].icon} ${TRACKS[k].name}</button>`).join("");
  $k("#kTrackPick").hidden = mode === "gp" || mode === "mp" || pickHidden;   // (multiplayer races whole cups)
  $k("#kCC").hidden = pickHidden || mode === "tt";   // Time Trial is always 150cc
  const rule = C.rule ? `<small class="kt-rule">${C.rule}</small>` : "";
  $k("#kPickHead").hidden = !(mode === "mp" && (!inRoom || MP.host === MP.me));
  $k("#kPickHead").textContent = inRoom ? "👑 Pick the cup: its 3 races are played one after another" : "Pick the cup for your room";
  $k("#kTrackCard").innerHTML = mode === "gp" ? `<b>🏆 ${C.name}</b><small>${C.tracks.map(c => TRACKS[c].icon + " " + TRACKS[c].name).join(" → ")}</small>${rule}`
    : mode === "mp" ? `<b>🏆 ${C.name}: 3 races in a row</b><small>${C.tracks.map(c => (inRoom && c === rk ? "▶ " : "") + TRACKS[c].icon + " " + TRACKS[c].name).join(" → ")}${inRoom ? " · " + CCS[roomCC()].label : ""}</small>${rule}${!inRoom ? `<small>Make a room and you're the host 👑: your room races this cup.</small>` : ""}`
    : `<b>${t.icon} ${t.name}</b><small>${t.open ? "one long climb" : "3 laps"} · ${inRoom ? CCS[roomCC()].label + " · " : ""}${t.sub}</small>${rule}${mode === "mp" && !inRoom ? `<small>Make a room and you're the host 👑: this is the first race.</small>` : ""}`;
  $k(".kt-track img").src = (t.art || HEN_ART).sky;
  if (mode === "gp") $k("#kGo").textContent = `🏆 Start the ${C.name}!`;
  $k("#kBoardName").textContent = t.name;
  if (inRoom && MP.host === MP.me && MP.ch) mpSend("tr", { t: track, cc });   // tell the room what the host picked
  if (!light) { showBest(); loadBoard(); }
}
$k("#kBoardTabs").addEventListener("click", e => { const b = e.target.closest("[data-b]"); if (!b) return; boardView = b.dataset.b; loadBoard(); });
$k("#kTrackPick").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (!b) return; track = b.dataset.t; store.set("kart_track", track); drawTrack(); });
$k("#kCupPick").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; cup = b.dataset.c; store.set("kart_cup", cup); track = CUPS[cup].tracks[0]; store.set("kart_track", track); gp = null; drawTrack(); });
function drawMode() {
  cc = mode === "tt" ? 150 : CCS[store.get("kart_cc")] ? +store.get("kart_cc") : 100;   // Time Trial is always 150cc; Multiplayer keeps your pick
  document.querySelectorAll("#kCC [data-cc], #kResult [data-cc]").forEach(b => b.classList.toggle("on", +b.dataset.cc === cc));
  document.querySelectorAll("#kMode [data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
  $k("#kDiff").hidden = mode === "tt" || mode === "mp"; $k("#kMine").hidden = mode === "mp";   // your best time is about solo tracks, not rooms
  $k("#kGo").textContent = { gp: `🏆 Start the ${CUPS[cup].name}!`, race: "🏁 Start race!", tt: "⏱️ Start Time Trial!", mp: "🏁 Start the race!" }[mode];
  $k("#kGo").hidden = false; $k("#kGo").disabled = false;
  $k("#kModeNote").textContent = { gp: "3 races against the same 7 computer rivals (cup points only, nothing on the board).", race: "One race against 7 computer rivals (no board points).",
    tt: "Alone at 🔥 150cc with 3 Elixirs against your ghost. Only Time Trial times go on the guild board.", mp: "Race guild members live (🤖 computer racers can fill empty seats). Races with 4+ racers and 2+ real players earn 🏆 points and save your 🏁 race time." }[mode];
  drawRoom();
}
$k("#kMode").addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (!b) return; if (mode === "mp" && b.dataset.m !== "mp" && MP.code) mpLeave(); mode = b.dataset.m; store.set("kart_mode", mode); gp = null; drawMode(); drawTrack(); });
drawMode(); drawTrack();
$k("#kHow").open = matchMedia("(min-width: 901px)").matches;   // "How to drive" starts folded on phones so the board is close
function drawCC() { document.querySelectorAll("#kCC [data-cc], #kResult [data-cc]").forEach(b => b.classList.toggle("on", +b.dataset.cc === cc)); }
$k("#kCC").addEventListener("click", e => { const b = e.target.closest("[data-cc]"); if (!b) return; cc = +b.dataset.cc; store.set("kart_cc", cc); drawCC(); drawTrack(); if (mode === "mp" && MP.code) drawRoom(); });
drawCC();
function drawDiff() { document.querySelectorAll("#kDiff [data-d]").forEach(b => b.classList.toggle("on", b.dataset.d === diff)); }
$k("#kDiff").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (!b) return; diff = b.dataset.d; store.set("kart_diff", diff); drawDiff(); });
drawDiff();
// name search with pictures (like Bonk Duel), and your character shown big
const ROSTER = (typeof D !== "undefined" ? [...D.founders, ...D.members] : []).filter((p, i, a) => p && p.name && a.findIndex(q => q.name === p.name) === i);
function kShowFace() {
  const n = $k("#kName").value.trim(), g = guildOf(n);
  $k("#kFace").innerHTML = `<img src="${n ? spriteOf(g ? g.name : n) : B.M + "guest.png?v=2"}" alt="">`;
  $k("#kGuest").hidden = !n || !!g;
}
let kSuggIdx = -1;
function kSuggest() {
  const q = $k("#kName").value.trim().toLowerCase(), box = $k("#kSugg");
  if (!q) { box.hidden = true; return; }
  const hits = ROSTER.filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length).slice(0, 8);
  if (!hits.length || (hits.length === 1 && hits[0].name.toLowerCase() === q)) { box.hidden = true; return; }
  kSuggIdx = -1;
  box.innerHTML = hits.map(p => `<button type="button" data-n="${esc(p.name)}">${p.sprite ? `<img src="${p.sprite}" alt="">` : "<span style='width:34px'>👤</span>"} ${esc(p.name)}</button>`).join("");
  box.hidden = false;
}
const kPick = n => { $k("#kName").value = n; $k("#kSugg").hidden = true; kShowFace(); showBest(); };
$k("#kSugg").addEventListener("pointerdown", e => { const b = e.target.closest("button"); if (!b) return; e.preventDefault(); kPick(b.dataset.n); });
$k("#kName").addEventListener("blur", () => setTimeout(() => $k("#kSugg").hidden = true, 150));
$k("#kName").addEventListener("keydown", e => {
  const items = [...$k("#kSugg").querySelectorAll("button")];
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items.length && !$k("#kSugg").hidden) { e.preventDefault();
    kSuggIdx = (kSuggIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("on", i === kSuggIdx)); }
  if (e.key === "Enter") { e.preventDefault();
    if (kSuggIdx >= 0 && items[kSuggIdx] && !$k("#kSugg").hidden) kPick(items[kSuggIdx].dataset.n);
    else if (mode !== "mp") start(); }
});
$k("#kName").addEventListener("input", () => { showBest(); kShowFace(); kSuggest(); });
$k("#kName").value = store.get("family_me") || "";
showBest(); kShowFace();
// ✕ during a race needs a second tap, so a stray thumb doesn't throw the race away
let leaveArm = 0;
$k("#kLeave").onclick = () => {
  if ((state === "race" || state === "count") && performance.now() - leaveArm > 2200) { leaveArm = performance.now(); flash("Tap ✕ again to leave", 2000); return; }
  quit();
};
$k("#kResult").addEventListener("click", e => {
  const rb0 = e.target.closest("[data-ready]"); if (rb0) { mpReady(rb0.dataset.ready === "1"); return; }   // (these buttons have no data-a: handle them first)
  const bb0 = e.target.closest("[data-bots]"); if (bb0) { setBots(+bb0.dataset.bots); return; }
  const a = e.target.closest("[data-a]"); if (!a) return;
  if (a.dataset.a === "again") { if (mode === "gp") gp = null; start(); }
  if (a.dataset.a === "next") { gp.race++; start(); }
  if (a.dataset.a === "podium") podium();
  if (a.dataset.a === "back") { gp = null; quit(); }
  if (a.dataset.a === "room") quit();
  if (a.dataset.a === "mpgo") { if (MP.goBusy > performance.now()) return; MP.goBusy = performance.now() + 3000; a.disabled = true; track = CUPS[cup].tracks[0]; MP.next = null; askFull(); mpStart().then(r => { if (r !== "ok") MP.goBusy = 0; }); }   // (a new cup starts at its first race)
  if (a.dataset.a === "lobby") { MP.next = null; quit(); drawRoom(); }   // back to the room's lobby (you stay in the room)
  if (a.dataset.a === "mpleave") { MP.next = null; mpLeave(); quit(); }
});
$k("#kResult").addEventListener("click", e => {   // the host's cup / track pick on the results screen
  const c = e.target.closest("[data-c]"), t = e.target.closest("[data-t]"), v = e.target.closest("[data-cc]"); if (!c && !t && !v) return;
  if (c) { cup = c.dataset.c; track = CUPS[cup].tracks[0]; } else if (t) track = t.dataset.t; else { cc = +v.dataset.cc; store.set("kart_cc", cc); drawCC(); }
  store.set("kart_cup", cup); store.set("kart_track", track);
  if (MP.ch && MP.host === MP.me) mpSend("tr", { t: track, cc });
  mpRedrawNext();
});
const syncMusicBtn = () => { $k("#kMusic").textContent = B.musicOn && B.musicOn() ? "🔊" : "🔇"; };
$k("#kMusic").onclick = () => { B.toggleMusic(); syncMusicBtn(); };
syncMusicBtn();
addEventListener("hashchange", () => { if (location.hash !== "#kart" && state !== "menu") quit(); });

// keyboard + touch buttons
const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Shift", "a", "d", "s", "w", "e"];
addEventListener("keydown", e => { if (e.target && e.target.closest && e.target.closest("input, textarea")) return; if (state === "menu" || $k("#kGame").hidden || !GAME_KEYS.includes(e.key)) return; keys[e.key] = true; e.preventDefault(); });
addEventListener("keyup", e => { keys[e.key] = false; });
addEventListener("blur", () => { keys = {}; touch = { x: 0, d: 0, b: 0, i: 0 }; stickSet(0); });
document.querySelectorAll("#kPad [data-k]").forEach(b => {
  const on = v => e => { e.preventDefault(); touch[b.dataset.k] = v; b.classList.toggle("on", !!v); };
  b.addEventListener("pointerdown", e => { try { b.setPointerCapture(e.pointerId); } catch (er) {} on(1)(e); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => b.addEventListener(ev, on(0)));
  b.addEventListener("contextmenu", e => e.preventDefault());
});
// steering joystick: a round stick. Put your thumb down anywhere on it and push from THERE (touching it never turns you by itself);
// the knob follows your thumb all round, only left / right steers: a small dead zone, gentle near the middle, full lock at the edge
const stick = $k("#kStick"), knob = stick.querySelector("i");
let stickId = null, stickX0 = 0, stickY0 = 0, knob0 = [0, 0];
const gameXY = (x, y) => rotWas ? [y, -x] : [x, y];   // screen movement -> the game's own left/right and up/down
const stickRange = () => stick.clientWidth * .3;
function stickSet(v, px = 0, py = 0) {
  const a = Math.abs(v), dz = .1; touch.x = a < dz ? 0 : Math.sign(v) * Math.pow((a - dz) / (1 - dz), 1.35);
  knob.style.transform = `translate(${px}px, ${py}px)`;
}
const knobClamp = (x, y) => { const lim = stick.clientWidth / 2 - 26, d = Math.hypot(x, y); return d > lim ? [x / d * lim, y / d * lim] : [x, y]; };
stick.addEventListener("pointerdown", e => {
  e.preventDefault(); stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (er) {}
  const r = stick.getBoundingClientRect(), [gx, gy] = gameXY(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); stickX0 = e.clientX; stickY0 = e.clientY; knob0 = knobClamp(gx, gy);
  stick.classList.add("on"); stickSet(0, ...knob0);
});
function stickMove(e) {
  if (e.pointerId !== stickId) return;
  const R = stickRange(), [dx, dy] = gameXY(e.clientX - stickX0, e.clientY - stickY0);
  stickSet(Math.max(-1, Math.min(1, dx / R)), ...knobClamp(knob0[0] + dx, knob0[1] + dy));
}
stick.addEventListener("pointermove", stickMove);
const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; stick.classList.remove("on"); stickSet(0); };
["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => stick.addEventListener(ev, stickEnd));
stick.addEventListener("contextmenu", e => e.preventDefault());
// after turning the phone sideways, the first touch goes fullscreen (browsers only allow it right after a tap)
let fullTries = 0;
const wantFull = () => TOUCH && state !== "menu" && !document.fullscreenElement && !!document.documentElement.requestFullscreen && fullTries < 3;
["pointerup", "touchend"].forEach(ev => $k("#kGame").addEventListener(ev, () => { if (wantFull()) { fullTries++; goLandscape(); } }, true));

// ------------------------------------------------------------------ sounds (made in the browser)
let eng = null;
let noiseBuf = null;
function noise(ac) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return noiseBuf;
}
let screechAt = 0, crunchAt = 0;
function engine() {   // 🏎️ a little go-kart engine, like Mario Kart's: a soft, light buzz whose pitch rises smoothly with your speed (no roar, no turbo, no "pssh")
  const ac = window.getAC && window.getAC(); if (!ac || state === "menu") return;
  if (!eng) {
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), m1 = ac.createGain(), m2 = ac.createGain(), f = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = "sawtooth"; o2.type = "square"; m1.gain.value = .55; m2.gain.value = .25; f.type = "lowpass"; f.Q.value = .5; g.gain.value = 0;
    const lfo = ac.createOscillator(), lg = ac.createGain(), trem = ac.createGain(); lfo.type = "sine"; lg.gain.value = .3; trem.gain.value = .7;   // the putter of a small engine
    lfo.connect(lg).connect(trem.gain);
    o1.connect(m1).connect(f); o2.connect(m2).connect(f); f.connect(trem).connect(g).connect(ac.destination); o1.start(); o2.start(); lfo.start();
    const n = ac.createBufferSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();   // a breath of wind at speed
    n.buffer = noise(ac); n.loop = true; nf.type = "bandpass"; nf.frequency.value = 900; nf.Q.value = .6; ng.gain.value = 0; n.connect(nf).connect(ng).connect(ac.destination); n.start();
    eng = { o1, o2, f, g, lfo, n, ng, nf };
  }
  const v = Math.abs(K.v), t = ac.currentTime, p = Math.min(1.3, v / VMAX), boost = K.boost > 0 ? 1.12 : 1;
  const hz = (68 + 150 * p) * boost;   // idle putter up to a happy high buzz
  eng.o1.frequency.setTargetAtTime(hz, t, .08); eng.o2.frequency.setTargetAtTime(hz * 1.006, t, .08); eng.lfo.frequency.setTargetAtTime(hz / 4, t, .08);
  eng.f.frequency.setTargetAtTime(500 + hz * 4, t, .1);
  const on = state !== "done", thr = state === "race" && K.v > 0 ? 1 : .6;
  eng.g.gain.setTargetAtTime(on ? (.035 + .025 * Math.min(1, p)) * thr : 0, t, .12);   // quiet: it sits under the music
  eng.ng.gain.setTargetAtTime(state === "race" ? Math.min(.02, p * p * .015) : 0, t, .15); eng.nf.frequency.setTargetAtTime(700 + v * 2.5, t, .2);
  if (K.drift && state === "race" && t - screechAt > .2) { screechAt = t; noiseHit(2600, .1, .018, 8); }   // a soft tyre squeal while drifting
  if (K.off && v > 60 && K.z <= 0 && state === "race" && t - crunchAt > .12) { crunchAt = t; noiseHit(300, .08, .03, 1.5); }   // grass under the wheels
}
function noiseHit(freq, dur, vol, q = 1, sweep) {
  const ac = window.getAC && window.getAC(); if (!ac) return;
  const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
  n.buffer = noise(ac); f.type = "bandpass"; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  n.connect(f).connect(g).connect(ac.destination); n.start(t, Math.random() * .5); n.stop(t + dur + .02);
}
const burstSound = pow => { const v = .05 + pow / 2400; tone(180, .35, "sawtooth", v, 900); noiseHit(800, .4, v * 1.4, .8, 3500); };   // boost: a rising roar + a whoosh
const whooshSound = () => noiseHit(1500, .25, .05, 1, 400);   // letting go of a drift
document.addEventListener("visibilitychange", () => { if (document.hidden) stopEngine(); });
function stopEngine() { if (eng) { try { eng.o1.stop(); eng.o2.stop(); eng.lfo.stop(); eng.n.stop(); } catch (e) {} eng = null; } }
function tone(f, dur, type = "square", vol = .08, f2) {
  const ac = window.getAC && window.getAC(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const beep = f => tone(f, .25, "square", .09);
const hopSound = () => tone(300, .12, "triangle", .08, 520);
const boingSound = () => { tone(180, .28, "sine", .12, 720); setTimeout(() => tone(520, .14, "triangle", .06, 900), 90); };   // 🍄 a big springy mushroom
const boostSound = () => { tone(220, .35, "sawtooth", .07, 880); };
const bumpSound = () => tone(140, .2, "square", .1, 60);
const coinSound = () => { tone(1320, .07, "square", .05); setTimeout(() => tone(1760, .12, "square", .05), 60); };
const padSound = () => tone(330, .3, "sawtooth", .06, 990);
const jumpSound = () => tone(200, .3, "triangle", .1, 700);
const itemSound = () => { tone(520, .1, "square", .06); setTimeout(() => tone(780, .25, "sawtooth", .06, 1200), 80); };
const spinSound = () => { for (let i = 0; i < 4; i++) setTimeout(() => tone(600 - i * 90, .12, "square", .06, 300 - i * 50), i * 110); };
const slamSound = d => tone(90, .5, "square", Math.max(.03, .16 - d / 2500), 35);
const boxSound = () => {};   // the roulette rattles in hud() while the slot spins
let rollTick = 0, rollN = 0;
const scrollSound = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .14, "triangle", .07), i * 90)); };
const thunderSound = () => { tone(1800, .08, "sawtooth", .08, 200); setTimeout(() => tone(70, .7, "square", .1, 30), 60); };
const splatSound = () => { tone(180, .25, "square", .09, 50); tone(90, .35, "sawtooth", .06, 40); };
const blockSound = () => { tone(1500, .08, "square", .06); tone(900, .15, "triangle", .06); };
const oinkSound = () => { tone(260, .12, "sawtooth", .07, 180); setTimeout(() => tone(240, .16, "sawtooth", .07, 160), 140); };
const finalSound = () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, i === 5 ? .4 : .13, "square", .08), i * 110)); };
const hyperSound = () => { for (let i = 0; i < 8; i++) setTimeout(() => tone(400 + i * 90, .1, "square", .06), i * 60); };
// the announcer (the phone's own voice, where there is one) and a referee's whistle for GO
function say(text, rate = 1.05) {
  try { const sp = window.speechSynthesis; if (!sp) return; const u = new SpeechSynthesisUtterance(text); u.rate = rate; u.pitch = 1.15; u.volume = 1; u.lang = "en-US"; sp.cancel(); sp.speak(u); } catch (e) {}
}
function whistle() {
  const ac = window.getAC && window.getAC(); if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), g = ac.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(2900, t); lfo.type = "square"; lfo.frequency.value = 32; lg.gain.value = 260;   // the pea rattling inside
  lfo.connect(lg).connect(o.frequency); o.connect(g).connect(ac.destination);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.14, t + .03); g.gain.setValueAtTime(.14, t + .55); g.gain.exponentialRampToValueAtTime(.001, t + .8);
  o.start(t); lfo.start(t); o.stop(t + .85); lfo.stop(t + .85);
  noiseHit(3000, .7, .05, 3);   // breath
}
function boomSound(d = 0) {   // a deep thump, a roar of fire and some crackle, quieter far away
  const v = Math.max(.15, 1 - d / 900);
  tone(70, .7, "sine", .28 * v, 28); tone(140, .35, "square", .08 * v, 50);
  noiseHit(420, .9, .32 * v, .6, 70); setTimeout(() => noiseHit(2600, .35, .07 * v, 1.5), 60);
}
const readySound = () => { [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, .16, "square", .06), i * 130)); setTimeout(() => tone(784, .4, "triangle", .07), 390); };
const goSound = () => { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, i === 4 ? .5 : .1, "square", .07), i * 70)); };
const lapSound = () => { tone(660, .12, "square", .07); setTimeout(() => tone(990, .2, "square", .07), 110); };
})();
