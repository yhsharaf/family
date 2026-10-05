// Family Kart: a time-trial racer drawn the way the SNES Mario Kart did it ("Mode 7"): a flat track picture is tilted into
// a 3D-looking floor one screen row at a time, and the karts, monsters and trees are flat pictures (billboards) on top.
// Step 1 of the plan: one track (Henesys), your character in a kart, drifting with mini-boosts, 3 laps and best times.
(() => {
const $k = s => document.querySelector(s);
const B = window.BD; if (!B || !$k("#kart")) return;
const { esc, store, spriteOf, guildOf } = B;

// ------------------------------------------------------------------ tracks
// Three Henesys tracks (the Henesys Cup). Each one has its own loop, theme, hazards and props; loadTrack() switches between them.
const WORLD = 2048, ROAD = 124, CURB = 12, LAPS = 3;
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
// the current track (loadTrack fills these in)
let T = null, TRACK_KEY = null, TRACK_ID = "henesys2", PTS = [], N = 1, FORK_A = -1e9, FORK_B = -1e9, ALT = [], AN = 0, ALT_ROAD = 92, ALT_STYLE = "cobble",
  ALTPADS = [], PEN = null, PADS = [], COINS = [], PIGS = [], KING = null, PENPIGS = [], BOXES = [], TUNNEL = null, LAKE = null;
const tangent = i => { const a = PTS[(i + N - 2) % N], b = PTS[(i + 2) % N]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
function nearest(x, y, guess) {   // nearest track point, searching around the last one (or everywhere)
  let best = -1, bd = 1e12;
  const scan = (from, to) => { for (let k = from; k <= to; k++) { const i = (k + N) % N, dx = PTS[i][0] - x, dy = PTS[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } };
  if (guess == null) scan(0, N - 1); else scan(guess - 40, guess + 40);
  return { i: best, d: Math.sqrt(bd) };
}
const I = (x, y) => nearest(x, y).i;                              // the track point nearest a spot on the map
// Mario Kart style extras placed along the track (i = track point, o = sideways offset from the middle, + is the right side)
const lat = (x, y, i) => { const a = tangent(i); return (x - PTS[i][0]) * -Math.sin(a) + (y - PTS[i][1]) * Math.cos(a); };
const at = (i, o) => { i = ((Math.round(i) % N) + N) % N; const a = tangent(i); return [PTS[i][0] - Math.sin(a) * o, PTS[i][1] + Math.cos(a) * o]; };
// a fork (Henesys market path, the forest bridge): ALT is the second road between main points FORK_A and FORK_B
const altTan = j => { const a = ALT[Math.max(0, j - 2)], b = ALT[Math.min(AN - 1, j + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
const altIdx = j => Math.round(FORK_A + (FORK_B - FORK_A) * j / (AN - 1));   // where you are on the second road, as a main-road point (laps, positions)
const altAt = (j, o) => { j = Math.max(0, Math.min(AN - 1, Math.round(j))); const a = altTan(j); return [ALT[j][0] - Math.sin(a) * o, ALT[j][1] + Math.cos(a) * o]; };
function nearAlt(x, y) { let best = 0, bd = 1e12; for (let j = 0; j < AN; j++) { const dx = ALT[j][0] - x, dy = ALT[j][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } } return { j: best, d: Math.sqrt(bd) }; }
// which road you're on: the main loop, or the second road when you're on it (or nearer to it)
function nav(x, y, guess) {
  const m = nearest(x, y, guess);
  if (!AN || m.i < FORK_A - 30 || m.i > FORK_B + 30) return { i: m.i, d: m.d, alt: false, half: ROAD / 2 };
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
function padAt(idx, l) {
  for (const p of PADS) { const di = (idx - p.i + N) % N; if (di <= p.len && Math.abs(l - p.o) < p.w / 2) return p; }
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

const TRACKS = {
  // 1. Henesys Loop: the pig farm jump, the market path, the King Slime
  henesys: {
    id: "henesys2", name: "Henesys Loop", sub: "pig farm · market path", icon: "🍄",
    ctrl: [[400, 1450], [400, 900], [520, 520], [620, 240], [900, 130], [1300, 130], [1580, 200], [1440, 400], [1260, 560], [1110, 880],
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
          { t: "slime", i: R(325), len: 8, o: -38, w: 36 }, { t: "slime", i: R(455), len: 8, o: 38, w: 36 }, { t: "slime", i: R(795), len: 8, o: -38, w: 36 },
          { t: "slime", i: R(958), len: 8, o: 38, w: 36 }],
        coins,
        pigs: [{ i: R(262), ph: 0, k: "pig" }, { i: R(470), ph: 2, k: "pig" }, { i: R(845), ph: 4.2, k: "pig" }],
        king: { i: R(905), T: 3, k: "king_slime", s: .5, name: "King Slime" },
        boxes: [...boxRow(R(118), [-42, -14, 14, 42]), ...boxRow(R(425), [-40, -13, 13, 40]), ...boxRow(R(772), [-42, -14, 14, 42])],
        extra(push, PROPS) {
          for (let i = pen.a; i <= pen.b; i += 4) for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 8)); push(x, y, "posts", .32, 6); }
          for (const [x, y, k] of [[1090, 40, "haypile"], [1180, 228, "haypile"], [985, 225, "hay"], [1120, 222, "redshrooms"]]) push(x, y, k);
        },
      };
    },
  },
  // 2. Henesys Town Run: twisty S-bends between the mushroom houses, a market street, a tunnel through a tree house, snails crossing
  town: {
    id: "town", name: "Henesys Town Run", sub: "market street · tree house tunnel · back alley", icon: "🏘️",
    ctrl: [[300, 1700], [300, 1100], [450, 800], [700, 700], [850, 900], [1050, 1000], [1200, 800], [1150, 550], [950, 400], [1000, 200], [1350, 180],
      [1650, 300], [1800, 550], [1650, 800], [1500, 1000], [1700, 1250], [1850, 1500], [1720, 1810], [1150, 1865], [600, 1860], [380, 1810]],
    theme: { grass: ["#74c552", "#68b847"], flowers: 3200, road: "cobble" },
    near: ["shroomhouse", "shroomtower", "stall", "stall2", "hay", "haypile", "sunflower", "posts", "redshrooms", "bush"],
    far: ["shroomhouse", "shroomtower", "tree", "shroomhouse", "bush"], mobs: ["snail", "blue_snail", "red_snail", "orange_mushroom"],
    build() {
      const t0 = I(1060, 196), t1 = I(1290, 184), m0 = I(1640, 1820), m1 = I(760, 1862);
      return {
        tunnel: { a: t0, b: t1 },
        // the back alley: a narrow short cut through the S-bends, behind the mushroom houses
        fork: { a: I(855, 905), b: I(1195, 805), via: [[960, 880], [1090, 858]], width: 58, style: "cobble", pads: [], coins: true },
        pads: [
          { t: "boost", i: I(300, 1420), len: 14, o: 0, w: 60 }, { t: "boost", i: I(1400, 182), len: 12, o: -24, w: 54 }, { t: "boost", i: I(1560, 1080), len: 12, o: 22, w: 52 },
          { t: "boost", i: I(1300, 1858), len: 12, o: 0, w: 56 },
          { t: "ramp", i: I(1790, 1380), len: 9, o: 0, w: ROAD },
          { t: "slime", i: I(1100, 1862), len: 8, o: 38, w: 36 }, { t: "slime", i: I(700, 712), len: 8, o: -38, w: 36 }, { t: "slime", i: I(1730, 520), len: 8, o: 38, w: 36 }],
        coins: [...coinRow(I(300, 1350), I(300, 1150), 6, 0), ...coinRow(m0, m1, 8, j => (j & 1 ? 22 : -22)), ...coinRow(I(1000, 220), I(1050, 200), 3, 0), ...coinRow(I(1680, 790), I(1540, 960), 6, -18)],
        pigs: [{ i: I(450, 820), ph: 0, k: "snail", sp: .5 }, { i: I(1640, 820), ph: 2.2, k: "blue_snail", sp: .5 }],
        boxes: [...boxRow(I(300, 1560), [-42, -14, 14, 42]), ...boxRow(I(965, 300), [-40, -13, 13, 40]), ...boxRow(I(1790, 1680), [-42, -14, 14, 42])],
        extra(push) {
          for (let i = m0; i <= m1; i += 6) for (const side of [-1, 1]) {   // the market street: stalls and hay on both sides
            const [x, y] = at(i, side * (ROAD / 2 + CURB + 26)); push(x, y, ["stall", "stall2", "haypile", "hay"][(i / 6 + (side > 0 ? 1 : 0)) & 3]);
          }
          const [ex, ey] = at(t0 - 2, 0); push(ex, ey, "treehouse", .62, 0);   // the tree house you drive through
          for (let i = t0; i <= t1; i += 5) for (const side of [-1, 1]) { const [x, y] = at(i, side * (ROAD / 2 + CURB + 14)); push(x, y, i % 2 ? "tree" : "bush", .42, 14); }
        },
      };
    },
  },
  // 3. Mushroom Forest: fast and wild; a narrow wooden bridge over a lake (fall in and you splash), hopping mushrooms, Mushmom, a big downhill jump
  forest: {
    id: "forest", name: "Mushroom Forest", sub: "bridge shortcut · S-bends · Mushmom · big jump", icon: "🌲",
    ctrl: [[350, 1500], [350, 900], [480, 480], [850, 260], [1400, 260], [1760, 500], [1800, 950], [1580, 1250], [1200, 1150], [990, 1255], [1105, 1405],
      [965, 1550], [1085, 1690], [1420, 1720], [1750, 1820], [1450, 1930], [800, 1900], [480, 1800]],
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
          { t: "slime", i: I(600, 340), len: 8, o: -38, w: 36 }, { t: "slime", i: I(1050, 1335), len: 8, o: 38, w: 36 }],
        coins: [...coinRow(I(350, 1150), I(350, 950), 6, 0), ...coinRow(I(1000, 255), I(1200, 258), 6, j => (j & 1 ? 24 : -24)), ...coinRow(I(1150, 1700), I(1350, 1715), 6, 0),
          ...[0, 1, 2, 3, 4].map(n => { const [x, y] = at(I(860, 1903) + 12 + n * 5, 0); return { x, y, z: 60, got: false }; })],
        pigs: [{ i: I(420, 700), ph: 0, k: "orange_mushroom", hop: true }, { i: I(1785, 700), ph: 1.5, k: "green_mushroom", hop: true },
          { i: I(1300, 1712), ph: 3, k: "orange_mushroom", hop: true }],
        king: { i: I(1120, 262), T: 3.2, k: "mushmom", s: .9, name: "Mushmom" },
        boxes: [...boxRow(I(350, 1080), [-42, -14, 14, 42]), ...boxRow(I(1660, 400), [-40, -13, 13, 40]), ...boxRow(I(1150, 1695), [-42, -14, 14, 42])],
        extra() {},
      };
    },
  },
};
const CUP = ["henesys", "town", "forest"];   // the Henesys Cup, in order
function loadTrack(key) {
  if (TRACK_KEY === key) return;
  T = TRACKS[key]; TRACK_KEY = key; TRACK_ID = T.id; PTS = loopPts(T.ctrl); N = PTS.length; TRACK_LEN = 0;
  const f = T.build();
  if (f.fork) {
    FORK_A = f.fork.a; FORK_B = f.fork.b; ALT_ROAD = f.fork.width; ALT_STYLE = f.fork.style;
    ALT = pathPts([PTS[(FORK_A - 10 + N) % N], PTS[FORK_A], ...f.fork.via, PTS[FORK_B], PTS[(FORK_B + 10) % N]]); AN = ALT.length; ALTPADS = f.fork.pads || [];
  } else { FORK_A = FORK_B = -1e9; ALT = []; AN = 0; ALTPADS = []; }
  PEN = f.pen || null; LAKE = f.lake || null; TUNNEL = f.tunnel || null;
  PADS = f.pads; COINS = f.coins; PIGS = f.pigs || []; KING = f.king || null; BOXES = f.boxes || [];
  if (f.fork && f.fork.coins) for (let q = .15; q <= .85; q += .07) { const [x, y] = altAt(q * (AN - 1), 0); COINS.push({ x, y, z: 0, got: false }); }
  PENPIGS = PEN ? [0, 1, 2, 3, 4, 5].map(n => ({ f: .12 + n * .15, o: (n % 3 - 1) * 34, ph: n * 1.7, k: n % 2 ? "ribbon_pig" : "pig", dx: 0, dy: 0 })) : [];
  T.extraFn = f.extra;
  paintTrack(); placeObjects();
}

// the track picture: grass in stripes, flowers, red/white curbs, a dirt road and a chequered start line
const tex = document.createElement("canvas"); tex.width = tex.height = WORLD;
let TEX = null, mini = null;
function paintTrack() {
  const g = tex.getContext("2d");
  const th = T.theme, dirt = th.road === "dirt";
  g.fillStyle = th.grass[0]; g.fillRect(0, 0, WORLD, WORLD);
  g.fillStyle = th.grass[1];                                                   // mowed stripes
  for (let k = -WORLD; k < WORLD * 2; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 32, 0); g.lineTo(k + 32 - WORLD, WORLD); g.lineTo(k - WORLD, WORLD); g.fill(); }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const flowers = ["#ffe066", "#ffffff", "#ff8fb8", "#ffb347"];
  for (let k = 0; k < th.flowers; k++) { const x = rnd() * WORLD, y = rnd() * WORLD; g.fillStyle = "#3f8a34"; g.fillRect(x + 1, y + 4, 3, 3); g.fillStyle = flowers[k % 4]; g.fillRect(x, y, 5, 5); }
  const pathOf = (pts, closed) => () => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (closed) g.closePath(); };
  const path = pathOf(PTS, true), apath = pathOf(ALT, false);
  g.lineJoin = g.lineCap = "round";
  const curbs = (p, wd) => {
    p(); g.strokeStyle = "#2f6e2a"; g.lineWidth = wd + CURB * 2 + 8; g.stroke();                 // dark edge where grass meets the curb
    p(); g.strokeStyle = "#ffffff"; g.lineWidth = wd + CURB * 2; g.stroke();                       // chequered red/white curb
    p(); g.strokeStyle = "#e0453a"; g.setLineDash([16, 16]); g.stroke(); g.setLineDash([]);
  };
  const edge = (p, wd) => { p(); g.strokeStyle = "#6e6558"; g.lineWidth = wd + 4; g.stroke(); };
  const surface = (p, wd, st) => { p(); g.strokeStyle = st === "planks" ? "#8a5a2e" : st === "dirt" ? "#b98b5a" : "#bdb3a2"; g.lineWidth = wd; g.stroke(); };
  if (LAKE) {   // the forest lake (the wooden bridge crosses it)
    g.fillStyle = "#2f6e2a"; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx + 10, LAKE.ry + 10, 0, 0, 7); g.fill();
    g.fillStyle = "#3d8de0"; g.beginPath(); g.ellipse(LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry, 0, 0, 7); g.fill();
    g.fillStyle = "#5aa8f0"; for (let k = 0; k < 40; k++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * .85; g.fillRect(LAKE.cx + Math.cos(a) * LAKE.rx * r, LAKE.cy + Math.sin(a) * LAKE.ry * r, 14, 3); }
  }
  const cobbles = (n, pt, tan, wd, st) => { for (let i = 0; i < n; i++) {   // rows of flat cobbles across the road (or dirt specks, or planks)
    if (st === "planks") { if (i % 2) continue; const a = tan(i), ca = Math.cos(a), sa = Math.sin(a), x = pt(i)[0], y = pt(i)[1];
      g.strokeStyle = i % 4 ? "#a36c38" : "#6b4423"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + sa * wd / 2, y - ca * wd / 2); g.lineTo(x - sa * wd / 2, y + ca * wd / 2); g.stroke(); continue; }
    if (st === "dirt") { for (let k = 0; k < 3; k++) { const a = tan(i), o = (rnd() - .5) * wd * .9, x = pt(i)[0] - Math.sin(a) * o, y = pt(i)[1] + Math.cos(a) * o;
      g.fillStyle = rnd() < .5 ? "#a87a4a" : "#c99d68"; g.fillRect(x - 3, y - 2, 6, 4); } continue; }
    const a = tan(i), ca = Math.cos(a), sa = Math.sin(a), shift = (i & 1) * 5;
    for (let o = -wd / 2 + 4 + shift; o < wd / 2 - 4; o += 10) {
      const x = pt(i)[0] - sa * o, y = pt(i)[1] + ca * o, t = rnd();
      g.fillStyle = t < .33 ? "#c9c0b0" : t < .66 ? "#b2a896" : "#a89e8c"; g.fillRect(x - 3.5, y - 3.5, 7, 7);
      if (t > .85) { g.fillStyle = "#d8d0c2"; g.fillRect(x - 3, y - 3, 3, 2); }
    }
  } };
  curbs(path, ROAD); curbs(apath, ALT_ROAD);
  edge(path, ROAD); edge(apath, ALT_ROAD); surface(path, ROAD, dirt ? "dirt" : "cobble"); surface(apath, ALT_ROAD, ALT_STYLE === "planks" ? "planks" : dirt ? "dirt" : "cobble");   // the market path's road paints over the main curbs where they meet
  cobbles(N, i => PTS[i], tangent, ROAD, dirt ? "dirt" : "cobble"); cobbles(AN, j => ALT[j], altTan, ALT_ROAD, ALT_STYLE === "planks" ? "planks" : dirt ? "dirt" : "cobble");
  path(); g.strokeStyle = "rgba(255,255,255,.8)"; g.lineWidth = 3; g.setLineDash([20, 28]); g.stroke(); g.setLineDash([]);
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
  m.beginPath(); ALT.forEach(([x, y], i) => i ? m.lineTo(x * k, y * k) : m.moveTo(x * k, y * k));
  m.strokeStyle = "rgba(0,0,0,.4)"; m.lineWidth = 7; m.stroke(); m.strokeStyle = "#ffe28c"; m.lineWidth = 3.5; m.stroke();
}

