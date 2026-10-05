// Family Kart: a time-trial racer drawn the way the SNES Mario Kart did it ("Mode 7"): a flat track picture is tilted into
// a 3D-looking floor one screen row at a time, and the karts, monsters and trees are flat pictures (billboards) on top.
// Step 1 of the plan: one track (Henesys), your character in a kart, drifting with mini-boosts, 3 laps and best times.
(() => {
const $k = s => document.querySelector(s);
const B = window.BD; if (!B || !$k("#kart")) return;
const { esc, store, spriteOf, guildOf } = B;

// ------------------------------------------------------------------ tracks
// Three Henesys tracks (the Henesys Cup). Each one has its own loop, theme, hazards and props; loadTrack() switches between them.
const WORLD = 2048, ROAD = 160, CURB = 14, VMAX = 270;   // road ~8 karts wide; base top speed
let LAPS = 3;   // 1 on the Zakum runs (one long climb, no laps)
// closed Catmull-Rom spline -> evenly spaced points every ~4 world units
function loopPts(ctrl) {
  const raw = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [ctrl[(i + n - 1) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
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
  const e = [[2 * c[0][0] - c[1][0], 2 * c[0][1] - c[1][1]], ...c, [2 * c[c.length - 1][0] - c[c.length - 2][0], 2 * c[c.length - 1][1] - c[c.length - 2][1]]];
  const raw = [];
  for (let i = 1; i < e.length - 2; i++) {
    const [p0, p1, p2, p3] = [e[i - 1], e[i], e[i + 1], e[i + 2]];
    for (let t = 0; t < 1; t += 1 / 80) {
      const t2 = t * t, t3 = t2 * t, f = (a, b, cc, d) => .5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push(e[e.length - 2]);
  const out = [raw[0]]; let acc = 0;
  for (let i = 1; i < raw.length; i++) { acc += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); if (acc >= 4) { out.push(raw[i]); acc = 0; } }
  return out;
}
// the current track (loadTrack fills these in)
let OPEN = false, SPC = 6.6, START_I = 0, MECH = null, LAVA = null, PIDX = null, LAVAT = null, T = null, TRACK_KEY = null, TRACK_ID = "henesys2", PTS = [], N = 1, FORK_A = -1e9, FORK_B = -1e9, ALT = [], AN = 0, ALT_ROAD = 92, ALT_STYLE = "cobble",
  ALTPADS = [], PEN = null, PADS = [], COINS = [], PIGS = [], KING = null, PENPIGS = [], BOXES = [], TUNNEL = null, LAKE = null;
const tangent = i => { const a = OPEN ? PTS[Math.max(0, i - 2)] : PTS[(i + N - 2) % N], b = OPEN ? PTS[Math.min(N - 1, i + 2)] : PTS[(i + 2) % N]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
function nearest(x, y, guess) {   // nearest track point, searching around the last one (or everywhere)
  let best = -1, bd = 1e12;
  const scan = (from, to) => { for (let k = from; k <= to; k++) { const i = (k + N) % N, dx = PTS[i][0] - x, dy = PTS[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } };
  if (guess == null) scan(0, N - 1); else if (OPEN) scan(Math.max(0, guess - 40), Math.min(N - 1, guess + 40)); else scan(guess - 40, guess + 40);
  return { i: best, d: Math.sqrt(bd) };
}
const I = (x, y) => nearest(x, y).i;                              // the track point nearest a spot on the map
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
const lakeFall = () => !!LAKE && LAKE.kind !== "ice";   // the frozen lake is safe to drive on (just slippery)
function padAt(idx, l) {
  for (const p of PADS) { const di = OPEN ? idx - p.i : (idx - p.i + N) % N; if (di >= 0 && di <= p.len && Math.abs(l - p.o) < p.w / 2) return p; }
  return null;
}
function penPigPos(p, tt) {
  const i = PEN.a + (PEN.b - PEN.a) * (p.f + Math.sin(tt * .5 + p.ph) * .06), [x, y] = at(i, p.o + Math.sin(tt * .9 + p.ph * 2) * 18);
  return { x: x + p.dx, y: y + p.dy, dir: Math.cos(tt * .9 + p.ph * 2) };
}
// road crossers: pigs (Henesys Loop), snails (Town Run, slow), mushrooms that hop (Mushroom Forest)
const pigPos = (p, tt) => { const sp = p.sp || 1.25, o = Math.sin(tt * sp + p.ph) * (ROAD / 2 + 8), [x, y] = at(p.i, o);
  return { x, y, dir: Math.cos(tt * sp + p.ph), z: p.hop ? Math.abs(Math.sin(tt * 5 + p.ph)) * 16 : 0 }; };
const kingPhase = tt => (tt % KING.T) / KING.T;   // 0-.45 up in the air, .45-.55 falling, .55 SLAM, then sitting on the road
const kingZ = ph => ph < .45 ? 150 * Math.sin(Math.min(1, ph / .2) * Math.PI / 2) : ph < .55 ? 150 * (1 - (ph - .45) / .1) : 0;
const coinRow = (a, b, st, o) => { const out = []; for (let i = a, j = 0; i <= b; i += st, j++) { const [x, y] = at(i, typeof o === "function" ? o(j) : o); out.push({ x, y, z: 0, got: false }); } return out; };
const boxRow = (i, os) => os.map(o => { const [x, y] = at(i, o); return { x, y, t: 0 }; });
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
  // 1. Henesys Loop: the pig farm jump, the market path, the King Slime
  henesys: {
    id: "henesys2", cup: "henesys", art: HEN_ART, name: "Henesys Loop", sub: "pig farm · market path", icon: "🍄", music: "henesys",
    ctrl: [[400, 1450], [400, 900], [520, 520], [620, 240], [900, 130], [1300, 130], [1545, 185], [1380, 420], [1240, 575], [1110, 880],
      [900, 1050], [1000, 1260], [1400, 1250], [1590, 900], [1650, 470], [1850, 360], [1910, 800], [1850, 1400], [1650, 1750], [1100, 1860], [650, 1820], [430, 1720]],
    theme: { grass: ["#6cc04a", "#5cb03e"], flowers: 2200, road: "cobble" },
    near: ["sunflower", "redshrooms", "bush", "hay", "posts", "tallshroom", "stall", "stall2", "haypile", "tree", "shroomtower", "shroomhouse"],
    far: ["tree", "tree", "bush", "shroomhouse", "shroomtower"], mobs: ["orange_mushroom", "green_mushroom", "blue_mushroom", "snail", "blue_snail", "slime", "pig"],
    build() {
      // features were first placed by point number on the original loop; R() moves those to the same spots on this one
      const V1 = loopPts([[400, 1450], [400, 900], [520, 520], [850, 390], [1150, 560], [1110, 880], [900, 1050], [1000, 1260], [1400, 1250],
        [1590, 900], [1650, 470], [1850, 360], [1910, 800], [1850, 1400], [1650, 1750], [1100, 1860], [650, 1820], [430, 1720]]);
      const R = i => { const p = V1[((Math.round(i) % V1.length) + V1.length) % V1.length]; return I(p[0], p[1]); };
      const pen = { a: I(1010, 130), b: I(1165, 130) };
      const coins = [];
      [[60, 95, 5, () => 0], [400, 440, 6, () => -20], [520, 556, 6, () => 25], [648, 676, 5, () => -30], [850, 930, 8, j => (j & 1 ? 26 : -26)]]
        .forEach(([a, b, st, o]) => { for (let i = a, j = 0; i <= b; i += st, j++) { const [x, y] = at(R(i), o(j)); coins.push({ x, y, z: 0, got: false }); } });
      for (let i = pen.a + 3; i <= pen.b - 3; i += 4) { const [x, y] = at(i, 0); coins.push({ x, y, z: 62, got: false }); }   // mesos in the air over the pen
      return {
        fork: { a: R(826), b: R(930), via: [[1330, 1665], [1040, 1625], [800, 1705]], width: 92, style: "cobble", pads: [{ t: "boost", j: .42, len: 6, o: 0, w: 46 }], coins: true },
        pen,
        pads: [
          { t: "boost", i: R(36), len: 14, o: 0, w: 60 }, { t: "boost", i: R(526), len: 14, o: -26, w: 50 }, { t: "boost", i: R(680), len: 14, o: 28, w: 54 },
          { t: "boost", i: R(874), len: 14, o: -28, w: 54 }, { t: "boost", i: I(800, 165), len: 12, o: 0, w: 60 },
          { t: "ramp", i: R(703), len: 9, o: 0, w: ROAD }, { t: "bigramp", i: I(950, 130), len: 7, o: 0, w: ROAD }, { t: "hay", i: I(1262, 131), len: 4, o: 0, w: 46 },
          { t: "rock", i: I(1525, 290), len: 30, o: 0, w: ROAD }, { t: "rock", i: R(578), len: 30, o: 0, w: ROAD },
          { t: "slime", i: R(325), len: 8, o: -52, w: 40 }, { t: "slime", i: R(455), len: 8, o: 52, w: 40 }, { t: "slime", i: R(795), len: 8, o: -52, w: 40 },
          { t: "slime", i: R(958), len: 8, o: 52, w: 40 }],
        coins,
        pigs: [{ i: R(262), ph: 0, k: "pig" }, { i: R(470), ph: 2, k: "pig" }, { i: R(845), ph: 4.2, k: "pig" }],
        king: { i: R(905), T: 3, k: "king_slime", s: .5, name: "King Slime" },
        boxes: [...boxRow(R(118), [-56, -19, 19, 56]), ...boxRow(R(425), [-54, -18, 18, 54]), ...boxRow(R(772), [-56, -19, 19, 56])],
        extra(push, PROPS) {
          for (let i = pen.a; i <= pen.b; i += 4) for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 8)); push(x, y, "posts", .32, 6); }
          for (const [x, y, k] of [[1090, 40, "haypile"], [1180, 228, "haypile"], [985, 225, "hay"], [1120, 222, "redshrooms"]]) push(x, y, k);
        },
      };
    },
  },
  // 2. Henesys Town Run: twisty S-bends between the mushroom houses, a market street, a tunnel through a tree house, snails crossing
  town: {
    id: "town", cup: "henesys", art: HEN_ART, music: "town", name: "Henesys Town Run", sub: "market street · tree house tunnel · back alley · hospital loop", icon: "🏘️",
    ctrl: [[300, 1700], [300, 1100], [450, 800], [700, 700], [850, 900], [1050, 1000], [1200, 800], [1150, 550], [950, 400], [1000, 200], [1350, 180],
      [1650, 300], [1800, 550], [1650, 800], [1500, 1000], [1300, 1150], [1000, 1250], [800, 1450], [1100, 1600], [1450, 1450], [1700, 1250],
      [1850, 1500], [1720, 1810], [1150, 1865], [600, 1860], [380, 1810]],
    theme: { grass: ["#74c552", "#68b847"], flowers: 3200, road: "cobble" },
    near: ["shroomhouse", "shroomtower", "stall", "stall2", "hay", "haypile", "sunflower", "posts", "redshrooms", "bush"],
    far: ["shroomhouse", "shroomtower", "tree", "shroomhouse", "bush"], mobs: ["snail", "blue_snail", "red_snail", "orange_mushroom"],
    build() {
      const t0 = I(1060, 196), t1 = I(1290, 184), m0 = I(1640, 1820), m1 = I(760, 1862);
      return {
        tunnel: { a: t0, b: t1 },
        // the back alley: a narrow short cut through the S-bends, behind the mushroom houses
        fork: { a: I(855, 905), b: I(1195, 805), via: [[960, 848], [1090, 832]], width: 58, style: "cobble", pads: [], coins: true },
        pads: [
          { t: "boost", i: I(300, 1420), len: 14, o: 0, w: 60 }, { t: "boost", i: I(1400, 182), len: 12, o: -24, w: 54 }, { t: "boost", i: I(1150, 1205), len: 12, o: 22, w: 52 }, { t: "boost", i: I(1300, 1535), len: 12, o: -20, w: 52 },
          { t: "boost", i: I(1300, 1858), len: 12, o: 0, w: 56 },
          { t: "ramp", i: I(1790, 1380), len: 9, o: 0, w: ROAD },
          { t: "slime", i: I(1100, 1862), len: 8, o: 52, w: 40 }, { t: "slime", i: I(700, 712), len: 8, o: -52, w: 40 }, { t: "slime", i: I(1730, 520), len: 8, o: 52, w: 40 }, { t: "slime", i: I(880, 1360), len: 8, o: -52, w: 40 }],
        coins: [...coinRow(I(300, 1350), I(300, 1150), 6, 0), ...coinRow(m0, m1, 8, j => (j & 1 ? 22 : -22)), ...coinRow(I(1000, 220), I(1050, 200), 3, 0), ...coinRow(I(1680, 790), I(1540, 960), 6, -18), ...coinRow(I(860, 1520), I(1040, 1590), 6, 0)],
        pigs: [{ i: I(450, 820), ph: 0, k: "snail", sp: .5 }, { i: I(1640, 820), ph: 2.2, k: "blue_snail", sp: .5 }],
        boxes: [...boxRow(I(300, 1560), [-56, -19, 19, 56]), ...boxRow(I(965, 300), [-54, -18, 18, 54]), ...boxRow(I(1790, 1680), [-56, -19, 19, 56])],
        extra(push) {
          for (let i = m0; i <= m1; i += 6) for (const side of [-1, 1]) {   // the market street: stalls and hay on both sides
            const [x, y] = at(i, side * (ROAD / 2 + CURB + 26)); push(x, y, ["stall", "stall2", "haypile", "hay"][(i / 6 + (side > 0 ? 1 : 0)) & 3]);
          }
          const [ex, ey] = at(t0 - 2, 0); push(ex, ey, "treehouse", .62, 0);   // the tree house you drive through
          push(1120, 1420, "hospital", .55, 40);   // the hospital mushroom in the middle of the loop
          for (const [x, y, k] of [[1010, 1400, "sunflower"], [1240, 1380, "shroomtower"], [1180, 1480, "redshrooms"], [960, 1470, "stall2"]]) push(x, y, k);
          for (let i = t0; i <= t1; i += 5) for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 14)); push(x, y, i % 2 ? "tree" : "bush", .42, 14); }
        },
      };
    },
  },
  // 3. Mushroom Forest: fast and wild; a narrow wooden bridge over a lake (fall in and you splash), hopping mushrooms, Mushmom, a big downhill jump
  forest: {
    id: "forest", cup: "henesys", art: HEN_ART, music: "forest", name: "Mushroom Forest", sub: "bridge shortcut · S-bends · Mushmom · big jump", icon: "🌲",
    ctrl: [[350, 1500], [350, 900], [480, 480], [850, 260], [1400, 260], [1760, 500], [1800, 950], [1580, 1250], [1200, 1150], [990, 1255], [1105, 1405],
      [965, 1550], [1085, 1690], [1420, 1700], [1750, 1820], [1450, 1945], [800, 1905], [480, 1800]],
    theme: { grass: ["#4f9a3c", "#478f35"], flowers: 900, road: "dirt" },
    near: ["tree", "tree", "bush", "tallshroom", "redshrooms", "bush", "tree", "tallshroom"],
    far: ["tree", "tree", "tree", "bush"], mobs: ["orange_mushroom", "green_mushroom", "blue_mushroom", "horny_mushroom"],
    build() {
      const lake = { cx: 1455, cy: 1030, rx: 135, ry: 85 };
      return {
        lake,
        fork: { a: I(1795, 880), b: I(1235, 1160), via: [[1610, 990], [1440, 1030], [1330, 1110]], width: 70, style: "planks", pads: [{ t: "boost", j: .35, len: 6, o: 0, w: 40 }], coins: true },
        pads: [
          { t: "boost", i: I(350, 1250), len: 14, o: 0, w: 60 }, { t: "boost", i: I(1250, 262), len: 12, o: 24, w: 54 }, { t: "boost", i: I(1300, 1690), len: 12, o: -22, w: 52 },
          { t: "bigramp", i: I(860, 1903), len: 7, o: 0, w: ROAD },
          { t: "rock", i: I(1560, 1760), len: 22, o: 0, w: ROAD },
          { t: "slime", i: I(600, 340), len: 8, o: -52, w: 40 }, { t: "slime", i: I(1050, 1335), len: 8, o: 52, w: 40 }],
        coins: [...coinRow(I(350, 1150), I(350, 950), 6, 0), ...coinRow(I(1000, 255), I(1200, 258), 6, j => (j & 1 ? 24 : -24)), ...coinRow(I(1150, 1700), I(1350, 1715), 6, 0),
          ...[0, 1, 2, 3, 4].map(n => { const [x, y] = at(I(860, 1903) + 12 + n * 5, 0); return { x, y, z: 60, got: false }; })],
        pigs: [{ i: I(420, 700), ph: 0, k: "orange_mushroom", hop: true }, { i: I(1785, 700), ph: 1.5, k: "green_mushroom", hop: true },
          { i: I(1300, 1712), ph: 3, k: "orange_mushroom", hop: true }],
        king: { i: I(1120, 262), T: 3.2, k: "mushmom", s: .9, name: "Mushmom" },
        boxes: [...boxRow(I(350, 1080), [-56, -19, 19, 56]), ...boxRow(I(1660, 400), [-54, -18, 18, 54]), ...boxRow(I(1150, 1695), [-56, -19, 19, 56])],
        extra() {},
      };
    },
  },
  // ================================================================ the new cups. F(f) = the track point a fraction f of the way round.
  // ---- El Nath Cup ❄️: icy roads, your kart keeps sliding the way it was going
  en1: {
    id: "elnath1", cup: "elnath", music: "k_elnath1", name: "El Nath Village", sub: "icy streets · snowy market · Jr. Yetis", icon: "🏘️",
    ctrl: [[300, 1600], [300, 900], [420, 500], [750, 300], [1150, 280], [1500, 380], [1750, 650], [1750, 1000], [1500, 1200], [1150, 1150], [900, 1250], [950, 1550], [1300, 1650],
      [1650, 1600], [1800, 1800], [1500, 1920], [800, 1900], [420, 1820]],
    theme: TH.elnath, art: { sky: "media/duel/bg_elnath.webp", strip: "media/kart/elnath/strip1.webp" },
    near: ["en_pine", "en_pine3", "en_bush", "en_bush2", "en_lamp", "en_fence", "en_hay", "en_sign", "en_barrel", "en_tree3", "en_bench"],
    far: ["en_pine", "en_pine2", "en_house1", "en_house2", "en_house3", "en_house4", "en_house5", "en_pine3", "en_tower"], mobs: ["jr_yeti", "pepe", "leatty", "hector"],
    build(F) {
      return {
        pads: [pad("boost", F(.05), 0, 60), pad("boost", F(.3), -24, 54), pad("boost", F(.62), 24, 54), pad("boost", F(.86), 0, 56), pad("ramp", F(.47), 0, ROAD, 9),
          pad("ice", F(.15), -30, 70, 16), pad("ice", F(.38), 30, 70, 16), pad("ice", F(.55), 0, 90, 18), pad("ice", F(.75), -20, 80, 16), pad("rock", F(.92), 0, ROAD, 24),
          pad("slime", F(.22), 52, 40, 8), pad("slime", F(.69), -52, 40, 8)],
        coins: [...coinRow(F(.02), F(.08), 6, 0), ...coinRow(F(.32), F(.37), 5, j => (j & 1 ? 24 : -24)), ...coinRow(F(.6), F(.66), 6, -18), ...coinRow(F(.8), F(.86), 6, 0)],
        pigs: [{ i: F(.25), ph: 0, k: "jr_yeti", sp: .9 }, { i: F(.58), ph: 2, k: "pepe", sp: 1.1 }, { i: F(.8), ph: 4, k: "jr_yeti", sp: .9 }],
        boxes: [...boxRow(F(.1), [-56, -19, 19, 56]), ...boxRow(F(.43), [-54, -18, 18, 54]), ...boxRow(F(.72), [-56, -19, 19, 56])],
        extra(push) {
          for (let f = .62; f < .7; f += .012) for (const s of [-1, 1]) { const [x, y] = at(F(f), s * (ROAD / 2 + CURB + 30)); push(x, y, ["en_house1", "en_house3", "en_house4", "en_house5"][Math.round(f * 1000) % 4]); }
          const [gx, gy] = at(F(.0) + 6, 0); push(gx, gy, "en_gate", big("en_gate", 1.25), 0);
          for (let f = .4; f < .5; f += .02) for (const s of [-1, 1]) { const [x, y] = at(F(f), s * (ROAD / 2 + CURB + 12)); push(x, y, "en_lamp"); }
        },
      };
    },
  },
  en2: {
    id: "elnath2", cup: "elnath", music: "k_elnath2", name: "Frozen Lake", sub: "a lake of pure ice · big jump · White Fangs", icon: "🧊",
    ctrl: [[400, 1700], [350, 1200], [450, 700], [700, 400], [1100, 250], [1500, 300], [1800, 550], [1850, 900], [1600, 1100], [1250, 950], [950, 800], [700, 950], [750, 1250],
      [1100, 1400], [1500, 1350], [1800, 1500], [1750, 1800], [1300, 1900], [750, 1880]],
    theme: { ...TH.elnath, grass: ["#e2ecf8", "#d6e3f3"] }, art: { sky: "media/kart/elnath/sky2.webp", strip: "media/kart/elnath/strip2.webp" },
    near: ["en_pine", "en_pine2", "en_bush", "en_bush2", "en_dead", "en_sign", "en_fence", "en_tree3"],
    far: ["en_pine", "en_pine2", "en_pine3", "en_tree3", "en_dead", "en_snowpines", "en_mill"], mobs: ["white_fang", "jr_yeti", "leatty"],
    build(F) {
      const [lx, ly] = at(F(.6), 0);
      return {
        lake: { cx: lx, cy: ly, rx: 270, ry: 190, kind: "ice" },
        pads: [pad("boost", F(.03), 0, 60), pad("boost", F(.25), 24, 54), pad("boost", F(.45), -24, 54), pad("boost", F(.82), 0, 56), pad("bigramp", F(.9), 0, ROAD, 7),
          pad("ice", F(.12), 0, 90, 18), pad("ice", F(.35), -28, 80, 18), pad("ice", F(.76), 28, 80, 16), pad("rock", F(.2), 0, ROAD, 22), pad("slime", F(.3), 52, 40, 8), pad("slime", F(.7), -52, 40, 8)],
        coins: [...coinRow(F(.05), F(.1), 6, 0), ...coinRow(F(.56), F(.64), 6, j => (j & 1 ? 26 : -26)), ...coinRow(F(.4), F(.44), 5, 0),
          ...[0, 1, 2, 3, 4].map(n => { const [x, y] = at(F(.9) + 12 + n * 5, 0); return { x, y, z: 60, got: false }; })],
        pigs: [{ i: F(.17), ph: 0, k: "white_fang", sp: 1.6 }, { i: F(.5), ph: 1.7, k: "jr_yeti", sp: .9 }, { i: F(.73), ph: 3.3, k: "white_fang", sp: 1.6 }],
        king: { i: F(.33), T: 3.1, k: "yeti", s: .55, name: "Yeti" },
        boxes: [...boxRow(F(.08), [-56, -19, 19, 56]), ...boxRow(F(.48), [-54, -18, 18, 54]), ...boxRow(F(.78), [-56, -19, 19, 56])],
        extra(push) { for (let k = 0; k < 10; k++) { const a = k / 10 * 6.28, [x, y] = [lx + Math.cos(a) * 250, ly + Math.sin(a) * 185]; if (roadDist(x, y) > ROAD / 2 + 30) push(x, y, k % 2 ? "en_pine" : "en_bush2"); } },
      };
    },
  },
  en3: {
    id: "elnath3", cup: "elnath", music: "k_elnath3", name: "Dead Mine Pass", sub: "moonlit night · black ice · Lycanthrope", icon: "🌙",
    ctrl: [[250, 1500], [250, 800], [450, 350], [850, 200], [1200, 350], [1100, 700], [800, 800], [700, 1100], [1000, 1300], [1400, 1100], [1550, 700], [1500, 350], [1800, 250],
      [1900, 700], [1850, 1300], [1650, 1700], [1200, 1850], [600, 1880], [320, 1800]],
    theme: TH.elnathNight, art: { sky: "media/kart/elnath/sky3.webp", strip: "media/kart/elnath/strip3.webp" },
    near: ["en_pine", "en_pine3", "en_dead", "en_bush", "en_lamp", "en_fence", "en_barrel", "en_sign"],
    far: ["en_pine", "en_pine2", "en_dhouse", "en_dhouse2", "en_dhouse3", "en_mill", "en_dead", "en_pine3"], mobs: ["dark_pepe", "hector", "werewolf", "jr_yeti"],
    build(F) {
      return {
        pads: [pad("boost", F(.04), 0, 60), pad("boost", F(.28), 24, 54), pad("boost", F(.52), -24, 54), pad("boost", F(.8), 0, 56), pad("ramp", F(.66), 0, ROAD, 9),
          pad("ice", F(.1), 0, ROAD - 20, 22), pad("ice", F(.33), -26, 80, 16), pad("ice", F(.46), 26, 80, 16), pad("ice", F(.6), 0, 100, 18), pad("ice", F(.88), 0, ROAD - 20, 20),
          pad("rock", F(.72), 0, ROAD, 24), pad("slime", F(.18), -52, 40, 8), pad("slime", F(.94), 52, 40, 8)],
        coins: [...coinRow(F(.01), F(.06), 6, 0), ...coinRow(F(.3), F(.36), 6, -20), ...coinRow(F(.54), F(.6), 6, j => (j & 1 ? 22 : -22)), ...coinRow(F(.82), F(.87), 6, 0)],
        pigs: [{ i: F(.22), ph: 0, k: "dark_pepe", sp: 1.2 }, { i: F(.5), ph: 2, k: "hector", sp: 1.4 }, { i: F(.77), ph: 4, k: "dark_pepe", sp: 1.2 }],
        king: { i: F(.42), T: 3, k: "lycanthrope", s: .5, name: "Lycanthrope" },
        boxes: [...boxRow(F(.08), [-56, -19, 19, 56]), ...boxRow(F(.4), [-54, -18, 18, 54]), ...boxRow(F(.7), [-56, -19, 19, 56])],
        extra(push) { for (let f = .02; f < 1; f += .05) { const [x, y] = at(F(f), (f * 100 & 1 ? 1 : -1) * (ROAD / 2 + CURB + 14)); push(x, y, "en_lamp"); } },
      };
    },
  },
  // ---- Sleepywood Cup 🌙: every 15 seconds the lights go out for 3 seconds, so learn the road. No minimap.
  sw1: {
    id: "sleepy1", cup: "sleepy", music: "k_sleepy1", name: "Sleepywood Village", sub: "tree houses · hollow trunk tunnel · zombie mushrooms", icon: "🍄",
    ctrl: [[350, 1650], [300, 1000], [500, 600], [900, 450], [1100, 200], [1500, 200], [1750, 450], [1600, 800], [1300, 900], [1150, 1150], [1350, 1400], [1700, 1350], [1850, 1650],
      [1600, 1900], [1000, 1880], [600, 1850]],
    theme: TH.sleepy, art: { sky: "media/duel/bg_sleepy.webp", strip: "media/kart/sleepy/strip1.webp" },
    near: ["sw_fern", "sw_flower", "sw_bell", "sw_bush", "sw_lily", "sw_lily2", "sw_leaf", "sw_shrooms", "sw_puff", "sw_lamp"],
    far: ["sw_treehouse", "sw_hut", "sw_stump", "sw_stump2", "sw_tree", "sw_vine", "sw_lily", "sw_moss"], mobs: ["zombie_mushroom", "horny_mushroom", "evil_eye", "curse_eye"],
    build(F) {
      const t0 = F(.3), t1 = F(.36);
      return {
        tunnel: { a: t0, b: t1 },
        pads: [pad("boost", F(.04), 0, 60), pad("boost", F(.24), -24, 54), pad("boost", F(.55), 24, 54), pad("boost", F(.84), 0, 56), pad("ramp", F(.66), 0, ROAD, 9),
          pad("rock", F(.45), 0, ROAD, 22), pad("slime", F(.15), 52, 40, 8), pad("slime", F(.5), -52, 40, 8), pad("slime", F(.76), 52, 40, 8), pad("slime", F(.93), -52, 40, 8)],
        coins: [...coinRow(F(.02), F(.08), 6, 0), ...coinRow(t0 + 4, t1 - 4, 5, 0), ...coinRow(F(.57), F(.62), 6, j => (j & 1 ? 22 : -22)), ...coinRow(F(.86), F(.9), 5, 0)],
        pigs: [{ i: F(.2), ph: 0, k: "zombie_mushroom", sp: .8 }, { i: F(.6), ph: 2, k: "horny_mushroom", sp: 1.2 }, { i: F(.8), ph: 4, k: "zombie_mushroom", sp: .8, hop: true }],
        boxes: [...boxRow(F(.1), [-56, -19, 19, 56]), ...boxRow(F(.4), [-54, -18, 18, 54]), ...boxRow(F(.72), [-56, -19, 19, 56])],
        extra(push) {
          const [ex, ey] = at(t0 - 2, 0); push(ex, ey, "sw_treehouse", big("sw_treehouse", 1.6), 0);
          for (let i = t0; i <= t1; i += 5) for (const s of [-1, 1]) { const [x, y] = at(i, s * (ROAD / 2 + CURB + 14)); push(x, y, i % 2 ? "sw_vine" : "sw_moss", null, 14); }
          for (let f = .05; f < 1; f += .07) { const [x, y] = at(F(f), (f * 100 & 1 ? 1 : -1) * (ROAD / 2 + CURB + 10)); push(x, y, "sw_lamp"); }
        },
      };
    },
  },
  sw2: {
    id: "sleepy2", cup: "sleepy", music: "k_sleepy2", name: "Swamp of Sleep", sub: "misty swamp water · Ligators · rotten logs", icon: "🐊",
    ctrl: [[300, 1700], [300, 1100], [600, 800], [900, 950], [1150, 750], [1000, 450], [1250, 200], [1650, 250], [1850, 600], [1700, 950], [1400, 1100], [1500, 1400], [1800, 1600],
      [1600, 1900], [1000, 1800], [650, 1900]],
    theme: TH.swamp, art: { sky: "media/kart/sleepy/sky2.webp", strip: "media/kart/sleepy/strip2.webp" },
    near: ["sw_fern", "sw_bush", "sw_leaf", "sw_bell", "sw_log", "sw_moss", "sw_lily"],
    far: ["sw_deadtree", "sw_deadtree2", "sw_moss", "sw_tree", "sw_lily2", "sw_boat"], mobs: ["ligator", "curse_eye", "evil_eye", "drake"],
    build(F) {
      const [lx, ly] = at(F(.42), 270);
      return {
        lake: { cx: lx, cy: ly, rx: 170, ry: 120, kind: "swamp" },
        pads: [pad("boost", F(.04), 0, 60), pad("boost", F(.3), 24, 54), pad("boost", F(.58), -24, 54), pad("boost", F(.86), 0, 56), pad("bigramp", F(.72), 0, ROAD, 7),
          pad("mud", F(.17), 0, ROAD, 18), pad("mud", F(.48), 0, ROAD, 14), pad("slime", F(.1), 52, 40, 8), pad("slime", F(.38), -52, 40, 8), pad("slime", F(.64), 52, 40, 8)],
        coins: [...coinRow(F(.02), F(.08), 6, 0), ...coinRow(F(.32), F(.37), 5, -20), ...coinRow(F(.6), F(.66), 6, j => (j & 1 ? 24 : -24)),
          ...[0, 1, 2, 3, 4].map(n => { const [x, y] = at(F(.72) + 12 + n * 5, 0); return { x, y, z: 60, got: false }; })],
        pigs: [{ i: F(.24), ph: 0, k: "ligator", sp: .7 }, { i: F(.52), ph: 2, k: "ligator", sp: .7 }, { i: F(.8), ph: 4, k: "curse_eye", sp: 1.3 }],
        boxes: [...boxRow(F(.12), [-56, -19, 19, 56]), ...boxRow(F(.44), [-54, -18, 18, 54]), ...boxRow(F(.76), [-56, -19, 19, 56])],
        extra(push) { for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28, x = lx + Math.cos(a) * 200, y = ly + Math.sin(a) * 150; if (roadDist(x, y) > ROAD / 2 + 30) push(x, y, k % 2 ? "sw_deadtree" : "sw_log"); } },
      };
    },
  },
  sw3: {
    id: "sleepy3", cup: "sleepy", music: "k_sleepy3", name: "Balrog's Temple", sub: "ancient ruins · the Crimson Balrog stomps", icon: "😈",
    ctrl: [[300, 1500], [350, 700], [700, 300], [1100, 450], [1300, 250], [1700, 300], [1850, 700], [1550, 1000], [1250, 900], [950, 1000], [1000, 1300], [1350, 1350], [1700, 1400],
      [1800, 1750], [1300, 1900], [700, 1850], [380, 1820]],
    theme: TH.temple, art: { sky: "media/kart/sleepy/sky3.webp", strip: "media/kart/sleepy/strip3.webp" },
    near: ["sw_ruin", "sw_ruin2", "sw_ruin3", "sw_fern", "sw_leaf", "sw_bush", "sw_lamp", "sw_head"],
    far: ["sw_temple", "sw_head", "sw_ruin", "sw_ring", "sw_ruin2", "sw_moss"], mobs: ["cold_eye", "curse_eye", "drake", "jr_balrog"],
    build(F) {
      return {
        pads: [pad("boost", F(.04), 0, 60), pad("boost", F(.26), -24, 54), pad("boost", F(.5), 24, 54), pad("boost", F(.82), 0, 56), pad("ramp", F(.36), 0, ROAD, 9),
          pad("rock", F(.15), 0, ROAD, 24), pad("rock", F(.66), 0, ROAD, 22), pad("slime", F(.2), 52, 40, 8), pad("slime", F(.44), -52, 40, 8), pad("slime", F(.9), 52, 40, 8)],
        coins: [...coinRow(F(.01), F(.07), 6, 0), ...coinRow(F(.28), F(.33), 5, j => (j & 1 ? 24 : -24)), ...coinRow(F(.52), F(.57), 6, 0), ...coinRow(F(.84), F(.88), 5, -20)],
        pigs: [{ i: F(.12), ph: 0, k: "cold_eye", sp: 1.1 }, { i: F(.4), ph: 2, k: "drake", sp: 1 }, { i: F(.7), ph: 4, k: "cold_eye", sp: 1.1 }],
        king: { i: F(.6), T: 3.4, k: "crimson_balrog", s: .32, name: "Crimson Balrog", big: true },
        boxes: [...boxRow(F(.09), [-56, -19, 19, 56]), ...boxRow(F(.47), [-54, -18, 18, 54]), ...boxRow(F(.76), [-56, -19, 19, 56])],
        extra(push) {
          const [gx, gy] = at(F(.6) - 30, 0); push(gx, gy, "sw_ring", big("sw_ring", 1.4), 0);
          for (let f = .55; f < .66; f += .02) for (const s of [-1, 1]) { const [x, y] = at(F(f), s * (ROAD / 2 + CURB + 18)); push(x, y, f * 50 & 1 ? "sw_head" : "sw_ruin3"); }
        },
      };
    },
  },
  // ---- Zakum Cup 🔥: one long run from the bottom of the mountain to the top, with the lava rising behind you. No laps.
  zk1: {
    id: "zakum1", cup: "zakum", music: "k_zakum1", name: "Dead Mine Climb", sub: "switchbacks up the mine · Fire Boars", icon: "⛏️", open: true,
    ctrl: OPEN_ZK1,
    theme: TH.mine, art: { sky: "media/kart/zakum/sky1.webp", strip: "media/kart/zakum/strip1.webp" },
    near: ["zk_rocks", "zk_rocks2", "zk_crate", "zk_barrier", "zk_logs", "zk_lantern"],
    far: ["zk_crane", "zk_board", "zk_rocks", "zk_rocks2", "zk_logs", "zk_lantern"], mobs: ["fire_boar", "drake", "firebomb"],
    build(F) { return zakumBuild(F, { cross: ["fire_boar", "fire_boar", "drake"], king: null, edge: ["zk_barrier", "zk_lantern"] }); },
  },
  zk2: {
    id: "zakum2", cup: "zakum", music: "k_zakum2", name: "Molten Spiral", sub: "spiral into the volcano · lava pools · Firebombs", icon: "🌋", open: true,
    ctrl: OPEN_ZK2,
    theme: TH.molten, art: { sky: "media/kart/zakum/sky2.webp", strip: "media/kart/zakum/strip2.webp" },
    near: ["zk_rubble", "zk_rubble2", "zk_skull2", "zk_horn", "zk_shell", "zk_bones"],
    far: ["zk_volcano", "zk_rig", "zk_rubble", "zk_bones", "zk_skull", "zk_ruins"], mobs: ["firebomb", "red_drake", "fire_boar"],
    build(F) { return zakumBuild(F, { cross: ["firebomb", "fire_boar", "firebomb"], hop: true, lava: true, king: { k: "red_drake", s: .6, name: "Red Drake" }, edge: ["zk_skull2", "zk_horn"] }); },
  },
  zk3: {
    id: "zakum3", cup: "zakum", music: "k_zakum3", name: "Zakum's Altar", sub: "the last climb to the altar · Zakum waits at the top", icon: "🗿", open: true,
    ctrl: OPEN_ZK3,
    theme: TH.altar, art: { sky: "media/duel/bg_zakum.webp", strip: "media/kart/zakum/strip3.webp" },
    near: ["zk_vase", "zk_vase2", "zk_idol", "zk_skull", "zk_horn", "zk_rubble2"],
    far: ["zk_gate", "zk_idol", "zk_ruins", "zk_vase", "zk_volcano", "zk_bones"], mobs: ["fire_boar", "dark_drake", "firebomb"],
    build(F) { return zakumBuild(F, { cross: ["dark_drake", "fire_boar", "firebomb"], lava: true, king: { k: "firebomb", s: .9, name: "Firebomb" }, edge: ["zk_vase", "zk_idol"], altar: true }); },
  },
  // ---- Ludibrium Cup 🧸: every 15-30 seconds left and right swap, then swap back (with a ⚠️ warning before each)
  ld1: {
    id: "ludi1", cup: "ludi", music: "k_ludi1", name: "Ludibrium Town", sub: "toy houses · lollipop lane · Ratz", icon: "🏰",
    ctrl: [[300, 1650], [300, 1000], [450, 550], [800, 300], [1150, 290], [1300, 560], [1150, 850], [950, 950], [880, 1250], [1150, 1450], [1450, 1300], [1580, 950], [1600, 520],
      [1780, 260], [1930, 700], [1880, 1400], [1650, 1820], [1000, 1900], [550, 1850]],
    theme: TH.ludi, art: { sky: "media/duel/bg_ludi.webp", strip: "media/kart/ludi/strip1.webp" },
    near: ["ld_flower", "ld_flower2", "ld_lamp", "ld_lolly", "ld_parasol", "ld_tree4", "ld_flag", "ld_banner"],
    far: ["ld_h1", "ld_h2", "ld_h3", "ld_h4", "ld_h7", "ld_h8", "ld_shop", "ld_tree", "ld_tree2", "ld_tree3"], mobs: ["ratz", "black_ratz", "brown_teddy", "panda_teddy", "trixter"],
    build(F) {
      return {
        pads: [pad("boost", F(.04), 0, 60), pad("boost", F(.22), -24, 54), pad("boost", F(.44), 24, 54), pad("boost", F(.68), -24, 54), pad("boost", F(.86), 0, 56),
          pad("ramp", F(.56), 0, ROAD, 9), pad("rock", F(.3), 0, ROAD, 20), pad("slime", F(.14), 52, 40, 8), pad("slime", F(.5), -52, 40, 8), pad("slime", F(.78), 52, 40, 8)],
        coins: [...coinRow(F(.02), F(.08), 6, 0), ...coinRow(F(.24), F(.29), 5, j => (j & 1 ? 24 : -24)), ...coinRow(F(.6), F(.66), 6, 0), ...coinRow(F(.88), F(.93), 5, 20)],
        pigs: [{ i: F(.18), ph: 0, k: "ratz", sp: 1.3 }, { i: F(.48), ph: 2, k: "black_ratz", sp: 1.3 }, { i: F(.75), ph: 4, k: "brown_teddy", sp: .9 }],
        boxes: [...boxRow(F(.1), [-56, -19, 19, 56]), ...boxRow(F(.38), [-54, -18, 18, 54]), ...boxRow(F(.72), [-56, -19, 19, 56])],
        extra(push) {
          const [ax, ay] = at(F(.0) + 8, 0); push(ax, ay, "ld_arch", big("ld_arch", 1.3), 0);
          for (let f = .6; f < .68; f += .01) for (const s of [-1, 1]) { const [x, y] = at(F(f), s * (ROAD / 2 + CURB + 12)); push(x, y, "ld_lolly"); }
        },
      };
    },
  },
  ld2: {
    id: "ludi2", cup: "ludi", music: "k_ludi2", name: "Toy Factory", sub: "boost belts everywhere · Block Golems · King Block Golem", icon: "🧱",
    ctrl: [[250, 1700], [250, 1200], [500, 1000], [300, 750], [350, 350], [750, 200], [900, 500], [700, 750], [950, 950], [1250, 750], [1150, 400], [1450, 200], [1800, 350],
      [1700, 750], [1450, 950], [1650, 1200], [1900, 1450], [1750, 1800], [1300, 1700], [1000, 1450], [750, 1600], [650, 1900], [400, 1880]],
    theme: TH.factory, art: { sky: "media/kart/ludi/sky2.webp", strip: "media/kart/ludi/strip2.webp" },
    near: ["ld_lego", "ld_lego2", "ld_cone", "ld_flag", "ld_fan", "ld_flower"],
    far: ["ld_blocks", "ld_blocks2", "ld_bear", "ld_cone", "ld_h5", "ld_h6", "ld_tree4"], mobs: ["block_golem", "robo", "toy_trojan", "bloctopus"],
    build(F) {
      const belts = [.07, .16, .25, .34, .43, .52, .61, .7, .79, .88].map((f, n) => pad("boost", F(f), [0, -30, 30][n % 3], 50, 10));
      return {
        pads: [...belts, pad("ramp", F(.3), 0, ROAD, 9), pad("ramp", F(.74), 0, ROAD, 9), pad("rock", F(.47), 0, ROAD, 18), pad("slime", F(.2), 52, 40, 8), pad("slime", F(.56), -52, 40, 8), pad("slime", F(.92), 52, 40, 8)],
        coins: [...coinRow(F(.01), F(.06), 6, 0), ...coinRow(F(.36), F(.41), 5, -20), ...coinRow(F(.63), F(.68), 6, j => (j & 1 ? 24 : -24)), ...coinRow(F(.9), F(.95), 5, 0)],
        pigs: [{ i: F(.12), ph: 0, k: "block_golem", sp: .6 }, { i: F(.4), ph: 2, k: "robo", sp: 1.1 }, { i: F(.66), ph: 4, k: "block_golem", sp: .6 }],
        king: { i: F(.83), T: 3.2, k: "king_block_golem", s: .55, name: "King Block Golem" },
        boxes: [...boxRow(F(.05), [-56, -19, 19, 56]), ...boxRow(F(.45), [-54, -18, 18, 54]), ...boxRow(F(.7), [-56, -19, 19, 56])],
        extra(push) { for (let f = .03; f < 1; f += .045) { const [x, y] = at(F(f), (f * 100 & 1 ? 1 : -1) * (ROAD / 2 + CURB + 12)); push(x, y, f * 40 & 1 ? "ld_cone" : "ld_lego2"); } },
      };
    },
  },
  ld3: {
    id: "ludi3", cup: "ludi", music: "k_ludi3", name: "Clocktower Night", sub: "under the big clock · Chronos · Papulatus", icon: "🕰️",
    ctrl: [[300, 1500], [300, 800], [600, 400], [1000, 250], [1400, 300], [1650, 600], [1450, 900], [1100, 800], [800, 1000], [1000, 1250], [1400, 1300], [1750, 1100], [1900, 1450],
      [1700, 1850], [1100, 1900], [600, 1850]],
    theme: TH.clock, art: { sky: "media/kart/ludi/sky3.webp", strip: "media/kart/ludi/strip3.webp" },
    near: ["ld_lamp", "ld_ufo", "ld_parasol", "ld_flower2", "ld_lolly", "ld_banner", "ld_fan"],
    far: ["ld_clock", "ld_h2", "ld_h5", "ld_h1", "ld_tree3", "ld_ufo", "ld_cone"], mobs: ["chronos", "master_chronos", "trixter", "robo"],
    build(F) {
      return {
        pads: [pad("boost", F(.04), 0, 60), pad("boost", F(.27), 24, 54), pad("boost", F(.5), -24, 54), pad("boost", F(.84), 0, 56), pad("bigramp", F(.66), 0, ROAD, 7),
          pad("rock", F(.18), 0, ROAD, 20), pad("slime", F(.12), -52, 40, 8), pad("slime", F(.4), 52, 40, 8), pad("slime", F(.6), -52, 40, 8), pad("slime", F(.92), 52, 40, 8)],
        coins: [...coinRow(F(.01), F(.07), 6, 0), ...coinRow(F(.3), F(.35), 5, j => (j & 1 ? 24 : -24)), ...coinRow(F(.52), F(.57), 6, 0),
          ...[0, 1, 2, 3, 4].map(n => { const [x, y] = at(F(.66) + 12 + n * 5, 0); return { x, y, z: 60, got: false }; })],
        pigs: [{ i: F(.22), ph: 0, k: "chronos", sp: 1.2, hop: true }, { i: F(.46), ph: 2, k: "master_chronos", sp: 1 }, { i: F(.78), ph: 4, k: "chronos", sp: 1.2, hop: true }],
        king: { i: F(.36), T: 3.3, k: "papulatus", s: .5, name: "Papulatus" },
        boxes: [...boxRow(F(.09), [-56, -19, 19, 56]), ...boxRow(F(.43), [-54, -18, 18, 54]), ...boxRow(F(.74), [-56, -19, 19, 56])],
        extra(push) { const [cx, cy] = at(F(.36), 260); push(cx, cy, "ld_clock", big("ld_clock", 1.8), 20); for (let f = .02; f < 1; f += .05) { const [x, y] = at(F(f), (f * 100 & 1 ? 1 : -1) * (ROAD / 2 + CURB + 12)); push(x, y, "ld_ufo"); } },
      };
    },
  },
};
// the cups: 3 tracks each, raced in this order in the Grand Prix. Each new cup has its own twist.
const CUPS = {
  henesys: { name: "Henesys Cup", icon: "🍄", tracks: ["henesys", "town", "forest"], rule: "" },
  elnath: { name: "El Nath Cup", icon: "❄️", tracks: ["en1", "en2", "en3"], rule: "❄️ Icy roads, and frost turrets shoot ice arrows across the road: a hit freezes you" },
  sleepy: { name: "Sleepywood Cup", icon: "🌙", tracks: ["sw1", "sw2", "sw3"], rule: "🌙 Every 15 s the lights go out for 3 s · no minimap" },
  zakum: { name: "Zakum Cup", icon: "🔥", tracks: ["zk1", "zk2", "zk3"], rule: "🔥 Outrun the rising lava · dodge the rolling boulders · fall off the road and you land in lava" },
  ludi: { name: "Ludibrium Cup", icon: "🧸", tracks: ["ld1", "ld2", "ld3"], rule: "🧸 Left and right swap now and then (⚠️ warning first) · Clocktower Night: Papulatus shocks everyone on the ground" },
};
const cupOf = key => Object.keys(CUPS).find(c => CUPS[c].tracks.includes(key)) || "henesys";
function loadTrack(key) {
  if (TRACK_KEY === key) return;
  T = TRACKS[key]; TRACK_KEY = key; TRACK_ID = T.id; OPEN = !!T.open; PTS = OPEN ? openPts(T.ctrl) : loopPts(T.ctrl); N = PTS.length; TRACK_LEN = 0;
  LAPS = OPEN ? 1 : 3; START_I = OPEN ? 44 : 0;
  { let L = 0; for (let i = 1; i < N; i++) L += Math.hypot(PTS[i][0] - PTS[i - 1][0], PTS[i][1] - PTS[i - 1][1]); SPC = L / (N - 1); }   // world units between track points
  MECH = { elnath: "ice", sleepy: "dark", zakum: "lava", ludi: "flip" }[T.cup] || null;
  OUT = T.theme.out ? hexABGR(T.theme.out) : OUT0; HAZE = T.theme.haze || HAZE0;
  const F = OPEN ? (fr => Math.round(Math.max(0, Math.min(1, fr)) * (N - 1))) : (fr => Math.round((((fr % 1) + 1) % 1) * N) % N);
  const f = T.build(F);
  if (!f.fork && SHORTCUTS[key]) { const [a, b, via] = SHORTCUTS[key];   // 🔀 the other maps' short cuts (found once with autoFork, kept here)
    f.fork = { a, b, via, width: T.cup === "zakum" ? 54 : 64, style: T.cup === "zakum" || T.cup === "sleepy" ? "planks" : "cobble", pads: [{ t: "boost", j: .45, len: 6, o: 0, w: 40 }], coins: true }; }   // every other map gets a short cut where its road loops back near itself
  if (f.fork) {
    FORK_A = f.fork.a; FORK_B = f.fork.b; ALT_ROAD = f.fork.width; ALT_STYLE = f.fork.style;
    ALT = pathPts([PTS[(FORK_A - 10 + N) % N], PTS[FORK_A], ...f.fork.via, PTS[FORK_B], PTS[(FORK_B + 10) % N]]); AN = ALT.length; ALTPADS = f.fork.pads || [];
  } else { FORK_A = FORK_B = -1e9; ALT = []; AN = 0; ALTPADS = []; }
  PEN = f.pen || null; LAKE = f.lake || null; TUNNEL = f.tunnel || null;
  PADS = f.pads; COINS = f.coins; PIGS = f.pigs || []; KING = f.king || null; BOXES = f.boxes || [];
  if (f.fork && f.fork.coins) for (let q = .15; q <= .85; q += .07) { const [x, y] = altAt(q * (AN - 1), 0); COINS.push({ x, y, z: 0, got: false }); }
  PENPIGS = PEN ? [0, 1, 2, 3, 4, 5].map(n => ({ f: .12 + n * .15, o: (n % 3 - 1) * 34, ph: n * 1.7, k: n % 2 ? "ribbon_pig" : "pig", dx: 0, dy: 0 })) : [];
  T.extraFn = f.extra;
  paintTrack(); placeObjects(); if (MECH === "lava") lavaMap();
}

