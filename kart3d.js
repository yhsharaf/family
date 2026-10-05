// Family Kart in real 3D (three.js): the same painted track, now laid over rolling hills, with a chase camera, real 3D karts
// (your character sitting in them), spinning 3D item boxes and the MapleStory scenery standing in the world.
// kart.js still runs the whole game (driving, items, bots, multiplayer); this file only draws it.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const seedOf = k => [...String(k)].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7) >>> 0;
const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

export function create(A) {
  const { WORLD } = A;
  A.CURB = 14;
  const renderer = new THREE.WebGLRenderer({ canvas: A.canvas, antialias: !A.touch, powerPreference: "high-performance", alpha: false });
  renderer.setPixelRatio(Math.min(A.touch ? 1.5 : 2, devicePixelRatio || 1));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 7000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 2.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.5); sun.position.set(-.45, 1, .3); scene.add(sun);
  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 18);

  // ---------------------------------------------------------------- ground: heights, terrain mesh, sky
  const G = 8, GN = WORLD / G + 1;
  let HG = new Float32Array(GN * GN), terrain = null, plain = null, skyMesh = null, key = null, skyRefs = [];
  const h = (x, y) => {
    const fx = Math.max(0, Math.min(GN - 1.001, x / G)), fy = Math.max(0, Math.min(GN - 1.001, y / G)), i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j, o = j * GN + i;
    return (HG[o] * (1 - ax) + HG[o + 1] * ax) * (1 - ay) + (HG[o + GN] * (1 - ax) + HG[o + GN + 1] * ax) * ay;
  };
  // the road's height along the track: two or three long waves (flat at the start line), never steeper than about 13%
  function profile(t) {
    const N = t.N, E = new Float32Array(N), s0 = seedOf(t.key), p1 = hash(1, 2, s0) * 6.28, p2 = hash(3, 4, s0) * 6.28, hills = t.theme.hills ?? 1;
    for (let i = 0; i < N; i++) {
      const s = i / N;
      if (t.OPEN) { E[i] = s * 260 + Math.sin(s * 6.28 * 3 + p1) * 30 * smooth(0, .08, s) * smooth(1, .9, s); continue; }
      const cd = Math.min(s, 1 - s);
      E[i] = (Math.sin(6.28 * 2 * s + p1) * 70 + Math.sin(6.28 * 3 * s + p2) * 32) * smooth(.015, .07, cd);
    }
    if (t.PTS[0].length > 2) { for (let i = 0; i < N; i++) E[i] = t.PTS[i][2] * (t.theme.hills ?? 1); return E; }   // a track with its own planned hills
    let mx = 0; for (let i = 1; i < N; i++) mx = Math.max(mx, Math.abs(E[i] - E[i - 1]) / t.SPC);
    const k = Math.min(1, .13 / (mx || 1)) * hills; for (let i = 0; i < N; i++) E[i] *= k;
    return E;
  }
  function buildGround(t) {
    const E = profile(t), wsum = new Float64Array(GN * GN), hsum = new Float64Array(GN * GN), dmin = new Float32Array(GN * GN).fill(1e9);
    const R = 300, rc = Math.ceil(R / G);
    const splat = (px, py, e) => {
      const ci = Math.round(px / G), cj = Math.round(py / G);
      for (let j = Math.max(0, cj - rc); j <= Math.min(GN - 1, cj + rc); j++) for (let i = Math.max(0, ci - rc); i <= Math.min(GN - 1, ci + rc); i++) {
        const dx = i * G - px, dy = j * G - py, d2 = dx * dx + dy * dy; if (d2 > R * R) continue;
        const o = j * GN + i; if (d2 < dmin[o]) dmin[o] = d2;
        const q = d2 + 64, w = 1 / (q * q * q * q); wsum[o] += w; hsum[o] += w * e;
      }
    };
    for (let i = 0; i < t.N; i++) splat(t.PTS[i][0], t.PTS[i][1], E[i]);
    if (t.AN > 1 && t.FORK_A >= 0) { const ea = E[Math.max(0, Math.min(t.N - 1, t.FORK_A))], eb = E[Math.max(0, Math.min(t.N - 1, t.FORK_B))];
      for (let j = 0; j < t.AN; j++) splat(t.ALT[j][0], t.ALT[j][1], ea + (eb - ea) * j / (t.AN - 1)); }
    let mean = 0; for (const e of E) mean += e; mean /= E.length;
    const s0 = seedOf(t.key) % 1000, edge = t.ROAD / 2 + t.CURB, hillAmp = 85 * (t.theme.hills ?? 1);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const o = j * GN + i, x = i * G, y = j * G, d = Math.sqrt(dmin[o]);
      const road = wsum[o] > 0 ? hsum[o] / wsum[o] : mean, base = road + (mean - road) * smooth(200, 300, d);
      const n = vnoise(x / 520, y / 520, s0) * .8 + vnoise(x / 230, y / 230, s0 + 1) * .2;   // broad, gentle hills
      const be = Math.min(x, y, WORLD - x, WORLD - y), hgt = base + Math.max(-20, (n - .32) * hillAmp) * smooth(edge + 90, edge + 520, d);
      HG[o] = hgt + (mean - hgt) * smooth(160, 0, be) * smooth(edge + 40, edge + 200, d);   // levels out to the open plain at the map's edge
    }
    const DIP = new Float32Array(GN * GN); for (let o = 0; o < GN * GN; o++) DIP[o] = 5 * smooth(edge + 24, edge + 4, Math.sqrt(dmin[o]));   // the ground sinks a little under the road, so it never pokes through
    // the terrain mesh, painted with the track picture, and a fine grain so it looks like a surface up close
    const pos = new Float32Array(GN * GN * 3), uv = new Float32Array(GN * GN * 2), idx = new Uint32Array((GN - 1) * (GN - 1) * 6);
    for (let j = 0, p = 0; j < GN; j++) for (let i = 0; i < GN; i++, p++) { pos.set([i * G, HG[p] - DIP[p], j * G], p * 3); uv.set([i / (GN - 1), 1 - j / (GN - 1)], p * 2); }
    for (let j = 0, q = 0; j < GN - 1; j++) for (let i = 0; i < GN - 1; i++) { const a = j * GN + i; idx.set([a, a + GN, a + 1, a + 1, a + GN, a + GN + 1], q); q += 6; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const map = new THREE.CanvasTexture(t.tex); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = aniso; map.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshLambertMaterial({ map });
    mat.onBeforeCompile = sh => { sh.uniforms.detail = { value: DETAIL };
      sh.fragmentShader = "uniform sampler2D detail;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        "#include <map_fragment>\n diffuseColor.rgb *= (.9 + .2 * texture2D(detail, vMapUv * 97.0).r) * (.94 + .12 * texture2D(detail, vMapUv * 19.0).g);"); };
    // the open plain all round the map, out to the horizon
    if (plain) { scene.remove(plain); plain.children.forEach(m => m.geometry.dispose()); }
    plain = new THREE.Group(); const pm = new THREE.MeshLambertMaterial({ color: new THREE.Color(t.theme.grass ? t.theme.grass[0] : "#5cae46") }), F = 7000;
    for (const [cx, cz, w, d] of [[WORLD / 2, -F / 2, WORLD + 2 * F, F], [WORLD / 2, WORLD + F / 2, WORLD + 2 * F, F], [-F / 2, WORLD / 2, F, WORLD], [WORLD + F / 2, WORLD / 2, F, WORLD]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pm); m.rotation.x = -Math.PI / 2; m.position.set(cx, mean - .3, cz); plain.add(m); }
    scene.add(plain);
    if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.map.dispose(); terrain.material.dispose(); }
    terrain = new THREE.Mesh(geo, mat); scene.add(terrain);
    buildRoad(t);
    scene.fog = new THREE.Fog(new THREE.Color(...(t.haze || [214, 236, 255]).map(c => c / 255)), 900, 2600);
    renderer.setClearColor(scene.fog.color);
  }
  // ---------------------------------------------------------------- the road: its own sharp surface (in the track's style) with raised curbs;
  // the pads, ramps, black ice and start line come from a see-through overlay painted by kart.js
  let roadObjs = [];
  function surfaceTex(style, th, U) {
    const R = 2048, c = canvas(R, R), g = c.getContext("2d"); g.scale(R / U, R / 192);
    let sd = 11; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(r() * a.length)];
    const rr = (x, y, w, hh, q) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, hh, q) : g.rect(x, y, w, hh); };
    const specks = (base, cols, n, sz) => { g.fillStyle = base; g.fillRect(0, 0, U, 192); for (let k = 0; k < n; k++) { g.fillStyle = pick(cols); g.fillRect(r() * U, r() * 192, sz * (.5 + r()), sz * (.4 + r() * .6)); } };
    const stones = (grout, pal, hi, lo, rowH = 12) => {
      g.fillStyle = grout; g.fillRect(0, 0, U, 192);
      for (let y = 0, row = 0; y < 192; y += rowH, row++) for (let x = -(row & 1) * 7; x < U; ) { const w = 10 + r() * 7;
        g.fillStyle = pick(pal); rr(x + .9, y + .9, w - 1.8, rowH - 1.8, 3); g.fill();
        g.fillStyle = hi; rr(x + 1.6, y + 1.4, w - 4, 1.6, 1); g.fill(); g.fillStyle = lo; rr(x + 2, y + rowH - 3, w - 4, 1.4, 1); g.fill(); x += w; }
    };
    if (style === "cobble") stones("#857b6a", ["#cfc6b6", "#bdb3a2", "#b0a691", "#c6bca9"], "rgba(255,255,255,.35)", "rgba(60,50,40,.25)");
    else if (style === "ruin") stones("#5e4c32", ["#b9a070", "#a68e62", "#937c54"], "rgba(255,240,200,.3)", "rgba(40,30,15,.3)", 16);
    else if (style === "moss") { stones("#26271f", ["#4e4e42", "#585a4c", "#44463a"], "rgba(200,220,160,.18)", "rgba(0,0,0,.3)");
      for (let k = 0; k < 160; k++) { g.fillStyle = r() < .5 ? "rgba(95,122,58,.7)" : "rgba(120,150,70,.5)"; g.beginPath(); g.ellipse(r() * U, r() * 192, 1 + r() * 3, 1 + r() * 2, 0, 0, 7); g.fill(); } }
    else if (style === "basalt") { stones("#1c1719", ["#3a3236", "#463c40", "#2f282b"], "rgba(255,160,120,.12)", "rgba(0,0,0,.4)", 14);
      g.lineWidth = .8; for (let k = 0; k < 14; k++) { let x = r() * U, y = r() * 192; g.strokeStyle = r() < .5 ? "#ff7a2a" : "#d84a1a"; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (r() - .5) * 14; y += (r() - .5) * 14; g.lineTo(x, y); } g.stroke(); } }
    else if (style === "dirt") { specks("#b98b5a", ["#a87a4a", "#c99d68", "#9c6e40", "#d2a878"], 2600, 1.6); g.fillStyle = "rgba(90,60,30,.18)"; for (const x of [.3, .7]) g.fillRect(U * x - 6, 0, 12, 192); }
    else if (style === "snow") { specks("#e3ebf6", ["#c9d6ea", "#f8fbff", "#d6e2f2"], 2400, 1.6); g.fillStyle = "rgba(150,170,205,.35)"; for (const x of [.28, .72]) g.fillRect(U * x - 5, 0, 10, 192); }
    else if (style === "toy") { const cols = ["#ffe39a", "#ffc8de", "#c4e8ff", "#cdf0bd"]; g.fillStyle = "#f4f0ff"; g.fillRect(0, 0, U, 192);
      for (let y = 0, j = 0; y < 192; y += 24, j++) for (let x = 0, i = 0; x < U; x += U / 8, i++) { g.fillStyle = cols[(i + j) % 4]; rr(x + 1, y + 1, U / 8 - 2, 22, 3); g.fill(); g.fillStyle = "rgba(255,255,255,.55)"; rr(x + 2.5, y + 2.5, U / 8 - 9, 3, 1.5); g.fill(); } }
    else if (style === "planks") { for (let y = 0, j = 0; y < 192; y += 8, j++) { g.fillStyle = ["#8a5a2e", "#9a6634", "#7e5229"][j % 3]; g.fillRect(0, y, U, 8); g.fillStyle = "#4a2e14"; g.fillRect(0, y + 7.2, U, .8);
      g.fillStyle = "rgba(255,220,170,.12)"; g.fillRect(0, y + .5, U, 1.2); g.fillStyle = "#3a2410"; for (const x of [6, U - 7]) g.fillRect(x, y + 3, 1.2, 1.2); } }
    else if (style === "pave") {   // smooth warm-grey pavement: a fine grain, a few soft patches and faint wear where the wheels run
      g.fillStyle = "#aca79e"; g.fillRect(0, 0, U, 192);
      for (let k = 0; k < 90; k++) { const x = r() * U, y = r() * 192, rad = 6 + r() * 16, gr = g.createRadialGradient(x, y, 0, x, y, rad), dk = r() < .5;
        gr.addColorStop(0, dk ? "rgba(80,70,60,.07)" : "rgba(255,250,240,.07)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        for (const dy of [-192, 192]) if (y + dy - rad < 192 && y + dy + rad > 0) { g.save(); g.translate(0, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); } }
      for (let k = 0; k < 26000; k++) { g.fillStyle = r() < .5 ? "rgba(70,62,54,.16)" : "rgba(255,255,255,.14)"; g.fillRect(r() * U, r() * 192, .3, .3); }
      g.fillStyle = "rgba(60,50,40,.045)"; for (const x of [.3, .7]) g.fillRect(U * x - 10, 0, 20, 192); }
    else specks("#5d5d64", ["#555560", "#66666e", "#4f4f58"], 3000, 1.2);
    if (style !== "planks" && style !== "toy") { g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(3, 0, 2.2, 192); g.fillRect(U - 5.2, 0, 2.2, 192); }   // edge lines
    if (style !== "planks") { g.fillStyle = th.line || "rgba(255,255,255,.8)"; for (let y = 0; y < 192; y += 48) g.fillRect(U / 2 - 1.5, y + 14, 3, 20); }   // centre dashes
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  }
  const curbTex = cc => { const c = canvas(8, 64), g = c.getContext("2d"); g.fillStyle = cc[0]; g.fillRect(0, 0, 8, 32); g.fillStyle = cc[1]; g.fillRect(0, 32, 8, 32);
    g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0, 30, 8, 2); g.fillRect(0, 62, 8, 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t; };
  function ribbon(pts, closed, Wd, roadMat, curbMat, lift) {
    const n = pts.length, ang = i => { const a = pts[closed ? (i + n - 2) % n : Math.max(0, i - 2)], b = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const L = [0]; for (let i = 1; i <= n; i++) { if (i === n && !closed) break; const p = pts[i % n], q = pts[i - 1]; L.push(L[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1])); }
    const tot = L[L.length - 1], rv = closed ? Math.max(1, Math.round(tot / 192)) / tot : 1 / 192, rc = closed ? Math.max(1, Math.round(tot / 32)) / tot : 1 / 32;
    const rows = closed ? n + 1 : n, K = 8, at = (i, o) => { const p = pts[i % n], a = ang(i % n); return [p[0] - Math.sin(a) * o, p[1] + Math.cos(a) * o]; };
    // road surface
    const P = [], UV = [], I = [];
    for (let i = 0; i < rows; i++) for (let k = 0; k <= K; k++) { const [x, y] = at(i, -Wd / 2 + Wd * k / K); P.push(x, h(x, y) + lift, y); UV.push(k / K, L[i] * rv); }
    for (let i = 0; i < rows - 1; i++) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + K + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }   // wound so the surface faces up
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(I); geo.computeVertexNormals();
    // curbs: a low red-and-white kerb each side, with a little wall down to the grass
    const CP = [], CU = [], CI = [], CUR = A.CURB || 14;
    for (const sd of [-1, 1]) {
      const base = CP.length / 3, prof = [[Wd / 2, lift], [Wd / 2, lift + 1.6], [Wd / 2 + CUR, lift + 1.6], [Wd / 2 + CUR + 1.5, -1.5]];
      for (let i = 0; i < rows; i++) for (const [o, dz] of prof) { const [x, y] = at(i, sd * o); CP.push(x, h(x, y) + dz, y); CU.push(.5, L[i] * rc); }
      for (let i = 0; i < rows - 1; i++) for (let k = 0; k < 3; k++) { const a = base + i * 4 + k, b = a + 4; CI.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(CP, 3)); cg.setAttribute("uv", new THREE.Float32BufferAttribute(CU, 2)); cg.setIndex(CI);
    const road = new THREE.Mesh(geo, roadMat), curb = new THREE.Mesh(cg, curbMat); scene.add(road, curb); roadObjs.push(road, curb);
  }
  function roadMat(tex, decal) {
    const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.onBeforeCompile = sh => { sh.uniforms.decal = { value: decal };
      sh.vertexShader = "varying vec2 vWXZ;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vWXZ = position.xz;");
      sh.fragmentShader = "uniform sampler2D decal; varying vec2 vWXZ;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        `#include <map_fragment>\n vec4 dc = texture2D(decal, vec2(vWXZ.x / ${WORLD.toFixed(1)}, 1.0 - vWXZ.y / ${WORLD.toFixed(1)})); diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);`); };
    return m;
  }
  function buildRoad(t) {
    for (const o of roadObjs) { scene.remove(o); o.geometry.dispose(); } roadObjs = [];
    const th = t.theme, RS = th.road || "cobble", decal = new THREE.CanvasTexture(t.decal()); decal.colorSpace = THREE.SRGBColorSpace; decal.anisotropy = aniso;
    const cm = new THREE.MeshLambertMaterial({ map: curbTex(th.curb || ["#d8352d", "#f4f1ea"]), flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    ribbon(t.PTS, !t.OPEN, t.ROAD, roadMat(surfaceTex(RS, th, t.ROAD), decal), cm, .5);
    if (t.AN > 1) { const st = t.ALT_STYLE === "planks" ? "planks" : RS; ribbon(t.ALT, false, t.ALT_ROAD, roadMat(surfaceTex(st, th, t.ALT_ROAD), decal), cm, .3); }
  }
  const DETAIL = (() => { const n = 64, d = new Uint8Array(n * n * 4); let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n * n; i++) { d[i * 4] = 140 + r() * 115; d[i * 4 + 1] = 120 + r() * 135; d[i * 4 + 2] = 128; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; })();
  // the sky: the track's sky picture with its horizon panorama (the town) wrapped around a huge cylinder that travels with the camera
  const SKY_R = 3000, SKY_H = 1800, SKY_BELOW = 450;
  // a picture that repeats without a visible join: its last part is faded over its start
  function seamless(im) {
    const iw = im.width, ih = im.height, ov = Math.round(iw * .22), L = iw - ov, c = canvas(L, ih), g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    const e = canvas(ov, ih), ge = e.getContext("2d"); ge.drawImage(im, L, 0, ov, ih, 0, 0, ov, ih);
    const gr = ge.createLinearGradient(0, 0, ov, 0); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    ge.globalCompositeOperation = "destination-in"; ge.fillStyle = gr; ge.fillRect(0, 0, ov, ih);
    g.drawImage(e, 0, 0); return c;
  }
  function buildSky(t) {
    const c = canvas(4096, 512), g = c.getContext("2d"), hor = Math.round(512 * (1 - SKY_BELOW / SKY_H));
    const pxU = 4096 / (2 * Math.PI * SKY_R) * 2, pyU = 512 / SKY_H, ax = pxU / pyU;   // 2 repeats around
    g.fillStyle = t.theme.sky || "#8fd0ff"; g.fillRect(0, 0, 4096, hor);
    if (t.sky) { const tile = seamless(t.sky), sh = hor, n = Math.max(1, Math.round(4096 / (tile.width * sh / tile.height * ax))), sw = 4096 / n;   // the same way round every time (no mirrored copies), joins blended away
      for (let i = 0; i < n; i++) g.drawImage(tile, i * sw, 0, sw + .5, sh); }
    if (t.strip) { const sh = 420 * pyU, sw = 4096 / Math.max(1, Math.round(4096 / (t.strip.width * sh / t.strip.height * ax))); for (let x = 0; x < 4096; x += sw) g.drawImage(t.strip, x, hor + 6 - sh, sw + 1, sh); }
    g.fillStyle = t.theme.grass ? t.theme.grass[0] : "#4a8a3a"; g.fillRect(0, hor + 6, 4096, 512);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.repeat.x = -2; map.anisotropy = aniso;
    if (skyMesh) { scene.remove(skyMesh); skyMesh.material.map.dispose(); skyMesh.material.dispose(); }
    skyMesh = new THREE.Mesh(new THREE.CylinderGeometry(SKY_R, SKY_R, SKY_H, 64, 1, true), new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -1; scene.add(skyMesh);
  }
  function sync(t) {
    if (key !== t.key) { key = t.key; buildGround(t); skyRefs = []; }
    if (skyRefs[0] !== t.sky || skyRefs[1] !== t.strip || !skyMesh) { skyRefs = [t.sky, t.strip]; buildSky(t); }
  }

  // ---------------------------------------------------------------- pictures standing in the world (props, mesos, monsters, fans)
  const texCache = new Map();
  function picTex(im, flip) {
    let c = texCache.get(im); if (!c) texCache.set(im, c = {});
    const k = flip ? "f" : "n";
    if (!c[k]) {
      const tx = new THREE.Texture(im); tx.colorSpace = THREE.SRGBColorSpace; tx.needsUpdate = true;
      if (im.px) { tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestMipmapLinearFilter; } else { tx.minFilter = THREE.LinearMipmapLinearFilter; tx.anisotropy = aniso; }
      if (flip) { tx.wrapS = THREE.RepeatWrapping; tx.repeat.x = -1; tx.offset.x = 1; }
      c[k] = new THREE.SpriteMaterial({ map: tx, alphaTest: .4, transparent: false, fog: true });
    }
    return c[k];
  }
  const pool = []; let pi = 0;
  function spr(im, x, y, z, sc, flip) {
    if (!im || !(im.naturalWidth || im.width)) return;
    let s = pool[pi++]; if (!s) { s = new THREE.Sprite(); s.center.set(.5, 0); scene.add(s); pool.push(s); }
    s.material = picTex(im, !!flip); s.visible = true; s.scale.set(im.width * sc, im.height * sc, 1); s.position.set(x, h(x, y) + (z || 0), y);
  }

  // ---------------------------------------------------------------- item boxes: real spinning rainbow "?" cubes
  const qTex = (() => { const c = canvas(128, 128), g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
    g.font = "900 92px Ubuntu, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 8; g.strokeStyle = "rgba(60,40,80,.55)"; g.strokeText("?", 64, 70); g.fillStyle = "#fff"; g.fillText("?", 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const boxes = []; let bi = 0;
  function box(x, y, tt, i) {
    let b = boxes[bi++]; if (!b) { b = new THREE.Mesh(BOX, new THREE.MeshPhongMaterial({ map: qTex, transparent: true, opacity: .82, shininess: 90, emissive: 0x222222 })); scene.add(b); boxes.push(b); }
    b.visible = true; b.scale.setScalar(13); b.material.color.setHSL(((tt * .33 + i * .13) % 1), .85, .6);
    b.position.set(x, h(x, y) + 11 + Math.sin(tt * 3 + i) * 1.6, y); b.rotation.set(.35, tt * 1.6 + i, .2);
  }

  // ---------------------------------------------------------------- karts
  const mat = (c, o) => new THREE.MeshPhongMaterial({ color: c, shininess: 45, ...o });
  const flameTex = (() => { const c = canvas(64, 64), g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, "rgba(255,255,230,1)"); gr.addColorStop(.35, "rgba(255,200,60,.9)"); gr.addColorStop(.7, "rgba(255,90,20,.5)"); gr.addColorStop(1, "rgba(255,40,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shadowTex = (() => { const c = canvas(64, 64), g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
    gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const crownTex = (() => { const c = canvas(64, 64), g = c.getContext("2d");
    g.fillStyle = "#ffd75e"; g.strokeStyle = "#7a5200"; g.lineWidth = 3; g.beginPath(); g.moveTo(8, 50); g.lineTo(8, 16); g.lineTo(20, 30); g.lineTo(32, 8); g.lineTo(44, 30); g.lineTo(56, 16); g.lineTo(56, 50); g.closePath(); g.fill(); g.stroke();
    g.font = "900 26px Ubuntu, sans-serif"; g.textAlign = "center"; g.lineWidth = 4; g.strokeStyle = "#5a0d10"; g.strokeText("F", 32, 47); g.fillStyle = "#c8232c"; g.fillText("F", 32, 47);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  function makeKart(color, ghost, family) {
    const o = ghost ? { transparent: true, opacity: .42, depthWrite: false } : {};
    const paint = mat(color, { shininess: 80, specular: 0x666666, ...o }), dark = mat(0x23202a, o), tire = mat(0x18161c, { shininess: 10, ...o }), gold = mat(0xe8b43a, { shininess: 90, specular: 0x886622, ...o }),
      white = mat(0xffffff, o), metal = mat(0x9aa0aa, { shininess: 100, specular: 0xaaaaaa, ...o }), trim = family ? gold : white;
    const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group(); root.add(tilt); tilt.add(body);
    const add = (m, w, hh, d, x, y, z) => { const me = new THREE.Mesh(BOX, m); me.scale.set(w, hh, d); me.position.set(x, y, z); body.add(me); return me; };
    add(dark, 25, 1.6, 13, 0, 3.2, 0);                 // floor pan
    add(paint, 15, 4.2, 11, 0, 6, 0);                  // body
    add(paint, 9, 3, 8.6, 10.5, 5.2, 0);               // nose
    add(dark, 2.2, 2.6, 15, 14.5, 4, 0);               // front bumper
    for (const s of [-1, 1]) add(paint, 11, 3, 3, -.5, 5, s * 7);   // side pods
    add(white, 15.2, .9, 11.2, 0, 6.6, 0); add(trim, 15.2, .7, 11.2, 0, 5.7, 0);   // white stripe and trim
    add(dark, 2.4, 6.5, 7.5, -5, 9.5, 0);              // seat back
    add(metal, 5, 4, 8, -9.5, 6.8, 0);                 // engine
    for (const s of [-1, 1]) { const p = new THREE.Mesh(CYL, metal); p.scale.set(.9, 4.5, .9); p.rotation.z = Math.PI / 2; p.position.set(-12.5, 7.2, s * 2.6); body.add(p); }
    for (const s of [-1, 1]) add(dark, 1, 4.5, 1, -11, 10.5, s * 4.5);   // spoiler struts
    add(family ? gold : paint, 3.4, .9, 17, -11.5, 13, 0);  // spoiler
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: crownTex, transparent: true, ...o }));
    badge.rotation.y = -Math.PI / 2; badge.position.set(-12.05, 10, 0); badge.visible = !!family; body.add(badge);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(2, .45, 6, 14), dark); wheel.position.set(3.5, 10.5, 0); wheel.rotation.set(0, Math.PI / 2, 0); wheel.rotation.order = "YXZ"; wheel.rotation.x = -.5; body.add(wheel);
    const wheels = [];
    for (const [x, r, front] of [[9, 3.5, 1], [-8.5, 4.2, 0]]) for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(x, r, s * 8.4); body.add(piv);
      const t = new THREE.Mesh(CYL, tire); t.scale.set(r, 3.2, r); t.rotation.x = Math.PI / 2; piv.add(t);
      const hub = new THREE.Mesh(CYL, gold); hub.scale.set(r * .45, 3.4, r * .45); hub.rotation.x = Math.PI / 2; piv.add(hub);
      const spoke = new THREE.Mesh(BOX, metal); spoke.scale.set(r * 1.5, r * .3, 3.3); piv.add(spoke);
      wheels.push({ piv, front, r });
    }
    const ice = new THREE.Mesh(BOX, new THREE.MeshPhongMaterial({ color: 0xbfe8ff, transparent: true, opacity: .45, shininess: 120, specular: 0xffffff }));
    ice.scale.set(30, 24, 24); ice.position.y = 11; ice.visible = false; body.add(ice);
    const flames = [-1, 1].map(s => { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); f.position.set(-15, 7.2, s * 2.6); body.add(f); return f; });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(34, 24, 1); shadow.position.y = .8; root.add(shadow);
    const driverTex = new THREE.Texture(); driverTex.colorSpace = THREE.SRGBColorSpace; driverTex.magFilter = THREE.NearestFilter; driverTex.minFilter = THREE.NearestMipmapLinearFilter; driverTex.wrapS = THREE.RepeatWrapping;
    const driver = new THREE.Sprite(new THREE.SpriteMaterial({ map: driverTex, alphaTest: ghost ? 0 : .4, transparent: !!ghost, opacity: ghost ? .5 : 1 })); driver.center.set(.5, .06); driver.position.set(-2, 7, 0); driver.visible = false; body.add(driver);
    scene.add(root);
    const mats = [paint, dark, tire, gold, white, metal, badge.material, driver.material];
    return { root, tilt, body, wheels, ice, flames, driver, driverTex, paint, mats, ghost: !!ghost, faded: false, im: null, roll: 0, used: true };
  }
  const karts = new Map();
  function kart(r, o) {
    let m = karts.get(r);
    if (!m || m.color !== o.color) { if (m) scene.remove(m.root); m = makeKart(o.color, o.ghost, o.family); m.color = o.color; karts.set(r, m); }
    m.used = true; m.root.visible = true; m.me = !!o.me;
    const gx = r.x, gy = r.y, a = r.a || 0, ca = Math.cos(a), sa = Math.sin(a);
    m.root.position.set(gx, h(gx, gy), gy); m.root.rotation.y = -a;
    // lean with the ground: nose up on a climb, tipped on a side slope
    const f = h(gx + ca * 11, gy + sa * 11) - h(gx - ca * 11, gy - sa * 11), sd = h(gx - sa * 8, gy + ca * 8) - h(gx + sa * 8, gy - ca * 8);
    m.tilt.rotation.set(Math.atan2(sd, 16) * .9, 0, Math.atan2(f, 22));
    const t = performance.now() / 1000, spin = r.spin > 0 ? (.9 - r.spin) / .9 * Math.PI * 4 : 0, flip = r.flip > 0 ? (1 - r.flip / .4) * Math.PI * 2 : 0;
    const hop = r.hop > 0 ? Math.sin((r.hop / .18) * Math.PI) * 4 : 0, lift = r.rescue > 0 ? (r.rescue > .7 ? (1.4 - r.rescue) / .7 : r.rescue / .7) * 40 : 0;
    m.body.position.y = Math.max(0, r.z || 0) + hop + lift;
    m.body.rotation.set(flip, -((r.drift || 0) * .34 + (r.steer || 0) * .07) - spin, 0, "YXZ");
    const sc = (r.small > 0 ? .6 : 1) * (r.hyper > 0 ? 1.3 : 1); m.body.scale.set(sc * (r.squash > 0 ? 1.35 : 1), sc * (r.squash > 0 ? .45 : 1), sc * (r.squash > 0 ? 1.35 : 1));
    m.body.visible = !(r.inv > 0 && !(r.spin > 0) && Math.floor(t * 11) % 2);
    m.paint.emissive.setHex(r.hyper > 0 ? new THREE.Color().setHSL((t * 1.7) % 1, 1, .35).getHex() : 0);
    m.roll += (r.v || 0) * o.dt / 4;
    for (const w of m.wheels) { w.piv.rotation.set(0, w.front ? -(r.steer || 0) * .45 : 0, -m.roll * 4 / w.r); }
    m.ice.visible = r.frozen > 0;
    const ex = r.extra || 0; for (const fl of m.flames) { fl.visible = ex > 5; if (fl.visible) { const s = (5 + Math.min(1, ex / 100) * 6) * (.8 + Math.random() * .45); fl.scale.set(s, s, 1); } }
    const im = o.img && (o.img.naturalHeight || o.img.height) ? o.img : null;
    if (im !== m.im) { m.im = im; if (im) { m.driverTex.image = im; m.driverTex.needsUpdate = true; } }
    m.driver.visible = !!im;
    if (im) { const dh = 21, dw = dh * im.width / im.height; m.driver.scale.set(dw, dh, 1);
      const fl = (r.steer || 0) < -.3 || (r.drift || 0) < 0; m.driverTex.repeat.x = fl ? -1 : 1; m.driverTex.offset.x = fl ? 1 : 0; }
    return m;
  }

  // ---------------------------------------------------------------- camera and frame
  const cam = { yaw: null, y: 0, x: 0, z: 0 };
  let VW = 320, VH = 180, shake = 0;
  const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), look = new THREE.Vector3();
  function begin(k, o) {
    VW = o.W; VH = o.H; pi = 0; bi = 0; for (const m of karts.values()) m.used = false;
    const a = k.a || 0;
    if (cam.yaw == null || o.snap) cam.yaw = a;
    let d = a - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * Math.min(1, o.dt * 7);   // the camera swings round a moment after the kart
    const dist = 58 + 9 * (o.fov || 0), up = 37 + Math.min(k.z || 0, 120) * .65;   // up high and looking down at the road, like Mario Kart Tour
    const gx = k.x - Math.cos(cam.yaw) * dist, gz = k.y - Math.sin(cam.yaw) * dist;
    const want = Math.max(h(k.x, k.y), h(gx, gz) - 6) + up;
    cam.y = o.snap || !cam.y ? want : cam.y + (want - cam.y) * Math.min(1, o.dt * 6);
    camera.position.set(gx, Math.max(cam.y, h(gx, gz) + 5), gz);
    look.set(k.x + Math.cos(cam.yaw) * 56, h(k.x + Math.cos(cam.yaw) * 56, k.y + Math.sin(cam.yaw) * 56) * .5 + h(k.x, k.y) * .5 + 2 + Math.min(k.z || 0, 120) * .65, k.y + Math.sin(cam.yaw) * 56);   // rises with you in a jump (no tilting up at the sky)
    if (o.intro != null && o.intro < 1 && o.grid) {   // before the start: from in front of the grid (everyone facing you), swooping up and round to behind your kart
      const [qx, qy, qa] = o.grid, e = o.intro * o.intro * (3 - 2 * o.intro), fx = qx + Math.cos(qa) * 170, fz = qy + Math.sin(qa) * 170;
      tmp.set(fx, h(fx, fz) + 38, fz).lerp(camera.position, e); tmp.y += Math.sin(Math.PI * e) * 45; camera.position.copy(tmp);
      tmp.set(qx - Math.cos(qa) * 20, h(qx, qy) + 10, qy - Math.sin(qa) * 20).lerp(look, e); look.copy(tmp);
      cam.yaw = a; cam.y = want;
    }
    shake = o.shake || 0; if (shake > 0) camera.position.add(tmp.set((Math.random() - .5) * shake * 6, (Math.random() - .5) * shake * 6, (Math.random() - .5) * shake * 6));
    camera.lookAt(look);
    camera.fov = 60 + 10 * (o.fov || 0); camera.aspect = VW / VH; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    if (skyMesh) skyMesh.position.set(camera.position.x, camera.position.y + SKY_H / 2 - SKY_BELOW, camera.position.z);
  }
  // a rival between the camera and your kart turns see-through, so it never blocks your view
  function fadeBlockers() {
    let me = null; for (const m of karts.values()) if (m.me && m.used) me = m; if (!me) return;
    const dMe = tmp.copy(me.root.position).sub(camera.position).dot(fwd);
    for (const m of karts.values()) { if (m === me || !m.used) continue;
      if (!m.base) m.base = m.mats.map(mt => [mt.transparent, mt.opacity, mt.depthWrite]);
      const d = tmp.copy(m.root.position).sub(camera.position).dot(fwd), lat = tmp.addScaledVector(fwd, -d).length(), block = m.ghost ? d < dMe + 15 : d > 0 && d < dMe - 6 && lat < 30;   // ghosts fade whenever they're level with you or behind
      if (block !== m.faded) { m.faded = block; m.mats.forEach((mt, i) => { const [tr, op, dw] = m.base[i];
        mt.transparent = block || tr; mt.opacity = block ? (m.ghost ? .1 : .3) : op; mt.depthWrite = block ? false : dw; mt.needsUpdate = true; }); } }
  }
  function end() {
    fadeBlockers();
    for (let i = pi; i < pool.length; i++) pool[i].visible = false;
    for (let i = bi; i < boxes.length; i++) boxes[i].visible = false;
    for (const [r, m] of karts) if (!m.used) { m.root.visible = false; if (r.gone || r.dead) { scene.remove(m.root); karts.delete(r); } }
    renderer.render(scene, camera);
  }
  // where a world spot shows up on the screen (in the game's 320-wide units), and how many screen units one world unit is there
  function proj(x, y, z = 0) {
    tmp.set(x, h(x, y) + z, y); const d = tmp.clone().sub(camera.position).dot(fwd); if (d < 4) return null;
    tmp.project(camera); const f = VH / 2 / Math.tan(camera.fov * Math.PI / 360);
    return { sx: (tmp.x + 1) / 2 * VW, sy: (1 - tmp.y) / 2 * VH, sc: f / d, d };
  }
  // is a spot hidden behind a hill?
  function hidden(x, y, z = 4) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, ty = h(x, y) + z;
    for (let i = 1; i < 10; i++) { const t = i / 10, px = cx + (x - cx) * t, pz = cz + (y - cz) * t; if (h(px, pz) > cy + (ty - cy) * t + 2) return true; }
    return false;
  }
  function resize(w, hh) { renderer.setSize(w, hh, false); }
  function clearKarts() { for (const m of karts.values()) scene.remove(m.root); karts.clear(); cam.yaw = null; }
  const snap = () => { renderer.render(scene, camera); return renderer.domElement; };   // (testing) the 3D picture, read right after drawing it
  return { snap, sync, begin, end, spr, box, kart, proj, hidden, h, resize, clearKarts, renderer, get key() { return key; } };
}