// roadside things: real Henesys props (trees, mushroom houses, market stalls, hay, sunflowers) and a few monsters.
// s = world units per picture pixel, r = how solid it is
const PROPS = { treehouse: [.62, 0], tree: [.36, 16], bush: [.3, 12], redshrooms: [.42, 10], sunflower: [.45, 6], tallshroom: [.4, 9], stall: [.42, 18], stall2: [.42, 18],
  hay: [.42, 12], haypile: [.38, 16], shroomtower: [.48, 16], shroomhouse: [.5, 18], posts: [.42, 10] };
const MOBS = ["orange_mushroom", "green_mushroom", "blue_mushroom", "horny_mushroom", "snail", "blue_snail", "red_snail", "slime", "pig", "ribbon_pig", "king_slime", "mushmom"];
const IMG = {};
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
function mesoFrames(strip) {   // the real gold meso from MapleStory (Item.wz 09000001), 4 spinning frames side by side
  return [0, 1, 2, 3].map(i => { const c = document.createElement("canvas"); c.width = 26; c.height = 24; c.getContext("2d").drawImage(strip, -i * 26, 0); c.px = true; return c; });
}
let OBJS = [];
function placeObjects() {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  OBJS = [];
  const push = (x, y, k, sc, r) => OBJS.push({ x, y, k, s: sc != null ? sc : PROPS[k][0], r: r != null ? r : PROPS[k][1] });
  for (let s = 20; s < N; s += 26) {
    for (const side of [-1, 1]) {
      if (rnd() < .3) continue;
      const a = tangent(s), off = ROAD / 2 + CURB + 22 + rnd() * 80, x = PTS[s][0] - Math.sin(a) * off * side, y = PTS[s][1] + Math.cos(a) * off * side;
      if (roadDist(x, y) < ROAD / 2 + CURB + 16 || inLake(x, y) || x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) continue;
      if (rnd() < .18) { OBJS.push({ x, y, k: T.mobs[Math.floor(rnd() * T.mobs.length)], s: .42, r: 10, mob: true }); continue; }
      push(x, y, T.near[Math.floor(rnd() * T.near.length)]);
    }
  }
  T.extraFn(push);
  for (let k = 0; k < 170; k++) {   // woods and houses further out
    const x = 30 + rnd() * (WORLD - 60), y = 30 + rnd() * (WORLD - 60), d = roadDist(x, y);
    if (d < ROAD / 2 + 130 || inLake(x, y)) continue;
    const kk = T.far[Math.floor(rnd() * T.far.length)];
    push(x, y, kk, PROPS[kk][0] * 1.2);
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
// modes: a 3-race Grand Prix with points and a podium, a single race, or a Time Trial alone against your ghost (only Time Trial
// times go on the guild board, like Mario Kart's leaderboards, since races with rivals depend on luck)
const MODES = { gp: "🏆 Grand Prix", race: "🏁 Single race", tt: "⏱️ Time Trial" };
let mode = MODES[store.get("kart_mode")] ? store.get("kart_mode") : "gp";
let track = TRACKS[store.get("kart_track")] ? store.get("kart_track") : "henesys";   // picked track for Race and Time Trial
const GP_RACES = 3, GP_PTS = [10, 8, 6, 4, 3, 2, 1, 0];
let gp = null;   // { race, names, pts: { name: points } }
let ghost = null, ghostRec = [];   // your best Time Trial run, sampled 10 times a second: [t, x, y, a, z]
const ghostKey = () => `kart_ghost:${TRACK_ID}:${me}`;
// difficulty, picked before the race: rival speed, how hard they catch up, how often they grab items
const DIFFS = { easy: { skill: .88, band: .07, pick: .4, label: "Easy" }, normal: { skill: 1.04, band: .15, pick: .6, label: "Normal" }, hard: { skill: 1.06, band: .18, pick: .8, label: "Hard" } };
let diff = DIFFS[store.get("kart_diff")] ? store.get("kart_diff") : "normal";
const DIFF = () => DIFFS[diff];
const RIVAL_COLORS = ["#6eaa64", "#4682be", "#8a6a4a", "#aa64b4", "#3ca0a0", "#e07a12", "#5a64a0"];   // red + gold is yours
const ITEM_ICON = { elixir: "media/duel/elixir.png", triple: "media/duel/elixir.png", slime: "media/mobs/slime.png", arrow: "media/duel/sk_arrowrain.png", arm: "media/duel/zarm_stand.gif",
  thunder: "media/kart/thunder.png?v=2", splat: "media/mobs/octopus.png", hyper: "media/kart/hyperbody.png" };
const ITEM_NAME = { elixir: "Elixir", triple: "3 Elixirs", slime: "Slime drop", arrow: "Arrow", arm: "Zakum's Arm", thunder: "Thunder", splat: "Splat", hyper: "Hyper Body" };
let RIV = [], DROPS = [], SHOTS = [], ARMS = [];
const progOf = r => (r.done ? 1e6 - r.finish : 0) + r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx);
const racers = () => [K, ...RIV];
function rankOf(r) { const p = progOf(r); return 1 + racers().filter(o => o !== r && progOf(o) > p).length; }
function gridSpot(slot) { const row = Math.floor(slot / 2), col = slot % 2, i = N - 6 - row * 9 - col * 3; return { i, o: col ? 24 : -24 }; }
function makeRivals(keep) {
  if (mode === "tt") { RIV = []; DROPS = []; SHOTS = []; ARMS = []; return; }
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
  DROPS = []; SHOTS = []; ARMS = []; BOXES.forEach(b => b.t = 0);
}
let bloopCD = 0, armCD = 0, thunderCD = 0, thunderFx = 0;   // Zakum's Arm: at most one every 20 seconds   // Dizzy/Splat: only one in the whole race every 14 seconds, so they stay special
// items depend on how far behind the leader you are (like Mario Kart 8), not just your place: right behind the leader you get
// defensive items, far back you get the catch-up ones. Zakum's Arm, Dizzy and Splat are locked for the first 30 seconds.
function rollItem(r, rival) {
  const lead = racers().reduce((a, b) => progOf(b) > progOf(a) ? b : a), gap = (progOf(lead) - progOf(r)) / N;   // in laps
  const early = K.t < 30000, b = bloopCD > 0 || early ? 0 : rival ? .25 : 1, arm = armCD > 0 || early || ARMS.length ? 0 : 1;
  const th = thunderCD > 0 || early ? 0 : rival ? .3 : 1;
  const t = (gap < .04 ? [["slime", 5], ["arrow", 3], ["elixir", 2]]
    : gap < .12 ? [["elixir", 3], ["arrow", 4], ["slime", 2], ["triple", 1], ["splat", .6 * b]]
    : gap < .25 ? [["triple", 3], ["arrow", 3], ["elixir", 2], ["splat", 1 * b], ["arm", .8 * arm], ["thunder", .5 * th], ["hyper", .8]]
    : [["triple", 4], ["arrow", 2], ["arm", 2 * arm], ["thunder", 1.2 * th], ["splat", 1.5 * b], ["hyper", 2]]).filter(x => x[1] > 0);
  let x = Math.random() * t.reduce((a, c) => a + c[1], 0);
  for (const [k, w] of t) { if ((x -= w) < 0) return k; }
  return "elixir";
}
const HOLDABLE = it => it === "slime" || it === "arrow";
function hit(r, msg) {
  if (r.hyper > 0) return;   // 💪 Hyper Body: nothing can hurt you
  if (r === K) { spinOut(msg); return; }
  if (r.spin <= 0 && r.inv <= 0 && r.z <= 0) { r.spin = .9; r.inv = 1.6; r.boost = 0; if (r.holding) { r.item = null; r.holding = false; } }
}
function useItem(r) {
  const it = r.item; if (!it) return;
  r.holding = false;
  if (it === "triple") { r.boost = Math.max(r.boost, 1.2); if (--r.itemN <= 0) r.item = null; }
  else r.item = null;
  if (it === "elixir") r.boost = Math.max(r.boost, 1.3);
  if (it === "hyper") { r.hyper = 7; r.spin = 0; r.small = 0; r.ink = 0; if (r === K) { flash("💪 HYPER BODY!", 1000); hyperSound(); } }
  if (it === "slime") DROPS.push({ x: r.x - Math.cos(r.a) * 24, y: r.y - Math.sin(r.a) * 24, t: 40, by: r, grace: .5 });
  if (it === "arrow") {
    const p = progOf(r), ahead = racers().filter(o => o !== r && progOf(o) > p && progOf(o) - p < N * .5).sort((a, b) => progOf(a) - progOf(b))[0];
    SHOTS.push({ x: r.x + Math.cos(r.a) * 16, y: r.y + Math.sin(r.a) * 16, a: r.a, v: Math.max(370, r.v + 130), tgt: ahead || null, by: r, life: 4 });
  }
  if (it === "splat") {   // like the Blooper: inks everyone ahead of whoever uses it
    bloopCD = 14;
    const p = progOf(r), from = r === K ? "" : ` from ${r.name}`;
    const hitList = racers().filter(o => o !== r && !o.done && progOf(o) > p && !(o.rescue > 0) && !(o.bloopSafe > 0) && !(o.ink > 0) && !(o.hyper > 0));
    for (const o of hitList) {
      o.ink = 4; o.bloopSafe = 12;   // 4s of ink + 8s safe afterwards
      if (o === K) { makeInk(); flash(`🐙 Splat${from}!`, 1000); splatSound(); }
    }
    if (r === K) flash(hitList.length ? `🐙 Inked ${hitList.length} racer${hitList.length > 1 ? "s" : ""} ahead!` : "Nobody ahead of you!", 1000);
  }
  if (it === "thunder") {   // ⚡ like Mario Kart's Lightning: strikes every other racer; they spin, shrink and drop what they hold. Nothing blocks it.
    thunderCD = 25; thunderFx = .35; thunderSound();
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
    if (leader) { ARMS.push({ tgt: leader, t: 2.6, by: r }); armCD = 20; }
  }
  if (r === K) itemSound();
}
// one computer racer: follows the road in its own lane, dodges slime puddles, keeps races close (rubber band), uses items
function rivalStep(r, dt, tt) {
  if (rescueStep(r, dt)) return;
  const near = nav(r.x, r.y, r.idx); r.idx = near.i; r.onAlt = near.alt; r.altJ = near.j; const off = near.d > near.half + CURB * .6, ground = under(near, r.x, r.y), L = ground.L;
  if (r.idx > FORK_A - 45 && r.idx < FORK_A - 5 && r.forkLap !== r.lap) { r.forkLap = r.lap; r.useAlt = Math.random() < .4; }   // pick a road at the fork
  if (r.z > 0 || r.vz > 0) { r.vz -= 720 * dt; r.z += r.vz * dt; if (r.z <= 0) { r.z = 0; r.vz = 0; if (Math.random() < .5) r.boost = Math.max(r.boost, .8); } }
  const air = r.z > 0;
  for (const key of ["spin", "inv", "squash", "boost", "itemT", "small", "ink", "bloopSafe", "noItem", "hyper"]) if (r[key] > 0) r[key] -= dt;
  const lost = near.d > near.half + 110 || (r.v < 20 && r.spin <= 0 && r.squash <= 0);
  r.lostT = lost ? (r.lostT || 0) + dt : 0; if (r.lostT > 2.5) { rescue(r); return; }
  if ((r.laneT -= dt) <= 0) { r.lane = (Math.random() - .5) * 76; r.laneT = 1.5 + Math.random() * 3; }
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
  const top = r.done ? 140 : r.hyper > 0 ? 320 : (!air && inPen(r.idx, L) ? 80 : off && !air ? 110 : r.skill * DIFF().skill * band * (r.small > 0 ? .72 : 1) * (r.ink > 0 ? .95 : 1)) + (r.boost > 0 ? 90 : 0);
  if (r.spin > 0) r.v *= Math.pow(.3, dt); else r.v += (r.v < top ? (r.v < 120 ? 190 : 110) : -220) * dt;
  r.x += Math.cos(r.a) * r.v * dt; r.y += Math.sin(r.a) * r.v * dt;
  const pad = air ? null : ground.pad;
  if (pad && pad !== r.lastPad) {
    if (pad.t === "boost") r.boost = Math.max(r.boost, 1);
    if (pad.t === "ramp" && r.v > 60) { r.vz = 160 + r.v * .22; r.z = .1; }
    if (pad.t === "bigramp" && r.v > 60) { r.vz = 300 + r.v * .3; r.z = .1; }
    if (pad.t === "hay") { r.vz = 230; r.z = .1; }
    if (pad.t === "slime") hit(r);
  }
  r.lastPad = pad;
  for (const p of PIGS) { const q = pigPos(p, tt); if (!air && q.z < 10 && Math.hypot(r.x - q.x, r.y - q.y) < 17) hit(r); }
  if (KING) {
    const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0);
    if (r.kingWas < .55 && kp >= .55 && Math.hypot(r.x - kx, r.y - ky) < 36 && !air) { hit(r); r.squash = 1.1; r.v = 0; }
    r.kingWas = kp;
  }
  if (LAKE && !air && near.d > near.half + 4 && inLake(r.x, r.y)) rescue(r);   // fell off the bridge
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
function lapTick(r) {   // 4 checkpoints in order, then the start line; true when a lap is done
  const prog = r.idx / N, cp = Math.floor(prog * 4);
  if (cp === (r.cps + 1) % 4 && r.cps < 3) r.cps = cp;
  let done = false;
  if (r.cps === 3 && r.prog > .9 && prog < .1) { r.lap++; r.cps = 0; done = true; if (r !== K && r.lap >= LAPS && !r.done) { r.done = true; r.finish = ++finishers; r.finishT = K.t; } }
  r.prog = prog; return done;
}
let finishers = 0;
// everything that moves besides you: rivals, item boxes, slime drops, arrows, Zakum's arm, karts bumping
function worldStep(dt, tt) {
  if (thunderFx > 0) thunderFx -= dt;
  if (bloopCD > 0) bloopCD -= dt; if (armCD > 0) armCD -= dt; if (thunderCD > 0) thunderCD -= dt;
  for (const r of RIV) rivalStep(r, dt, tt);
  const all = racers();
  for (const b of BOXES) {
    if (mode === "tt") break;
    if (b.t > 0) { b.t -= dt; continue; }
    for (const r of all) if (r.z < 22 && !r.done && Math.hypot(r.x - b.x, r.y - b.y) < 15) {
      b.t = 2.5;
      if (r === K) {
        if (!K.item && K.roll <= 0) { K.roll = 1.1; K.pending = rollItem(K); boxSound(); }
        else if (!K.item2 && !(K.roll2 > 0)) { K.roll2 = 1.1; K.pending2 = rollItem(K); boxSound(); }   // a second item waits in the small slot
      }
      else if (!r.item && !(r.noItem > 0) && Math.random() < DIFF().pick) { r.item = rollItem(r, true); r.itemN = r.item === "triple" ? 3 : 0; r.itemT = 1.5 + Math.random() * 3; r.holding = HOLDABLE(r.item); }
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
    for (const r of all) if (!gone && r !== sh.by && Math.hypot(r.x - sh.x, r.y - sh.y) < 16 && r.holding && HOLDABLE(r.item)
      && (sh.x - r.x) * Math.cos(r.a) + (sh.y - r.y) * Math.sin(r.a) < 0) {   // blocked by the item held behind
      r.item = null; r.holding = false; gone = true; blockSound();
      if (r === K) flash("🛡️ Blocked!", 800); else if (sh.by === K) flash(`🛡️ ${r.name} blocked it`, 900);
    }
    for (const r of all) if (!gone && r !== sh.by && Math.hypot(r.x - sh.x, r.y - sh.y) < 16) { hit(r, "🏹 Arrowed!"); gone = true; if (r !== K && sh.by === K) flash(`🏹 Got ${r.name}!`, 900); }
    if (gone) SHOTS.splice(i, 1);
  }
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
      const push = (15 - d) / 2, nx = dx / d, ny = dy / d; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
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
  get PIGS() { return PIGS; }, get KING() { return KING; }, get ALT() { return ALT; }, get AN() { return AN; }, get TRACK() { return TRACK_KEY; }, I, at, altAt, loadTrack }) : null;
function freshKart() {
  const g = gridSpot(4), i = (g.i + N) % N, a = tangent(i), [x, y] = at(i, g.o);
  return { x, y, a, item: null, itemN: 0, roll: 0, pending: null, v: 0, steer: 0, drift: 0, charge: 0, boost: 0, hop: 0, idx: i, lap: 0, cps: 0,
    t: 0, lapStart: 0, laps: [], wrong: 0, prog: 0, off: false, bump: 0, z: 0, vz: 0, trick: false, flip: 0, spin: 0, inv: 0, squash: 0,
    shake: 0, stall: 0, mesos: 0, held: null, lastPad: null, prevDrift: false, prevItem: false, kingWas: 0 };
}
const fmt = ms => ms == null ? "--" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
const bestKey = () => `kart_best:${TRACK_ID}:${me}`;

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
  k.spin = .9; k.inv = 1.9; k.drift = 0; k.charge = 0; k.boost = 0; spinSound();
  if (k.holding) { k.item = null; k.holding = false; }   // you drop what you were holding
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
function rescue(r, msg) {
  if (r.rescue > 0) return;
  r.rescue = 1.4; r.rescueAt = (r.idx - 4 + N) % N; r.rescueAlt = r.onAlt ? Math.max(1, (r.altJ || 0) - 5) : null; r.drift = 0; r.charge = 0; r.boost = 0; r.spin = 0;
  if (r === K) { flash(msg || "📜 Return Scroll!", 1200); msg ? splatSound() : scrollSound(); }
}
function rescueStep(r, dt) {   // true while being rescued (no driving)
  if (!(r.rescue > 0)) return false;
  const before = r.rescue; r.rescue -= dt; r.v = 0;
  if (before > .7 && r.rescue <= .7) {   // halfway: move to the road
    if (r.rescueAlt != null) { const [x, y] = altAt(r.rescueAlt, 0); r.x = x; r.y = y; r.a = altTan(r.rescueAlt); r.idx = altIdx(r.rescueAlt); }
    else { const [x, y] = at(r.rescueAt, 0); r.x = x; r.y = y; r.a = tangent(r.rescueAt); r.idx = r.rescueAt; }
    r.z = 0; r.vz = 0;
    r.lostT = 0; r.wrong = 0;
  }
  if (r.rescue <= 0) { r.rescue = 0; r.inv = 1; }
  return true;
}
function step(dt) {
  const k = K, inp = input(), racing = state === "race", tt = performance.now() / 1000;
  for (let i = COINFX.length - 1; i >= 0; i--) { const c = COINFX[i]; c.t -= dt; c.vy += 320 * dt; c.x += c.vx * dt; c.y += c.vy * dt; if (c.t <= 0) COINFX.splice(i, 1); }
  if (rescueStep(k, dt)) { if (racing) { k.t += dt * 1000; worldStep(dt, tt); } return; }
  const near = nav(k.x, k.y, k.idx); k.idx = near.i; k.off = near.d > near.half + CURB * .6; k.onAlt = near.alt; k.altJ = near.j;
  if (racing) {
    const lost = near.d > near.half + 150 || (k.v < 25 && !inp.brake && k.spin <= 0 && k.stall <= 0 && k.squash <= 0);
    k.lostT = lost ? (k.lostT || 0) + dt : Math.max(0, (k.lostT || 0) - dt);
    if (k.lostT > 2.6 || k.wrong > 3) { rescue(k); return; }
  }
  const ground = under(near, k.x, k.y), L = ground.L;
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
  const pad = air ? null : ground.pad;
  if (pad && pad !== k.lastPad) {
    if (pad.t === "boost") { k.boost = Math.max(k.boost, 1); padSound(); }
    if (pad.t === "ramp" && k.v > 60) { k.vz = 160 + k.v * .22; k.z = .1; k.drift = 0; jumpSound(); if (!k.tricked) { k.tricked = true; flash("Tap Drift in the air! ✨", 900); } }
    if (pad.t === "bigramp" && k.v > 60) { k.vz = 300 + k.v * .3; k.z = .1; k.drift = 0; jumpSound(); setTimeout(jumpSound, 120); flash(PEN ? (k.v > 200 ? "🐷 Fly over the pig farm!" : "Uh oh… 🐷") : "🚀 Big jump!", 900); }
    if (pad.t === "hay") { k.vz = 230; k.z = .1; k.mesos = Math.min(10, k.mesos + 2); flash("🌾 Boing! +2 mesos", 900); hopSound(); coinSound(); }
    if (pad.t === "slime") spinOut("🫧 Slimed!");
  }
  k.lastPad = pad;
  const rocky = pad && pad.t === "rock" && k.v > 60;
  const mud = !air && inPen(k.idx, L);   // landed in the pig pen
  if (mud && !k.wasMud) { flash("🐷 Mud bath!", 1100); oinkSound(); k.shake = .2; }
  k.wasMud = mud;
  if (rocky) { k.shake = Math.max(k.shake, .12); if (Math.random() < dt * 9) k.hop = .1; }
  if (!air && !k.off && Math.abs(L) > near.half - 2 && k.v > 100) k.shake = Math.max(k.shake, .04);   // rumble on the curbs
  // speed: always accelerating (phone friendly), the brake slows / reverses; mesos raise the top speed a little
  const hb = k.hyper > 0;
  const top = hb ? 330 + k.mesos * 3 : ((mud ? 80 : k.off && !air ? 105 : rocky && k.boost <= 0 ? 185 : 250 + k.mesos * 3) + (k.boost > 0 ? 90 : 0)) * (k.small > 0 ? .72 : 1);
  if (!racing || k.spin > 0 || k.stall > 0) k.v *= Math.pow(k.spin > 0 ? .3 : .2, dt);
  else if (inp.brake) k.v = Math.max(-60, k.v - 380 * dt);
  else k.v += (k.v < top ? (k.v < 120 ? 210 : 120) : -260) * dt;
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
    if (k.charge > 2.6) { k.boost = 1.5; boostSound(); flash("💜 Ultra boost!", 600); } else if (k.charge > 1.7) { k.boost = 1; boostSound(); } else if (k.charge > .8) { k.boost = .55; boostSound(); }
    k.drift = 0; k.charge = 0;
  }
  let turn = k.steer * 2.1 * Math.min(1, Math.abs(k.v) / 110) * (k.v < 0 ? -1 : 1) * (air ? .5 : 1);
  if (k.drift) { turn = (k.drift * 1.55 + k.steer * .9) * Math.min(1, k.v / 110); if (!k.off) { const before = k.charge; k.charge += dt * Math.max(.4, 1 + .7 * k.steer * k.drift);   // steering into the turn charges faster
    if ([.8, 1.7, 2.6].some(th => before < th && k.charge >= th)) tone(k.charge > 2.6 ? 1320 : k.charge > 1.7 ? 990 : 740, .1, "triangle", .06); } }
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
  for (const o of OBJS) if (o.r) solid(o.x, o.y, o.r);
  if (k.bump > 0) k.bump -= dt;
  // slipstream: right behind another kart for about a second gives a short boost to pass them
  let tuck = false;
  if (racing && !air && k.v > 150) for (const r of RIV) {
    const dx = r.x - k.x, dy = r.y - k.y, fwd = dx * Math.cos(k.a) + dy * Math.sin(k.a), side = -dx * Math.sin(k.a) + dy * Math.cos(k.a);
    if (fwd > 12 && fwd < 110 && Math.abs(side) < 20) { tuck = true; break; }
  }
  k.slip = tuck ? (k.slip || 0) + dt : Math.max(0, (k.slip || 0) - dt * 2);
  if (k.slip > .9) { k.slip = 0; k.boost = Math.max(k.boost, .8); flash("💨 Slipstream!", 600); padSound(); }
  // mesos, pigs and the King Slime
  for (const c of COINS) if (!c.got && Math.abs(k.z - (c.z || 0)) < 30 && Math.hypot(k.x - c.x, k.y - c.y) < 18) { c.got = true; k.mesos = Math.min(10, k.mesos + 1); k.v = Math.min(k.v + 22, 360); coinSound(); }
  for (const p of PIGS) { const q = pigPos(p, tt); if (!air && q.z < 10 && Math.hypot(k.x - q.x, k.y - q.y) < 17) spinOut(p.k.includes("pig") ? "🐷 Oink!" : p.k.includes("snail") ? "🐌 Snail!" : "🍄 Bonk!"); }
  if (LAKE && !air && k.off && inLake(k.x, k.y)) { rescue(k, "💦 Splash!"); return; }   // fell off the bridge into the lake
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
      if (kd < 36 && !air && k.inv <= 0) { k.squash = 1.1; k.inv = 0; spinOut("💥 SQUASHED!"); k.v = 0; }
    }
    k.kingWas = kp;
    if (kp >= .55) solid(kx, ky, 26);
  }
  if (!racing) return;
  worldStep(dt, tt);
  // laps: 4 checkpoints in order, then crossing the start line
  k.t += dt * 1000;
  if (mode === "tt" && (!ghostRec.length || k.t - ghostRec[ghostRec.length - 1][0] >= 100)) ghostRec.push([Math.round(k.t), Math.round(k.x), Math.round(k.y), +k.a.toFixed(2), Math.round(k.z)]);
  if (lapTick(k)) {
    k.laps.push(k.t - k.lapStart); k.lapStart = k.t; lapSound();
    COINS.forEach(c => c.got = false);   // mesos come back every lap (the 10 max stays)
    if (k.lap >= LAPS) finish();
    else if (k.lap === LAPS - 1) { flash("🏁 FINAL LAP!", 1600); finalSound(); B.musicRate(1.15); }   // fanfare, and the music speeds up
    else flash(`Lap ${k.lap + 1}`, 1300);
  }
  // wrong way: moving against the track direction for a moment
  const along = Math.cos(k.a - tangent(k.idx)) * k.v;
  k.wrong = along < -20 ? k.wrong + dt : Math.max(0, k.wrong - dt * 2);
}