// 🔀 each map's short cut: [from track point, to track point, the two bends in between]. Found with autoFork below (run it again with
// __kart.autoFork() on localhost if a track's shape ever changes). Zakum's zig-zag climbs (zk1, zk3) have no room for one.
const SHORTCUTS = { en1: [271, 501, [[1310, 609], [1323, 903]]], en2: [211, 473, [[1183, 528], [1429, 792]]], en3: [57, 277, [[542, 698], [851, 614]]],
  sw1: [219, 437, [[1275, 388], [1441, 578]]], sw2: [349, 575, [[1254, 513], [1359, 783]]], sw3: [223, 427, [[1434, 492], [1528, 728]]],
  zk2: [1104, 1294, [[648, 741], [701, 1038]]], ld1: [59, 299, [[610, 808], [944, 657]]], ld2: [839, 1111, [[1175, 1020], [1032, 1170]]], ld3: [111, 341, [[897, 524], [1228, 655]]] };
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
const tex = document.createElement("canvas"); tex.width = tex.height = WORLD;
let TEX = null, mini = null;
function paintTrack() {
  const g = tex.getContext("2d");
  const th = T.theme, dirt = th.road === "dirt", RS = th.road === "cobble" || !th.road ? (dirt ? "dirt" : "cobble") : th.road;
  g.fillStyle = th.grass[0]; g.fillRect(0, 0, WORLD, WORLD);
  g.fillStyle = th.grass[1];
  if (th.checker) for (let y = 0; y < WORLD; y += 64) for (let x = (y / 64 & 1) * 64; x < WORLD; x += 128) g.fillRect(x, y, 64, 64);   // Ludibrium: a chequered toy floor
  else for (let k = -WORLD; k < WORLD * 2; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 32, 0); g.lineTo(k + 32 - WORLD, WORLD); g.lineTo(k - WORLD, WORLD); g.fill(); }   // mowed stripes
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const flowers = th.flowerCols || ["#ffe066", "#ffffff", "#ff8fb8", "#ffb347"], stem = th.stem === undefined ? "#3f8a34" : th.stem;
  if (!th.checker) {   // grass tufts: little darker and lighter blades all over, so the ground isn't flat colour
    const sh = (hex, d) => { const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, c + d)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
    const tuftCols = [sh(th.grass[0], -22), sh(th.grass[0], -12), sh(th.grass[0], 14), sh(th.grass[1], -18)];
    for (let k = 0; k < (th.tufts || 26000); k++) { const x = rnd() * WORLD, y = rnd() * WORLD; g.fillStyle = tuftCols[k & 3]; g.fillRect(x, y, 1.5, 3); g.fillRect(x + 1.5, y + 1, 1.5, 2); }
  }
  for (let k = 0; k < th.flowers; k++) { const x = rnd() * WORLD, y = rnd() * WORLD; if (stem) { g.fillStyle = stem; g.fillRect(x + 1, y + 4, 3, 3); } g.fillStyle = flowers[k % 4]; g.fillRect(x, y, 5, 5); }
  if (T.cup === "zakum") {   // 🔥 no ground beside the road: it's all lava (glowing blobs and bright veins)
    g.fillStyle = "#6a1806"; g.fillRect(0, 0, WORLD, WORLD);
    for (let k = 0; k < 2600; k++) { const x = rnd() * WORLD, y = rnd() * WORLD, r = 6 + rnd() * 26; g.fillStyle = ["#a8280a", "#d2441a", "#ff7a1e", "#8a1e08"][k & 3]; g.globalAlpha = .55; g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.lineWidth = 2.5; for (let k = 0; k < 500; k++) { let x = rnd() * WORLD, y = rnd() * WORLD; g.strokeStyle = rnd() < .5 ? "#ffd23f" : "#ff9a2e"; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (rnd() - .5) * 50; y += (rnd() - .5) * 50; g.lineTo(x, y); } g.stroke(); }
  }
  if (th.cracks) { g.lineWidth = 2; for (let k = 0; k < 260; k++) {   // glowing cracks in the rock
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
  const SURF = { planks: "#8a5a2e", dirt: "#b98b5a", cobble: "#bdb3a2", snow: "#dfe8f4", moss: "#5b5a4c", ruin: "#a08a62", basalt: "#4a4044", toy: "#f4f0ff" };
  const surface = (p, wd, st) => { p(); g.strokeStyle = SURF[st] || "#bdb3a2"; g.lineWidth = wd; g.stroke(); };
  const lake = () => {   // the forest lake (the wooden bridge crosses it), the swamp, or El Nath's frozen lake (drawn over the road: it's all ice)
    const LC = { water: ["#2f6e2a", "#3d8de0", "#5aa8f0"], ice: ["#8fb4d8", "#bfe0fa", "#ffffff"], swamp: ["#1e3326", "#3d5e3a", "#6f8f4a"] }[LAKE.kind || "water"];
    g.fillStyle = LC[0]; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx + 10, LAKE.ry + 10, 0, 0, 7); g.fill();
    g.fillStyle = LC[1]; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry, 0, 0, 7); g.fill();
    g.fillStyle = LC[2]; for (let k = 0; k < 40; k++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * .85; g.fillRect(LAKE.cx + Math.cos(a) * LAKE.rx * r, LAKE.cy + Math.sin(a) * LAKE.ry * r, 14, 3); }
  };
  if (LAKE && LAKE.kind !== "ice") lake();
  const cobbles = (n, pt, tan, wd, st) => { for (let i = 0; i < n; i++) {   // rows of flat cobbles across the road (or dirt specks, or planks)
    if (st === "planks") { if (i % 2) continue; const a = tan(i), ca = Math.cos(a), sa = Math.sin(a), x = pt(i)[0], y = pt(i)[1];
      g.strokeStyle = i % 4 ? "#a36c38" : "#6b4423"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + sa * wd / 2, y - ca * wd / 2); g.lineTo(x - sa * wd / 2, y + ca * wd / 2); g.stroke(); continue; }
    if (st === "dirt") { for (let k = 0; k < 3; k++) { const a = tan(i), o = (rnd() - .5) * wd * .9, x = pt(i)[0] - Math.sin(a) * o, y = pt(i)[1] + Math.cos(a) * o;
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
  curbs(path, ROAD, PTS, tangent, !OPEN); if (AN) curbs(apath, ALT_ROAD, ALT, altTan, false);
  edge(path, ROAD); edge(apath, ALT_ROAD); surface(path, ROAD, RS); surface(apath, ALT_ROAD, ALT_STYLE === "planks" ? "planks" : RS);   // the market path's road paints over the main curbs where they meet
  cobbles(N, i => PTS[i], tangent, ROAD, RS); cobbles(AN, j => ALT[j], altTan, ALT_ROAD, ALT_STYLE === "planks" ? "planks" : RS);
  if (LAKE && LAKE.kind === "ice") { g.globalAlpha = .88; lake(); g.globalAlpha = 1; }
  { let acc = 0;   // speed bands
    for (let i = 0; i < (OPEN ? N - 1 : N); i++) {
      const j = (i + 1) % N, d = Math.hypot(PTS[j][0] - PTS[i][0], PTS[j][1] - PTS[i][1]); acc += d;
      if (Math.floor(acc / 20) % 2) { const a1 = at(i, -ROAD / 2), b1 = at(i, ROAD / 2), c1 = at(j, ROAD / 2), d1 = at(j, -ROAD / 2);
        g.fillStyle = dirt ? "rgba(70,40,10,.09)" : "rgba(40,30,20,.075)"; g.beginPath(); g.moveTo(a1[0], a1[1]); g.lineTo(b1[0], b1[1]); g.lineTo(c1[0], c1[1]); g.lineTo(d1[0], d1[1]); g.fill(); }
    } }
  path(); g.strokeStyle = th.line || "rgba(255,255,255,.8)"; g.lineWidth = 3; g.setLineDash([20, 28]); g.stroke(); g.setLineDash([]);
  apath(); g.strokeStyle = "rgba(255,226,140,.85)"; g.lineWidth = 3; g.setLineDash([12, 18]); g.stroke(); g.setLineDash([]);
  // the market path's boost arrows
  for (const p of ALTPADS) for (let j = 0; j <= p.len; j += .5) for (let c = 0; c < 10; c++) {
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
  for (const p of PADS) {
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
    if (p.t === "rock") for (let k = 0; k < p.len * 16; k++) {   // gravel first, then fewer, bigger shaded rocks
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w * .98); g.fillStyle = RS === "snow" ? "#c9d6ea" : RS === "toy" ? "#e8dcff" : rnd() < .5 ? "#8a8274" : "#6e675b"; g.fillRect(x - 1.5, y - 1, 3, 2);
    }
    if (p.t === "rock") for (let k = 0; k < p.len * 4; k++) {
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w * .9), z = 10 + rnd() * 10;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(x + 3, y + 3, z / 2 + 1, z * .42, 0, 0, 7); g.fill();   // its shadow
      const rp = RS === "toy" ? [["#c8323c", "#ff5a64", "#ffb0b4"], ["#2a6ac8", "#5a9aff", "#b0d0ff"], ["#d8a020", "#ffd23f", "#fff0a0"], ["#2a9a3a", "#5ad06a", "#b8f0c0"]][Math.floor(rnd() * 4)]
        : RS === "snow" ? [rnd() < .5 ? "#c4d4ea" : "#b0c4e0", "#eef4ff"] : RS === "basalt" ? [rnd() < .5 ? "#3a3236" : "#4a3e40", "#ff7a3a"] : [rnd() < .5 ? "#7d7466" : "#696154", "#a59c8c"];
      g.fillStyle = "#3e3830"; g.beginPath(); g.ellipse(x + 2, y + 2, z / 2, z * .4, 0, 0, 7); g.fill();   // lumpy rocks (toy blocks in Ludibrium, snow lumps in El Nath)
      g.fillStyle = rp.length === 3 ? rp[1] : rp[0]; g.beginPath(); g.ellipse(x, y, z / 2, z * .4, 0, 0, 7); g.fill();
      g.fillStyle = rp.length === 3 ? rp[2] : rp[1]; g.beginPath(); g.ellipse(x - z * .15, y - z * .12, z * .18, z * .12, 0, 0, 7); g.fill();
    }
    if (p.t === "ice") for (let j = 0; j <= p.len; j += .5) {   // a glassy patch of black ice
      const e = Math.sin(Math.PI * j / p.len), w2 = p.w / 2 * (.55 + .45 * e);
      quad(p.i + j, p.o - w2, p.o + w2, j % 2 < 1 ? "#a9d4f5" : "#bfe2fb");
      if (rnd() < .5) { const [x, y] = at(p.i + j, p.o + (rnd() - .5) * w2 * 1.6); g.fillStyle = "#ffffff"; g.fillRect(x - 4, y - 1, 8, 2); }
    }
    if (p.t === "lava") { const [x, y] = at(p.i + p.len / 2, p.o), a = tangent(p.i);   // a bubbling pool of lava on the road
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = "#3a1208"; g.beginPath(); g.ellipse(0, 0, p.len * 2.9, p.w / 2 + 4, 0, 0, 7); g.fill();
      g.fillStyle = "#e0401a"; g.beginPath(); g.ellipse(0, 0, p.len * 2.6, p.w / 2, 0, 0, 7); g.fill();
      g.fillStyle = "#ffb02e"; for (const [bx, by, br] of [[-8, -6, 6], [10, 5, 5], [2, -1, 4], [-14, 8, 3]]) { g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); }
      g.restore(); }
    if (p.t === "mud") for (let k = 0; k < p.len * 5; k++) {   // swamp mud across the road: slows you down
      const [x, y] = at(p.i + rnd() * p.len, (rnd() - .5) * p.w), r = 6 + rnd() * 14;
      g.fillStyle = rnd() < .5 ? "#3e3a22" : "#5a5230"; g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill();
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
  for (const li of OPEN ? [START_I, N - FIN_OFF] : [0]) {
    const [sx, sy] = PTS[li], ta = tangent(li), nx = -Math.sin(ta), ny = Math.cos(ta), sq = 10;
    for (let r = 0; r < 2; r++) for (let c = -ROAD / 2; c < ROAD / 2; c += sq) {
      g.fillStyle = ((c / sq + r) & 1) ? "#222" : "#fff";
      g.save(); g.translate(sx + nx * (c + sq / 2) + Math.cos(ta) * (r - 1) * sq, sy + ny * (c + sq / 2) + Math.sin(ta) * (r - 1) * sq); g.rotate(ta);
      g.fillRect(-sq / 2, -sq / 2, sq + .5, sq + .5); g.restore();
    }
  }
  TEX = new Uint32Array(g.getImageData(0, 0, WORLD, WORLD).data.buffer);
  // minimap
  mini = document.createElement("canvas"); mini.width = mini.height = 128; const m = mini.getContext("2d"), k = 128 / WORLD;
  m.lineJoin = "round"; m.beginPath(); PTS.forEach(([x, y], i) => i ? m.lineTo(x * k, y * k) : m.moveTo(x * k, y * k)); if (!OPEN) m.closePath();
  m.strokeStyle = "rgba(0,0,0,.45)"; m.lineWidth = 9; m.stroke(); m.strokeStyle = "#f4e2b8"; m.lineWidth = 5; m.stroke();
  m.beginPath(); ALT.forEach(([x, y], i) => i ? m.lineTo(x * k, y * k) : m.moveTo(x * k, y * k));
  m.strokeStyle = "rgba(0,0,0,.4)"; m.lineWidth = 7; m.stroke(); m.strokeStyle = "#ffe28c"; m.lineWidth = 3.5; m.stroke();
}

// 🔥 Zakum: which track point every spot of the map belongs to (so the lava can flood everything behind its front), and a lava texture
function lavaMap() {
  const c = document.createElement("canvas"); c.width = c.height = WORLD; const g = c.getContext("2d"), R2 = 150;
  for (let i = 0; i < N - 1; i++) {
    const a = at(i, -R2), b = at(i, R2), cc = at(i + 1.6, R2), d = at(i + 1.6, -R2);
    g.fillStyle = `rgb(${i >> 8},${i & 255},255)`; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.lineTo(d[0], d[1]); g.fill();
  }
  const px = g.getImageData(0, 0, WORLD, WORLD).data; PIDX = new Uint16Array(WORLD * WORLD);
  for (let p = 0, q = 0; p < PIDX.length; p++, q += 4) if (px[q + 2] >= 250) PIDX[p] = (px[q] << 8 | px[q + 1]) + 1;
  if (!LAVAT) { LAVAT = new Uint32Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = (Math.sin(x * .39 + Math.sin(y * .21) * 2) + Math.sin(y * .33 + Math.cos(x * .17) * 2)) * .25 + .5, r = 230 + v * 25 | 0, gg = 60 + v * 150 | 0, b = 10 + v * v * 60 | 0;
      LAVAT[y * 64 + x] = (0xff000000 | (b << 16) | (gg << 8) | r) >>> 0;
    } }
}
// roadside things: real Henesys props (trees, mushroom houses, market stalls, hay, sunflowers) and a few monsters.
// s = world units per picture pixel, r = how solid it is
const PROPS = { treehouse: [.62, 0], hospital: [.55, 40], tree: [.36, 16], bush: [.3, 12], redshrooms: [.42, 10], sunflower: [.45, 6], tallshroom: [.4, 9], stall: [.42, 18], stall2: [.42, 18],
  hay: [.42, 12], haypile: [.38, 16], shroomtower: [.48, 16], shroomhouse: [.5, 18], posts: [.42, 10],
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
  ["#ff5a5a", "#ffd23f", "#5ac8ff", "#ffffff", "#7ad06a", "#ff8fd0"].forEach((col, i) => IMG["balloon" + i] = mk(26, 60, (g) => {
    g.strokeStyle = "rgba(60,40,20,.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(13, 30); g.quadraticCurveTo(9, 45, 14, 60); g.stroke();
    g.fillStyle = col; g.beginPath(); g.ellipse(13, 15, 11, 14, 0, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.ellipse(9, 9, 3, 5, -.4, 0, 7); g.fill();
    g.fillStyle = col; g.beginPath(); g.moveTo(10, 29); g.lineTo(16, 29); g.lineTo(13, 33); g.fill(); }));
}
function placeStart(push) {
  if (!IMG.arch_post) makeArchArt();
  const li = OPEN ? START_I : 0, half = ROAD / 2 + CURB + 10, [cx, cy] = at(li, 0);
  for (const sd of [-1, 1]) { const [x, y] = at(li, sd * half); push(x, y, "arch_post", .62, 0); }
  OBJS.push({ x: cx, y: cy, k: "arch_banner", s: (half * 2 + 14) / 420, r: 0, z: 70 });
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
  for (let s = 20; s < N; s += 16) {
    for (const side of [-1, 1]) {
      if (rnd() < .22) continue;
      const a = tangent(s), off = ROAD / 2 + CURB + 18 + rnd() * 60, x = PTS[s][0] - Math.sin(a) * off * side, y = PTS[s][1] + Math.cos(a) * off * side;
      if (roadDist(x, y) < ROAD / 2 + CURB + 16 || inLake(x, y) || x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) continue;
      if (rnd() < .18) { OBJS.push({ x, y, k: T.mobs[Math.floor(rnd() * T.mobs.length)], s: .42, r: 10, mob: true }); continue; }
      push(x, y, T.near[Math.floor(rnd() * T.near.length)]);
    }
  }
  T.extraFn(push);
  placeStart(push);   // the FAMILY arch and balloons on every map
  { const li = OPEN ? START_I : 0, s0 = PTS[li];   // a map's own gate at the start line moves to halfway round, so the two arches don't stand together
    for (const o of OBJS) if (!o.r && !/^(arch|balloon)/.test(o.k) && Math.hypot(o.x - s0[0], o.y - s0[1]) < 140 && nearest(o.x, o.y).d < 30) {
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
  for (let k = 0; k < 170; k++) {   // woods and houses further out
    const x = 30 + rnd() * (WORLD - 60), y = 30 + rnd() * (WORLD - 60), d = roadDist(x, y);
    if (d < ROAD / 2 + 130 || inLake(x, y)) continue;
    const kk = T.far[Math.floor(rnd() * T.far.length)];
    push(x, y, kk, PROPS[kk][0] * 1.2);
  }
}

// ------------------------------------------------------------------ screen
// the world is laid out on a 320-unit-wide screen; the height follows the screen's shape (tall on phones), with the camera raised to match.
// The floor is drawn QUAL times sharper than that (2-3x on most screens), and steps down by itself if the device can't keep up.
const W = 320, FOCAL = 170, CAMD = 84;
let H = 192, HOR = 58, CAMH = 30, floor = null, F32 = null, FOG = [], S = 1, FW = 320, FH = 134, QMAX = 3, floorMs = 0;
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

// ------------------------------------------------------------------ rivals and items
// 7 computer racers (real guild members), rows of item boxes, and the MapleStory items: Elixir, 3 Elixirs, Slime drop, Arrow, Zakum's Arm
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
const DIFFS = { easy: { skill: .95, band: .07, pick: .4, label: "Easy" }, normal: { skill: 1.16, band: .15, pick: .6, label: "Normal" }, hard: { skill: 1.2, band: .18, pick: .8, label: "Hard" } };
let diff = DIFFS[store.get("kart_diff")] ? store.get("kart_diff") : "normal";
// speed classes like Mario Kart's: everything on the track moves slower (turning stays the same, so it's easier to steer)
const CCS = { 50: { spd: .7, label: "🐢 50cc" }, 100: { spd: .85, label: "🏎️ 100cc" }, 150: { spd: 1, label: "🔥 150cc" } };
let cc = CCS[store.get("kart_cc")] ? +store.get("kart_cc") : 100, SPD = 1;   // 100cc unless you picked another class   // SPD: the class of the race being driven right now
const ccId = (id, c) => c === 150 ? id : `${id}_${c}`;   // board / ghost / best ids: 150cc keeps the plain track id
const DIFF = () => DIFFS[diff];
const RIVAL_COLORS = ["#6eaa64", "#4682be", "#8a6a4a", "#aa64b4", "#3ca0a0", "#e07a12", "#5a64a0"];   // red + gold is yours
const ITEM_ICON = { elixir: "media/duel/elixir.png", triple: "media/duel/elixir.png", slime: "media/mobs/slime.png", arrow: "media/kart/items/arrow_icon.png", arm: "media/duel/zarm_stand.gif",
  thunder: "media/kart/thunder.png?v=2", splat: "media/mobs/octopus.png", hyper: "media/kart/hyperbody.png", bomb: "media/kart/items/bomb0.png" };
const ITEM_NAME = { elixir: "Elixir", triple: "3 Elixirs", slime: "Slime drop", arrow: "Arrow", arm: "Zakum's Arm", thunder: "Thunder", splat: "Splat", hyper: "Hyper Body", bomb: "Pirate Bomb" };
let RIV = [], DROPS = [], SHOTS = [], ARMS = [], BOMBS = [], BOOMS = [];
const BOMB_R = 78;   // 💣 the Pirate Bomb's blast radius (world units; a kart is about 20 wide)
const progOf = r => (r.done ? 1e6 - r.finish : 0) + (OPEN ? r.idx : r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx));
const racers = () => [K, ...RIV];
function rankOf(r) { const p = progOf(r); return 1 + racers().filter(o => o !== r && progOf(o) > p).length; }
function gridSpot(slot) { const row = Math.floor(slot / 2), col = slot % 2, i = (OPEN ? START_I - 6 : N - 6) - row * 9 - col * 3; return { i, o: col ? 24 : -24 }; }
// ------------------------------------------------------------------ multiplayer (rooms of 2-8, the first one in is the host)
// Everyone drives their own kart; positions go out ~12 times a second over Realtime broadcast, other players are drawn from those.
// Items reach other players as events; each player only ever decides hits on their OWN kart. The server keeps the room and scores it.
const MP = { tally: {}, tallied: null, pick: null, endAt: 0, firstName: null, code: null, token: null, me: null, host: null, players: [], status: null, track: "henesys", raceNo: 0, ch: null, poll: null, slot: 0, goAt: 0, sendAt: 0, results: null, finished: false };
const mpOn = () => mode === "mp" && !!MP.code;
function mpSend(event, payload) { if (MP.ch) MP.ch.send({ type: "broadcast", event, payload: { n: MP.me, rc: MP.raceNo, ...payload } }); }   // payload.n speaks for a bot
const nameOf = o => o === K ? MP.me : o && o.name;
// items used by you, or by one of the host's bots, are announced to the room
function mpItem(r, payload) { if ((r === K || r.bot) && mpOn()) mpSend("it", { ...payload, n: nameOf(r) }); }
function mpByName(n) { return n === MP.me ? K : RIV.find(r => r.name === n); }
function mpOnPos(p) {
  if (!p || p.rc !== MP.raceNo || !K) return;
  const r = RIV.find(o => o.name === p.n); if (!r) return;
  r.net = { x: p.x, y: p.y, a: p.a, v: p.v, t: performance.now() };
  r.z = p.z || 0; r.steer = p.s || 0; r.spin = p.sp || 0; r.small = p.sm || 0; r.hyper = p.hy || 0; r.extra = p.ex || 0; r.squash = p.sq || 0;
  r.lap = p.lap; r.cps = p.cps; r.idx = p.idx; r.holding = !!p.ho; r.item = p.it || null; r.ink = p.ik || 0;
  if (p.dn && !r.done) { r.done = true; r.finishT = p.ft; r.finish = ++finishers; if (!MP.endAt && !r.bot) { MP.endAt = performance.now() + 10000; MP.firstName = r.name; } }   // bots don't start the 10 s clock
}
function mpOnItem(p) {
  if (!p || p.rc !== MP.raceNo || !K || state === "menu") return;
  const by = RIV.find(o => o.name === p.n); if (!by) return;
  if (p.k === "drop") DROPS.push({ x: p.x, y: p.y, t: 40, by, grace: .3 });
  if (p.k === "bomb") BOMBS.push({ x: p.x, y: p.y, z: 12, a: p.a, v: p.v, vz: 230, by, t: 0 });
  if (p.k === "shot") SHOTS.push({ x: p.x, y: p.y, a: p.a, v: p.v, tgt: p.tgt ? mpByName(p.tgt) || null : null, by, life: 4 });
  if (p.k === "arm" && p.tgt === MP.me) { ARMS.push({ tgt: K, t: 2.6, by }); armCD = 20; }
  if (p.k === "thunder") {
    thunderCD = 25; thunderFx = .35; thunderSound();
    if (!K.done && !(K.rescue > 0) && !(K.hyper > 0)) { if (K.holding || HOLDABLE(K.item)) { K.item = null; K.holding = false; } K.small = 3.2; K.inv = 0; K.z = 0; K.vz = 0; spinOut(`⚡ Thunder from ${by.name}!`); K.shake = .3; }
  }
  if (p.k === "splat") { bloopCD = 14; if (!K.done && progOf(K) > p.p && !(K.bloopSafe > 0) && !(K.hyper > 0)) { K.ink = 4; K.bloopSafe = 12; makeInk(); flash(`🐙 Splat from ${by.name}!`, 1000); splatSound(); } }
}
// other players' karts: glide toward where their last message says they are (with a little prediction)
function remoteStep(r, dt) {
  if (!r.net) return;
  const age = Math.min(.3, (performance.now() - r.net.t) / 1000), px = r.net.x + Math.cos(r.net.a) * r.net.v * SPD * age, py = r.net.y + Math.sin(r.net.a) * r.net.v * SPD * age;
  const f = Math.min(1, dt * 12); r.x += (px - r.x) * f; r.y += (py - r.y) * f; r.v = r.net.v;
  let d = r.net.a - r.a; d = Math.atan2(Math.sin(d), Math.cos(d)); r.a += d * f;
  r.gone = performance.now() - r.net.t > 6000;
}
// 🤖 computer racers in rooms are MapleStory monsters in karts
const BOT_IMG = { "Orange Mushroom": "orange_mushroom", "Ribbon Pig": "ribbon_pig", "Blue Snail": "blue_snail", "Stump": "stump", "Green Mushroom": "green_mushroom", "Horny Mushroom": "horny_mushroom", "Pig": "pig" };
const botImg = name => `media/mobs/${BOT_IMG[name] || "orange_mushroom"}.png`;
function makeRivals(keep) {
  if (mode === "tt") { RIV = []; DROPS = []; SHOTS = []; ARMS = []; return; }
  if (mode === "mp") {   // the other players in the room, on the grid in the order they joined
    const order = MP.players.filter(p => !p.spec).map(p => p.name), others = MP.players.filter(p => p.name !== MP.me && !p.spec), host = MP.host === MP.me && !MP.watching;
    RIV = others.map((p, n) => {
      const name = p.name, g = gridSpot(order.indexOf(name)), [x, y] = at(g.i, g.o), img = new Image(); img.src = p.bot ? botImg(name) : spriteOf(name);
      const r = { name, img, color: RIVAL_COLORS[n % RIVAL_COLORS.length], x, y, a: tangent((g.i + N) % N), v: 0, idx: (g.i + N) % N, lap: 0, cps: 0, prog: 0, done: false, finish: 0, finishT: 0,
        remote: true, net: null, steer: 0, spin: 0, inv: 0, squash: 0, z: 0, vz: 0, boost: 0, extra: 0, item: null, itemN: 0, itemT: 0, skill: VMAX, lane: 0, laneT: 9, bot: !!p.bot };
      if (p.bot && host) Object.assign(r, { remote: false, lane: g.o, laneT: 1 + Math.random() * 2, skill: 226 + n * 3 + Math.random() * 10, lastPad: null, kingWas: 0 });   // 🤖 the host drives the bots
      return r;
    });
    DROPS = []; SHOTS = []; ARMS = []; BOMBS = []; BOOMS = []; BOXES.forEach(b => b.t = 0); return;
  }
  const pool = [...(typeof D !== "undefined" ? [...D.founders, ...D.members] : [])].map(p => p.name).filter((n, i, a) => n && /^[A-Za-z0-9]{2,13}$/.test(n) && n !== me && a.indexOf(n) === i);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const names = keep || pool.slice(0, 7); while (names.length < 7) names.push(["Orange Mushroom", "Blue Snail", "Slime", "Pig", "Stump", "Green Mushroom", "Ribbon Pig"][names.length]);
  const slots = [0, 1, 2, 3, 5, 6, 7];   // you start 5th on the grid
  RIV = names.map((name, n) => {
    const g = gridSpot(slots[n]), [x, y] = at(g.i, g.o), img = new Image(); img.src = spriteOf(name);
    return { name, img, color: RIVAL_COLORS[n], x, y, finishT: 0, a: tangent((g.i + N) % N), v: 0, idx: (g.i + N) % N, lap: 0, cps: 0, prog: 0, done: false, finish: 0,
      lane: g.o, laneT: 1 + Math.random() * 2, skill: 228 + n * 3 + Math.random() * 10, steer: 0, spin: 0, inv: 0, squash: 0, z: 0, vz: 0, boost: 0,
      item: null, itemN: 0, itemT: 0, lastPad: null, kingWas: 0 };
  });
  DROPS = []; SHOTS = []; ARMS = []; BOMBS = []; BOOMS = []; BOXES.forEach(b => b.t = 0);
}
let bloopCD = 0, armCD = 0, thunderCD = 0, thunderFx = 0;   // Zakum's Arm: at most one every 20 seconds   // Dizzy/Splat: only one in the whole race every 14 seconds, so they stay special
// items depend on how far behind the leader you are (like Mario Kart 8), not just your place: right behind the leader you get
// defensive items, far back you get the catch-up ones. Zakum's Arm, Dizzy and Splat are locked for the first 30 seconds.
function rollItem(r, rival) {
  const lead = racers().reduce((a, b) => progOf(b) > progOf(a) ? b : a), gap = (progOf(lead) - progOf(r)) / N;   // in laps
  const early = K.t < 30000, b = bloopCD > 0 || early ? 0 : rival ? .25 : 1, arm = armCD > 0 || early || ARMS.length ? 0 : 1;
  const th = thunderCD > 0 || early ? 0 : rival ? .3 : 1;
  const t = (gap < .04 ? [["slime", 5], ["arrow", 3], ["elixir", 2], ["bomb", 1.5]]
    : gap < .12 ? [["elixir", 3], ["arrow", 4], ["slime", 2], ["triple", 1], ["splat", .6 * b], ["bomb", 2.5]]
    : gap < .25 ? [["triple", 3], ["arrow", 3], ["elixir", 2], ["splat", 1 * b], ["arm", .8 * arm], ["thunder", .5 * th], ["hyper", .8], ["bomb", 2]]
    : [["triple", 4], ["arrow", 2], ["arm", 2 * arm], ["thunder", 1.2 * th], ["splat", 1.5 * b], ["hyper", 2], ["bomb", 1]]).filter(x => x[1] > 0);
  let x = Math.random() * t.reduce((a, c) => a + c[1], 0);
  for (const [k, w] of t) { if ((x -= w) < 0) return k; }
  return "elixir";
}
const HOLDABLE = it => it === "slime" || it === "arrow";
// boosts (like SRB2Kart / SuperTuxKart): the speed jumps up at once, the strongest active boost wins, and when it ends the extra
// speed fades out over ~0.8 s instead of stopping dead. Also a camera kick for you.
function giveBoost(r, dur, pow) {
  r.boostPow = r.boost > 0 ? Math.max(r.boostPow || 0, pow) : pow;
  r.boost = Math.max(r.boost || 0, dur); r.extra = Math.max(r.extra || 0, r.boostPow);
  r.v = Math.max(r.v, (r === K ? VMAX : r.skill * DIFF().skill) + pow * .6);
  if (r === K) { K.kick = Math.max(K.kick || 0, Math.min(1, pow / 110)); burstSound(pow); }
}
function boostTick(r, dt) {
  if (r.boost > 0) r.extra = Math.max(r.extra || 0, r.boostPow || 0);
  else { r.extra = (r.extra || 0) * Math.pow(.94, dt * 60); if (r.extra < 2) r.extra = 0; r.boostPow = 0; }
}
function hit(r, msg) {
  if (r.remote) return;   // another player's own game decides their hits
  if (r.hyper > 0) return;   // 💪 Hyper Body: nothing can hurt you
  if (r === K) { spinOut(msg); return; }
  if (r.spin <= 0 && r.inv <= 0 && r.z <= 0) { r.spin = .9; r.inv = 1.6; r.boost = 0; r.extra = 0; if (r.holding) { r.item = null; r.holding = false; } }
}
function useItem(r) {
  const it = r.item; if (!it) return;
  r.holding = false;
  if (it === "triple") { giveBoost(r, 1.2, 120); if (--r.itemN <= 0) r.item = null; }
  else r.item = null;
  if (it === "elixir") giveBoost(r, 1.5, 120);
  if (it === "hyper") { r.hyper = 7; r.spin = 0; r.small = 0; r.ink = 0; if (r === K) { flash("💪 HYPER BODY!", 1000); hyperSound(); } }
  if (it === "slime") { const d = { x: r.x - Math.cos(r.a) * 24, y: r.y - Math.sin(r.a) * 24, t: 40, by: r, grace: .5 }; DROPS.push(d); mpItem(r, { k: "drop", x: d.x, y: d.y }); }
  if (it === "arrow") {
    const p = progOf(r), ahead = racers().filter(o => o !== r && progOf(o) > p && progOf(o) - p < N * .5).sort((a, b) => progOf(a) - progOf(b))[0];
    const sh = { x: r.x + Math.cos(r.a) * 16, y: r.y + Math.sin(r.a) * 16, a: r.a, v: Math.max(370, r.v + 130), tgt: ahead || null, by: r, life: 4 }; SHOTS.push(sh);
    mpItem(r, { k: "shot", x: sh.x, y: sh.y, a: sh.a, v: sh.v, tgt: ahead ? nameOf(ahead) : null });
  }
  if (it === "bomb") {   // 💣 lobbed forward in an arc; explodes where it lands (or on whoever it hits on the way)
    const b = { x: r.x + Math.cos(r.a) * 18, y: r.y + Math.sin(r.a) * 18, z: 12, a: r.a, v: Math.max(250, Math.abs(r.v) + 120), vz: 230, by: r, t: 0 }; BOMBS.push(b);
    mpItem(r, { k: "bomb", x: Math.round(b.x), y: Math.round(b.y), a: +b.a.toFixed(3), v: Math.round(b.v) });
    if (r === K) flash("💣 Bombs away!", 700);
  }
  if (it === "splat") {   // like the Blooper: inks everyone ahead of whoever uses it
    bloopCD = 14; mpItem(r, { k: "splat", p: progOf(r) });
    const p = progOf(r), from = r === K ? "" : ` from ${r.name}`;
    const hitList = racers().filter(o => o !== r && !o.done && progOf(o) > p && !(o.rescue > 0) && !(o.bloopSafe > 0) && !(o.ink > 0) && !(o.hyper > 0));
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
      if (o === r || o.done || o.rescue > 0 || o.hyper > 0) continue;
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
// 💥 a Pirate Bomb goes off: everyone in the blast spins out and is thrown into the air (the closer, the higher); the screen shakes with distance
function explode(b, all) {
  BOOMS.push({ x: b.x, y: b.y, t: 0, debris: Array.from({ length: 14 }, () => ({ a: Math.random() * 6.28, v: 60 + Math.random() * 90, vz: 120 + Math.random() * 160, s: 2 + Math.random() * 3, c: ["#3a3236", "#6b4426", "#8a8d96", "#ffb02e"][Math.floor(Math.random() * 4)] })) });
  const dK = Math.hypot(K.x - b.x, K.y - b.y);
  boomSound(dK); if (dK < 520) K.shake = Math.max(K.shake, .55 * (1 - dK / 520));
  for (const r of all) {
    const d = Math.hypot(r.x - b.x, r.y - b.y); if (d > BOMB_R || r.z > 60 || r.done || r.rescue > 0) continue;
    const was = r.spin; hit(r, b.by === K ? "💣 Your own bomb!" : `💣 Boom${b.by && b.by.name ? ` from ${b.by.name}` : ""}!`);
    if (r.spin > 0 && !(was > 0) && !r.remote) { r.vz = 150 + 160 * (1 - d / BOMB_R); r.z = .1; r.v *= .3; }
    if (r !== K && b.by === K && r.spin > 0 && !(was > 0)) flash(`💣 Blew up ${r.name}!`, 900);
  }
  if (dK < 140) K.hitFlash = Math.max(K.hitFlash || 0, .12 * (1 - dK / 140));
}
// ================================================================ map hazards
// ❄️ El Nath: frost turrets beside the road fire an ice arrow straight across it every few seconds (a glint warns first); a hit freezes you for a moment.
// 🧸 Clocktower Night: Papulatus floats over the track, charges up and shocks everyone on the ground (be in the air to dodge it).
// 🔥 Zakum: boulders roll down the climb at you, and the road has no safe edge: drive off it and you fall into the lava.
const HAZ = { lanes: [], ice: [], rocks: [], rockT: 3, pap: null };
function setupHazards() {
  HAZ.lanes = []; HAZ.ice = []; HAZ.rocks = []; HAZ.rockT = 4; HAZ.pap = null;
  const F = f => OPEN ? Math.round(START_I + (N - FIN_OFF - START_I) * f) : Math.round(N * f) % N;
  if (T.cup === "elnath") [.24, .52, .79].forEach((f, n) => HAZ.lanes.push({ i: F(f), side: n % 2 ? 1 : -1, period: 5.5 + n * .4, phase: n * 1.9, shot: -1, warn: 0 }));
  if (TRACK_KEY === "ld3") HAZ.pap = { charge: 0, fx: 0, last: -1 };
}
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
      const [x0, y0] = at(L.i, L.side * (ROAD / 2 + CURB + 34)), [x1, y1] = at(L.i, -L.side * (ROAD / 2 + CURB + 34)), d = Math.hypot(x1 - x0, y1 - y0);
      HAZ.ice.push({ x: x0, y: y0, a: Math.atan2(y1 - y0, x1 - x0), v: 430, life: d / 430 }); if (Math.hypot(K.x - x0, K.y - y0) < 500) tone(2400, .12, "triangle", .04, 1200);
    }
    L.shot = cyc;
  }
  for (let i = HAZ.ice.length - 1; i >= 0; i--) {
    const a = HAZ.ice[i]; a.life -= dt; a.x += Math.cos(a.a) * a.v * dt; a.y += Math.sin(a.a) * a.v * dt;
    let gone = a.life <= 0;
    for (const r of all) if (!gone && r.z < 22 && Math.hypot(r.x - a.x, r.y - a.y) < 15) { freeze(r); gone = true; }
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
  if (r.z > 0 || r.vz > 0) { r.vz -= 720 * dt; r.z += r.vz * dt; if (r.z <= 0) { r.z = 0; r.vz = 0; if (!(r.spin > 0) && Math.random() < .5) giveBoost(r, .8, 90); } }
  const air = r.z > 0;
  for (const key of ["spin", "inv", "squash", "boost", "itemT", "small", "ink", "bloopSafe", "noItem", "hyper"]) if (r[key] > 0) r[key] -= dt;
  const lost = near.d > near.half + 110 || (r.v < 20 && r.spin <= 0 && r.squash <= 0);
  r.lostT = lost ? (r.lostT || 0) + dt : 0; if (r.lostT > 2.5) { rescue(r); return; }
  if ((r.laneT -= dt) <= 0) { r.lane = (Math.random() - .5) * 100; r.laneT = 1.5 + Math.random() * 3; }
  for (const p of PADS) if (p.t === "slime") { const di = (p.i - r.idx + N) % N; if (di < 45 && Math.abs(r.lane - p.o) < 34) r.lane = p.o > 0 ? p.o - 48 : p.o + 48; }
  for (const d of DROPS) { const dd = Math.hypot(d.x - r.x, d.y - r.y); if (dd < 90 && dd > 20 && Math.random() < .5) { const dl = lat(d.x, d.y, r.idx); if (Math.abs(dl - r.lane) < 26) r.lane = dl > 0 ? dl - 40 : dl + 40; } }
  r.lane = Math.max(-ROAD / 2 + 14, Math.min(ROAD / 2 - 14, r.lane));
  const onFork = r.useAlt && r.idx >= FORK_A - 4 && r.idx < FORK_B - 6;
  const [tx, ty] = onFork ? altAt((near.alt ? near.j : nearAlt(r.x, r.y).j) + 12, Math.max(-ALT_ROAD / 2 + 12, Math.min(ALT_ROAD / 2 - 12, r.lane * .7))) : at(r.idx + 14, r.lane);
  let d = Math.atan2(ty - r.y, tx - r.x) - r.a; d = Math.atan2(Math.sin(d), Math.cos(d));
  // inked rivals don't swerve (like Mario Kart 8): they're a little slower and slippery, so they turn late
  const turn = Math.max(-2.6, Math.min(2.6, d * 4)); r.steer += (Math.sign(turn) * Math.min(1, Math.abs(turn) / 2) - r.steer) * Math.min(1, dt * 8);
  if (r.spin <= 0) r.a += turn * dt * Math.min(1, r.v / 80) * (r.ink > 0 ? .5 : 1);
  const gap = (progOf(K) - progOf(r)) / N;   // + when you're ahead of them
  const band = 1 + Math.max(-.13, Math.min(DIFF().band, gap * .7));
  boostTick(r, dt);
  const top = r.done ? (OPEN ? 0 : 140) : r.hyper > 0 ? VMAX + 50 : (!air && inPen(r.idx, L) ? 80 : off && !air ? 110 : r.skill * DIFF().skill * band * (r.small > 0 ? .72 : 1) * (r.ink > 0 ? .95 : 1)) + (r.extra || 0);
  if (r.spin > 0) r.v *= Math.pow(.3, dt); else r.v += (r.v < top ? (r.extra > 5 ? 800 : r.v < 120 ? 190 : 110) : -220) * dt;
  const ricy = MECH === "ice" && !air && (ground.pad && ground.pad.t === "ice" || (LAKE && LAKE.kind === "ice" && inLake(r.x, r.y)));
  { const rg = MECH === "ice" ? (ricy ? 2 : 5) : 99; let dm = r.a - (r.ma == null ? r.a : r.ma); dm = Math.atan2(Math.sin(dm), Math.cos(dm)); r.ma = rg > 50 ? r.a : (r.ma == null ? r.a : r.ma) + dm * Math.min(1, rg * dt); }
  if (!air && ground.pad && ground.pad.t === "mud") r.v = Math.min(r.v, 150);
  r.x += Math.cos(r.ma) * r.v * dt * SPD; r.y += Math.sin(r.ma) * r.v * dt * SPD;
  const pad = air ? null : ground.pad;
  if (pad && pad !== r.lastPad) {
    if (pad.t === "boost") giveBoost(r, 1, 110);
    if (pad.t === "ramp" && r.v > 60) { r.vz = (160 + r.v * .22) / SPD; r.z = .1; }
    if (pad.t === "bigramp" && r.v > 60) { r.vz = (300 + r.v * .3) / SPD; r.z = .1; }
    if (pad.t === "hay") { r.vz = 230; r.z = .1; }
    if (pad.t === "slime" || pad.t === "lava") hit(r);
  }
  r.lastPad = pad;
  for (const p of PIGS) { const q = pigPos(p, tt); if (!air && q.z < 10 && Math.hypot(r.x - q.x, r.y - q.y) < 17) hit(r); }
  if (KING) {
    const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0);
    if (r.kingWas < .55 && kp >= .55 && Math.hypot(r.x - kx, r.y - ky) < (KING.big ? 62 : 36) && !air) { hit(r); r.squash = 1.1; r.v = 0; }
    r.kingWas = kp;
  }
  if (LAKE && lakeFall() && !air && near.d > near.half + 4 && inLake(r.x, r.y)) rescue(r);   // fell off the bridge
  // items: Elixirs and the Arm right away, a slime when someone is close behind, an arrow when someone is ahead
  if (r.item && r.itemT <= 0 && r.spin <= 0 && !r.done) {
    const p = progOf(r), others = racers().filter(o => o !== r);
    const behind = others.some(o => p - progOf(o) > 0 && p - progOf(o) < 30), ahead = others.some(o => progOf(o) - p > 0 && progOf(o) - p < 120);
    if (["elixir", "triple", "arm", "thunder", "hyper"].includes(r.item) || (r.item === "splat" && (ahead || progOf(K) > p || Math.random() < dt * .1)) || (r.item === "slime" && (behind || Math.random() < dt * .15)) || (r.item === "arrow" && (ahead || Math.random() < dt * .1))) {
      useItem(r); r.itemT = .6; if (!r.item) r.noItem = 6 + Math.random() * 6; else r.holding = HOLDABLE(r.item);
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
function worldStep(dt, tt) {
  if (thunderFx > 0) thunderFx -= dt;
  if (LAVA && state === "race") lavaStep(dt);
  if (bloopCD > 0) bloopCD -= dt; if (armCD > 0) armCD -= dt; if (thunderCD > 0) thunderCD -= dt;
  for (const r of RIV) rivalStep(r, dt, tt);
  const all = racers();
  for (const b of BOXES) {
    if (mode === "tt") break;
    if (b.t > 0) { b.t -= dt; continue; }
    for (const r of all) if (r.z < 22 && !r.done && Math.hypot(r.x - b.x, r.y - b.y) < 15) {
      b.t = 2.5;
      if (r === K) {
        K.boxBurst = true;   // ✨ sparkles out of the box
        if (!K.item && K.roll <= 0) { K.roll = 1.1; K.pending = rollItem(K); boxSound(); }
        else if (!K.item2 && !(K.roll2 > 0)) { K.roll2 = 1.1; K.pending2 = rollItem(K); boxSound(); }   // a second item waits in the small slot
      }
      else if (!r.remote && !r.item && !(r.noItem > 0) && Math.random() < DIFF().pick) { r.item = rollItem(r, true); r.itemN = r.item === "triple" ? 3 : 0; r.itemT = 1.5 + Math.random() * 3; r.holding = HOLDABLE(r.item); }
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
    sh.x += Math.cos(sh.a) * sh.v * dt * SPD; sh.y += Math.sin(sh.a) * sh.v * dt * SPD;
    let gone = sh.life <= 0;
    for (const r of all) if (!gone && r !== sh.by && Math.hypot(r.x - sh.x, r.y - sh.y) < 16 && r.holding && HOLDABLE(r.item)
      && (sh.x - r.x) * Math.cos(r.a) + (sh.y - r.y) * Math.sin(r.a) < 0) {   // blocked by the item held behind
      r.item = null; r.holding = false; gone = true; blockSound();
      if (r === K) flash("🛡️ Blocked!", 800); else if (sh.by === K) flash(`🛡️ ${r.name} blocked it`, 900);
    }
    for (const r of all) if (!gone && r !== sh.by && Math.hypot(r.x - sh.x, r.y - sh.y) < 16) { hit(r, "🏹 Arrowed!"); gone = true; if (r !== K && sh.by === K) flash(`🏹 Got ${r.name}!`, 900); }
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
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {   // karts bump each other
    const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < 15 && Math.abs(a.z - b.z) < 12) {
      const push = (15 - d) / 2, nx = dx / d, ny = dy / d;
      if (a.remote || b.remote) { const s2 = a === K ? -1 : 1; K.x += nx * push * 2 * s2; K.y += ny * push * 2 * s2; }   // you can only move yourself
      else { a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push; }
      const fast = a.v > b.v ? a : b; fast.v *= .9;
      if ((a.hyper > 0) !== (b.hyper > 0)) { const v = a.hyper > 0 ? b : a; hit(v, "💪 Rammed by Hyper Body!"); if (v.spin > 0) { v.v *= .4; if (v === K || a === K || b === K) slamSound(0); } }
      else if ((a.small > 0) !== (b.small > 0)) { const tiny = a.small > 0 ? a : b; hit(tiny, "👟 Flattened!"); tiny.squash = .8; }
      if (a === K || b === K) { K.shake = Math.max(K.shake, .1); if (K.bump <= 0) { bumpSound(); K.bump = .3; } }
    }
  }
}

// ------------------------------------------------------------------ the race
let me = null, state = "menu", raf = 0, last = 0, keys = {}, touch = { x: 0, d: 0, b: 0, i: 0 };
let K = null, best = null, countAt = 0;
const DEV = location.hostname === "localhost" ? (window.__kart = { auto: false, get K() { return K; }, get RIV() { return RIV; }, get PEN() { return PEN; }, get N() { return N; }, get PADS() { return PADS; },
  get PIGS() { return PIGS; }, get KING() { return KING; }, get ALT() { return ALT; }, get AN() { return AN; }, get TRACK() { return TRACK_KEY; }, I, at, altAt, loadTrack,
  get tex() { return tex; }, get MP() { return MP; }, redrawNext: () => mpRedrawNext(), get IMG() { return IMG; }, get OBJS() { return OBJS; }, get LAVA() { return LAVA; }, get T() { return T; }, setTrack: k => { track = k; cup = cupOf(k); drawTrack(); }, setQ: q => { QMAX = q; fit(); }, engineLoop: (ac, f) => engineLoop(ac, f), get CROWD() { return CROWD; }, boomAt: (d, t) => { const e = { x: K.x + Math.cos(K.a) * d, y: K.y + Math.sin(K.a) * d, t, frozen: true, debris: Array.from({ length: 14 }, () => ({ a: Math.random() * 6.28, v: 60 + Math.random() * 90, vz: 120 + Math.random() * 160, s: 2 + Math.random() * 3, c: "#6b4426" })) }; BOOMS.push(e); return e; }, get BOOMS() { return BOOMS; }, get SHOTS() { return SHOTS; }, get HAZ() { return HAZ; }, get FORK() { return { a: FORK_A, b: FORK_B, AN, N, SPC }; }, autoFork: f => autoFork(f || {}), get floorMs() { return floorMs; } }) : null;
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
  const k = K; if (k.spin > 0 || k.inv > 0 || k.z > 0 || k.rescue > 0 || k.hyper > 0) return;
  k.spin = .9; k.inv = 1.9; k.drift = 0; k.charge = 0; k.boost = 0; k.extra = 0; k.hitFlash = .09; k.shake = Math.max(k.shake, .25); spinSound();
  if (k.holding) { k.item = null; k.holding = false; }   // you drop what you were holding
  const lose = Math.min(3, k.mesos); k.mesos -= lose;   // getting hit drops mesos, like coins in Mario Kart
  for (let i = 0; i < lose; i++) COINFX.push({ x: (Math.random() - .5) * 10, y: 0, vx: (Math.random() - .5) * 90, vy: -120 - Math.random() * 60, t: 1 });
  flash(lose ? `${msg} −${lose} mesos` : msg, 1000);
}
const COINFX = [];
// screen-space effects around your kart (sparks, streaks, dust, sparkles) and fire trails left on the road (world space)
let PFX = [], FIRE = [], fxClock = 0, fxSpawn = 0, fireSpawn = 0;
const sparkCol = (c, t) => c > 2.6 ? `hsl(${(t * 900) % 360},100%,65%)` : c > 1.7 ? (Math.random() < .5 ? "#ff5a2e" : "#ffb02e") : c > .8 ? (Math.random() < .5 ? "#4aa8ff" : "#c8ecff") : "#ffffff";
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
  r.rescue = 1.4; r.rescueAt = OPEN ? Math.max(START_I, r.idx - 4) : (r.idx - 4 + N) % N; r.rescueLava = !!lava; r.rescueAlt = r.onAlt ? Math.max(1, (r.altJ || 0) - 5) : null; r.drift = 0; r.charge = 0; r.boost = 0; r.extra = 0; r.spin = 0;
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
  const near = nav(k.x, k.y, k.idx); k.idx = near.i; k.off = near.d > near.half + CURB * .6; k.onAlt = near.alt; k.altJ = near.j;
  if (racing) {
    const lost = near.d > near.half + 150 || (k.v < 25 && !inp.brake && k.spin <= 0 && k.stall <= 0 && k.squash <= 0);
    k.lostT = lost ? (k.lostT || 0) + dt : Math.max(0, (k.lostT || 0) - dt);
    if (k.lostT > 2.6 || k.wrong > 3) { rescue(k); return; }
  }
  const ground = under(near, k.x, k.y), L = ground.L;
  if (MECH === "lava" && racing && k.z <= 0 && near.d > near.half + CURB + 8) {   // (on the plank bridge too: off its sides is lava)   // 🔥 Zakum: there's no safe edge, off the road is lava
    k.fallT = (k.fallT || 0) + dt; if (k.fallT > .12) { k.fallT = 0; rescue(k, "🔥 Fell into the lava!"); return; }
  } else k.fallT = 0;
  // in the air (ramps): gravity, and a trick on the way up/down gives a boost when you land
  if (k.z > 0 || k.vz > 0) {
    k.vz -= 720 * dt; k.z += k.vz * dt;
    if (k.z <= 0) { k.z = 0; k.vz = 0; k.hop = .14; if (k.trick) { giveBoost(k, .9, 95); flash("✨ Trick boost!", 700); } else bumpSound(); k.trick = false; }
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
    if (pad.t === "hay") { k.vz = 230; k.z = .1; k.mesos = Math.min(10, k.mesos + 2); flash("🌾 Boing! +2 mesos", 900); hopSound(); coinSound(); }
    if (pad.t === "slime") spinOut("🫧 Slimed!");
    if (pad.t === "lava") { spinOut("🔥 Lava! Hot hot hot!"); k.shake = .3; }
  }
  k.lastPad = pad;
  const icy = MECH === "ice" && !air && (pad && pad.t === "ice" || (LAKE && LAKE.kind === "ice" && inLake(k.x, k.y)));
  const muddy = !air && pad && pad.t === "mud";
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
  const top = k.frozen > 0 ? 90 : hb ? VMAX + 60 + k.mesos * 3 : ((mud ? 80 : muddy ? 150 : k.off && !air ? 113 : rocky && k.boost <= 0 ? 200 : VMAX + k.mesos * 3) + (k.extra || 0)) * (k.small > 0 ? .72 : 1);
  if (!racing || k.spin > 0 || k.stall > 0) k.v *= Math.pow(k.spin > 0 ? .3 : .2, dt);
  else if (inp.brake) k.v = Math.max(-60, k.v - 380 * dt);
  else k.v += (k.v < top ? (k.extra > 5 ? 900 : k.v < 120 ? 210 : 120) : -260) * dt;   // boosts reach their speed almost at once
  if (k.kick > 0) k.kick = Math.max(0, k.kick - dt * 1.4);
  for (const key of ["boost", "spin", "inv", "squash", "shake", "stall", "flip", "small", "ink", "bloopSafe", "hyper", "roll2"]) if (k[key] > 0) k[key] -= dt;
  // items from the boxes: the slot spins like a slot machine for a second, then it's yours to use
  if (k.roll > 0) { k.roll -= dt; if (k.roll <= 0) { k.item = k.pending; k.itemN = k.item === "triple" ? 3 : 0; flash(`${ITEM_NAME[k.item]}!`, 700); } }
  if (k.pending2 && !(k.roll2 > 0)) { k.item2 = k.pending2; k.pending2 = null; }
  if (!k.item && k.roll <= 0 && k.item2) { k.item = k.item2; k.itemN = k.item === "triple" ? 3 : 0; k.item2 = null; }   // the second item moves up
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
    if (k.charge > 2.6) { giveBoost(k, 2.5, 100); flash("🌈 Ultra boost!", 600); } else if (k.charge > 1.7) giveBoost(k, 1.2, 80); else if (k.charge > .8) giveBoost(k, .6, 60);
    if (k.charge > .8) whooshSound();
    k.drift = 0; k.charge = 0;
  }
  let turn = k.steer * 2.1 * Math.min(1, Math.abs(k.v) / 110) * (k.v < 0 ? -1 : 1) * (air ? .5 : 1);
  if (k.drift) { turn = (k.drift * 1.55 + k.steer * .9) * Math.min(1, k.v / 110); if (!k.off) { const before = k.charge; k.charge += dt * Math.max(.4, 1 + .7 * k.steer * k.drift);   // steering into the turn charges faster
    if ([.8, 1.7, 2.6].some(th => before < th && k.charge >= th)) tone(k.charge > 2.6 ? 1320 : k.charge > 1.7 ? 990 : 740, .1, "triangle", .06); } }
  k.a += turn * dt;
  // ❄️ El Nath: on ice the kart keeps going the way it was moving and only slowly follows where it's pointing
  const grip = MECH === "ice" ? (icy ? 1.1 : k.off ? 4.5 : 2.6) : 99;
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
  for (const c of COINS) if (!c.got && Math.abs(k.z - (c.z || 0)) < 30 && Math.hypot(k.x - c.x, k.y - c.y) < 18) { c.got = true; k.mesos = Math.min(10, k.mesos + 1); k.v = Math.min(k.v + 22, 360); coinSound(); }
  for (const p of PIGS) { const q = pigPos(p, tt); if (!air && q.z < 10 && Math.hypot(k.x - q.x, k.y - q.y) < 17) spinOut(p.k.includes("pig") ? "🐷 Oink!" : p.k.includes("snail") ? "🐌 Snail!" : "🍄 Bonk!"); }
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
    COINS.forEach(c => c.got = false);   // mesos come back every lap (the 10 max stays)
    if (k.lap >= LAPS) finish();
    else if (k.lap === LAPS - 1) { flash("🏁 FINAL LAP!", 1600); finalSound(); B.musicRate(1.15); fireworks(3); }   // fanfare, and the music speeds up
    else flash(`Lap ${k.lap + 1}`, 1300);
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
  k.fov = (k.fov || 0) + (((k.boost > 0 || k.hyper > 0) ? 1 : 0) - (k.fov || 0)) * .12;
  const FO = FOCAL * (1 - .19 * k.fov);
  const cx = k.x - ca * CD, cy = k.y - sa * CD;
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
  const CH = CAMH + Math.min(k.z, 130) * .35;
  const fk = FW / W, LV = MECH === "lava" && LAVA && PIDX ? Math.floor(LAVA.i) + 1 : 0, lvs = Math.floor(performance.now() / 70), f0 = performance.now();
  for (let y = 0; y < FH; y++) {
    const yl = (y + .5) / fk, z = CH * FO / (yl + .5), half = z * (W / 2) / FO;
    let wx = cx + ca * z + sa * half, wy = cy + sa * z - ca * half;   // left end of the row
    const stx = -sa * 2 * half / FW, sty = ca * 2 * half / FW, f = FOG[y], nf = 256 - f;
    const hr = HAZE[0] * f, hg = HAZE[1] * f, hb = HAZE[2] * f;
    let o = y * FW;
    if (LV > 0) for (let x = 0; x < FW; x++, wx += stx, wy += sty, o++) {   // 🔥 the Zakum runs: everything behind the lava front is lava
      const ix = wx | 0, iy = wy | 0, inside = ix >= 0 && iy >= 0 && ix < WORLD && iy < WORLD;
      let c = inside ? TEX[iy * WORLD + ix] : OUT;
      if (inside) { const pi = PIDX[iy * WORLD + ix]; if (pi && pi < LV) c = pi > LV - 7 ? 0xff7ee8ff : LAVAT[((iy + lvs) & 63) * 64 + ((ix + (lvs >> 1)) & 63)]; }
      if (f) c = 0xff000000 | ((((c >>> 16) & 255) * nf + hb) >> 8) << 16 | ((((c >>> 8) & 255) * nf + hg) >> 8) << 8 | (((c & 255) * nf + hr) >> 8);
      F32[o] = c >>> 0;
    }
    else if (stx * stx + sty * sty < .36) for (let x = 0; x < FW; x++, wx += stx, wy += sty, o++) {   // close up: blend the 4 nearest texture pixels (smooth, not blocky)
      const fx = wx - .5, fy = wy - .5, ix = Math.floor(fx), iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= WORLD - 1 || iy >= WORLD - 1) { F32[o] = OUT; continue; }
      const ax = fx - ix, ay = fy - iy, p = iy * WORLD + ix, c00 = TEX[p], c10 = TEX[p + 1], c01 = TEX[p + WORLD], c11 = TEX[p + WORLD + 1];
      const w00 = (1 - ax) * (1 - ay) * 256 | 0, w10 = ax * (1 - ay) * 256 | 0, w01 = (1 - ax) * ay * 256 | 0, w11 = 256 - w00 - w10 - w01;
      const r = ((c00 & 255) * w00 + (c10 & 255) * w10 + (c01 & 255) * w01 + (c11 & 255) * w11) >> 8,
        g = (((c00 >>> 8) & 255) * w00 + ((c10 >>> 8) & 255) * w10 + ((c01 >>> 8) & 255) * w01 + ((c11 >>> 8) & 255) * w11) >> 8,
        b = (((c00 >>> 16) & 255) * w00 + ((c10 >>> 16) & 255) * w10 + ((c01 >>> 16) & 255) * w01 + ((c11 >>> 16) & 255) * w11) >> 8;
      const dt2 = DETAIL[(((fy * 3) | 0) & 63) * 64 + (((fx * 3) | 0) & 63)];
      F32[o] = (0xff000000 | ((b * dt2) >> 8) << 16 | ((g * dt2) >> 8) << 8 | ((r * dt2) >> 8)) >>> 0;
    }
    else for (let x = 0; x < FW; x++, wx += stx, wy += sty, o++) {
      const ix = wx | 0, iy = wy | 0;
      let c = (ix >= 0 && iy >= 0 && ix < WORLD && iy < WORLD) ? TEX[iy * WORLD + ix] : OUT;
      if (f) c = 0xff000000 | ((((c >>> 16) & 255) * nf + hb) >> 8) << 16 | ((((c >>> 8) & 255) * nf + hg) >> 8) << 8 | (((c & 255) * nf + hr) >> 8);
      F32[o] = c >>> 0;
    }
  }
  bctx.putImageData(floor, 0, Math.round(HOR * fk));
  floorMs += (performance.now() - f0 - floorMs) * .05;   // too slow for this device? draw the floor less sharp
  if (floorMs > 11 && fk > 1 && state === "race") { QMAX = fk - 1; floorMs = 6; fit(); }
  if (T.theme.night) { ctx.fillStyle = `rgba(8,10,40,${T.theme.night})`; ctx.fillRect(0, 0, W, H); }
  // billboards, far to near: scenery, mesos, pigs and the King Slime (with a shadow when it's up in the air)
  const tt = performance.now() / 1000, vis = [];
  const add = (x, y, im, sc, z, flip, shadow) => {
    const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa;
    if (fz < 8 || fz > 1400 || !im) return;
    const sx = W / 2 + (-rx * sa + ry * ca) * FO / fz;
    if (sx < -120 || sx > W + 120) return;
    vis.push({ im, fz, sx, sc, z, flip, shadow, px: im.px });
  };
  const addDraw = (x, y, draw) => {
    const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa;
    if (fz < 6 || fz > 1300) return;
    const sx = W / 2 + (-rx * sa + ry * ca) * FO / fz;
    if (sx < -80 || sx > W + 80) return;
    vis.push({ fz, sx, draw });
  };
  for (const r of RIV) if (!r.gone) addDraw(r.x, r.y, (sx, gy, sc, fz) => drawRival(r, sx, gy, sc, fz));
  if (mode !== "tt") for (const b of BOXES) if (b.t <= 0) addDraw(b.x, b.y, (sx, gy, sc) => drawBox(sx, gy, sc, tt));
  if (mode === "tt" && topGhost && state !== "menu") {   // 🏆 the guild's #1, see-through and gold
    const gs = ghostAt(K.t, topGhost.data);
    if (gs) addDraw(gs.x, gs.y, (sx, gy, sc, fz) => drawRival({ name: `🏆 ${topGhost.name}`, img: topGhost.img, color: "#e8b43a", steer: 0, z: gs.z, spin: 0, squash: 0, inv: 0, ghost: true }, sx, gy, sc, fz));
  }
  if (mode === "tt" && ghost && state !== "menu" && !(topGhost && topGhost.name === me)) {   // 👻 your best run, see-through
    const gs = ghostAt(K.t); if (gs) addDraw(gs.x, gs.y, (sx, gy, sc, fz) => drawRival({ name: "👻 Your best", img: IMG.me, color: "#c8232c", steer: 0, z: gs.z, spin: 0, squash: 0, inv: 0, ghost: true }, sx, gy, sc, fz));
  }
  for (const d of DROPS) add(d.x, d.y, IMG.slime, .32, 0, false, .5);
  for (const f of FIRE) addDraw(f.x, f.y, (sx, gy, sc) => { const a = f.t / .4, h = 5.5 * sc * (.5 + a * .7) * (.85 + Math.random() * .3), w2 = 2.2 * sc;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * .75;
    const g3 = ctx.createLinearGradient(0, gy - h, 0, gy); g3.addColorStop(0, "rgba(255,80,20,0)"); g3.addColorStop(.5, "#ff7a1e"); g3.addColorStop(1, "#ffe08a");
    ctx.fillStyle = g3; ctx.beginPath(); ctx.ellipse(sx, gy - h / 2, w2, h / 2, 0, 0, 7); ctx.fill(); ctx.restore(); });
  const proj = (x, y) => { const rx = x - cx, ry = y - cy, fz = rx * ca + ry * sa; return fz < 4 ? null : [W / 2 + (-rx * sa + ry * ca) * FO / fz, HOR + CH * FO / fz, FO / fz]; };
  // 🏹 a real MapleStory arrow in flight, pointing where it's going, with a glowing streak behind it
  for (const sh of SHOTS) addDraw(sh.x, sh.y, (sx, gy, sc) => {
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
  for (const L of HAZ.lanes) { const [lx, ly] = at(L.i, L.side * (ROAD / 2 + CURB + 34)); addDraw(lx, ly, (sx, gy, sc) => {
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
  for (const a of ARMS) addDraw(a.tgt.x, a.tgt.y, (sx, gy, sc) => { const im = IMG.arm; if (!im) return; const h = 70 * sc, w = h * im.width / im.height, drop = Math.max(0, a.t - .3) / 2.3;
    ctx.drawImage(im, sx - w / 2, gy - h - drop * 160 * sc, w, h); });
  for (const ob of OBJS) add(ob.x, ob.y, IMG[ob.k], ob.s, ob.bob ? (ob.z || 0) + Math.sin(tt * 2 + ob.x) * ob.bob : ob.z || 0);
  for (const c of CROWD) if (c.img) addDraw(c.x, c.y, (sx, gy, sc) => {   // cheering (jumping) fans; founders get a name tag with a crown
    const im = c.img, w = im.width * sc * c.s, h = im.height * sc * c.s, top = gy - h - Math.max(0, Math.sin(tt * c.sp + c.ph)) * c.jump * sc;
    if (w < .6) return;
    ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.beginPath(); ctx.ellipse(sx, gy, w * .35, h * .06 + .5, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.imageSmoothingEnabled = false; if (c.flip) { ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(im, -w / 2, top, w, h); } else ctx.drawImage(im, sx - w / 2, top, w, h); ctx.restore();
    if (c.tag && sc > .35) { const fs = Math.max(5, Math.min(10, 6 * sc)); ctx.font = `900 ${fs}px Ubuntu, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = Math.max(1.5, fs / 4);
      ctx.strokeStyle = "#5a0d10"; ctx.strokeText(c.tag, sx, top - 2); ctx.fillStyle = "#ffd75e"; ctx.fillText(c.tag, sx, top - 2); }
  });
  for (const p of PENPIGS) { const q = penPigPos(p, tt); add(q.x, q.y, IMG[p.k], .45, 0, q.dir > 0); }
  if (IMG.meso) for (const c of COINS) if (!c.got && (c.x - cx) * ca + (c.y - cy) * sa > CD * 1.05) add(c.x, c.y, IMG.meso[Math.floor(tt * 8 + c.x * .05) % 4], .55, (c.z || 0) + 6 + Math.sin(tt * 4 + c.x) * 2);
  for (const p of PIGS) { const q = pigPos(p, tt); add(q.x, q.y, IMG[p.k], .45, q.z, q.dir > 0, q.z > 2 ? .5 : 0); }
  if (KING) { const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0), kz = kingZ(kp); add(kx, ky, IMG[KING.k], KING.s, kz, false, kz > 0 ? 1 - kz / 170 : 0); }
  vis.sort((a, b) => b.fz - a.fz);
  let kartDrawn = false;
  const dk = darkness(); let darkDone = false;
  const lightsOut = () => { if (darkDone || dk <= 0) return; darkDone = true; ctx.globalAlpha = 1; ctx.fillStyle = `rgba(2,3,8,${dk * .97})`; ctx.fillRect(0, 0, W, H);
    const gl = ctx.createRadialGradient(W / 2, H * .78, 4, W / 2, H * .78, W * .28); gl.addColorStop(0, `rgba(255,230,160,${.12 * dk})`); gl.addColorStop(1, "rgba(255,230,160,0)"); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); };
  for (const v of vis) {
    if (!kartDrawn && v.fz < CD) { lightsOut(); ctx.globalAlpha = 1; drawKart(k); kartDrawn = true; }   // things between the camera and you go in front of your kart
    if (v.draw) { ctx.globalAlpha = 1; v.draw(v.sx, HOR + CH * FO / v.fz, FO / v.fz, v.fz); continue; }
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
  if (!kartDrawn) { lightsOut(); drawKart(k); }
  if (T.theme.snow) snowfall(T.theme.snow);
  if (HAZ.pap && IMG.papStand) drawPapulatus(k, tt);
  if (!T.theme.snow) petals(T.cup);   // petals in Henesys, fireflies in Sleepywood, embers at Zakum, confetti in Ludibrium (El Nath has its snow)
  if (LAVA && state !== "menu" && !k.done) { const near = Math.max(0, 1 - (k.idx - LAVA.i) * SPC / 640); if (near > 0) {   // the screen glows red as the lava closes in
    const gr = ctx.createRadialGradient(W / 2, H * .6, H * .2, W / 2, H * .6, W * .75); gr.addColorStop(0, "rgba(255,60,0,0)"); gr.addColorStop(1, `rgba(255,60,0,${near * .5})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); } }
  if (k.hitFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(.7, k.hitFlash * 8)})`; ctx.fillRect(0, 0, W, H); }
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
function drawKart(k) {
  if (k.watch) return;   // watching: there's no kart of yours
  const CH = CAMH + Math.min(k.z, 130) * .35, gy = HOR + CH * FOCAL / CD, gy0 = HOR + CAMH * FOCAL / CD, sc = FOCAL / CD, x = W / 2 + k.steer * 4;
  const hop = k.hop > 0 ? Math.sin((k.hop / .18) * Math.PI) * 6 : 0, rumble = k.off && k.v > 40 ? (Math.random() - .5) * 2 : 0;
  const jitter = k.v > 150 && k.z <= 0 ? (Math.random() - .5) * 1.3 * k.v / VMAX : 0;
  const y = gy0 - hop + rumble + jitter - Math.min(k.z * sc * .45, H * .2), tilt = (k.drift ? k.drift * .16 : 0) + k.steer * .06 + (k.flip > 0 ? (1 - k.flip / .4) * Math.PI * 2 : 0);
  const w = 20 * sc, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(x, gy + 2, w * .55 / (1 + k.z / 80), 4, 0, 0, 7); ctx.fill();
  cv.style.transform = fxc.style.transform = k.shake > 0 ? `translate(${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px, ${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px)` : "";
  // effects: spawn (about 60 a second), move and draw the screen-space particles
  const now = performance.now() / 1000, fdt = Math.min(.05, now - (fxClock || now)); fxClock = now;
  if ((fxSpawn -= fdt) <= 0) {
    fxSpawn = .02;
    if (k.drift && k.charge > .2) for (const side of [-1, 1]) for (let n = 0; n < 2; n++)   // drift sparks from the rear wheels
      PFX.push({ x: x + side * w * .42, y: y - 2, vx: side * (30 + Math.random() * 70) - k.drift * 20, vy: 20 + Math.random() * 70, t: .15, life: .15, size: 1.4 + Math.random() * 1.4, col: sparkCol(k.charge, now), kind: "spark" });
    if (k.fov > .2 && state === "race") for (let n = 0; n < 2; n++) {   // speed streaks rushing past
      const ang = Math.random() * Math.PI * 2, r0 = W * (.22 + Math.random() * .25), cxs = W / 2, cys = HOR + (H - HOR) * .32;
      PFX.push({ x: cxs + Math.cos(ang) * r0, y: cys + Math.sin(ang) * r0 * .55, vx: Math.cos(ang) * 420, vy: Math.sin(ang) * 230, t: .14, life: .14, size: 1, col: "#ffffff", kind: "streak" });
    }
    if (k.off && k.v > 60 && k.z <= 0) { const side = Math.random() < .5 ? -1 : 1;   // dust off the road
      PFX.push({ x: x + side * w * .4 + (Math.random() - .5) * 6, y: y - 2, vx: side * 18 + (Math.random() - .5) * 20, vy: 25 + Math.random() * 25, t: .45, life: .45, size: 3 + Math.random() * 2, col: T.theme.dust || (T.theme.road === "dirt" ? "120,90,50" : "110,95,60"), kind: "dust" }); }
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
  const glow = k.drift && k.charge > .8 ? (k.charge > 2.6 ? `hsla(${(now * 900) % 360},100%,60%,` : k.charge > 1.7 ? "rgba(255,110,30," : "rgba(70,160,255,") : (k.extra || 0) > 20 ? "rgba(255,140,40," : null;
  if (glow) { const g4 = ctx.createRadialGradient(x, gy, 2, x, gy, w * .9); g4.addColorStop(0, glow + ".55)"); g4.addColorStop(1, glow + "0)"); ctx.fillStyle = g4; ctx.fillRect(x - w, gy - w * .5, w * 2, w); }
  if (IMG.meso) for (const c of COINFX) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(IMG.meso[Math.floor(c.t * 16) % 4], x + c.x - 6.5, y - 30 + c.y, 13, 12); ctx.restore(); }
  let lift = 0;
  if (k.rescue > 0) { const p = k.rescue > .7 ? (1.4 - k.rescue) / .7 : k.rescue / .7; lift = p * 40; ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("📜", x, y - 60 - lift); }
  ctx.save(); ctx.translate(x, y - lift); ctx.rotate(tilt);
  if (k.small > 0) ctx.scale(.6, .6);   // shrunk by Thunder
  if (k.hyper > 0) { ctx.scale(1.3, 1.3); ctx.shadowColor = `hsl(${(t * 600) % 360},100%,60%)`; ctx.shadowBlur = 14; }   // 💪 Hyper Body
  if (k.spin > 0) ctx.scale(Math.cos((.9 - k.spin) * Math.PI * 4), 1);      // spinning out
  if (k.squash > 0) ctx.scale(1.35, .45);                                   // flattened by the King Slime
  if (k.inv > 0 && k.spin <= 0 && Math.floor(performance.now() / 90) % 2) ctx.globalAlpha = .55;
  const bw = w, bh = w * .42;
  if (k.holding && k.item) { const hi = k.item === "arrow" ? IMG.arrowIcon : IMG.slime; if (hi) { const hs = 16; ctx.save(); ctx.imageSmoothingEnabled = k.item === "arrow"; ctx.drawImage(hi, -hs / 2, -2, hs, hs * hi.height / hi.width); ctx.restore(); } }
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
  if (k.spin > 0 || k.squash > 0) dizzy(x, y - lift - w * 1.55, w * .55, t);   // 💫 seeing stars after a hit
  if (k.frozen > 0) iceBlock(x, y - lift, w, Math.min(1, k.frozen / .3));
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
  if (r.ghost) ctx.globalAlpha = .45;
  const w = 17 * sc, bh = w * .42, y = gy - r.z * sc * .45, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(sx, gy + 1, w * .55, Math.max(1, 3 * sc / 2), 0, 0, 7); ctx.fill();
  if (r.rescue > 0) { const p = r.rescue > .7 ? (1.4 - r.rescue) / .7 : r.rescue / .7; ctx.globalAlpha = Math.max(0, 1 - p); }
  ctx.save(); ctx.translate(sx, y); ctx.rotate(r.steer * .06);
  if (r.small > 0) ctx.scale(.6, .6);
  if (r.hyper > 0) { ctx.scale(1.3, 1.3); ctx.shadowColor = "#ffd75e"; ctx.shadowBlur = 10; }
  if (r.spin > 0) ctx.scale(Math.cos((.9 - r.spin) * Math.PI * 4), 1);
  if (r.squash > 0) ctx.scale(1.35, .45);
  if (r.inv > 0 && r.spin <= 0 && Math.floor(t * 11) % 2) ctx.globalAlpha = .55;
  if (r.ghost) ctx.globalAlpha = .45;
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
  if (r.holding && r.item) { const hi = r.item === "arrow" ? IMG.arrowIcon : IMG.slime; if (hi) { const hs = 9 * sc; ctx.drawImage(hi, -hs / 2, -hs * .3, hs, hs * hi.height / hi.width); } }
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
  $k("#kLap").textContent = state === "menu" ? "" : OPEN ? `🏔️ ${Math.min(100, Math.round(Math.max(0, k.idx - START_I) / (N - FIN_OFF - START_I) * 100))}%` : `LAP ${Math.min(k.lap + 1, LAPS)}/${LAPS}`;
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
  const bag = state === "menu" ? "" : `${k.mesos}/10`; if ($k("#kBag").dataset.v !== bag) { $k("#kBag").dataset.v = bag; $k("#kBag").innerHTML = bag ? `<img src="media/kart/meso1.png" alt="">${bag}` : ""; }
  if ((k.roll > 0 || k.roll2 > 0) && performance.now() - rollTick > 85) { rollTick = performance.now(); tone([660, 740, 830, 880, 990, 880, 830, 740][rollN++ % 8], .05, "square", .035); }
  const keys = Object.keys(ITEM_ICON), spinIcon = () => ITEM_ICON[keys[Math.floor(performance.now() / 80) % keys.length]];
  const icon = k.roll > 0 ? spinIcon() : k.item ? ITEM_ICON[k.item] : "";
  const icon2 = k.roll2 > 0 ? spinIcon() : k.item2 ? ITEM_ICON[k.item2] : "";
  const img2 = $k("#kItem2 img"); if (img2.dataset.src !== icon2) { img2.dataset.src = icon2; if (icon2) img2.src = icon2; img2.hidden = !icon2; }
  $k("#kItem2").hidden = !icon2;
  const img = $k("#kItemBox img"); if (img.dataset.src !== icon) { img.dataset.src = icon; if (icon) img.src = icon; img.hidden = !icon; }
  $k("#kItemBox").classList.toggle("empty", !k.item && k.roll <= 0);
  $k("#kItemBoxN").textContent = k.item === "triple" ? k.itemN : ""; $k("#kItemBoxN").hidden = k.item !== "triple";
  const pb = $k("#kPad [data-k=i]"); pb.disabled = !k.item || k.roll > 0; const pi = pb.querySelector("img"); if (pi.dataset.src !== icon) { pi.dataset.src = icon; if (icon) pi.src = icon; pi.hidden = !icon; }
  const rk = state === "menu" || mode === "tt" ? 0 : state === "done" ? K.place : rankOf(k);
  if (state === "race" && rk && lastRk && rk !== lastRk) { posPop = { up: rk < lastRk, at: performance.now() }; if (rk < lastRk) tone(988, .09, "square", .05, 1320); }
  if (state !== "race") posPop = null; lastRk = rk;
  const pop = posPop && performance.now() - posPop.at < 650 ? (posPop.up ? " up" : " down") : "";
  $k("#kPos").textContent = rk ? rk + (["", "st", "nd", "rd"][rk] || "th") : ""; $k("#kPos").className = "kt-pos p" + rk + (k.lap === LAPS - 1 && state === "race" ? " final" : "") + pop;
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
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  syncRot(); $k("#kFull").hidden = !wantFull();
  if (TEX && K && state !== "loading") { if (state === "watch") { watchStep(dt); render(); watchHud(); } else { step(dt); render(); hud(); engine(); } }
  if (mpOn() && K && (state === "race" || state === "count" || state === "done") && now - MP.sendAt > 80) {
    MP.sendAt = now; const k = K;
    mpSend("p", { x: Math.round(k.x), y: Math.round(k.y), a: +k.a.toFixed(3), v: Math.round(k.v), z: Math.round(k.z), s: +k.steer.toFixed(2), sp: k.spin > 0 ? +k.spin.toFixed(2) : 0,
      sm: k.small > 0 ? 1 : 0, hy: k.hyper > 0 ? 1 : 0, ex: Math.round(k.extra || 0), sq: k.squash > 0 ? 1 : 0, lap: k.lap, cps: k.cps, idx: k.idx, ho: k.holding ? 1 : 0, it: k.holding ? k.item : null,
      ik: k.ink > 0 ? 1 : 0, dn: state === "done" ? 1 : 0, ft: state === "done" ? Math.round(k.laps.reduce((a, b) => a + b, 0)) : 0 });
    for (const r of RIV) if (r.bot && !r.remote) mpSend("p", { n: r.name, x: Math.round(r.x), y: Math.round(r.y), a: +r.a.toFixed(3), v: Math.round(r.v), z: Math.round(r.z || 0), s: +(r.steer || 0).toFixed(2),
      sp: r.spin > 0 ? +r.spin.toFixed(2) : 0, sm: r.small > 0 ? 1 : 0, hy: r.hyper > 0 ? 1 : 0, ex: Math.round(r.extra || 0), sq: r.squash > 0 ? 1 : 0, lap: r.lap, cps: r.cps, idx: r.idx,
      ho: r.holding ? 1 : 0, it: r.holding ? r.item : null, ik: r.ink > 0 ? 1 : 0, dn: r.done ? 1 : 0, ft: r.done ? Math.round(r.finishT) : 0 });
  }
  raf = requestAnimationFrame(loop);
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
  K = freshKart(); setupHazards(); PETALS = []; FWK = []; lastRk = 0; finishers = 0; bloopCD = 0; armCD = 0; thunderCD = 0; thunderFx = 0; FLAKES = [];
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
async function prepare() {
  const mstrip = await loadImg("media/kart/meso.png?v=1"); IMG.meso = mstrip ? mesoFrames(mstrip) : null;
  [IMG.arrowIcon, IMG.arm, IMG.arrowShot] = await Promise.all([loadImg("media/kart/items/arrow_icon.png"), loadImg(B.M + "zarm_stand.gif"), loadImg("media/kart/items/arrow.png")]);   // the quiver (held as a shield) and the real arrow
  IMG.bombF = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => loadImg(`media/kart/items/bomb${i}.png`)));   // 💣 Gunslinger's Grenade (MapleStory)
  IMG.boomF = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(i => loadImg(`media/kart/items/boom${i}.png`)));
  if (IMG.arrowShot) { const c = document.createElement("canvas"); c.width = IMG.arrowShot.width; c.height = IMG.arrowShot.height; const g = c.getContext("2d");
    g.drawImage(IMG.arrowShot, 0, 0); g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(120,200,255,.75)"; g.fillRect(0, 0, c.width, c.height); IMG.iceArrow = c; }
  if (IMG.bombF.some(x => !x)) IMG.bombF = null; if (IMG.boomF.some(x => !x)) IMG.boomF = null;
  await Promise.all([...MOBS, "king_slime", "ribbon_pig"].map(async m => { IMG[m] = await loadImg(`media/mobs/${m}.png`); if (IMG[m]) IMG[m].px = true; })
    .concat(Object.keys(PROPS).filter(k => !PROPS[k][2]).map(async k => { IMG[k] = await loadImg(`media/kart/${k}.webp?v=1`); })));
  assetsReady = true;
}
// a track's own sky, horizon strip, scenery and monsters, loaded the first time it's raced
const ART = {};
const artImg = src => ART[src] || (ART[src] = loadImg(src));
async function loadArt() {
  const want = new Set([...OBJS.map(o => o.k), ...PIGS.map(p => p.k), ...(KING ? [KING.k] : []), ...(T.mobs || [])]), jobs = [];
  for (const k of want) if (!(k in IMG)) {
    IMG[k] = null; const p = PROPS[k];
    jobs.push(artImg(p ? (p[2] ? `media/kart/${p[2]}/${k}.webp?v=1` : `media/kart/${k}.webp?v=1`) : `media/mobs/${k}.png?v=1`).then(im => { IMG[k] = im; if (im && !p) im.px = true; }));
  }
  const art = T.art || HEN_ART;
  jobs.push(makeCrowd());
  if (TRACK_KEY === "ld3" && !IMG.papStand) jobs.push(Promise.all([...[0, 1, 2, 3, 4, 5].map(i => artImg(`media/kart/ludi/pap_stand${i}.webp`)), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => artImg(`media/kart/ludi/pap_skill${i}.webp`))])
    .then(a => { if (a.every(Boolean)) { IMG.papStand = a.slice(0, 6); IMG.papSkill = a.slice(6); } }));
  jobs.push(artImg(art.sky).then(im => { sky = im; }), artImg(art.strip).then(im => { IMG.strip = im; }));
  await Promise.all(jobs);
}
const ordinal = n => n + (["", "st", "nd", "rd"][n] || "th");
let TRACK_LEN = 0;
function finish() {
  if (mode === "mp") return mpFinish();
  const k = K; state = "done"; K.doneAt = performance.now(); B.musicRate(1); fireworks(6);
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
    const laps = `<div class="k-laps">${k.laps.map((l, i) => `<span class="${l === bl ? "b" : ""}">Lap ${i + 1}: ${fmt(l)}</span>`).join("")}</div>`;
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
      html = `${head}<p class="k-diff">${DIFF().label}${mode === "gp" ? ` · ${CUPS[gp.cup].name} race ${gp.race}/${GP_RACES}` : ` · ${T.name}`}</p>${table}
        <div class="row">${mode === "gp" ? (last ? `<button class="sk-btn bd-play" data-a="podium">🏆 See the podium</button>` : `<button class="sk-btn bd-play" data-a="next">Next: ${nx.icon} ${nx.name} ▶</button>`)
          : `<button class="sk-btn bd-play" data-a="again">Race again</button>`}<button class="sk-btn sk-private" data-a="back">Back</button></div>`;
    }
    $k("#kResult").innerHTML = html; $k("#kResult").hidden = false; $k("#kResult").classList.toggle("wide", mode !== "tt");
    sent.then(r => { const el = $k("#kRank"); if (!el || !r) return;
      el.innerHTML = r.r === "ok" ? `🏆 You're <b>#${r.rank}</b> on the guild board` : r.r === "laps" ? "That time looks impossible, so it wasn't saved 🤔" : r.r === "dev" ? "(test race, not saved)" : "Couldn't save your time this time."; });
  }, 1400);
}
function mpFinish() {
  const k = K; state = "done"; K.doneAt = performance.now(); B.musicRate(1); MP.finished = true; fireworks(6); if (!MP.endAt) { MP.endAt = performance.now() + 10000; MP.firstName = MP.me; }
  const total = Math.round(k.laps.reduce((a, b) => a + b, 0)), place = rankOf(k);
  B.sound(place <= 3 ? "win" : "lose"); flash(place === 1 ? "🏆 1st PLACE!" : "🏁 FINISH!", 1600);
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
  $k("#kResult").innerHTML = `<h3>${total == null ? "⏱️ Time's up!" : "🏁 " + fmt(total)}</h3><p class="k-diff">${total == null ? "Your place is where you were on the track. Getting the results…" : "Everyone else has 10 seconds to finish…"}</p>
    <table class="k-table">${rows.map((r, i) => `<tr class="${r === K ? "you" : ""}"><td>${ordinal(i + 1)}</td><td><img src="${r !== K && r.bot ? botImg(r.name) : spriteOf(r === K ? me : r.name)}" alt=""></td><td>${esc(r === K ? me : r.name)}</td>
    <td>${r === K ? (total == null ? "—" : fmt(total)) : r.done ? fmt(r.finishT) : "racing…"}</td></tr>`).join("")}</table>`;
  $k("#kResult").hidden = false; $k("#kResult").classList.add("wide");
}
function mpShowResults(res) {
  if (state !== "done" || !res) return;
  const mine = res.find(r => r.name === MP.me);
  if (MP.tallied !== MP.raceNo) { MP.tallied = MP.raceNo; for (const r of res) MP.tally[r.name] = (MP.tally[r.name] || 0) + (GP_PTS[r.place - 1] || 0); }   // this room's own standings, for everyone
  $k("#kResult").innerHTML = `<h3>${mine ? (["", "🥇", "🥈", "🥉"][mine.place] || "🏁") + " " + ordinal(mine.place) + " place" : "🏁 Race over"}</h3>
    <p class="k-diff">👥 Room ${MP.code} · ${esc(TRACKS[String(MP.track).split("@")[0]] ? TRACKS[String(MP.track).split("@")[0]].name : "")} · ${CCS[raceCC].label}</p>
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
  const order = Object.entries(MP.tally).filter(([n]) => here.has(n)).sort((a, b) => b[1] - a[1]);
  const stand = order.length ? `<div class="k-stand"><b>🏆 Room standings</b>${order.map(([n, p], i) => `<span class="${n === MP.me ? "you" : ""}">${["🥇", "🥈", "🥉"][i] || ordinal(i + 1)} <img src="${spriteOf(n)}" alt="">${esc(n)} <em>${p}</em></span>`).join("")}</div>` : "";
  const pick = host ? `<p class="kt-pickhead">👑 You're the host: pick the next race</p>
      <div class="kt-cuppick">${Object.entries(CUPS).map(([k, c]) => `<button type="button" data-c="${k}" class="${k === cup ? "on" : ""}"><span>${c.icon}</span>${c.name.replace(" Cup", "")}</button>`).join("")}</div>
      <div class="kt-trackpick">${CUPS[cup].tracks.map(k => `<button type="button" data-t="${k}" class="${k === track ? "on" : ""}">${TRACKS[k].icon} ${TRACKS[k].name}</button>`).join("")}</div>
      <div class="kt-diff">${Object.entries(CCS).map(([k, c]) => `<button type="button" data-cc="${k}" class="${+k === cc ? "on" : ""}">${c.label}</button>`).join("")}</div>
      ${playerList()}${botPick()}<p class="k-diff">${countNote()}</p>
      <div class="row"><button class="sk-btn bd-play" data-a="mpgo" ${(humansIn() < 2 && !botsWant) || !R.all ? "disabled" : ""}>${R.all ? `🏁 Race ${t.icon} ${esc(t.name)} · ${CCS[cc].label.split(" ")[1]}!` : `⏳ Waiting for ${R.waiting.length} to be ready…`}</button></div>
      ${humansIn() < 2 && !botsWant ? `<p class="k-diff">Everyone else left… waiting for someone to join (or turn on 🤖).</p>` : !R.all ? `<p class="k-diff">Waiting for ${R.waiting.map(esc).join(", ")} to press Ready ✋</p>` : ""}`
    : `${readyBtn(R.mine)}${playerList()}<div class="k-wait"><img class="k-dance" src="media/mobs/anim/jr_balrog.gif" alt=""><div><b>⏳ ${esc(MP.host || "The host")} 👑 is picking the next race</b>
      <small>Next up: ${t.icon} ${esc(t.name)} · ${CCS[roomCC()].label}${CUPS[cupOf(rk)].rule ? ` · ${CUPS[cupOf(rk)].rule}` : ""}</small></div></div>`;
  return `${stand}${pick}<div class="row"><button class="sk-btn sk-private" data-a="mpleave">🚪 Leave the room</button></div>`;
}
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
  let tok = null; try { tok = store.get("kart_room_tok:" + code); } catch (e) {}
  const { data, error } = await sb.rpc("kart_room_join", { p_code: code, p_name: nm, p_tok: tok, p_public: !!pub });
  if (error || !data) { $k("#kErr").textContent = "Couldn't reach the room, try again."; return; }
  const why = { name: "Type your name first.", taken: "Someone in that room already has your name.", full: "That room is full (8 players).",
    running: "That room is racing right now. Try again when the race ends.", busy: "Too many rooms right now, try again soon.", code: "That room code doesn't look right." }[data.r];
  if (why) { $k("#kErr").textContent = why; return; }
  $k("#kErr").textContent = "";
  store.set("kart_room_tok:" + code, data.token);
  Object.assign(MP, { code, token: data.token, me: data.name, raceNo: -1, results: null, pick: null, tally: {}, tallied: null, chat: [], watching: false }); chatDraw();
  if (MP.ch) sb.removeChannel(MP.ch);
  MP.ch = sb.channel("kartroom:" + code, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "p" }, ({ payload }) => mpOnPos(payload))
    .on("broadcast", { event: "it" }, ({ payload }) => mpOnItem(payload))
    .on("broadcast", { event: "go" }, () => mpPoll())
    .on("broadcast", { event: "rd" }, () => mpPoll())
    .on("broadcast", { event: "ch" }, ({ payload }) => { if (payload && chatAdd([{ id: payload.id, name: payload.name, msg: payload.msg }])) tone(880, .07, "triangle", .04); })
    .on("broadcast", { event: "tr" }, ({ payload }) => { if (payload && TRACKS[payload.t] && (MP.pick !== payload.t || MP.pickCC !== payload.cc)) { MP.pick = payload.t; MP.pickCC = CCS[payload.cc] ? +payload.cc : 150; if (!$k("#kMenu").hidden) drawRoom(); else mpRedrawNext(); } })
    .subscribe();
  if (location.hash !== "#kart/" + code) history.replaceState(null, "", "#kart/" + code);
  clearInterval(MP.poll); MP.poll = setInterval(mpPoll, 1500); await mpPoll(true);
}
async function mpPoll(first) {
  if (!MP.code || MP.polling) return; MP.polling = true;
  try {
    const racingNow = state === "race" && K && !MP.finished;
    const prog = racingNow ? Math.max(0, Math.min(1, OPEN ? K.idx / N : (K.lap * N + (K.cps === 0 && K.idx > N * .75 ? K.idx - N : K.idx)) / (LAPS * N))) : null;
    const sb = await B.client(); const { data } = await sb.rpc("kart_room_state", { p_code: MP.code, p_tok: MP.token, p_prog: prog });
    const bots = (state === "race" || state === "done") && K && MP.host === MP.me ? RIV.filter(r => r.bot && !r.remote) : [];
    if (bots.length) { const d = {}; for (const r of bots) d[r.name] = r.done ? { p: 1, f: Math.round(r.finishT) } : { p: +Math.max(0, Math.min(1, OPEN ? r.idx / N : (r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx)) / (LAPS * N))).toFixed(3) };
      sb.rpc("kart_room_bots", { p_code: MP.code, p_tok: MP.token, p_data: d }).then(() => {}); }   // (.then: the request is only sent once something listens)
    if (!data) return;
    if (data.r === "gone") { mpLeave(true); $k("#kErr").textContent = "You left that room."; return; }
    Object.assign(MP, { host: data.host, players: data.players || [], status: data.status, track: data.track, pub: !!data.public });
    if (data.chat) chatAdd(data.chat);
    MP.slot = Math.max(0, MP.players.findIndex(p => p.name === MP.me));
    if (data.status === "racing" && data.ends_in != null && data.race_no === MP.raceNo) MP.endAt = performance.now() + data.ends_in * 1000;
    if (first) MP.raceNo = data.status === "racing" ? data.race_no : data.race_no;   // don't jump into a race that's already running
    const meP = MP.players.find(p => p.name === MP.me), spec = !!(meP && meP.spec);
    if (data.status === "racing" && spec && !MP.watching && state === "menu") mpWatch(data);   // 👀 joined mid-race: watch it
    if (MP.watching && data.status !== "racing") stopWatch();
    if (data.status === "racing" && !spec && data.race_no > MP.raceNo && data.starts_in != null && data.starts_in > -4) {
      MP.raceNo = data.race_no; MP.goAt = performance.now() + data.starts_in * 1000; MP.results = null; MP.endAt = 0; MP.firstName = null;
      if (mode !== "mp") { mode = "mp"; drawMode(); }
      start();
    }
    if (data.status === "lobby" && data.results && MP.finished && !MP.results) { MP.results = data.results; mpShowResults(data.results); loadBoard(); }
    if (!$k("#kMenu").hidden) drawRoom(); else if (MP.results) { mpRedrawNext(); if (MP.host === MP.me && MP.ch) MP.ch.send({ type: "broadcast", event: "tr", payload: { t: track, cc } }); }
  } finally { MP.polling = false; }
}
async function mpStart() {
  const sb = await B.client(); const { data } = await sb.rpc("kart_room_start", { p_code: MP.code, p_tok: MP.token, p_track: cc === 150 ? track : `${track}@${cc}`, p_bots: botsWant });
  if (!data || data.r !== "ok") { if (state === "done") { flash("Couldn't start, try again", 1200); const b = $k("[data-a=mpgo]"); if (b) b.disabled = false; } $k("#kErr").textContent = { few: "You need at least 2 players to start (or turn on 🤖 computer racers).", host: "Only the host can start.", running: "Already racing!", track: "That track isn't open for rooms yet. Pick a Henesys track.",
    notready: `Waiting for ${(data && data.who || []).join(", ")} to press Ready ✋` }[data && data.r] || "Couldn't start, try again.";
    if (data && data.r === "notready" && state === "done") flash("⏳ Not everyone is ready", 1200);
    return; }
  MP.ch && MP.ch.send({ type: "broadcast", event: "go", payload: {} });
  mpPoll();
}
async function mpLeave(silent) {
  const sb = await B.client();
  if (MP.code && !silent) { sb.rpc("kart_room_leave", { p_code: MP.code, p_tok: MP.token }).then(() => {}); try { store.del("kart_room_tok:" + MP.code); } catch (e) {} }
  clearInterval(MP.poll); if (MP.ch) sb.removeChannel(MP.ch);
  Object.assign(MP, { code: null, token: null, ch: null, players: [], host: null, status: null, chat: [] });
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
    ${MP.pub ? `<p class="kt-modenote">Anyone can join from the Open rooms list on the Family Kart page.</p>` : ""}
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
  raceId++; state = "menu"; $k("#kart").classList.remove("watching"); B.musicRate(1); leaveLandscape(); $k("#kRotate").hidden = true; $k("#kart").classList.remove("rot"); rotWas = null; cancelAnimationFrame(raf); raf = 0; stopEngine(); B.music(null);
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
$k("#kGo").onclick = () => { if (mode === "mp") { askFull(); mpStart(); } else start(); };
// the room's track as everyone should see it: the host's own pick, or what the host last told the room
const roomTrack = () => { const st = String(MP.track || "").split("@")[0]; return MP.host === MP.me ? track : TRACKS[MP.pick] ? MP.pick : TRACKS[st] ? st : "henesys"; };
const roomCC = () => { const sc = String(MP.track || "").split("@")[1]; return MP.host === MP.me ? cc : MP.pick ? (MP.pickCC || 150) : CCS[sc] ? +sc : 150; };
function drawTrack(light) {
  if (!CUPS[cup].tracks.includes(track)) track = CUPS[cup].tracks[0];
  const inRoom = mode === "mp" && !!MP.code, rk = inRoom ? roomTrack() : track, C = CUPS[inRoom ? cupOf(rk) : cup];
  const t = TRACKS[mode === "gp" ? C.tracks[0] : rk], pickHidden = mode === "mp" && !!MP.code && MP.host !== MP.me;
  $k("#kCupPick").innerHTML = Object.entries(CUPS).map(([k, c]) => `<button type="button" data-c="${k}" class="${k === cup ? "on" : ""}"><span>${c.icon}</span>${c.name.replace(" Cup", "")}</button>`).join("");
  $k("#kCupPick").hidden = pickHidden;
  $k("#kTrackPick").innerHTML = CUPS[cup].tracks.map(k => `<button type="button" data-t="${k}" class="${k === track ? "on" : ""}">${TRACKS[k].icon} ${TRACKS[k].name}</button>`).join("");
  $k("#kTrackPick").hidden = mode === "gp" || pickHidden;
  $k("#kCC").hidden = pickHidden || mode === "tt";   // Time Trial is always 150cc
  const rule = C.rule ? `<small class="kt-rule">${C.rule}</small>` : "";
  $k("#kPickHead").hidden = !(mode === "mp" && (!inRoom || MP.host === MP.me));
  $k("#kPickHead").textContent = inRoom ? "👑 Pick the cup and track for this race" : "Pick the cup and track for your room";
  $k("#kTrackCard").innerHTML = mode === "gp" ? `<b>🏆 ${C.name}</b><small>${C.tracks.map(c => TRACKS[c].icon + " " + TRACKS[c].name).join(" → ")}</small>${rule}`
    : `<b>${t.icon} ${t.name}</b><small>${t.open ? "one long climb" : "3 laps"} · ${inRoom ? CCS[roomCC()].label + " · " : ""}${t.sub}</small>${rule}${mode === "mp" && !inRoom ? `<small>Make a room and you're the host 👑: this is the first race.</small>` : ""}`;
  $k(".kt-track img").src = (t.art || HEN_ART).sky;
  if (mode === "gp") $k("#kGo").textContent = `🏆 Start the ${C.name}!`;
  $k("#kBoardName").textContent = t.name;
  if (inRoom && MP.host === MP.me && MP.ch) MP.ch.send({ type: "broadcast", event: "tr", payload: { t: track, cc } });   // tell the room what the host picked
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
  const a = e.target.closest("[data-a]"); if (!a) return;
  if (a.dataset.a === "again") { if (mode === "gp") gp = null; start(); }
  if (a.dataset.a === "next") { gp.race++; start(); }
  if (a.dataset.a === "podium") podium();
  if (a.dataset.a === "back") { gp = null; quit(); }
  if (a.dataset.a === "room") quit();
  if (a.dataset.a === "mpgo") { a.disabled = true; askFull(); mpStart(); }
  const rb = e.target.closest("[data-ready]"); if (rb) mpReady(rb.dataset.ready === "1");
  const bb = e.target.closest("[data-bots]"); if (bb) setBots(+bb.dataset.bots);
  if (a.dataset.a === "mpleave") { mpLeave(); quit(); }
});
$k("#kResult").addEventListener("click", e => {   // the host's cup / track pick on the results screen
  const c = e.target.closest("[data-c]"), t = e.target.closest("[data-t]"), v = e.target.closest("[data-cc]"); if (!c && !t && !v) return;
  if (c) { cup = c.dataset.c; track = CUPS[cup].tracks[0]; } else if (t) track = t.dataset.t; else { cc = +v.dataset.cc; store.set("kart_cc", cc); drawCC(); }
  store.set("kart_cup", cup); store.set("kart_track", track);
  if (MP.ch && MP.host === MP.me) MP.ch.send({ type: "broadcast", event: "tr", payload: { t: track, cc } });
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
// 🏎️ the engine: a modelled V8 (like a Dodge Charger) instead of a buzzing oscillator. Each loop is real combustion pulses:
// 8 cylinders firing with the cross-plane V8's uneven rhythm (that's the muscle-car burble), every pulse ringing through
// exhaust-pipe resonances, then a little saturation. Two loops (low and high rpm) blend as the revs climb; on top a quiet
// turbo whistle (Supra style) rises with speed. Made once in the browser, nothing downloaded.
const ENGBUF = {};
function engineLoop(ac, fire) {
  const key = fire + ":" + ac.sampleRate; if (ENGBUF[key]) return ENGBUF[key];
  const sr = ac.sampleRate, n = 32, len = Math.round(n / fire * sr), d = new Float32Array(len), per = sr / fire;
  const amp = [1, .62, .9, .55, .97, .7, .84, .6], jit = [0, .07, -.04, .09, -.02, .06, -.07, .03];   // uneven V8 firing
  const RES = [[fire * 1.0, .034, 1], [fire * 2.02, .02, .8], [235, .016, .7], [610, .008, .38], [1450, .0035, .1]];   // pipe + body resonances [Hz, decay s, level]
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < n; k++) {
    const t0 = (k + jit[k % 8] * .5) * per, A = amp[k % 8] * (.92 + rnd() * .16), ph = RES.map(() => rnd() * 6.28), plen = Math.round(.09 * sr);
    for (let i = 0; i < plen; i++) {
      const t = i / sr; let v = 0;
      for (let r = 0; r < RES.length; r++) { const [f, dc, lv] = RES[r]; v += lv * Math.exp(-t / dc) * Math.sin(6.2832 * f * t + ph[r]); }
      v += (rnd() * 2 - 1) * .2 * Math.exp(-t / .004);   // the bang itself
      d[(Math.round(t0) + i) % len] += A * v;
    }
  }
  let peak = 0; for (let i = 0; i < len; i++) { d[i] = Math.tanh(d[i] * .9); peak = Math.max(peak, Math.abs(d[i])); }
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  const buf = ac.createBuffer(1, len, sr); buf.getChannelData(0).set(d); return (ENGBUF[key] = buf);
}
// the real engine: two loops cut from a recording of a Maserati GranTurismo S V8 (lmartins, Freesound, CC BY 4.0):
// idle (~55 Hz rumble) and high revs (~130 Hz). They're re-pitched with your revs and blended; the modelled V8 above is only the fallback.
const REAL = { idle: null, high: null, base: { idle: 55, high: 130 }, loading: false };
async function loadRealEngine() {
  const ac = window.getAC && window.getAC(); if (!ac || REAL.loading || REAL.idle) return; REAL.loading = true;
  try {
    const get = async u => { const r = await fetch(u); const b = await r.arrayBuffer(); return await new Promise((ok, no) => ac.decodeAudioData(b, ok, no)); };
    [REAL.idle, REAL.high] = await Promise.all([get("media/kart/sound/eng_idle.wav?v=2"), get("media/kart/sound/eng_high.wav?v=2")]);
    if (eng && !eng.real) stopEngine();   // swap the fallback for the real one
  } catch (e) { REAL.idle = REAL.high = null; } finally { REAL.loading = false; }
}
function engine() {
  const ac = window.getAC && window.getAC(); if (!ac || state === "menu") return;
  if (!REAL.idle && !REAL.loading) loadRealEngine();
  if (!eng) {
    const real = !!(REAL.idle && REAL.high);
    const mk = (buf, fire) => { const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf || engineLoop(ac, fire); src.loop = true; g.gain.value = 0; src.connect(g); src.start(); return { src, g }; };
    const lo = mk(real && REAL.idle, 40), hi = mk(real && REAL.high, 120), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = "lowpass"; f.frequency.value = 1800; f.Q.value = .7; g.gain.value = 0;
    lo.g.connect(f); hi.g.connect(f); f.connect(g).connect(ac.destination);
    const tb = ac.createOscillator(), tg = ac.createGain(); tb.type = "sine"; tg.gain.value = 0; tb.connect(tg).connect(ac.destination); tb.start();   // turbo
    const n = ac.createBufferSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();   // wind
    n.buffer = noise(ac); n.loop = true; nf.type = "bandpass"; nf.frequency.value = 900; nf.Q.value = .6; ng.gain.value = 0;
    n.connect(nf).connect(ng).connect(ac.destination); n.start();
    eng = { lo, hi, f, g, tb, tg, n, ng, nf, lastV: 0, real, bl: real ? REAL.base.idle : 40, bh: real ? REAL.base.high : 120 };
  }
  const v = Math.abs(K.v); let f = v / VMAX; f = f > 1 ? 1 + (1 - 1 / f) : f;
  // revs: climb through each gear, drop at 1/3 and 2/3 of top speed like gear changes, and keep rising in a boost
  const gear = .6 + .35 * (.9 * f + 3 * ((Math.min(f, 1) % (1 / 3)))), t = ac.currentTime;
  const fire = eng.real ? (55 + Math.max(0, gear - .6) * 400) * (f > 1 ? f : 1) : (40 + Math.max(0, gear - .6) * 560) * (f > 1 ? f : 1);
  const mix = eng.real ? Math.max(0, Math.min(1, (fire - 72) / 52)) : Math.max(0, Math.min(1, (fire - 85) / 70));   // low loop -> high loop
  eng.lo.src.playbackRate.setTargetAtTime(Math.min(3, fire / eng.bl), t, .05); eng.hi.src.playbackRate.setTargetAtTime(Math.max(.6, fire / eng.bh), t, .05);
  eng.lo.g.gain.setTargetAtTime(1 - mix, t, .08); eng.hi.g.gain.setTargetAtTime(mix, t, .08);
  const on = state !== "done", thr = state === "race" && K.v > 0 ? 1 : .55;   // on the gas it's louder and brighter
  eng.g.gain.setTargetAtTime(on ? (eng.real ? .21 + Math.min(.14, v / 2000) : .16 + Math.min(.12, v / 2600)) * thr : 0, t, .1);
  eng.f.frequency.setTargetAtTime(eng.real ? 2200 + fire * 14 * thr : 520 + fire * 9 * thr, t, .1);
  eng.tb.frequency.setTargetAtTime(1800 + v * 11, t, .2); eng.tg.gain.setTargetAtTime(state === "race" ? Math.min(.012, (v / VMAX) ** 2 * .01) : 0, t, .2);
  if (state === "race" && eng.lastV > 200 && (v < eng.lastV - 60 || K.spin > 0) && t - (eng.bov || 0) > 1.2) { eng.bov = t; noiseHit(2400, .35, .06, 1.2, 900); }   // blow-off valve "pssh" when you lose speed fast
  eng.lastV = eng.lastV * .9 + v * .1;
  eng.ng.gain.setTargetAtTime(state === "race" ? Math.min(.05, (v / VMAX) ** 2 * .035) : 0, t, .15);
  eng.nf.frequency.setTargetAtTime(700 + v * 2.5, t, .2);
  if (K.drift && state === "race" && t - screechAt > .17) { screechAt = t; noiseHit(2600, .12, .035, 8); }   // tyre screech
  if (K.off && v > 60 && K.z <= 0 && state === "race" && t - crunchAt > .1) { crunchAt = t; noiseHit(300, .08, .05, 1.5); }   // grass crunch
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
function stopEngine() { if (eng) { try { eng.lo.src.stop(); eng.hi.src.stop(); eng.tb.stop(); eng.n.stop(); } catch (e) {} eng = null; } }
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