// ------------------------------------------------------------------ drawing
function render() {
  const k = K, ca = Math.cos(k.a), sa = Math.sin(k.a);
  // boosts widen the view a little (the camera "pulls back"), which makes the speed feel bigger
  k.fov = (k.fov || 0) + (((k.boost > 0 || k.hyper > 0) ? 1 : 0) - (k.fov || 0)) * .12;
  const FO = FOCAL * (1 - .14 * k.fov);
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
  // floor, one row at a time (the camera rises a little when you jump, so big jumps feel like flying)
  const CH = CAMH + Math.min(k.z, 130) * .35;
  for (let y = 0; y < H - HOR; y++) {
    const z = CH * FO / (y + 1), half = z * (W / 2) / FO;
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
  for (const r of RIV) addDraw(r.x, r.y, (sx, gy, sc, fz) => drawRival(r, sx, gy, sc, fz));
  if (mode !== "tt") for (const b of BOXES) if (b.t <= 0) addDraw(b.x, b.y, (sx, gy, sc) => drawBox(sx, gy, sc, tt));
  if (mode === "tt" && ghost && state !== "menu") {   // 👻 your best run, see-through
    const gs = ghostAt(K.t); if (gs) addDraw(gs.x, gs.y, (sx, gy, sc, fz) => drawRival({ name: "👻 Your best", img: IMG.me, color: "#c8232c", steer: 0, z: gs.z, spin: 0, squash: 0, inv: 0, ghost: true }, sx, gy, sc, fz));
  }
  for (const d of DROPS) add(d.x, d.y, IMG.slime, .32, 0, false, .5);
  for (const sh of SHOTS) addDraw(sh.x, sh.y, (sx, gy, sc) => { const im = IMG.arrowIcon; if (!im) return; const w = 26 * sc; ctx.save(); ctx.translate(sx, gy - 12 * sc);
    ctx.fillStyle = "rgba(255,240,120,.5)"; ctx.beginPath(); ctx.arc(0, 0, w * .6, 0, 7); ctx.fill(); ctx.drawImage(im, -w / 2, -w / 2, w, w); ctx.restore(); });
  for (const a of ARMS) addDraw(a.tgt.x, a.tgt.y, (sx, gy, sc) => { const im = IMG.arm; if (!im) return; const h = 70 * sc, w = h * im.width / im.height, drop = Math.max(0, a.t - .3) / 2.3;
    ctx.drawImage(im, sx - w / 2, gy - h - drop * 160 * sc, w, h); });
  for (const ob of OBJS) add(ob.x, ob.y, IMG[ob.k], ob.s, 0);
  for (const p of PENPIGS) { const q = penPigPos(p, tt); add(q.x, q.y, IMG[p.k], .45, 0, q.dir > 0); }
  if (IMG.meso) for (const c of COINS) if (!c.got) add(c.x, c.y, IMG.meso[Math.floor(tt * 8 + c.x * .05) % 4], .55, (c.z || 0) + 6 + Math.sin(tt * 4 + c.x) * 2);
  for (const p of PIGS) { const q = pigPos(p, tt); add(q.x, q.y, IMG[p.k], .45, q.z, q.dir > 0, q.z > 2 ? .5 : 0); }
  if (KING) { const kp = kingPhase(tt), [kx, ky] = at(KING.i, 0), kz = kingZ(kp); add(kx, ky, IMG[KING.k], KING.s, kz, false, kz > 0 ? 1 - kz / 170 : 0); }
  vis.sort((a, b) => b.fz - a.fz);
  let kartDrawn = false;
  for (const v of vis) {
    if (!kartDrawn && v.fz < CAMD) { ctx.globalAlpha = 1; drawKart(k); kartDrawn = true; }   // things between the camera and you go in front of your kart
    if (v.draw) { ctx.globalAlpha = 1; v.draw(v.sx, HOR + CH * FO / v.fz, FO / v.fz, v.fz); continue; }
    const { im, fz, sx, z, flip, shadow } = v, sc = FO / fz * v.sc, w = im.width * sc, h = im.height * sc, gy = HOR + CH * FO / fz;
    if (w < .6) continue;
    ctx.globalAlpha = fz > 1000 ? Math.max(0, (1400 - fz) / 400) : 1; ctx.imageSmoothingEnabled = !v.px;
    if (shadow) { ctx.fillStyle = `rgba(0,0,0,${.15 + shadow * .3})`; ctx.beginPath(); ctx.ellipse(sx, gy, w * .45 * (.4 + shadow * .6), h * .08 + 1, 0, 0, 7); ctx.fill(); }
    const top = gy - h - z * FO / fz;
    if (flip) { ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(im, -w / 2, top, w, h); ctx.restore(); }
    else ctx.drawImage(im, sx - w / 2, top, w, h);
  }
  ctx.globalAlpha = 1;
  if (!kartDrawn) drawKart(k);
  // inside the tree house tunnel: dark, with a warm glow ahead
  if (TUNNEL && k.idx >= TUNNEL.a && k.idx <= TUNNEL.b) {
    const g2 = ctx.createRadialGradient(W / 2, HOR + 10, 10, W / 2, HOR + 10, W * .7);
    g2.addColorStop(0, "rgba(255,200,120,.08)"); g2.addColorStop(1, "rgba(18,10,4,.72)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  }
  // speed lines from the edges while boosting
  if (k.fov > .15 && state === "race") {
    const t2 = performance.now() / 1000; ctx.strokeStyle = `rgba(255,255,255,${.5 * k.fov})`; ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) { const ang = i / 14 * Math.PI * 2 + i * 1.7, ph = (t2 * 3 + i * .37) % 1, r0 = W * (.32 + ph * .3), r1 = r0 + W * .08;
      const cxs = W / 2, cys = HOR + (H - HOR) * .35; ctx.beginPath(); ctx.moveTo(cxs + Math.cos(ang) * r0, cys + Math.sin(ang) * r0 * .6); ctx.lineTo(cxs + Math.cos(ang) * r1, cys + Math.sin(ang) * r1 * .6); ctx.stroke(); }
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
  // minimap
  if (mini) {
    ctx.imageSmoothingEnabled = true;
    const side = TOUCH && !upright(), mx = side ? 4 : W - 54, my = Math.round(H * (side ? .34 : .3)), s = 50 / 128;   // phones: left side, clear of the buttons
    ctx.globalAlpha = .85; ctx.drawImage(mini, mx, my, 50, 50); ctx.globalAlpha = 1;
    for (const sh of SHOTS) { ctx.fillStyle = sh.tgt === k ? "#ff2a2a" : "#ffe08a"; ctx.beginPath(); ctx.arc(mx + sh.x * 128 / WORLD * s, my + sh.y * 128 / WORLD * s, 2, 0, 7); ctx.fill(); }
    for (const r of RIV) { ctx.fillStyle = r.color; ctx.fillRect(mx + r.x * 128 / WORLD * s - 1.5, my + r.y * 128 / WORLD * s - 1.5, 3, 3); }
    ctx.fillStyle = "#fff"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 3, my + k.y * 128 / WORLD * s - 3, 6, 6);
    ctx.fillStyle = "#c8232c"; ctx.fillRect(mx + k.x * 128 / WORLD * s - 2, my + k.y * 128 / WORLD * s - 2, 4, 4);
  }
}
function drawKart(k) {
  const CH = CAMH + Math.min(k.z, 130) * .35, gy = HOR + CH * FOCAL / CAMD, gy0 = HOR + CAMH * FOCAL / CAMD, sc = FOCAL / CAMD, x = W / 2 + k.steer * 4;
  const hop = k.hop > 0 ? Math.sin((k.hop / .18) * Math.PI) * 6 : 0, rumble = k.off && k.v > 40 ? (Math.random() - .5) * 2 : 0;
  const y = gy0 - hop + rumble - Math.min(k.z * sc * .45, H * .2), tilt = (k.drift ? k.drift * .16 : 0) + k.steer * .06 + (k.flip > 0 ? (1 - k.flip / .4) * Math.PI * 2 : 0);
  const w = 20 * sc, t = performance.now() / 1000;
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(x, gy + 2, w * .55 / (1 + k.z / 80), 4, 0, 0, 7); ctx.fill();
  cv.style.transform = fxc.style.transform = k.shake > 0 ? `translate(${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px, ${(Math.random() - .5) * 6 * Math.min(1, k.shake * 6)}px)` : "";
  if (k.slip > .2) {   // wind lines while you're in someone's slipstream
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(.8, k.slip)})`; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) { const lx = W * (.2 + .6 * ((i * 37 + t * 900) % 100) / 100), ly = H * .3 + ((i * 53 + t * 400) % (H * .5)); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + (lx - W / 2) * .08, ly + 14); ctx.stroke(); }
  }
  // drift sparks and dust
  if (k.drift && k.charge > .2) {
    const col = k.charge > 2.6 ? ["#c86bff", "#f0c8ff"] : k.charge > 1.7 ? ["#ff9a2e", "#ffd34d"] : k.charge > .8 ? ["#5ab4ff", "#c8ecff"] : ["#ffffff", "#dddddd"];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = col[i & 1]; const sx = x + (i < 3 ? -1 : 1) * w * .42 + (Math.random() - .5) * 10, sy = y - Math.random() * 8;
      ctx.fillRect(sx, sy, 2, 2); }
  }
  if (k.off && k.v > 60) for (let i = 0; i < 4; i++) { ctx.fillStyle = "rgba(120,90,50,.6)"; ctx.fillRect(x + (Math.random() - .5) * w, y - Math.random() * 6, 3, 3); }
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
  if (k.boost > 0) for (const sx of [-bw * .16, bw * .16]) { ctx.fillStyle = Math.random() < .5 ? "#ffb02e" : "#ff5a2e"; ctx.beginPath();
    ctx.moveTo(sx - 3, -bh * .2); ctx.lineTo(sx + 3, -bh * .2); ctx.lineTo(sx, -bh * .2 + 6 + Math.random() * 6); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha = 1;
}
// a rival's kart: same shape as yours in their colour, their character picture sharp when close, their name above
function ghostAt(t) {
  if (!ghost || !ghost.length) return null;
  let lo = 0, hi = ghost.length - 1; if (t >= ghost[hi][0]) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ghost[m][0] <= t) lo = m; else hi = m; }
  const a = ghost[lo], b = ghost[hi], f = (t - a[0]) / Math.max(1, b[0] - a[0]);
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
  if (r.boost > 0) { ctx.fillStyle = Math.random() < .5 ? "#ffb02e" : "#ff5a2e"; ctx.fillRect(-w * .1, -bh * .2, w * .2, bh * .4 + Math.random() * bh * .4); }
  if (r.holding && r.item) { const hi = r.item === "arrow" ? IMG.arrowIcon : IMG.slime; if (hi) { const hs = 9 * sc; ctx.drawImage(hi, -hs / 2, -hs * .3, hs, hs * hi.height / hi.width); } }
  ctx.restore(); ctx.globalAlpha = 1;
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
function hud() {
  const k = K;
  $k("#kLap").textContent = state === "menu" ? "" : `LAP ${Math.min(k.lap + 1, LAPS)}/${LAPS}`;
  $k("#kTime").textContent = state === "menu" ? "" : fmt(k.t);
  $k("#kBest").textContent = mode === "tt" ? (best && best.race ? `Best ${fmt(best.race)}` : "") : mode === "gp" && gp ? `Cup race ${gp.race}/${GP_RACES}` : T ? T.name : "";
  $k("#kSpeed").textContent = state === "race" ? `${Math.max(0, Math.round(k.v * .5))} km/h` : "";
  $k("#kWrong").hidden = !(state === "race" && k.wrong > .6);
  const armIn = state === "race" && ARMS.some(a => a.tgt === k), shotIn = state === "race" && SHOTS.some(sh => sh.tgt === k);
  const warn = armIn ? "🖐️ ZAKUM'S ARM IS COMING FOR YOU!" : shotIn ? (k.holding ? "⚠️🏹 Arrow behind you · your item will block it" : "⚠️🏹 Arrow behind you! Hold a Slime or Arrow to block") : "";
  if ($k("#kWarn").textContent !== warn) { $k("#kWarn").textContent = warn; $k("#kWarn").className = "kt-warn" + (armIn ? " arm" : ""); }
  $k("#kWarn").hidden = !warn;
  if (warn && performance.now() - warnAt > (armIn ? 300 : 420)) { warnAt = performance.now(); tone(armIn ? 880 : 1180, .12, "square", .05, armIn ? 620 : 0); }
  const bag = state === "menu" ? "" : `${k.mesos}/10`; if ($k("#kBag").dataset.v !== bag) { $k("#kBag").dataset.v = bag; $k("#kBag").innerHTML = bag ? `<img src="media/kart/meso1.png" alt="">${bag}` : ""; }
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
  $k("#kPos").textContent = rk ? rk + (["", "st", "nd", "rd"][rk] || "th") : ""; $k("#kPos").className = "kt-pos p" + rk + (k.lap === LAPS - 1 && state === "race" ? " final" : "");
}
let flashT = null, warnAt = 0;
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
const waitLandscape = () => new Promise(res => { const my = raceId, chk = () => { if (!upright() || my !== raceId) { removeEventListener("resize", chk); res(); } }; addEventListener("resize", chk); chk(); });
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  const rot = upright(); $k("#kRotate").hidden = !rot; $k("#kFull").hidden = !wantFull();
  if (TEX && K && state !== "loading") { if (!rot) step(dt); render(); hud(); engine(); }
  raf = requestAnimationFrame(loop);
}
let raceId = 0;   // bumps on every start and quit, so timers and loading from an old race can't touch the next one
async function start() {
  const my = ++raceId, alive = () => my === raceId && state !== "menu";
  const n = $k("#kName").value.trim().slice(0, 20);
  if (n.length < 2) { $k("#kErr").textContent = "Type your character name first."; return; }
  $k("#kErr").textContent = "";
  const g = guildOf(n); me = g ? g.name : n; if (g) store.set("family_me", g.name);
  try { best = JSON.parse(store.get(bestKey())) || null; } catch (e) { best = null; }
  $k("#kMenu").hidden = true; $k("#kResult").hidden = true; $k("#kGame").hidden = false;
  $k("#kart").classList.add("racing"); document.body.classList.add("bd-playing");
  window.getAC && window.getAC(); fullTries = 0; goLandscape();
  state = "loading";
  if (mode === "gp" && (!gp || gp.over)) gp = { race: 1, names: null, pts: {} };
  const key = mode === "gp" ? CUP[gp.race - 1] : track;
  if (!assetsReady || TRACK_KEY !== key) { $k("#kLoad").hidden = false; await new Promise(r => setTimeout(r, 30)); if (!assetsReady) await prepare(); loadTrack(key); $k("#kLoad").hidden = true; }
  IMG.me = await loadImg(spriteOf(me)); if (!alive()) return; fit();
  
  try { ghost = mode === "tt" ? JSON.parse(store.get(ghostKey())) : null; } catch (e) { ghost = null; }
  ghostRec = [];
  K = freshKart(); finishers = 0; bloopCD = 0; armCD = 0; thunderCD = 0; thunderFx = 0; makeRivals(mode === "gp" ? gp.names : null); if (mode === "gp") gp.names = RIV.map(r => r.name);
  if (mode === "tt") { K.item = "triple"; K.itemN = 3; }
  B.musicRate(1);
  state = "wait"; B.music("henesys"); syncMusicBtn();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  await waitLandscape(); if (!alive() || state !== "wait") return; fit(); state = "count";
  countAt = performance.now(); COINS.forEach(c => c.got = false);
  for (const [t, d] of [["3", 0], ["2", 1000], ["1", 2000]]) setTimeout(() => { if (alive() && state === "count") { flash(t, 900); beep(440); } }, d);
  setTimeout(() => {
    if (!alive() || state !== "count") return; state = "race"; beep(880);
    const h = K.held;
    if (h != null && h >= 950) { K.boost = 1.2; K.v = 160; flash("🚀 ROCKET START!", 1000); boostSound(); }
    else if (h != null) { K.stall = .9; flash("💨 Too early!", 1000); bumpSound(); }
    else flash("GO!", 900);
    RIV.forEach(r => { if (Math.random() < .35) { r.boost = 1; r.v = 120; } });
  }, 3000);
}
let assetsReady = false;
async function prepare() {
  sky = await loadImg(B.M + "bg_henesys.webp?v=9");
  const mstrip = await loadImg("media/kart/meso.png?v=1"); IMG.meso = mstrip ? mesoFrames(mstrip) : null;
  [IMG.arrowIcon, IMG.arm] = await Promise.all([loadImg(B.M + "sk_arrowrain.png"), loadImg(B.M + "zarm_stand.gif")]);
  await Promise.all([...MOBS, "king_slime", "ribbon_pig"].map(async m => { IMG[m] = await loadImg(`media/mobs/${m}.png`); if (IMG[m]) IMG[m].px = true; })
    .concat(Object.keys(PROPS).map(async k => { IMG[k] = await loadImg(`media/kart/${k}.webp?v=1`); }))
    .concat([(async () => { IMG.strip = await loadImg("media/kart/henesys_strip.webp?v=1"); })()]));
  assetsReady = true;
}
const ordinal = n => n + (["", "st", "nd", "rd"][n] || "th");
let TRACK_LEN = 0;
function finish() {
  const k = K; state = "done"; B.musicRate(1);
  if (!TRACK_LEN) for (let i = 0; i < N; i++) TRACK_LEN += Math.hypot(PTS[(i + 1) % N][0] - PTS[i][0], PTS[(i + 1) % N][1] - PTS[i][1]);
  const total = k.laps.reduce((a, b) => a + b, 0), bl = Math.min(...k.laps);
  // everyone's time: rivals who finished have theirs, the rest are estimated from how far they still have to go
  const rows = [{ name: me, img: spriteOf(me), time: total, you: true }, ...RIV.map(r => {
    if (r.done) return { name: r.name, img: spriteOf(r.name), time: r.finishT };
    const left = Math.max(0, LAPS * N - (r.lap * N + (r.cps === 0 && r.idx > N * .75 ? r.idx - N : r.idx)));
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
        <p class="k-rank" id="kRank">${guildOf(me) ? "Saving your time…" : "Guests aren't on the guild board."}</p>
        <div class="row"><button class="sk-btn bd-play" data-a="again">Try again</button><button class="sk-btn sk-private" data-a="back">Back</button></div>`;
    } else {
      const head = mode === "gp" ? `<h3>${T.icon} ${T.name} · ${["", "🥇", "🥈", "🥉"][k.place] || "🏁"} ${ordinal(k.place)} place</h3>` : `<h3>${["", "🥇", "🥈", "🥉"][k.place] || "🏁"} ${ordinal(k.place)} place · ${fmt(total)}</h3>`;
      const table = `<table class="k-table">${rows.map((r, i) => `<tr class="${r.you ? "you" : ""}"><td>${ordinal(i + 1)}</td><td><img src="${r.img}" alt=""></td><td>${esc(r.name)}</td>
        <td>${r.est ? "~" : ""}${fmt(r.time)}</td>${mode === "gp" ? `<td class="pts">+${r.add}</td>` : ""}</tr>`).join("")}</table>`;
      const last = mode === "gp" && gp.race >= GP_RACES;
      html = `${head}<p class="k-diff">${DIFF().label}${mode === "gp" ? ` · Henesys Cup race ${gp.race}/${GP_RACES}` : ` · ${T.name}`}</p>${table}
        <div class="row">${mode === "gp" ? (last ? `<button class="sk-btn bd-play" data-a="podium">🏆 See the podium</button>` : `<button class="sk-btn bd-play" data-a="next">Next: ${TRACKS[CUP[gp.race]].icon} ${TRACKS[CUP[gp.race]].name} ▶</button>`)
          : `<button class="sk-btn bd-play" data-a="again">Race again</button>`}<button class="sk-btn sk-private" data-a="back">Back</button></div>`;
    }
    $k("#kResult").innerHTML = html; $k("#kResult").hidden = false; $k("#kResult").classList.toggle("wide", mode !== "tt");
    sent.then(r => { const el = $k("#kRank"); if (!el || !r) return;
      el.innerHTML = r.r === "ok" ? `🏆 You're <b>#${r.rank}</b> on the guild board` : r.r === "laps" ? "That time looks impossible, so it wasn't saved 🤔" : r.r === "dev" ? "(test race, not saved)" : "Couldn't save your time this time."; });
  }, 1400);
}
// the Grand Prix podium: top 3 on the steps, a trophy for you, confetti
function podium() {
  const order = Object.entries(gp.pts).sort((a, b) => b[1] - a[1]), myPlace = order.findIndex(([n]) => n === me) + 1;
  gp.over = true;
  const step = (i, h) => { const e = order[i]; if (!e) return ""; return `<div class="pd-step p${i + 1}"><img src="${spriteOf(e[0])}" alt=""><b>${esc(e[0])}</b><small>${e[1]} pts</small>
    <div class="pd-block" style="height:${h}px">${i + 1}</div></div>`; };
  const cup = myPlace === 1 ? "🏆 You won the Henesys Cup!" : myPlace <= 3 ? `${["", "", "🥈", "🥉"][myPlace]} ${ordinal(myPlace)} in the Henesys Cup!` : `You finished ${ordinal(myPlace)} in the Henesys Cup`;
  $k("#kResult").innerHTML = `<h3>${cup}</h3><div class="pd">${step(1, 56)}${step(0, 84)}${step(2, 40)}</div>
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
  raceId++; state = "menu"; B.musicRate(1); leaveLandscape(); $k("#kRotate").hidden = true; cancelAnimationFrame(raf); raf = 0; stopEngine(); B.music(null);
  $k("#kGame").hidden = true; $k("#kMenu").hidden = false; $k("#kResult").hidden = true;
  $k("#kart").classList.remove("racing"); document.body.classList.remove("bd-playing"); showBest();
}
async function submit(laps) {
  if (DEV) return { r: "dev" };   // local test races never touch the real board
  const sb = await B.client(); if (!sb) return null;
  const { data } = await sb.rpc("kart_submit", { p_track: TRACK_ID, p_name: me, p_laps: laps.map(Math.round) });
  loadBoard(); return data;
}
async function loadBoard() {
  const sb = await B.client(); if (!sb) return;
  const { data } = await sb.from("kart_times").select("player,race_ms,lap_ms").eq("track", TRACKS[mode === "gp" ? "henesys" : track].id).order("race_ms").limit(10);
  $k("#kBoard").innerHTML = (data || []).length ? data.map((r, i) => `<li><img src="${spriteOf(r.player)}" alt=""><b>${esc(r.player)}</b>
    <span>${fmt(r.race_ms)}</span><small>lap ${fmt(r.lap_ms)}</small></li>`).join("") : `<p class="bd-none">No times yet. Be the first!</p>`;
}
if (location.hash === "#kart") loadBoard();
addEventListener("hashchange", () => { if (location.hash === "#kart") loadBoard(); });
function showBest() {
  const n = ($k("#kName").value || "").trim(), g = n && guildOf(n), key = `kart_best:${TRACKS[mode === "gp" ? "henesys" : track].id}:${g ? g.name : n}`;
  let b = null; try { b = JSON.parse(store.get(key)); } catch (e) {}
  $k("#kMine").innerHTML = b && b.race ? `🏆 Your best: race <b>${fmt(b.race)}</b> · lap <b>${fmt(b.lap)}</b>` : "No time yet on this track. Go set one!";
}
$k("#kGo").onclick = start;
function drawTrack() {
  const t = TRACKS[mode === "gp" ? "henesys" : track];
  $k("#kTrackPick").hidden = mode === "gp";
  document.querySelectorAll("#kTrackPick [data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === track));
  $k("#kTrackCard").innerHTML = mode === "gp" ? `<b>🏆 Henesys Cup</b><small>${CUP.map(c => TRACKS[c].icon + " " + TRACKS[c].name).join(" → ")}</small>`
    : `<b>${t.icon} ${t.name}</b><small>3 laps · ${t.sub}</small>`;
  $k("#kBoardName").textContent = t.name;
  showBest(); loadBoard();
}
$k("#kTrackPick").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (!b) return; track = b.dataset.t; store.set("kart_track", track); drawTrack(); });
function drawMode() {
  document.querySelectorAll("#kMode [data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
  $k("#kDiff").hidden = mode === "tt"; $k("#kGo").textContent = { gp: "🏆 Start the Henesys Cup!", race: "🏁 Start race!", tt: "⏱️ Start Time Trial!" }[mode];
  $k("#kModeNote").textContent = { gp: "3 races against the same 7 rivals: 10-8-6-4-3-2-1-0 points, then the podium.", race: "One race against 7 guild members.",
    tt: "Alone with 3 Elixirs against your ghost. Only Time Trial times go on the guild board." }[mode];
}
$k("#kMode").addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m; store.set("kart_mode", mode); gp = null; drawMode(); drawTrack(); });
drawMode(); drawTrack();
function drawDiff() { document.querySelectorAll("#kDiff [data-d]").forEach(b => b.classList.toggle("on", b.dataset.d === diff)); }
$k("#kDiff").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (!b) return; diff = b.dataset.d; store.set("kart_diff", diff); drawDiff(); });
drawDiff();
$k("#kName").addEventListener("keydown", e => { if (e.key === "Enter") start(); });
$k("#kName").addEventListener("input", showBest);
$k("#kName").value = store.get("family_me") || "";
showBest();
$k("#kLeave").onclick = quit;
$k("#kResult").addEventListener("click", e => {
  const a = e.target.closest("[data-a]"); if (!a) return;
  if (a.dataset.a === "again") { if (mode === "gp") gp = null; start(); }
  if (a.dataset.a === "next") { gp.race++; start(); }
  if (a.dataset.a === "podium") podium();
  if (a.dataset.a === "back") { gp = null; quit(); }
});
const syncMusicBtn = () => { $k("#kMusic").textContent = B.musicOn && B.musicOn() ? "🔊" : "🔇"; };
$k("#kMusic").onclick = () => { B.toggleMusic(); syncMusicBtn(); };
syncMusicBtn();
addEventListener("hashchange", () => { if (location.hash !== "#kart" && state !== "menu") quit(); });

// keyboard + touch buttons
const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Shift", "a", "d", "s", "w", "e"];
addEventListener("keydown", e => { if (state === "menu" || $k("#kGame").hidden || !GAME_KEYS.includes(e.key)) return; keys[e.key] = true; e.preventDefault(); });
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
document.addEventListener("visibilitychange", () => { if (document.hidden) stopEngine(); });
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
const thunderSound = () => { tone(1800, .08, "sawtooth", .08, 200); setTimeout(() => tone(70, .7, "square", .1, 30), 60); };
const splatSound = () => { tone(180, .25, "square", .09, 50); tone(90, .35, "sawtooth", .06, 40); };
const blockSound = () => { tone(1500, .08, "square", .06); tone(900, .15, "triangle", .06); };
const oinkSound = () => { tone(260, .12, "sawtooth", .07, 180); setTimeout(() => tone(240, .16, "sawtooth", .07, 160), 140); };
const finalSound = () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, i === 5 ? .4 : .13, "square", .08), i * 110)); };
const hyperSound = () => { for (let i = 0; i < 8; i++) setTimeout(() => tone(400 + i * 90, .1, "square", .06), i * 60); };
const lapSound = () => { tone(660, .12, "square", .07); setTimeout(() => tone(990, .2, "square", .07), 110); };
})();
