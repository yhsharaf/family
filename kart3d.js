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
  let WORLD = A.WORLD;   // world size in units: each track sets its own (track.WORLD), so longer courses fit
  A.CURB = 14;
  const renderer = new THREE.WebGLRenderer({ canvas: A.canvas, antialias: !A.touch, powerPreference: "high-performance", alpha: false });
  renderer.setPixelRatio(Math.min(A.touch ? 1.5 : 2, devicePixelRatio || 1));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 7000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 2.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.5); sun.position.set(-.45, 1, .3); scene.add(sun);
  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 18);

  // ---------------------------------------------------------------- ✨ the next-gen look (an experiment, switched off): the sun
  // casts real shadows, every picture standing in the world gets a soft shadow on the ground, the picture goes through filmic colour, bright
  // things glow, and each cup has its own light and colour grade. Quality: 2 = computers, 1 = phones, 0 = off (the old look).
  let Q = (() => { try { const v = localStorage.getItem("kart_q"); return v != null ? +v : A.touch ? 1 : 2; } catch (e) { return A.touch ? 1 : 2; } })(), NG = false, mood = null;
  const MOODS = {
    henesys: { sun: 0xffe6c4, sunI: 2.4, dir: [-.6, .55, .5], sky: 0xd8eaff, gnd: 0x5e6a48, hemiI: 1.05, exp: 1, sat: 1.04, con: 1.06, warm: .02, vig: .26, bloom: .45, thr: .95 },
  };
  const OLD_LIGHT = { hemiSky: hemi.color.getHex(), hemiGnd: hemi.groundColor.getHex(), hemiI: hemi.intensity, sun: sun.color.getHex(), sunI: sun.intensity, pos: sun.position.clone() };
  scene.add(sun.target);
  sun.shadow.bias = -.0005; sun.shadow.normalBias = 1.2;
  { const sc = sun.shadow.camera; sc.left = -520; sc.right = 520; sc.top = 520; sc.bottom = -520; sc.near = 10; sc.far = 3600; }
  // soft round shadows under the pictures (trees, pigs, fans, mesos): one instanced mesh, filled each frame by spr()
  const blobTex = (() => { const c = canvas(64, 64), g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 1, 32, 32, 31); gr.addColorStop(0, "rgba(0,0,0,.5)"); gr.addColorStop(.55, "rgba(0,0,0,.24)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const BLOBN = 1200, blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), BLOBN);
  blobs.frustumCulled = false; blobs.count = 0; blobs.visible = false; blobs.renderOrder = 1; scene.add(blobs); let blobI = 0; const M4b = new THREE.Matrix4();
  // the picture pipeline: the scene into a float buffer, its bright parts blurred into a glow at quarter size, then glow + filmic colour + grade
  let PP = null;
  const fsGeo = new THREE.BufferGeometry(); fsGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); fsGeo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene(), fsQuad = new THREE.Mesh(fsGeo); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
  const VS = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";
  const brightM = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, thr: { value: .9 } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: "uniform sampler2D tex; uniform float thr; varying vec2 vUv; void main() { vec3 c = texture2D(tex, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(thr, thr + .7, l), 1.); }" });
  const blurM = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: "uniform sampler2D tex; uniform vec2 d; varying vec2 vUv; void main() { vec3 c = texture2D(tex, vUv).rgb * .227; c += (texture2D(tex, vUv + d * 1.385).rgb + texture2D(tex, vUv - d * 1.385).rgb) * .316; c += (texture2D(tex, vUv + d * 3.231).rgb + texture2D(tex, vUv - d * 3.231).rgb) * .07; gl_FragColor = vec4(c, 1.); }" });
  const compM = new THREE.ShaderMaterial({ uniforms: { scene: { value: null }, bloom: { value: null }, strength: { value: .5 }, exposure: { value: 1 }, sat: { value: 1.1 }, con: { value: 1.05 }, warm: { value: 0 }, vig: { value: .25 } },
    vertexShader: VS, depthTest: false, depthWrite: false, fragmentShader: `
      uniform sampler2D scene, bloom; uniform float strength, exposure, sat, con, warm, vig; varying vec2 vUv;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
      void main() {
        vec3 c = (texture2D(scene, vUv).rgb + texture2D(bloom, vUv).rgb * strength) * exposure;
        c = toSRGB(aces(c));
        float l = dot(c, vec3(.299, .587, .114)); c = mix(vec3(l), c, sat); c = (c - .5) * con + .5;
        c += vec3(warm, warm * .35, -warm);
        vec2 q = vUv - .5; c *= 1. - vig * smoothstep(.25, .85, dot(q, q) * 2.2);
        gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
      }` });
  const hasHalf = renderer.extensions.has("EXT_color_buffer_half_float") || renderer.extensions.has("EXT_color_buffer_float");
  function ppSize() {
    if (!PP) return; const v = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, v.x), hh = Math.max(2, v.y);
    PP.main.setSize(w, hh); PP.b1.setSize(Math.max(1, w >> 2), Math.max(1, hh >> 2)); PP.b2.setSize(Math.max(1, w >> 2), Math.max(1, hh >> 2));
  }
  function makePP() {
    const type = hasHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
    PP = { main: new THREE.WebGLRenderTarget(2, 2, { type, samples: Q >= 2 ? 4 : 0 }), b1: new THREE.WebGLRenderTarget(2, 2, { type, depthBuffer: false }), b2: new THREE.WebGLRenderTarget(2, 2, { type, depthBuffer: false }) };
    ppSize();
  }
  const fs = (m, target) => { fsQuad.material = m; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };
  function draw() {   // one frame: straight to the screen (old look), or through the picture pipeline
    if (!(NG && Q >= 1)) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    if (!PP) makePP();
    renderer.setRenderTarget(PP.main); renderer.render(scene, camera);
    brightM.uniforms.tex.value = PP.main.texture; brightM.uniforms.thr.value = mood.thr; fs(brightM, PP.b1);
    const bw = PP.b1.width, bh = PP.b1.height;
    for (let k = 0; k < 2; k++) { blurM.uniforms.tex.value = PP.b1.texture; blurM.uniforms.d.value.set((1 + k) / bw, 0); fs(blurM, PP.b2); blurM.uniforms.tex.value = PP.b2.texture; blurM.uniforms.d.value.set(0, (1 + k) / bh); fs(blurM, PP.b1); }
    const u = compM.uniforms; u.scene.value = PP.main.texture; u.bloom.value = PP.b1.texture; u.strength.value = mood.bloom; u.exposure.value = mood.exp; u.sat.value = mood.sat; u.con.value = mood.con; u.warm.value = mood.warm; u.vig.value = mood.vig;
    fs(compM, null);
  }
  // switch the look for a track: its cup's mood (prototype: Oink Oink Meadows, or every track with localStorage kart_ng = "all")
  function applyLook(t) {
    let all = false; try { all = localStorage.getItem("kart_ng") === "all"; } catch (e) {}
    const want = Q >= 1 && all && !!MOODS[t.cup] ? MOODS[t.cup] : null, was = NG;   // (off by default: the guild preferred the original look; localStorage kart_ng = "all" to try it)
    NG = !!want; mood = want; blobs.visible = NG;
    if (NG) { sun.color.setHex(mood.sun); sun.intensity = mood.sunI; sun.position.set(...mood.dir); hemi.color.setHex(mood.sky); hemi.groundColor.setHex(mood.gnd); hemi.intensity = mood.hemiI;
      sun.castShadow = true; const ms = Q >= 2 ? 2048 : 1024; if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
    else { hemi.color.setHex(OLD_LIGHT.hemiSky); hemi.groundColor.setHex(OLD_LIGHT.hemiGnd); hemi.intensity = OLD_LIGHT.hemiI; sun.color.setHex(OLD_LIGHT.sun); sun.intensity = OLD_LIGHT.sunI; sun.position.copy(OLD_LIGHT.pos); sun.target.position.set(0, 0, 0); sun.castShadow = false; }
    if (!NG && t.theme.dark) { const D = t.theme.dark; hemi.color.setHex(D.sky); hemi.groundColor.setHex(D.gnd); hemi.intensity = D.hemiI; sun.color.setHex(D.sun); sun.intensity = D.sunI; }   // 👻 a track's own gloomy light (Sleepywood)
    if (NG !== renderer.shadowMap.enabled) { renderer.shadowMap.enabled = NG; renderer.shadowMap.type = THREE.PCFSoftShadowMap; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); }); }
    if (NG) scene.traverse(o => { if (!o.isMesh || o === blobs) return; const big = !o.geometry.boundingSphere && o.geometry.computeBoundingSphere() || (o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) > 900);
      o.receiveShadow = true; o.castShadow = !big && o !== terrain && !(o.material && o.material.transparent) && !(o.geometry.type === "PlaneGeometry" || o.geometry.type === "CircleGeometry"); });
    if (was !== NG && !NG && PP) { renderer.setRenderTarget(null); }
  }
  // 🐢 too slow on this device? step down a level for this visit (2 → 1 → 0): measured over 3 s of racing
  let lastT = null, lastEnd = 0, perfN = 0, perfSum = 0;
  function perfCheck() {
    const now = performance.now(), d = now - lastEnd; lastEnd = now;
    if (!NG || !lastT || d > 250) return; perfSum += d; perfN++;
    if (perfN < 180) return; const avg = perfSum / perfN; perfSum = perfN = 0;
    if (avg > 27 && Q > 0) { Q--; if (PP) { PP.main.dispose(); PP.b1.dispose(); PP.b2.dispose(); PP = null; } applyLook(lastT); console.info("Family Kart: graphics down to level " + Q + " (" + avg.toFixed(1) + " ms a frame)"); }
  }
  const setQuality = q => { Q = q; try { localStorage.setItem("kart_q", String(q)); } catch (e) {} if (PP) { PP.main.dispose(); PP.b1.dispose(); PP.b2.dispose(); PP = null; } key = null; };   // (rebuilds the track's look on the next frame)

  // ---------------------------------------------------------------- ground: heights, terrain mesh, sky
  let G = 8, GN = WORLD / G + 1;
  let HG = new Float32Array(GN * GN), terrain = null, plain = null, skyMesh = null, key = null, skyRefs = [], RE = null;   // RE: the road's height at each track point
  // 🪁 in the air (a jump, a glide, a mushroom bounce) a kart's height counts from the road it left, not from whatever is below it (a ravine,
  // the slope far under a glide): off the road the ground can be far lower. How far above the ground that puts it:
  let bridgeG = [];
  const airLift = r => { if (!RE || r.idx == null) return 0; if (!(r.z > 0)) { const i = r.idx | 0; if (!bridgeG.some(g => i > g.a && i < g.b)) return 0; } const g = h(r.x, r.y), e = RE[Math.max(0, Math.min(RE.length - 1, r.idx | 0))]; return Math.max(0, e - g); };   // (and on a rope bridge, over the ravine, you're held up at the road's height)
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
    if (t.WORLD && t.WORLD !== WORLD) { WORLD = t.WORLD; const n = Math.round(WORLD / (WORLD > 3200 ? 12 : 8)); G = WORLD / n; GN = n + 1; HG = new Float32Array(GN * GN); }   // (a big world gets a coarser ground grid, so it stays light)
    const E = profile(t); RE = E; const wsum = new Float64Array(GN * GN), hsum = new Float64Array(GN * GN), dmin = new Float32Array(GN * GN).fill(1e9), near = new Int32Array(GN * GN).fill(-1);
    const MT = !!t.theme.mountain, R = MT ? 640 : 300, rc = Math.ceil(R / G);   // (a mountain: the slope runs smoothly between the switchbacks)
    const splat = (px, py, e, idx = -1) => {
      const ci = Math.round(px / G), cj = Math.round(py / G);
      for (let j = Math.max(0, cj - rc); j <= Math.min(GN - 1, cj + rc); j++) for (let i = Math.max(0, ci - rc); i <= Math.min(GN - 1, ci + rc); i++) {
        const dx = i * G - px, dy = j * G - py, d2 = dx * dx + dy * dy; if (d2 > R * R) continue;
        const o = j * GN + i; if (d2 < dmin[o]) { dmin[o] = d2; near[o] = idx; }
        const q = d2 + 64, w = 1 / (q * q * q * q); wsum[o] += w; hsum[o] += w * e;
      }
    };
    for (let i = 0; i < t.N; i++) splat(t.PTS[i][0], t.PTS[i][1], E[i], i);
    if (t.AN > 1 && t.FORK_A >= 0) { const ea = E[Math.max(0, Math.min(t.N - 1, t.FORK_A))], eb = E[Math.max(0, Math.min(t.N - 1, t.FORK_B))];
      for (let j = 0; j < t.AN; j++) splat(t.ALT[j][0], t.ALT[j][1], ea + (eb - ea) * j / (t.AN - 1)); }
    let mean = 0; for (const e of E) mean += e; mean /= E.length; if (MT) mean = Math.min(...E) - 20;   // (a mountain stands on the low plain)
    const s0 = seedOf(t.key) % 1000, edge = t.ROAD / 2 + t.CURB, hillAmp = 85 * (t.theme.hills ?? 1);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const o = j * GN + i, x = i * G, y = j * G, d = Math.sqrt(dmin[o]);
      const road = wsum[o] > 0 ? hsum[o] / wsum[o] : mean, base = MT ? road + (mean - road) * smooth(560, 640, d) : road + (mean - road) * smooth(200, 300, d);
      const n = vnoise(x / 520, y / 520, s0) * .8 + vnoise(x / 230, y / 230, s0 + 1) * .2;   // broad, gentle hills
      const be = Math.min(x, y, WORLD - x, WORLD - y), hgt = base + Math.max(-20, (n - .32) * hillAmp) * smooth(edge + 90, edge + 520, d);
      HG[o] = hgt + (mean - hgt) * smooth(160, 0, be) * smooth(edge + 40, edge + 200, d);   // levels out to the open plain at the map's edge
    }
    if (t.lake && (t.lake.kind === "ice" || t.lake.kind === "shallow" || t.lake.kind === "clock")) {   // ⛸ a frozen rink (or a shallow pond) is dead flat, at the height of the road across it
      const L = t.lake; let sum = 0, n = 0; for (let i = 0; i < t.N; i++) if (((t.PTS[i][0] - L.cx) / L.rx) ** 2 + ((t.PTS[i][1] - L.cy) / L.ry) ** 2 < 1) { sum += E[i]; n++; }
      const lh = n ? sum / n : mean;
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const q = Math.sqrt(((i * G - L.cx) / L.rx) ** 2 + ((j * G - L.cy) / L.ry) ** 2), w = smooth(1.35, 1.02, q); if (w > 0) { const o = j * GN + i; HG[o] += (lh - HG[o]) * w; } }
    }
    if (t.lake && t.lake.kind === "fountain") {   // ⛲ the fountain stands on a flat plaza, level with the road round it (not up on a hill)
      const L = t.lake; let sum = 0, n = 0; for (let i = 0; i < t.N; i++) if (Math.hypot(t.PTS[i][0] - L.cx, t.PTS[i][1] - L.cy) < L.rx + 380) { sum += E[i]; n++; }
      const lh = n ? sum / n : mean;
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const w = smooth(L.rx + 150, L.rx + 20, Math.hypot(i * G - L.cx, j * G - L.cy)); if (w > 0) { const o = j * GN + i; HG[o] += (lh - HG[o]) * w; } }
    }
    for (const l of t.ledges || []) for (let o = 0; o < GN * GN; o++) { const n = near[o]; if (!(n >= l.a && n <= l.b && Math.sqrt(dmin[o]) > edge + 14)) continue;
      if (l.side) { const P0 = t.PTS[(n + t.N - 1) % t.N], P1 = t.PTS[(n + 1) % t.N], p = t.PTS[n], cx = (o % GN) * G - p[0], cz = Math.floor(o / GN) * G - p[1], sd = Math.sign((P1[0] - P0[0]) * cz - (P1[1] - P0[1]) * cx), d = Math.sqrt(dmin[o]);
        if (sd === l.side) HG[o] -= (l.drop ?? 260) * smooth(edge + 14, edge + 50, d) * (l.fade ? smooth(edge + 800, edge + 250, d) * smooth(l.a, l.a + 25, n) * smooth(l.b, l.b - 25, n) : 1); else if (l.rise) HG[o] += l.rise * smooth(edge + 30, edge + 200, d); continue; }   // (fading: the cliff, then the mountainside sloping on down to the valley)   // 🏔️ Sharp Cliff: a sheer drop on the valley side, the mountain rising on the other
      HG[o] -= (t.theme.ledgeDrop ?? 260) * smooth(edge + 14, edge + 60, Math.sqrt(dmin[o])); }   // ⛏️ no railings: a sheer drop into the dark beside the road
    if (t.sea != null) {   // 🌋 a flat sea (of lava) everywhere off the road, which stands above it on its own rock
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const o = j * GN + i; if (Math.sqrt(dmin[o]) > edge + 14) HG[o] = t.sea; }
      mean = t.sea;
    }
    if (t.water) {   // 🌊 a lake: the bed lies deep under the water everywhere, and the boardwalk stands on its own piles above it
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const o = j * GN + i, d = Math.sqrt(dmin[o]); if (d > edge + 14) HG[o] = t.water.bed; }   // (a lip a couple of cells wide, so the road edge never sags)
      mean = t.water.bed;
    }
    const DIP = new Float32Array(GN * GN); for (let o = 0; o < GN * GN; o++) DIP[o] = 5 * smooth(edge + 24, edge + 4, Math.sqrt(dmin[o]));   // the ground sinks a little under the road, so it never pokes through
    for (const g of t.gaps || []) { const depth = g.depth ?? (g.kind === "water" ? 70 : g.open ? 90 : 320);   // 🍄 a gorge (deep, misty) or the park pond
      const GW = g.wall || 424; for (let o = 0; o < GN * GN; o++) if (near[o] >= g.a && near[o] < g.b) DIP[o] = Math.max(DIP[o], depth * (g.open ? smooth(700, 120, Math.sqrt(dmin[o])) : smooth(GW + 96, GW + 6, Math.sqrt(dmin[o]))));   // (g.wall: a narrower ravine)   // (an open glide: a smooth hollow in the mountainside)
      if (t.theme.cliffs && !g.open && (g.kind === "gorge" || g.kind === "chasm" || g.kind === "bridge")) {   // with cliff walls: the pit is exactly the walls' box (no ground left standing in front of them where the track bends)
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = g.a; i <= g.b; i++) { const p = t.PTS[i % t.N]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
        const M = 480, gi0 = Math.max(0, Math.floor((x0 - M) / G)), gi1 = Math.min(GN - 1, Math.ceil((x1 + M) / G)), gj0 = Math.max(0, Math.floor((z0 - M) / G)), gj1 = Math.min(GN - 1, Math.ceil((z1 + M) / G));
        for (let j = gj0; j <= gj1; j++) for (let i = gi0; i <= gi1; i++) { const x = i * G, z = j * G; let bd = 1e12, bi = -1;
          for (let k = g.a - 6; k <= g.b + 6; k++) { const p = t.PTS[((k % t.N) + t.N) % t.N], d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; bi = k; } }
          if (bi > g.a && bi < g.b && (!g.wall || (near[j * GN + i] >= g.a - 8 && near[j * GN + i] <= g.b + 8))) { const o = j * GN + i; DIP[o] = Math.max(DIP[o], depth * smooth(GW + 46, GW + 8, Math.sqrt(bd))); } } } }
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
        "#include <map_fragment>\n diffuseColor.rgb *= (.9 + .2 * texture2D(detail, vMapUv * 97.0).r) * (.94 + .12 * texture2D(detail, vMapUv * 19.0).g);");
 };
    // the open plain all round the map, out to the horizon
    if (plain) { scene.remove(plain); plain.children.forEach(m => m.geometry.dispose()); }
    plain = new THREE.Group(); const pm = new THREE.MeshLambertMaterial({ color: new THREE.Color(t.theme.grass ? t.theme.grass[0] : "#5cae46") }), F = 7000;
    for (const [cx, cz, w, d] of [[WORLD / 2, -F / 2, WORLD + 2 * F, F], [WORLD / 2, WORLD + F / 2, WORLD + 2 * F, F], [-F / 2, WORLD / 2, F, WORLD], [WORLD + F / 2, WORLD / 2, F, WORLD]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pm); m.rotation.x = -Math.PI / 2; m.position.set(cx, mean - .3, cz); plain.add(m); }
    if (t.theme.earth) {   // 🌍 the Earth, far below the road
      const c = canvas(512, 256), g = c.getContext("2d"); g.fillStyle = "#1e5aa8"; g.fillRect(0, 0, 512, 256); let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 40; k++) { g.fillStyle = ["#3a8a3a", "#5aa04a", "#c8b070"][k % 3]; g.beginPath(); g.ellipse(rnd() * 512, 40 + rnd() * 176, 10 + rnd() * 40, 6 + rnd() * 26, rnd() * 3, 0, 7); g.fill(); }
      g.fillStyle = "rgba(255,255,255,.75)"; for (let k = 0; k < 60; k++) { g.beginPath(); g.ellipse(rnd() * 512, rnd() * 256, 14 + rnd() * 40, 3 + rnd() * 6, rnd() * .6, 0, 7); g.fill(); }
      g.fillStyle = "#f4f8ff"; g.fillRect(0, 0, 512, 18); g.fillRect(0, 238, 512, 18);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(5200, 48, 24), new THREE.MeshBasicMaterial({ map: tx, fog: false }));
      earth.position.set(WORLD / 2, mean - 5800, WORLD / 2); earth.rotation.z = .4; earth.userData.keep = true; plain.add(earth); }
    if (t.water) { const wm = new THREE.MeshPhongMaterial({ color: 0x1d3f63, transparent: true, opacity: .74, shininess: 90, specular: 0x6f8fb0, side: THREE.DoubleSide, depthWrite: false });
      const wp = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 2 * F, WORLD + 2 * F), wm); wp.rotation.x = -Math.PI / 2; wp.position.set(WORLD / 2, t.water.level, WORLD / 2); wp.renderOrder = 2; plain.add(wp); }
    scene.add(plain);
    gapsBuilt = t.gaps || [];
    if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.map.dispose(); terrain.material.dispose(); }
    terrain = new THREE.Mesh(geo, mat); scene.add(terrain);
    if (t.theme.space) { terrain.visible = false; for (const m of plain.children) if (!m.userData.keep) m.visible = false; }   // 🌌 in space there's no ground: the road floats over the stars
    buildRoad(t); buildCliffs(t);
    scene.fog = new THREE.Fog(new THREE.Color(...(t.haze || [214, 236, 255]).map(c => c / 255)), ...(t.theme.fog || [900, 2600]));
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
    else if (style === "icy") {   // Snow Land's purple-blue ice road: glassy, with frosty skid streaks
      const gr0 = g.createLinearGradient(0, 0, U, 0); gr0.addColorStop(0, "#8f9ee8"); gr0.addColorStop(.5, "#a9b6f2"); gr0.addColorStop(1, "#8f9ee8"); g.fillStyle = gr0; g.fillRect(0, 0, U, 192);
      for (let k = 0; k < 60; k++) { const x = r() * U, y = r() * 192, w = 1 + r() * 2.5, l = 20 + r() * 60; g.fillStyle = r() < .6 ? "rgba(255,255,255,.22)" : "rgba(90,100,190,.18)"; g.fillRect(x, y, w, l); }   // skid streaks along the road
      for (let k = 0; k < 5000; k++) { g.fillStyle = r() < .6 ? "rgba(255,255,255,.35)" : "rgba(80,90,180,.15)"; g.fillRect(r() * U, r() * 192, .5, .5); }
      g.fillStyle = "rgba(255,255,255,.55)"; g.fillRect(0, 0, 3, 192); g.fillRect(U - 3, 0, 3, 192);
    }
    else if (style === "garden") {   // Peach Gardens' cream garden path, with a soft darker border
      g.fillStyle = "#f0e3c4"; g.fillRect(0, 0, U, 192);
      for (let k = 0; k < 80; k++) { const x = r() * U, y = r() * 192, rad = 8 + r() * 16, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .5 ? "rgba(190,160,110,.12)" : "rgba(255,250,235,.15)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      for (let k = 0; k < 7000; k++) { g.fillStyle = r() < .5 ? "rgba(150,120,80,.18)" : "rgba(255,255,255,.25)"; g.fillRect(r() * U, r() * 192, .4, .4); }
      g.fillStyle = "rgba(170,130,90,.28)"; g.fillRect(0, 0, 4, 192); g.fillRect(U - 4, 0, 4, 192);
    }
    else if (style === "farm") {   // Moo Moo Meadows' orange-tan country dirt, with tyre tracks worn into it
      g.fillStyle = "#d6a35e"; g.fillRect(0, 0, U, 192);
      for (let k = 0; k < 120; k++) { const x = r() * U, y = r() * 192, rad = 8 + r() * 18, gr = g.createRadialGradient(x, y, 0, x, y, rad), dk = r() < .5;
        gr.addColorStop(0, dk ? "rgba(150,95,40,.13)" : "rgba(255,225,170,.12)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      for (let k = 0; k < 9000; k++) { g.fillStyle = r() < .5 ? "rgba(120,78,36,.22)" : "rgba(255,236,196,.2)"; g.fillRect(r() * U, r() * 192, .5 + r() * .6, .5 + r() * .6); }
      g.fillStyle = "rgba(140,90,40,.16)"; for (const x of [.22, .3, .7, .78]) g.fillRect(U * x - 3, 0, 6, 192);   // two pairs of wheel ruts
    }
    else if (style === "dirt") { specks("#b98b5a", ["#a87a4a", "#c99d68", "#9c6e40", "#d2a878"], 2600, 1.6); g.fillStyle = "rgba(90,60,30,.18)"; for (const x of [.3, .7]) g.fillRect(U * x - 6, 0, 12, 192); }
    else if (style === "snow") { specks("#e3ebf6", ["#c9d6ea", "#f8fbff", "#d6e2f2"], 2400, 1.6); g.fillStyle = "rgba(150,170,205,.35)"; for (const x of [.28, .72]) g.fillRect(U * x - 5, 0, 10, 192); }
    else if (style === "rainbow" || style === "pastel") {   // 🌈 Rainbow Road: rows of glowing tiles in the eight colours (soft pastels on the Wii one), with bright edges
      const cols = style === "pastel" ? ["#ffb0c8", "#ffd0a0", "#fff0a0", "#c0f0b0", "#a8f0e8", "#a8d8ff", "#c0c0ff", "#e0b8ff"] : ["#ff3a5a", "#ff8a2a", "#ffd23a", "#5ae06a", "#3ad8c8", "#3ab8ff", "#5a6aff", "#b85aff"], n = Math.max(4, Math.round(U / 22));
      g.fillStyle = "#101028"; g.fillRect(0, 0, U, 192);
      for (let row = 0; row < 8; row++) for (let k = 0; k < n; k++) { const x = k * U / n, y = row * 24, gr = g.createLinearGradient(x, y, x, y + 24); gr.addColorStop(0, "#ffffff"); gr.addColorStop(.18, cols[row]); gr.addColorStop(1, cols[row]);
        g.fillStyle = gr; g.globalAlpha = .9; rr(x + 1, y + 1, U / n - 2, 22, 3); g.fill(); g.globalAlpha = 1; g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = .8; g.stroke(); } }
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
    if (style !== "planks" && style !== "toy" && style !== "farm" && style !== "garden") { g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(3, 0, 2.2, 192); g.fillRect(U - 5.2, 0, 2.2, 192); }   // edge lines
    if (style !== "planks" && style !== "farm" && style !== "garden" && style !== "icy") { g.fillStyle = th.line || "rgba(255,255,255,.8)"; for (let y = 0; y < 192; y += 48) g.fillRect(U / 2 - 1.5, y + 14, 3, 20); }   // centre dashes
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  }
  const curbTex = cc => { const c = canvas(8, 64), g = c.getContext("2d"); g.fillStyle = cc[0]; g.fillRect(0, 0, 8, 32); g.fillStyle = cc[1]; g.fillRect(0, 32, 8, 32);
    g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0, 30, 8, 2); g.fillRect(0, 62, 8, 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t; };
  function ribbon(pts, closed, Wd, roadMat, curbMat, lift, skip = [], bare = []) {
    const skipped = i => skip.some(g => i >= g.a && i < g.b), noCurb = i => skipped(i) || bare.some(g => i >= g.a && i < g.b);   // (bare: no curbs, e.g. across a frozen rink)
    const n = pts.length, ang = i => { const a = pts[closed ? (i + n - 2) % n : Math.max(0, i - 2)], b = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const L = [0]; for (let i = 1; i <= n; i++) { if (i === n && !closed) break; const p = pts[i % n], q = pts[i - 1]; L.push(L[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1])); }
    const tot = L[L.length - 1], rv = closed ? Math.max(1, Math.round(tot / 192)) / tot : 1 / 192, rc = closed ? Math.max(1, Math.round(tot / 32)) / tot : 1 / 32;
    const rows = closed ? n + 1 : n, K = 8, at = (i, o) => { const p = pts[i % n], a = ang(i % n); return [p[0] - Math.sin(a) * o, p[1] + Math.cos(a) * o]; };
    // road surface
    const P = [], UV = [], I = [];
    for (let i = 0; i < rows; i++) for (let k = 0; k <= K; k++) { const [x, y] = at(i, -Wd / 2 + Wd * k / K); P.push(x, h(x, y) + lift, y); UV.push(k / K, L[i] * rv); }
    for (let i = 0; i < rows - 1; i++) if (!skipped(i)) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + K + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }   // wound so the surface faces up
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(I); geo.computeVertexNormals();
    // curbs: a low red-and-white kerb each side, with a little wall down to the grass
    const CP = [], CU = [], CI = [], CUR = A.CURB || 14;
    for (const sd of [-1, 1]) {
      const base = CP.length / 3, prof = [[Wd / 2, lift], [Wd / 2, lift + 1.6], [Wd / 2 + CUR, lift + 1.6], [Wd / 2 + CUR + 1.5, -1.5]];
      for (let i = 0; i < rows; i++) for (const [o, dz] of prof) { const [x, y] = at(i, sd * o); CP.push(x, h(x, y) + dz, y); CU.push(.5, L[i] * rc); }
      for (let i = 0; i < rows - 1; i++) if (!noCurb(i)) for (let k = 0; k < 3; k++) { const a = base + i * 4 + k, b = a + 4; CI.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(CP, 3)); cg.setAttribute("uv", new THREE.Float32BufferAttribute(CU, 2)); cg.setIndex(CI);
    const road = new THREE.Mesh(geo, roadMat), curb = new THREE.Mesh(cg, curbMat); scene.add(road, curb); roadObjs.push(road, curb);
  }
  function roadMat(tex, decal, glow) {
    const w = WORLD;
    const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    if (glow) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = tex; m.emissiveIntensity = .55; }   // (Rainbow Road's tiles glow)
    m.onBeforeCompile = sh => { sh.uniforms.decal = { value: decal };
      sh.vertexShader = "varying vec2 vWXZ;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vWXZ = position.xz;");
      sh.fragmentShader = "uniform sampler2D decal; varying vec2 vWXZ;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        `#include <map_fragment>\n vec4 dc = texture2D(decal, vec2(vWXZ.x / ${w.toFixed(1)}, 1.0 - vWXZ.y / ${w.toFixed(1)})); diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);`)
        .replace("#include <emissivemap_fragment>", glow ? "#include <emissivemap_fragment>\n totalEmissiveRadiance *= (1.0 - dc.a);" : "#include <emissivemap_fragment>"); };   // (on a glowing road, what's painted on it, like a hole, doesn't glow)
    m.customProgramCacheKey = () => "road" + w + (glow ? "g" : "");   // (the world size is baked into the shader, so tracks of different sizes need their own)
    return m;
  }
  // 🧱 clean cliff walls round each gorge (Mushroom Canyon): smooth vertical strips along the pit's edge - the grassy lip at the top, the
  // dirt with mossy rocks below, darker further down - mapped evenly along the wall like a MapleStory map's ground
  function buildCliffs(t) {
    const CL = t.theme.cliffs ? cliffMats(t.theme.cliffs) : null; if (!CL || !RE) return;
    const DEPTH = 330, N = t.N, P = t.PTS;
    const tan = i => { const a = P[Math.max(0, i - 2) % N], b = P[Math.min(N - 1, i + 2) % N]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const lipM = new THREE.MeshLambertMaterial({ map: CL.top, side: THREE.DoubleSide, vertexColors: true }), fillM = new THREE.MeshLambertMaterial({ map: CL.fill, side: THREE.DoubleSide, vertexColors: true });
    const strip = pts => {   // pts: [x, z, top] along the wall -> a lip strip and a fill strip
      const lp = [], lu = [], lc = [], fp = [], fu = [], fc = [], li = [], fi = []; let arc = 0;
      pts.forEach((q, k) => { if (k) arc += Math.hypot(q[0] - pts[k - 1][0], q[1] - pts[k - 1][1]); const u = arc / CL.w, top = q[2];
        lp.push(q[0], top, q[1], q[0], top - CL.lip, q[1]); lu.push(u, 1, u, 0); lc.push(1, 1, 1, .92, .92, .92);
        fp.push(q[0], top - CL.lip + 1, q[1], q[0], top - DEPTH, q[1]); fu.push(u, 0, u, -(DEPTH - CL.lip) / CL.fh); fc.push(.92, .92, .92, .35, .35, .35);
        if (k) { const a = (k - 1) * 2; li.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); fi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
      for (const [pos, uv, col, ix, m] of [[lp, lu, lc, li, lipM], [fp, fu, fc, fi, fillM]]) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); g.computeVertexNormals(); const mesh = new THREE.Mesh(g, m); scene.add(mesh); roadObjs.push(mesh); }
    };
    for (const g of t.gaps || []) { if (g.open || (g.kind !== "gorge" && g.kind !== "chasm" && g.kind !== "bridge")) continue;
      const W = g.wall || 424, at2 = (i, o) => { const [tx, ty] = tan(i), p = P[i % N]; return [p[0] - ty * o, p[1] + tx * o]; }, rim = i => RE[Math.max(0, Math.min(N - 1, i % N))] + 1;
      for (const sd of [-1, 1]) { const pts = []; for (let i = g.a; i <= g.b; i += 2) { const [x, z] = at2(i, sd * W), [hx, hz] = at2(i, sd * (W + 110)); pts.push([x, z, Math.max(rim(i), h(hx, hz) + 1)]); } strip(pts); }   // the two long sides, as tall as the hillside behind them
      for (const i of [g.a + 1, g.b - 1]) { const pts = []; for (let o = -W; o <= W; o += 24) { const [x, z] = at2(i, o); pts.push([x, z, rim(i)]); } strip(pts); }   // the ends, under the road's edge
      if (t.theme.cliffs === "snow") {   // ❄ far below: a floor of snow under drifting mist (not bare earth)
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, lo = 1e9; for (let i = g.a; i <= g.b; i++) { const p = P[i % N]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); lo = Math.min(lo, rim(i)); }
        const fl = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 2 * W + 60, z1 - z0 + 2 * W + 60), g.river ? new THREE.MeshLambertMaterial({ map: riverTex(), emissive: 0x2a5a8a }) : new THREE.MeshLambertMaterial({ color: 0xeef4fc, emissive: 0x3a4658 })); fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + x1) / 2, lo - 300, (z0 + z1) / 2); scene.add(fl); roadObjs.push(fl);   // (a frozen river under the rope bridge)
        const mist = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 2 * W, z1 - z0 + 2 * W), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .45, depthWrite: false })); mist.rotation.x = -Math.PI / 2; mist.position.set((x0 + x1) / 2, lo - 230, (z0 + z1) / 2); scene.add(mist); roadObjs.push(mist); }
    }
  }
  function buildRoad(t) {
    for (const o of roadObjs) { scene.remove(o); if (o.geometry) o.geometry.dispose(); } roadObjs = [];
    for (const o of extraObjs) scene.remove(o); extraObjs = [];
    const th = t.theme, RS = th.road || "cobble", decal = new THREE.CanvasTexture(t.decal()); decal.colorSpace = THREE.SRGBColorSpace; decal.anisotropy = aniso;
    const cm = new THREE.MeshLambertMaterial({ map: curbTex(th.curb || ["#d8352d", "#f4f1ea"]), flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    // where a second road (a fork) leaves and rejoins, neither road has curbs across the other: the junction stays open and clean
    const mainBare = [...(t.bare || [])], altBare = [];
    if (t.AN > 1) {
      const runs = (n, test) => { const out = []; for (let i = 0; i < n; i++) if (test(i)) { const l = out[out.length - 1]; if (l && l.b === i) l.b = i + 1; else out.push({ a: i, b: i + 1 }); } return out; };
      const near = (x, y, P, lo, hi, d) => { for (let k = Math.max(0, lo); k < Math.min(P.length, hi); k += 2) if (Math.hypot(P[k][0] - x, P[k][1] - y) < d) return true; return false; };
      const reach = t.ROAD / 2 + t.ALT_ROAD / 2 + t.CURB * 2 + 6;
      altBare.push(...runs(t.AN, j => near(t.ALT[j][0], t.ALT[j][1], t.PTS, t.FORK_A - 80, t.FORK_B + 80, t.ROAD / 2 + t.CURB + t.ALT_ROAD / 2)));
      mainBare.push(...runs(t.N, i => (Math.abs(i - t.FORK_A) < 70 || Math.abs(i - t.FORK_B) < 70) && near(t.PTS[i][0], t.PTS[i][1], t.ALT, 0, t.AN, reach)));
    }
    ribbon(t.PTS, !t.OPEN, t.ROAD, roadMat(surfaceTex(RS, th, t.ROAD), decal, RS === "rainbow" || RS === "pastel"), cm, .5, [...(t.gaps || []), ...(t.hide || [])], mainBare);
    if (t.water) {   // 🪵 the boardwalk's piles, down into the lake
      const step = Math.max(1, Math.round(46 / t.SPC)), spots = [];
      for (let i = 0; i < t.N; i += step) { const p = t.PTS[i], q = t.PTS[(i + 1) % t.N], a = Math.atan2(q[1] - p[1], q[0] - p[0]); for (const sd of [-1, 1]) { const o = sd * (t.ROAD / 2 + t.CURB - 3); spots.push([p[0] - Math.sin(a) * o, p[1] + Math.cos(a) * o]); } }
      const im = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ color: 0x4a3420 }), spots.length), M4 = new THREE.Matrix4();
      spots.forEach(([x, y], k) => { const top = h(x, y), hh = Math.max(4, top - t.water.bed); M4.makeScale(7, hh, 7); M4.setPosition(x, top - hh / 2, y); im.setMatrixAt(k, M4); });
      scene.add(im); roadObjs.push(im);
    }
    // ❄ ice caves: a crystal arch over the road (open at both ends), with a red rail along its foot
    for (const cv of t.caves || []) {
      const shell = (R0, mat, ht, ext = 0) => { const K = 18, P = [], UV = [], IX = []; let rows = 0, L = 0;
        for (let i = cv.a; i <= cv.b; i += 2, rows++) {
          const sm = ext ? 10 : 1, p = t.PTS[i % t.N], p0 = t.PTS[(i - sm + t.N) % t.N], q = t.PTS[(i + sm + 1) % t.N], a = Math.atan2(q[1] - p0[1], q[0] - p0[0]), base = h(p[0], p[1]); if (rows) L += 2 * t.SPC;   // (a big cave turns with the road smoothly, so its walls never fold on a tight bend)
          let inS = 0, inF = 1; if (ext) { const pa = t.PTS[(i - 2 * sm + t.N) % t.N], qb = t.PTS[(i + 2 * sm) % t.N], a1 = Math.atan2(p[1] - pa[1], p[0] - pa[0]), a2 = Math.atan2(qb[1] - p[1], qb[0] - p[0]); let da = a2 - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
            const rt = Math.hypot(qb[0] - pa[0], qb[1] - pa[1]) / Math.max(1e-3, 2 * Math.abs(da)); inS = Math.sign(da); inF = Math.min(1, Math.max(rt * .8, t.ROAD / 2 + t.CURB + 26) / R0); }   // on a tight bend the inside wall comes in (so it never folds over)
          for (let k = 0; k <= K; k++) { const th2 = -ext + (Math.PI + 2 * ext) * k / K; let o = -Math.cos(th2) * R0; if (o * inS > 0) o *= inF; const y = Math.sin(th2) * R0 * ht; P.push(p[0] - Math.sin(a) * o, base + y - 6, p[1] + Math.cos(a) * o); UV.push(k / K * 3, L / 160); }
        }
        for (let r = 0; r < rows - 1; r++) for (let k = 0; k < K; k++) { const a = r * (K + 1) + k, b = a + K + 1; IX.push(a, b, a + 1, a + 1, b, b + 1); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(IX); geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mat); scene.add(m); roadObjs.push(m); };
      const R0 = cv.half || t.ROAD / 2 + t.CURB + 14, HTR = cv.half ? .85 : .72, EXT = cv.half ? .2 : 0;   // (the crystal cave is a big one)
      shell(R0, cv.star ? new THREE.MeshBasicMaterial({ map: starTex(), side: THREE.DoubleSide }) : cv.temple ? new THREE.MeshLambertMaterial({ map: goldTex(), side: THREE.DoubleSide, emissive: 0x3a2a10 }) : cv.rock ? new THREE.MeshLambertMaterial({ map: rockTex(), side: THREE.DoubleSide, emissive: 0x2a2630 }) : cv.crystal ? new THREE.MeshLambertMaterial({ map: caveTex(), color: 0x5a6fa8, side: THREE.DoubleSide, emissive: 0x0a1838 }) : new THREE.MeshLambertMaterial({ map: caveTex(), side: THREE.DoubleSide, emissive: 0x1d4f7a }), HTR, EXT);   // (the crystal cave is dark inside: its glowing crystals light it)   // the crystal (or rock) inside
      shell(R0 + 16, cv.crystal ? new THREE.MeshLambertMaterial({ color: 0xbfdcff, side: THREE.DoubleSide, emissive: 0x2a4a7a, flatShading: true }) : new THREE.MeshLambertMaterial({ color: cv.temple ? 0xb89a5a : cv.mound != null ? cv.mound : 0xeef5fc, side: THREE.DoubleSide, emissive: cv.temple ? 0x2a2010 : 0x2a3a50 }), HTR + .08, EXT);
      if (cv.crystal) crystalCave(t, cv, R0, R0 * HTR);                // a mound of snow over it
      if (cv.rock || cv.temple || cv.star || cv.crystal) continue;
      const RP = [], RI = [];   // the red rail (one side, like Double Dash!!)
      for (let i = cv.a, r = 0; i <= cv.b; i += 2, r++) { const p = t.PTS[i % t.N], q = t.PTS[(i + 2) % t.N], a = Math.atan2(q[1] - p[1], q[0] - p[0]), o = t.ROAD / 2 + t.CURB + 6, x = p[0] - Math.sin(a) * o, y = p[1] + Math.cos(a) * o, gz = h(x, y);
        RP.push(x, gz, y, x, gz + 16, y); if (r) { const b = r * 2; RI.push(b - 2, b, b - 1, b - 1, b, b + 1); } }
      const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(RP, 3)); rg.setIndex(RI);
      const rail = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xc8302a, side: THREE.DoubleSide })); scene.add(rail); roadObjs.push(rail);
    }
    // 🗿 Thwomps: a stone block with a face on every side, and its shadow on the road (darker as it comes down)
    // 🔥 fireballs (a glowing ball and its warning shadow) and the road that gives way on later laps (a crumbled hole glowing with lava)
    fireM = []; fireFn = t.fireZ || null;
    for (const b of t.fireballs || []) { const m = new THREE.Mesh(new THREE.SphereGeometry(18, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff7a1e })), glow = new THREE.Mesh(new THREE.SphereGeometry(26, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: .4, depthWrite: false }));
      m.add(glow); const sh = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: 0x220800, transparent: true, opacity: .3, depthWrite: false })); sh.rotation.x = -Math.PI / 2;
      scene.add(m, sh); roadObjs.push(m, sh); fireM.push({ b, m, sh, g: h(b.x, b.y) }); }
    holeM = []; lapFn = t.lapNow || null;
    for (const hl of t.holes || []) {   // (the lava inside is real MapleStory molten rock)
      const g = new THREE.Group(), lava = new THREE.Mesh(new THREE.CircleGeometry(hl.r, 28), new THREE.MeshBasicMaterial(t.tiles && t.tiles.moltenRock ? { map: (() => { const tx = new THREE.CanvasTexture(t.tiles.moltenRock); tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(hl.r / 60, hl.r / 40); return tx; })() } : { color: 0xff5a1a })), rim = new THREE.Mesh(new THREE.RingGeometry(hl.r, hl.r + 10, 28), new THREE.MeshBasicMaterial({ color: 0x2a1a14 }));
      for (const q of [lava, rim]) { q.rotation.x = -Math.PI / 2; g.add(q); } rim.position.y = .3; g.position.set(hl.x, h(hl.x, hl.y) + 1.4, hl.y); g.visible = false; scene.add(g); roadObjs.push(g); holeM.push({ hl, g }); }
    // 🕰️ the clockwork: gears that turn (a toothed wheel set into the floor), the clock's hands sweeping round, pendulums swinging across the road
    clockM = { gears: [], hands: [], pends: [], t };
    for (const g of t.gears || []) { const grp = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: g.col || 0xd8a83a, emissive: 0x2a1a00 }), dark = new THREE.MeshLambertMaterial({ color: 0x6a4a1a });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(g.r, g.r, 6, 40), mat); disc.position.y = -2; grp.add(disc);
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, tooth = new THREE.Mesh(BOX, mat); tooth.scale.set(18, 6, 14); tooth.position.set(Math.cos(a) * (g.r + 7), -2, Math.sin(a) * (g.r + 7)); tooth.rotation.y = -a; grp.add(tooth); }
      for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(BOX, dark); sp.scale.set(g.r * 1.8, 1.4, 10); sp.rotation.y = k * Math.PI / 4; sp.position.y = 1.4; grp.add(sp); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 4, 20), dark); hub.position.y = 2; grp.add(hub);
      grp.position.set(g.x, h(g.x, g.y) + 1, g.y); scene.add(grp); roadObjs.push(grp); clockM.gears.push({ g, grp }); }
    if (t.lake) for (const hd of t.hands || []) { const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x3a2a50 })); m.scale.set(hd.len, 8, hd.w); scene.add(m); roadObjs.push(m); clockM.hands.push({ hd, m, y: h(t.lake.cx, t.lake.cy) + 5 }); }
    for (const p of t.pends || []) { const grp = new THREE.Group(), rod = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x8a6a2a })), bob = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 8, 28), new THREE.MeshLambertMaterial({ color: 0xe8b83a, emissive: 0x3a2a00 }));
      rod.scale.set(4, 300, 4); rod.position.y = -150; bob.rotation.x = Math.PI / 2; bob.position.y = -300; grp.add(rod, bob); const gz = h(p.base[0], p.base[1]); grp.position.set(p.base[0], gz + 330, p.base[1]); grp.rotation.order = "YXZ"; grp.rotation.y = -p.a; scene.add(grp); roadObjs.push(grp); clockM.pends.push({ p, grp }); }
    cartM = []; cartFn = t.cartAt || null;   // 🛒 mine carts: a wooden tub full of gold on little wheels
    for (const c of t.carts || []) { const g = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x6a4424 }), gold = new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x6a4a00 }), iron = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
      const tub = new THREE.Mesh(BOX, wood); tub.scale.set(40, 18, 26); tub.position.y = 14; g.add(tub); const ore = new THREE.Mesh(new THREE.SphereGeometry(14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold); ore.scale.set(1.3, .8, .85); ore.position.y = 23; g.add(ore);
      for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) { const w = new THREE.Mesh(CYL, iron); w.scale.set(5, 3, 5); w.rotation.x = Math.PI / 2; w.position.set(x, 5, z); g.add(w); }
      scene.add(g); roadObjs.push(g); cartM.push({ c, g }); }
    thw = []; thFn = t.thz || null;
    for (const th of t.thwomps || []) { const fm = new THREE.MeshLambertMaterial({ map: faceTex(), color: th.col || 0xffffff, emissive: th.col ? 0x202020 : 0 }), top = new THREE.MeshLambertMaterial({ color: th.col || 0x7a7f8a });
      const m = new THREE.Mesh(BOX, [fm, fm, top, top, fm, fm]); m.scale.set(74, 62, 74); m.rotation.y = -(th.a || 0); scene.add(m); roadObjs.push(m);
      const sh = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; scene.add(sh); roadObjs.push(sh);
      thw.push({ th, m, sh, g: h(th.x, th.y) }); }
    // ⭕ boost rings hanging in the air over a glider jump: fly through one for a boost
    for (const rg of t.rings || []) { const m = new THREE.Mesh(new THREE.TorusGeometry(rg.r || 40, 5, 10, 36), new THREE.MeshBasicMaterial({ color: 0xffc83a }));
      const glow = new THREE.Mesh(new THREE.TorusGeometry((rg.r || 40) - 6, 2, 8, 36), new THREE.MeshBasicMaterial({ color: 0xfff4b8 }));
      for (const q of [m, glow]) { q.position.set(rg.x, h(rg.x, rg.y) + rg.z, rg.y); q.rotation.y = -rg.a + Math.PI / 2; scene.add(q); roadObjs.push(q); } }
    // ✈ the plane at the top of the mountain (you start just out of its back door)
    if (t.plane) { const P = t.plane, g = new THREE.Group(), y0 = P.at ? h(P.at[0], P.at[1]) : h(P.x, P.y), yel = new THREE.MeshLambertMaterial({ color: 0xffd23a }), pur = new THREE.MeshLambertMaterial({ color: 0x6a3fb0 }), win = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(48, 48, 300, 20), yel); fus.rotation.z = Math.PI / 2; fus.position.set(0, 52, 0); g.add(fus);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(48, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), yel); nose.rotation.z = -Math.PI / 2; nose.position.set(150, 52, 0); g.add(nose);
      const wing = new THREE.Mesh(BOX, pur); wing.scale.set(80, 8, 420); wing.position.set(20, 40, 0); g.add(wing);
      const tail = new THREE.Mesh(BOX, pur); tail.scale.set(50, 90, 8); tail.position.set(-130, 120, 0); g.add(tail);
      const stab = new THREE.Mesh(BOX, pur); stab.scale.set(40, 6, 150); stab.position.set(-135, 80, 0); g.add(stab);
      for (let k = -3; k <= 3; k++) { const w = new THREE.Mesh(BOX, win); w.scale.set(16, 14, 98); w.position.set(k * 30 + 20, 70, 0); g.add(w); }
      const ramp = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x8a8f99 })); ramp.scale.set(70, 6, 80); ramp.position.set(-175, 14, 0); ramp.rotation.z = .35; g.add(ramp);   // the open back door, down to the snow
      g.position.set(P.x, y0, P.y); g.rotation.y = -P.a + Math.PI; scene.add(g); roadObjs.push(g); }
    if (t.AN > 1) { const st = t.ALT_STYLE === "planks" ? "planks" : RS; ribbon(t.ALT, false, t.ALT_ROAD, roadMat(surfaceTex(st, th, t.ALT_ROAD), decal), cm, .3, [], altBare); }
    // 🏰 buildings: walls with rows of windows and a pitched roof (Pets Park's mansion)
    fountM = t.lake && t.lake.kind === "fountain" ? buildFountain(t.lake) : null;
    balloonM = []; flowM = []; golemM = []; for (const o of t.props3d || []) buildProp(o);
    bridgeG = (t.gaps || []).filter(g => g.kind === "bridge"); buildRopeBridges(t);
    gondM = []; if (t.trunk) buildTrunk(t.trunk); if (t.temple) buildTemple(t, t.temple); if (t.cable) buildCableCar(t.cable); for (const f of t.icefalls || []) buildIcefall(f); for (const l of t.ledges || []) if (l.side && l.wall) buildCliffWall(t, l);
    buildSnowWorld(t); auroraM = []; if (t.aurora) buildAurora(t); if (t.fairy) buildFairy(t.fairy, t);
    for (const b of t.buildings || []) {
      if (b.castle) { buildCastle(b); continue; }
      if (b.dam && b.frozen) { buildDam(b, t); continue; }
      if (b.ice || b.dam || b.stone) {   // a wall or tower of ice blocks, the concrete dam, or a stone pillar (no roof)
        const T0 = b.dam ? damTex() : b.stone ? rockTex() : iceTex(), U = b.dam ? 220 : b.stone ? 120 : 90, V = b.dam ? 220 : b.stone ? 120 : 45, em = b.dam ? 0x3a3a38 : b.stone ? 0x2a2630 : 0x3a5f80;
        const tx = T0.clone(); tx.needsUpdate = true; tx.repeat.set(Math.max(1, b.w / U), Math.max(1, b.h / V));
        const tz = T0.clone(); tz.needsUpdate = true; tz.repeat.set(Math.max(1, b.d / U), Math.max(1, b.h / V));
        const mx = new THREE.MeshLambertMaterial({ map: tx, emissive: em }), mz = new THREE.MeshLambertMaterial({ map: tz, emissive: em }), top = new THREE.MeshLambertMaterial({ color: b.dam ? 0xb8b4ac : b.stone ? 0x7a7480 : 0xeaf6ff, emissive: em });
        const m = new THREE.Mesh(BOX, [mz, mz, top, top, mx, mx]); m.scale.set(b.w, b.h, b.d); m.rotation.y = -(b.a || 0); m.position.set(b.x, h(b.x, b.y) + b.h / 2 - 4, b.y); scene.add(m); roadObjs.push(m);
        continue;
      }
      const gnd = h(b.x, b.y), wallM = new THREE.MeshBasicMaterial({ map: b.hospital ? hospWallTex(b.wall, Math.max(2, Math.round(b.w / 70))) : windowsTex(b.wall, Math.max(2, Math.round(b.w / 70)), 2) }), plain = new THREE.MeshBasicMaterial({ color: new THREE.Color(b.wall).multiplyScalar(.92) }), roofM = new THREE.MeshBasicMaterial({ color: b.roof });   // shown in their true colours: a white house with a pink roof, even in shade
      const body = new THREE.Mesh(BOX, [plain, plain, plain, plain, wallM, wallM]); body.scale.set(b.w, b.h, b.d); body.position.set(b.x, gnd + b.h / 2, b.y); scene.add(body); roadObjs.push(body);
      if (b.hospital) {   // a flat roof with a pink trim (a hospital, not a pointed house)
        const slab = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0xe9e2d8 })); slab.scale.set(b.w + 12, 6, b.d + 12); slab.position.set(b.x, gnd + b.h + 3, b.y); scene.add(slab); roadObjs.push(slab);
        const trim = new THREE.Mesh(BOX, roofM); trim.scale.set(b.w + 16, 10, b.d + 16); trim.position.set(b.x, gnd + b.h - 2, b.y); scene.add(trim); roadObjs.push(trim);
      } else { const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), roofM); roof.rotation.y = Math.PI / 4; roof.scale.set(b.w * .74, b.h * .55, b.d * .9); roof.position.set(b.x, gnd + b.h + b.h * .275, b.y); scene.add(roof); roadObjs.push(roof); }
      if (b.tower && b.hospital) {   // the hospital's centre tower: taller, the red cross up high, a pink cap
        const twF = new THREE.MeshBasicMaterial({ map: crossTex() }), tw = new THREE.Mesh(BOX, [plain, plain, plain, plain, twF, twF]); tw.scale.set(b.w * .18, b.h * 1.9, b.d * 1.25); tw.position.set(b.x, gnd + b.h * .95, b.y - 4); scene.add(tw); roadObjs.push(tw);
        const cap = new THREE.Mesh(BOX, roofM); cap.scale.set(b.w * .2, 10, b.d * 1.4); cap.position.set(b.x, gnd + b.h * 1.9 + 5, b.y - 4); scene.add(cap); roadObjs.push(cap);
      } else if (b.tower) { const twF = b.hospital ? new THREE.MeshBasicMaterial({ map: crossTex() }) : wallM, tw = new THREE.Mesh(BOX, [plain, plain, plain, plain, twF, twF]);   // (a hospital: the big red cross on the tower) tw.scale.set(b.w * .22, b.h * 1.6, b.d * 1.1); tw.position.set(b.x, gnd + b.h * .8, b.y - 4); scene.add(tw); roadObjs.push(tw);
        const tr = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), roofM); tr.rotation.y = Math.PI / 4; tr.scale.set(b.w * .18, b.h * .7, b.d * .85); tr.position.set(b.x, gnd + b.h * 1.6 + b.h * .35, b.y - 4); scene.add(tr); roadObjs.push(tr); }
    }
    // 🌿 hedge blocks (Pets Park's maze): solid, leafy cubes
    for (const b of t.hedges || []) if (!b.sprite) { const m = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ map: hedgeTex() })); m.scale.set(b.w, b.h, b.w); m.rotation.y = -b.a; m.position.set(b.x, h(b.x, b.y) + b.h / 2, b.y); scene.add(m); roadObjs.push(m); }
    // 🍄 bouncy mushroom caps on the road: spotted domes that squash when someone bounces on them
    caps = [];
    for (const g of t.gaps || []) {
      const depth = g.kind === "water" ? 70 : 320;
      for (const c of g.caps) {
        const lift = c.top || 0, top = h(c.x, c.y) + 1 + lift, grp = new THREE.Group(); grp.position.set(c.x, top, c.y);
        const dh = c.r * (c.gold ? .5 : .56), sink = dh - 14, dome = new THREE.Mesh(CAP, new THREE.MeshPhongMaterial({ map: capTex(c.col), shininess: c.gold ? 90 : 50, specular: c.gold ? 0xfff0a0 : 0x333333, emissive: c.gold ? 0x6a4800 : 0x000000 })); dome.scale.set(c.r, dh, c.r); dome.position.y = -sink; grp.add(dome);   // (the golden ones glow; fat: most of the dome hangs below the road edge, the top you land on stays level)
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(c.r * 1.01, c.r * .94, 7, 40), new THREE.MeshLambertMaterial({ color: { g: 0x2f7a2a, r: 0xa8321e, b: 0x235fa8, o: 0xb85a1a, n: 0x4a2c14, y: 0xb8860b }[c.col] || 0xa8321e })); rim.position.y = -sink - 2; grp.add(rim);
        const under = new THREE.Mesh(new THREE.CylinderGeometry(c.r * .93, c.r * .36, 18, 32), new THREE.MeshLambertMaterial({ color: 0xf6e8c4 })); under.position.y = -sink - 14; grp.add(under);
        const sl = depth + 10 + lift, stem = new THREE.Mesh(new THREE.CylinderGeometry(c.r * .26, c.r * .32, sl, 24), new THREE.MeshLambertMaterial({ color: 0xf4e3a8 })); stem.position.y = -sink - sl / 2 - 12; grp.add(stem);
        scene.add(grp); roadObjs.push(dome, rim, under, stem); extraObjs.push(grp); caps.push({ m: dome, pad: c, h: dh });
      }
      // what's down there: drifting mist in the gorge, water in the pond (not under an open drop or a bridge: those have their own ground)
      if (g.open || g.kind === "bridge") continue;
      const p0 = g.caps[0] || { x: t.PTS[g.a % t.N][0], y: t.PTS[g.a % t.N][1] }, p1 = g.caps[g.caps.length - 1] || { x: t.PTS[g.b % t.N][0], y: t.PTS[g.b % t.N][1] }, mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, base = h(mx, my);   // (a glider's ravine has no mushrooms)
      const sz = Math.max(1100, Math.hypot(p1.x - p0.x, p1.y - p0.y) + 600), sheet = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), g.kind === "water"
        ? new THREE.MeshPhongMaterial({ color: 0x3d8de0, transparent: true, opacity: .85, shininess: 120, specular: 0xffffff })
        : new THREE.MeshBasicMaterial({ map: mistTex(), transparent: true, opacity: .8, depthWrite: false, fog: false }));
      sheet.rotation.x = -Math.PI / 2; sheet.position.set(mx, base - (g.kind === "water" ? 40 : 230), my); scene.add(sheet); roadObjs.push(sheet);
    }
    for (const c of t.shrooms || []) {
      const m = new THREE.Mesh(CAP, new THREE.MeshPhongMaterial({ map: capTex(c.col), shininess: 60, specular: 0x333333 }));
      m.scale.set(c.l / 2, 13, c.w / 2); m.rotation.y = -c.a; m.position.set(c.x, h(c.x, c.y) + .6, c.y); scene.add(m); roadObjs.push(m); caps.push({ m, pad: c.pad });
    }
  }
  let caps = [], capT = 0, gapsBuilt = [], extraObjs = [], hedgeT = null;
  // 🏥 the Pet Hospital: white walls with a red band and blue windows; the tower carries a big red cross and a paw
  const hospWallTex = (wall, cols) => { const c = canvas(256, 128), g = c.getContext("2d"); g.fillStyle = wall; g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#e8352d"; g.fillRect(0, 54, 256, 8); g.fillStyle = "#f07ab0"; g.fillRect(0, 120, 256, 8);
    for (let i = 0; i < cols; i++) for (const y of [16, 72]) { const x = (i + .5) * 256 / cols - 11; g.fillStyle = "#8fd0ff"; g.fillRect(x, y, 22, 30); g.fillStyle = "rgba(255,255,255,.55)"; g.fillRect(x + 2, y + 2, 7, 26); g.strokeStyle = "#c9c2b8"; g.lineWidth = 2; g.strokeRect(x, y, 22, 30); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  let crossT = null;
  const crossTex = () => crossT || (crossT = (() => { const c = canvas(128, 256), g = c.getContext("2d"); g.fillStyle = "#fbf7f2"; g.fillRect(0, 0, 128, 256);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(64, 70, 46, 0, 7); g.fill(); g.strokeStyle = "#e8352d"; g.lineWidth = 6; g.stroke();
    g.fillStyle = "#e8352d"; g.fillRect(52, 36, 24, 68); g.fillRect(30, 58, 68, 24);   // the red cross
    g.fillStyle = "#f07ab0"; g.beginPath(); g.ellipse(64, 160, 16, 14, 0, 0, 7); g.fill(); for (const [dx, dy] of [[-16, -12], [-6, -22], [6, -22], [16, -12]]) { g.beginPath(); g.ellipse(64 + dx, 160 + dy, 6, 7, 0, 0, 7); g.fill(); }   // a paw
    g.fillStyle = "#8fd0ff"; g.fillRect(46, 200, 36, 44); g.strokeStyle = "#c9c2b8"; g.lineWidth = 3; g.strokeRect(46, 200, 36, 44);   // the glass doors
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })());
  const windowsTex = (wall, cols, rows) => { const c = canvas(256, 128), g = c.getContext("2d"); g.fillStyle = wall; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const x = (i + .5) * 256 / cols - 12, y = (j + .5) * 128 / rows - 18; g.fillStyle = "#8fd0ff"; g.fillRect(x, y, 24, 34); g.fillStyle = wall; g.fillRect(x + 11, y, 2, 34); g.fillRect(x, y + 16, 24, 2); g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(x - 2, y + 34, 28, 3); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const hedgeTex = () => hedgeT || (hedgeT = (() => { const c = canvas(128, 128), g = c.getContext("2d"); g.fillStyle = "#3f9a34"; g.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 700; k++) { const v = Math.random(); g.fillStyle = v < .4 ? "#2f7d28" : v < .75 ? "#56b848" : "#78d066"; g.beginPath(); g.ellipse(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 4, 1.5 + Math.random() * 3, Math.random() * 3, 0, 7); g.fill(); }
    for (let k = 0; k < 26; k++) { const x = Math.random() * 128, y = Math.random() * 128; g.fillStyle = ["#ff8fc4", "#ffffff", "#ffd23f"][k % 3]; for (let q = 0; q < 5; q++) { g.beginPath(); g.arc(x + Math.cos(q * 1.26) * 2.6, y + Math.sin(q * 1.26) * 2.6, 1.8, 0, 7); g.fill(); } g.fillStyle = "#ffe48a"; g.beginPath(); g.arc(x, y, 1.4, 0, 7); g.fill(); }   // little flowers in the leaves
    const sh = g.createLinearGradient(0, 0, 0, 128); sh.addColorStop(0, "rgba(255,255,200,.12)"); sh.addColorStop(.7, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,40,0,.25)"); g.fillStyle = sh; g.fillRect(0, 0, 128, 128);   // lit on top, shaded at the foot
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })());
  let iceT = null, caveT = null;
  // 🧊 stacked ice blocks (Sherbet Land's walls and towers): pale blue bricks with bright edges and a frosty shine
  const iceTex = () => iceT || (iceT = (() => { const c = canvas(256, 256), g = c.getContext("2d"), B = 64;
    for (let y = 0; y < 256; y += B / 2) for (let x = -B; x < 256; x += B) { const ox = x + ((y / (B / 2)) & 1) * B / 2, gr = g.createLinearGradient(ox, y, ox + B, y + B / 2);
      gr.addColorStop(0, "#d9f1ff"); gr.addColorStop(.55, "#9fd2f5"); gr.addColorStop(1, "#7fbce8"); g.fillStyle = gr; g.fillRect(ox, y, B, B / 2);
      g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 3; g.strokeRect(ox + 1.5, y + 1.5, B - 3, B / 2 - 3);
      g.fillStyle = "rgba(255,255,255,.55)"; g.fillRect(ox + 6, y + 5, B * .35, 3); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })());
  // ❄ the ice cave's walls: blue crystal facets, darker deep inside
  let starT = null;
  const starTex = () => starT || (starT = (() => { const c = canvas(256, 256), g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, "#1a1050"); gr.addColorStop(1, "#3a1a70"); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);   // ✨ a starry tunnel
    let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 160; k++) { g.fillStyle = ["#ffffff", "#fff3a0", "#a8d8ff", "#ffc8f0"][k % 4]; const x = rnd() * 256, y = rnd() * 256, r = rnd() < .1 ? 3 : 1.2; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })());
  // ⛲ Pets Park's fountain, built in 3D: a paved pink-and-white plaza, a round white basin with a pink lip, three tiers of bowls with water
  // spilling over each one, a jet on top, little arcs of water from the rim, lily pads and sparkling spray
  const ctex = (w, hh, draw, rep) => { const c = document.createElement("canvas"); c.width = w; c.height = hh; draw(c.getContext("2d"), w, hh); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; if (rep) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; } return tx; };
  function plazaTex() {   // round paving: rings of cream and pink stones, a white border
    return ctex(512, 512, (g, W) => { const c = W / 2; g.fillStyle = "#f6efe6"; g.fillRect(0, 0, W, W);
      for (let r = 250, k = 0; r > 20; r -= 26, k++) { const n = Math.max(6, Math.round(r / 9)); for (let q = 0; q < n; q++) { const a0 = q / n * 6.283, a1 = (q + 1) / n * 6.283 - .03;
        g.fillStyle = r > 236 ? "#ffffff" : (k + q) % 7 === 0 ? "#ffb3d6" : (k % 2 ? "#efe4d6" : "#f9f3ea"); g.beginPath(); g.arc(c, c, r, a0, a1); g.arc(c, c, r - 23, a1, a0, true); g.closePath(); g.fill(); } }
      g.strokeStyle = "#f07ab0"; g.lineWidth = 6; g.beginPath(); g.arc(c, c, 236, 0, 7); g.stroke(); });
  }
  function waterTex() {   // a clear blue pool: lighter in the middle, soft white ripples
    return ctex(256, 256, (g, W) => { const gr = g.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W / 2); gr.addColorStop(0, "#9fe0ff"); gr.addColorStop(1, "#4fb3ef"); g.fillStyle = gr; g.fillRect(0, 0, W, W);
      g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 2; for (let k = 0; k < 26; k++) { const x = Math.random() * W, y = Math.random() * W, r = 6 + Math.random() * 16; g.beginPath(); g.ellipse(x, y, r, r * .45, 0, 3.6, 5.8); g.stroke(); } }, true);
  }
  function fallTex() {   // falling water: streaks of white on clear blue (scrolled down every frame)
    return ctex(128, 128, (g, W) => { g.fillStyle = "rgba(170,225,255,.38)"; g.fillRect(0, 0, W, W);
      for (let k = 0; k < 70; k++) { const x = Math.random() * W, y = Math.random() * W, l = 10 + Math.random() * 30; g.strokeStyle = `rgba(255,255,255,${.35 + Math.random() * .5})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + l); g.stroke(); } }, true);
  }
  function buildFountain(L) {
    const R = L.r || 118, x = L.cx, z = L.cy, g0 = h(x, z), add = (m, y) => { m.position.set(x, g0 + y, z); scene.add(m); roadObjs.push(m); return m; };
    const stone = new THREE.MeshLambertMaterial({ color: 0xfbf7f2, emissive: 0x5a5652 }), pink = new THREE.MeshLambertMaterial({ color: 0xf07ab0, emissive: 0x3a1020 }), gold = new THREE.MeshLambertMaterial({ color: 0xffd75e, emissive: 0x403010 });
    const wtx = waterTex(), water = new THREE.MeshBasicMaterial({ map: wtx }), falls = [], flat = m => { m.rotation.x = -Math.PI / 2; return m; };
    const fall = (r0, r1, hh, y) => { const tx = fallTex(); tx.repeat.set(Math.round(r0 / 6), 1); const m = new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, side: THREE.DoubleSide }); falls.push({ tx, sp: .9 + Math.random() * .3 }); return add(new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, hh, 40, 1, true), m), y); };
    const plaza = add(flat(new THREE.Mesh(new THREE.CircleGeometry(L.rx, 64), new THREE.MeshLambertMaterial({ map: plazaTex(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))), 1.2);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R, R + 6, 24, 64), stone), 10);   // the basin: a round white wall
    add(new THREE.Mesh(new THREE.TorusGeometry(R - 2, 7, 10, 64), pink), 23).rotation.x = Math.PI / 2;   // its pink lip
    add(flat(new THREE.Mesh(new THREE.CircleGeometry(R - 7, 64), water)), 20);   // the pool
    for (let k = 0; k < 5; k++) { const a = k * 1.3 + .4, rr = R * (.55 + (k % 2) * .2), pad = new THREE.Mesh(new THREE.CircleGeometry(9 + (k % 2) * 3, 12, .5, 5.6), new THREE.MeshLambertMaterial({ color: 0x5fbf4a, emissive: 0x10300c }));
      flat(pad); pad.position.set(x + Math.cos(a) * rr, g0 + 20.6, z + Math.sin(a) * rr); scene.add(pad); roadObjs.push(pad);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), k % 2 ? pink : stone); fl.position.set(pad.position.x + 2, g0 + 22.5, pad.position.z); scene.add(fl); roadObjs.push(fl); }   // lily pads with a flower
    add(new THREE.Mesh(new THREE.CylinderGeometry(15, 24, 52, 24), stone), 46);   // the pedestal
    add(new THREE.Mesh(new THREE.TorusGeometry(19, 3.5, 8, 24), pink), 30).rotation.x = Math.PI / 2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(60, 20, 18, 40), stone), 80);   // the big bowl
    add(new THREE.Mesh(new THREE.TorusGeometry(59, 4, 8, 48), pink), 89).rotation.x = Math.PI / 2;
    add(flat(new THREE.Mesh(new THREE.CircleGeometry(56, 40), water)), 88);
    fall(61, 74, 68, 55);   // water spilling over it all round, into the pool
    add(new THREE.Mesh(new THREE.CylinderGeometry(8, 13, 38, 18), stone), 106);
    add(new THREE.Mesh(new THREE.CylinderGeometry(28, 9, 12, 28), stone), 128);   // the little top bowl
    add(new THREE.Mesh(new THREE.TorusGeometry(27, 3, 8, 32), pink), 134).rotation.x = Math.PI / 2;
    add(flat(new THREE.Mesh(new THREE.CircleGeometry(25, 28), water)), 133.5);
    fall(28, 36, 44, 112);
    add(new THREE.Mesh(new THREE.SphereGeometry(8, 16, 12), gold), 140);   // a gold ball on top, with the jet rising out of it
    const jt = fallTex(); jt.repeat.set(2, 1); const jet = add(new THREE.Mesh(new THREE.CylinderGeometry(2, 6, 46, 14, 1, true), new THREE.MeshBasicMaterial({ map: jt, transparent: true, depthWrite: false, side: THREE.DoubleSide })), 166); falls.push({ tx: jt, sp: -1.6 });
    for (let k = 0; k < 8; k++) {   // little arcs of water from the rim, into the pool
      const a = k / 8 * 6.283 + .2, c = Math.cos(a), s2 = Math.sin(a), at = (r, y) => new THREE.Vector3(x + c * r, g0 + y, z + s2 * r);
      const tx = fallTex(); tx.repeat.set(4, 1); tx.rotation = Math.PI / 2; const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(at(R - 6, 26), at(R - 22, 64), at(R - 38, 21)), 16, 2.6, 6), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
      scene.add(m); roadObjs.push(m); falls.push({ tx, sp: 1.2, u: true }); }
    const ND = 90, pos = new Float32Array(ND * 3), pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xeaf8ff, size: 4, transparent: true, opacity: .85, depthWrite: false }));
    pts.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3)); pts.frustumCulled = false; scene.add(pts); roadObjs.push(pts);
    const drops = Array.from({ length: ND }, (_, k) => ({ a: Math.random() * 6.283, ph: Math.random(), sp: .7 + Math.random() * .5, top: k < 40, r: Math.random() }));
    return { plaza, falls, wtx, pts, pos, drops, x, z, g0, R };
  }
  // 🎈 Pets Park's big things in 3D: the pink-and-white gazebos and the hot-air balloons
  function iglooTex() {   // rows of snow blocks
    return ctex(256, 128, (g, W, H) => { g.fillStyle = "#f4f9ff"; g.fillRect(0, 0, W, H); g.strokeStyle = "#b8cce4"; g.lineWidth = 3;
      for (let r = 0; r < 6; r++) { const y = r * H / 6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let c = 0; c < 8; c++) { const x = c * W / 8 + (r % 2) * W / 16; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + H / 6); g.stroke(); } } });
  }
  function iceBrickTex(windows) {   // frosty ice bricks; towers get arched windows that glow soft blue at night (the glow map lights only them)
    const draw = (g, W, H, glow) => { g.fillStyle = glow ? "#3a4a68" : "#e8f4ff"; g.fillRect(0, 0, W, H);
      if (!glow) { g.strokeStyle = "#a9c6ea"; g.lineWidth = 2; for (let r = 0; r < 8; r++) { const y = r * H / 8; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let c = 0; c < 6; c++) { const x = c * W / 6 + (r % 2) * W / 12; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + H / 8); g.stroke(); } }
        g.fillStyle = "rgba(255,255,255,.5)"; for (let k = 0; k < 30; k++) g.fillRect((k * 53) % W, (k * 97) % H, 6, 2); }
      if (windows) for (const x of [W * .25, W * .75]) { g.fillStyle = glow ? "#fff" : "#7fd8ff"; g.beginPath(); g.moveTo(x - 12, H * .62); g.lineTo(x - 12, H * .4); g.arc(x, H * .4, 12, Math.PI, 0); g.lineTo(x + 12, H * .62); g.closePath(); g.fill(); } };
    const mk = glow => ctex(256, 256, (g, W, H) => draw(g, W, H, glow), true);
    return { map: mk(false), glow: mk(true) };
  }
  let castleT = null;
  // 🌉 rope bridges: the one you drive across (planks on two ropes, no railings, tall log posts at each end), and others hung across the ravines far below
  function plankBridge(pts, half, rail) {   // pts: [x, y, z, ang] along the deck (rail: posts and a handrail along both sides)
    const wood = [new THREE.MeshLambertMaterial({ color: 0xa0703c, emissive: 0x201004 }), new THREE.MeshLambertMaterial({ color: 0x8a5a2e, emissive: 0x1a0c02 })], rope = new THREE.MeshLambertMaterial({ color: 0xc8b48a, emissive: 0x201a10 });
    const n = pts.length, geo = new THREE.BoxGeometry(1, 1, 1), ms = wood.map(m => new THREE.InstancedMesh(geo, m, n)), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), U = new THREE.Vector3(0, 1, 0), cnt = [0, 0];
    pts.forEach(([x, y, z, a], k) => { const w = k % 2; Q.setFromAxisAngle(U, -a); M.compose(new THREE.Vector3(x, y - 2, z), Q, new THREE.Vector3(7.5, 4, half * 2 * (.94 + ((k * 37) % 7) / 60))); ms[w].setMatrixAt(cnt[w]++, M); });
    ms.forEach((m, w) => { m.count = cnt[w]; scene.add(m); roadObjs.push(m); });
    for (const sd of [-1, 1]) { const c = pts.map(([x, y, z, a]) => new THREE.Vector3(x - Math.sin(a) * sd * half, y, z + Math.cos(a) * sd * half)); if (c.length < 2) continue;
      const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(c), c.length * 2, 1.6, 6), rope); scene.add(t); roadObjs.push(t);
      if (rail) { const hr = c.map(v => v.clone().setY(v.y + 26)), tr = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hr), hr.length * 2, 2.6, 6), wood[1]); scene.add(tr); roadObjs.push(tr);
        const pg = new THREE.CylinderGeometry(2.4, 2.8, 30, 6); c.forEach((v, k) => { if (k % 3) return; const pm = new THREE.Mesh(pg, wood[1]); pm.position.set(v.x, v.y + 13, v.z); scene.add(pm); roadObjs.push(pm); }); } }
    if (rail && pts.length > 2) {   // stilts down to the forest floor
      const st = new THREE.MeshLambertMaterial({ color: 0x4a3626, emissive: 0x0c0804 }); pts.forEach(([x, y, z, a], k) => { if (k % 6) return; for (const sd of [-1, 1]) { const px = x - Math.sin(a) * sd * (half - 6), pz = z + Math.cos(a) * sd * (half - 6), g = h(px, pz), L2 = y - g; if (L2 < 20) continue; const m = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, L2, 6), st); m.position.set(px, g + L2 / 2, pz); scene.add(m); roadObjs.push(m); } }); }
  }
  function buildRopeBridges(t) {
    const N = t.N, P = t.PTS, ang = i => { const a = P[(i + N - 1) % N], b = P[(i + 1) % N]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const post = new THREE.MeshLambertMaterial({ color: 0x6b4426, emissive: 0x140802 }), snow = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e });
    for (const g of bridgeG) { const half = g.deck + 6, pts = []; if (g.rail) { /* (railed walkway) */ }
      for (let i = g.a - 1; i <= g.b + 1; i++) { const p = P[i % N]; pts.push([p[0], RE[i % N], p[1], ang(i)]); }
      plankBridge(pts, half, g.rail);
      for (const i of [g.a - 1, g.b + 1]) for (const sd of [-1, 1]) { const p = P[i % N], a = ang(i), x = p[0] - Math.sin(a) * sd * (half + 4), z = p[1] + Math.cos(a) * sd * (half + 4), y = RE[i % N];
        const m = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 60, 10), post); m.position.set(x, y + 22, z); scene.add(m); roadObjs.push(m);
        const c = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 6, 0, 6.3, 0, 1.6), snow); c.position.set(x, y + 52, z); scene.add(c); roadObjs.push(c); } }
    for (const b of t.bridges3d || []) { const i = b.ri % N, p = P[i], a = ang(i) + Math.PI / 2, y0 = RE[i] + b.dy, pts = [];   // across the ravine, sagging in the middle
      for (let s2 = -b.len / 2; s2 <= b.len / 2; s2 += 8) { const f = s2 / (b.len / 2); pts.push([p[0] + Math.cos(a) * s2, y0 - (1 - f * f) * 26, p[1] + Math.sin(a) * s2, a]); }
      plankBridge(pts, 22); }
  }
  // ❄ Mount El Nath's big pieces
  function riverTex() { return ctex(256, 256, (g, W) => { g.fillStyle = "#9fd2f2"; g.fillRect(0, 0, W, W); g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 2;
    for (let k = 0; k < 24; k++) { let x = Math.random() * W, y = Math.random() * W; g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 4; q++) { x += (Math.random() - .5) * 60; y += (Math.random() - .5) * 60; g.lineTo(x, y); } g.stroke(); } }, true); }
  function snowballModel(stone) {   // a giant lumpy snowball, a few sticks and pebbles frozen into it (or a mossy stone ball)
    const g = new THREE.Group(), sn = stone ? new THREE.MeshLambertMaterial({ map: rockTex(), color: 0x9a968a, emissive: 0x141210, flatShading: true }) : new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e, flatShading: true }), geo = new THREE.IcosahedronGeometry(30, 2), pa = geo.attributes.position;
    for (let v = 0; v < pa.count; v++) { const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v), k = 1 + .08 * Math.sin(x * .3 + y * .2) * Math.cos(z * .25); pa.setXYZ(v, x * k, y * k, z * k); } geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, sn)); const dark = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
    for (let k = 0; k < 5; k++) { const a = k * 1.3, b = k * .9, m = new THREE.Mesh(new THREE.SphereGeometry(3, 6, 4), dark); m.position.set(Math.cos(a) * Math.sin(b) * 30, Math.cos(b) * 30, Math.sin(a) * Math.sin(b) * 30); g.add(m); }
    return g;
  }
  function buildIcefall(f) {   // 🧊 a huge frozen waterfall pouring down a rock cliff: the cliff face, a curtain of blue ice trickling slowly down it, icicles along the lip, snow on top, a heap of ice at its foot
    const bot = h(f.x, f.y) - 30, H = f.height || 380, top = bot + H, W = f.w || 160, CW = W * 4.2, grp = new THREE.Group();
    const rockG = new THREE.BoxGeometry(CW, H, W * 1.4, 14, 10, 2), pa = rockG.attributes.position;   // the cliff: lumpy, faceted rock
    for (let v = 0; v < pa.count; v++) { const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v), n = Math.sin(x * .05 + y * .03) * 14 + Math.sin(x * .013 - y * .021) * 22; if (z > 0) pa.setZ(v, z + n * (1 - Math.abs(x) / CW)); pa.setX(v, x + Math.sin(y * .04) * 10); }
    rockG.computeVertexNormals(); const rock = new THREE.Mesh(rockG, new THREE.MeshLambertMaterial({ map: cliffMats("snow").fill, color: 0xb8c2d8, emissive: 0x141a24, flatShading: true })); rock.position.set(0, bot + H / 2, -W * .5); grp.add(rock);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(CW + 30, 26, W * 1.6), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e })); cap.position.set(0, top + 8, -W * .5); grp.add(cap);
    for (let k = 0; k < 9; k++) { const sx = (k / 8 - .5) * CW, b = new THREE.Mesh(new THREE.SphereGeometry(30 + (k % 3) * 10, 10, 6), cap.material); b.scale.y = .55; b.position.set(sx, top + 16, -W * .2); grp.add(b); }   // soft snow drifts along the top
    const tx = ctex(128, 256, (g, w2, h2) => { const gr = g.createLinearGradient(0, 0, w2, 0); gr.addColorStop(0, "#7fc4ee"); gr.addColorStop(.5, "#e0f6ff"); gr.addColorStop(1, "#7fc4ee"); g.fillStyle = gr; g.fillRect(0, 0, w2, h2);
      for (let k = 0; k < 60; k++) { const x = Math.random() * w2, y = Math.random() * h2, l = 30 + Math.random() * 80; g.strokeStyle = `rgba(255,255,255,${.3 + Math.random() * .5})`; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 6, y + l); g.stroke(); } }, true);
    tx.repeat.set(2, H / 260); flowM.push(tx);
    const sheetG = new THREE.CylinderGeometry(W * .7, W * 1.05, H, 24, 10, true, -1.1, 2.2), sp = sheetG.attributes.position;   // the falls bulge out at the bottom, rippling as they go
    for (let v = 0; v < sp.count; v++) { const y = sp.getY(v), x = sp.getX(v); sp.setX(v, x * (1 + .1 * Math.sin(y * .04))); sp.setZ(v, sp.getZ(v) * (1 + .08 * Math.sin(x * .1 + y * .02))); }
    sheetG.computeVertexNormals(); const sheet = new THREE.Mesh(sheetG, new THREE.MeshLambertMaterial({ map: tx, emissive: 0x3a6a9a, side: THREE.DoubleSide })); sheet.position.set(0, bot + H / 2, -W * .55); grp.add(sheet);
    const icy = new THREE.MeshLambertMaterial({ color: 0xe8f6ff, emissive: 0x4a7aa0, transparent: true, opacity: .9 });
    for (let k = 0; k < 26; k++) { const x = (k / 25 - .5) * CW, l = 18 + (k * 37 % 5) * 10, ic = new THREE.Mesh(new THREE.ConeGeometry(5, l, 6), icy); ic.rotation.x = Math.PI; ic.position.set(x, top - 6 - l / 2, W * .25 + Math.abs(x) * .0); grp.add(ic); }
    const heap = new THREE.Mesh(new THREE.SphereGeometry(W * 1.1, 18, 8, 0, 6.3, 0, 1.4), new THREE.MeshLambertMaterial({ color: 0xcfeaff, emissive: 0x3a5a7a, flatShading: true })); heap.scale.set(1.3, .3, .8); heap.position.set(0, bot + 20, W * .3); grp.add(heap);
    grp.position.set(f.x, 0, f.y); grp.rotation.y = f.faceTo ? Math.atan2(f.faceTo[0] - f.x, f.faceTo[1] - f.y) : 0; scene.add(grp); roadObjs.push(grp);
  }
  function buildCliffWall(t, l) {   // the mountain's rock face along Sharp Cliff, on the side away from the drop
    const CL = cliffMats("snow"), N = t.N, P = t.PTS, off = -l.side * (t.ROAD / 2 + t.CURB + 26), pts = [];
    for (let i = l.a; i <= l.b; i += 2) { const a = P[(i + N - 1) % N], b = P[(i + 1) % N], ln = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / ln, ty = (b[1] - a[1]) / ln, p = P[i % N]; pts.push([p[0] - ty * off, p[1] + tx * off, RE[i % N]]); }
    const pos = [], uv = [], ix = []; let arc = 0;
    pts.forEach((q, k) => { if (k) arc += Math.hypot(q[0] - pts[k - 1][0], q[1] - pts[k - 1][1]); const top = q[2] + 160 + 22 * Math.sin(k * .21) + 10 * Math.sin(k * .53); pos.push(q[0], q[2] - 6, q[1], q[0], top, q[1]); uv.push(arc / 300, 0, arc / 300, (top - q[2]) / 100); if (k) { const a = (k - 1) * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: CL.fill, side: THREE.DoubleSide, emissive: 0x141a24 })); scene.add(m); roadObjs.push(m);
    const tp = pts.map((q, k) => new THREE.Vector3(q[0], q[2] + 160 + 22 * Math.sin(k * .21) + 10 * Math.sin(k * .53), q[1]));   // a fat lip of snow along its top
    const lip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tp), tp.length * 2, 12, 8), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e })); scene.add(lip); roadObjs.push(lip);
    if (l.fade) {   // and on the drop side, the cliff face falling sheer below the road's edge, icicles hanging off it
      const off2 = l.side * (t.ROAD / 2 + t.CURB + 16), dp = [], du = [], di = []; let a2 = 0, prev = null; const top2 = [];
      for (let i = l.a; i <= l.b; i += 2) { const a = P[(i + N - 1) % N], b = P[(i + 1) % N], ln = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / ln, ty = (b[1] - a[1]) / ln, p = P[i % N], x = p[0] - ty * off2, z = p[1] + tx * off2, y = RE[i % N];
        if (prev) a2 += Math.hypot(x - prev[0], z - prev[1]); prev = [x, z]; dp.push(x, y + 2, z, x, y - (l.drop ?? 260) * .9, z); du.push(a2 / 300, 0, a2 / 300, -(l.drop ?? 260) * .9 / 100); top2.push(new THREE.Vector3(x, y + 4, z)); const k = dp.length / 6 - 1; if (k) { const q = (k - 1) * 2; di.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } }
      const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.Float32BufferAttribute(dp, 3)); g2.setAttribute("uv", new THREE.Float32BufferAttribute(du, 2)); g2.setIndex(di); g2.computeVertexNormals();
      const face = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ map: CL.fill, side: THREE.DoubleSide, emissive: 0x141a24 })); scene.add(face); roadObjs.push(face);
      const icy = new THREE.MeshLambertMaterial({ color: 0xe8f6ff, emissive: 0x4a6a8a, transparent: true, opacity: .9 });
      top2.forEach((v, k) => { if (k % 2) return; const ln = 14 + (k * 37 % 5) * 8, ic = new THREE.Mesh(new THREE.ConeGeometry(3.5, ln, 6), icy); ic.rotation.x = Math.PI; ic.position.set(v.x, v.y - 6 - ln / 2, v.z); scene.add(ic); roadObjs.push(ic); });
    }
  }
  function buildCableCar(c) {   // 🚡 a cable car up the mountain: snowy stations top and bottom, steel pylons, two cables, cute red gondolas gliding up and down
    const A = new THREE.Vector3(c.a[0], h(c.a[0], c.a[1]), c.a[1]), B = new THREE.Vector3(c.b[0], h(c.b[0], c.b[1]), c.b[1]), steel = new THREE.MeshLambertMaterial({ color: 0x5a6070, emissive: 0x101418 });
    const snow = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e }), wood = new THREE.MeshLambertMaterial({ color: 0x8a5a32, emissive: 0x1a0a04 }), red = new THREE.MeshLambertMaterial({ color: 0xd8352d, emissive: 0x2a0606 });
    const dir = new THREE.Vector3(B.x - A.x, 0, B.z - A.z).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x), yaw = Math.atan2(dir.x, dir.z), add = m => { scene.add(m); roadObjs.push(m); return m; };
    const station = (P, back) => { const g = new THREE.Group(), bx = new THREE.Mesh(new THREE.BoxGeometry(110, 60, 90), wood); bx.position.y = 30; g.add(bx); const rf = new THREE.Mesh(new THREE.BoxGeometry(124, 14, 104), snow); rf.position.y = 66; g.add(rf);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(26, 4, 8, 20), steel); wheel.rotation.x = Math.PI / 2; wheel.position.y = 82; g.add(wheel); g.position.copy(P); g.rotation.y = yaw; add(g); };
    station(A); station(B);
    const top = 90, L = A.distanceTo(B), n = Math.max(2, Math.round(L / 320)), cab = (u) => { const p = A.clone().lerp(B, u); return p; };
    let maxClear = 0; for (let k = 1; k < n; k++) { const p = cab(k / n), g = h(p.x, p.z); maxClear = Math.max(maxClear, g - p.y); }
    const lift = Math.max(top, maxClear + top);   // (the cable runs high enough to clear the slope between the stations)
    for (let k = 1; k < n; k++) { const p = cab(k / n), g = h(p.x, p.z), hh = p.y + lift - g, pl = new THREE.Group();
      for (const sd of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(5, hh, 5), steel); leg.position.set(sd * 14, hh / 2, 0); leg.rotation.z = sd * .08; pl.add(leg); }
      for (let y = 20; y < hh; y += 34) { const cr = new THREE.Mesh(new THREE.BoxGeometry(26, 3, 3), steel); cr.position.y = y; pl.add(cr); }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(60, 6, 6), steel); arm.position.y = hh; pl.add(arm); pl.position.set(p.x, g, p.z); pl.rotation.y = yaw + Math.PI / 2; add(pl); }
    const a0 = A.clone(), b0 = B.clone(); a0.y += lift; b0.y += lift;
    for (const sd of [-1, 1]) { const off = side.clone().multiplyScalar(sd * 26), pts = [];
      for (let k = 0; k <= 20; k++) { const u = k / 20, p = a0.clone().lerp(b0, u).add(off); p.y -= Math.sin(Math.PI * ((u * n) % 1)) * 10; pts.push(p); }
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 1.4, 5), steel)); }
    const line = { a: a0.clone().setY(a0.y - 34), b: b0.clone().setY(b0.y - 34), off: side.clone().multiplyScalar(26) };
    for (let k = 0; k < 6; k++) { const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(30, 26, 30), red); g.add(body);
      const win = new THREE.Mesh(new THREE.BoxGeometry(31, 10, 31), new THREE.MeshBasicMaterial({ color: 0xffe9a0 })); win.position.y = 3; g.add(win);
      const rf = new THREE.Mesh(new THREE.BoxGeometry(34, 6, 34), snow); rf.position.y = 16; g.add(rf); const hang = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2), steel); hang.position.y = 28; g.add(hang);
      g.rotation.y = yaw; add(g); gondM.push({ g, line, sp: .05, ph: k / 3 }); }
  }
  function buildTrunk(T0) {   // 🌳 the giant haunted tree: a huge gnarled trunk of dark bark with roots spreading out, glowing fungus on it, dead branches up top hung with moss
    const g0 = h(T0.x, T0.y), grp = new THREE.Group(), R = T0.r, H = T0.h || 500;
    const bark = ctex(256, 512, (g, W, Hh) => { g.fillStyle = "#3a2c22"; g.fillRect(0, 0, W, Hh); for (let k = 0; k < 90; k++) { const x = Math.random() * W; g.strokeStyle = `rgba(${20 + Math.random() * 30},${14 + Math.random() * 20},${10 + Math.random() * 14},.8)`; g.lineWidth = 2 + Math.random() * 6; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y < Hh; y += 40) g.lineTo(x + Math.sin(y * .02 + k) * 10, y); g.stroke(); }
      for (let k = 0; k < 30; k++) { g.fillStyle = "rgba(90,120,60,.35)"; g.beginPath(); g.ellipse(Math.random() * W, Math.random() * Hh, 10 + Math.random() * 20, 6 + Math.random() * 10, 0, 0, 7); g.fill(); } }, true);
    bark.repeat.set(4, 2); const bm = new THREE.MeshLambertMaterial({ map: bark, emissive: 0x0a0806 });
    const tg = new THREE.CylinderGeometry(R * .82, R * 1.08, H, 28, 12), pa = tg.attributes.position;
    for (let v = 0; v < pa.count; v++) { const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v), a = Math.atan2(z, x), k = 1 + .07 * Math.sin(a * 5 + y * .01) + .05 * Math.sin(a * 11 - y * .02); pa.setX(v, x * k); pa.setZ(v, z * k); }
    tg.computeVertexNormals(); const trunk = new THREE.Mesh(tg, bm); trunk.position.y = H / 2 - 20; grp.add(trunk);
    for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283 + .3, root = new THREE.Mesh(new THREE.CylinderGeometry(R * .06, R * .2, R * .9, 8), bm); root.position.set(Math.cos(a) * R * 1.05, 10, Math.sin(a) * R * 1.05); root.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25); grp.add(root); }
    const fun = [0x9aff7a, 0xc07aff, 0x7af0ff]; for (let k = 0; k < 26; k++) { const a = Math.random() * 6.283, y = 20 + Math.random() * (H - 80), m = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 8, 10, 6, 0, 6.283, 0, 1.4), new THREE.MeshBasicMaterial({ color: fun[k % 3] })); m.scale.y = .35; m.position.set(Math.cos(a) * R * .98, y, Math.sin(a) * R * .98); m.rotation.z = Math.cos(a) * 1.4; m.rotation.x = -Math.sin(a) * 1.4; grp.add(m); }   // glowing fungus
    for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, br = new THREE.Mesh(new THREE.CylinderGeometry(6, 18, R * 1.6, 6), bm); br.position.set(Math.cos(a) * R * .9, H - 40 + (k % 3) * 30, Math.sin(a) * R * .9); br.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1); grp.add(br); }   // bare branches reaching out
    const moss = new THREE.MeshLambertMaterial({ color: 0x3a4a30, emissive: 0x080c06, transparent: true, opacity: .85, side: THREE.DoubleSide });
    for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283, m = new THREE.Mesh(new THREE.PlaneGeometry(14, 70 + (k % 4) * 20), moss); m.position.set(Math.cos(a) * R * 1.3, H - 90, Math.sin(a) * R * 1.3); m.rotation.y = -a; grp.add(m); }   // hanging moss
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.3, 18, 10), new THREE.MeshLambertMaterial({ color: 0x24301e, emissive: 0x060a04, flatShading: true })); cap.scale.y = .45; cap.position.y = H + 30; grp.add(cap);   // a dark crown of leaves
    grp.position.set(T0.x, g0, T0.y); scene.add(grp); roadObjs.push(grp);
  }
  function buildTemple(t, T0) {   // 🛕 Golem's Temple: a stepped pyramid of mossy stone over the passage, a carved doorway at each end with glowing eyes above it, torches, a shrine with a cursed green flame on top
    const P = t.PTS, N = t.N, pa = P[T0.a % N], pb = P[T0.b % N], dx = pb[0] - pa[0], dz = pb[1] - pa[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, cx = (pa[0] + pb[0]) / 2, cz = (pa[1] + pb[1]) / 2;
    let lo = 1e9, hi = -1e9; for (let i = T0.a; i <= T0.b; i++) { lo = Math.min(lo, RE[i % N]); hi = Math.max(hi, RE[i % N]); }
    const R0 = t.ROAD / 2 + t.CURB + 14, gapH = R0 + 30, base = lo - 40, clear = hi - base + (R0 + 16) * .95 + 14;
    const st = new THREE.MeshLambertMaterial({ map: rockTex(), color: 0xd8d0b8, emissive: 0x3a362c }), moss = new THREE.MeshLambertMaterial({ color: 0x5a8a44, emissive: 0x16240e });
    const grp = new THREE.Group(), box = (w, hh, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m || st); b.position.set(x, y, z); grp.add(b); return b; };
    const TH = 46; for (let k = 0; k < 9; k++) { const Wk = 2 * gapH + 2 * Math.max(40, 300 - k * 34), Lk = L + 140 - k * 40, yb = k * TH; if (Lk < 120) break;
      if (yb < clear) { const sw = Wk / 2 - gapH; for (const sd of [-1, 1]) { box(Lk, TH, sw, 0, yb + TH / 2, sd * (gapH + sw / 2)); box(Lk + 4, 6, sw + 4, 0, yb + TH - 1, sd * (gapH + sw / 2), moss); } }
      else { box(Lk, TH, Wk, 0, yb + TH / 2, 0); box(Lk + 4, 6, Wk + 4, 0, yb + TH - 1, 0, moss); } }
    const topY = Math.ceil(clear / TH) * TH + 4 * TH; box(90, 50, 90, 0, topY + 25, 0); const flame = new THREE.Mesh(new THREE.ConeGeometry(16, 50, 8), new THREE.MeshBasicMaterial({ color: 0x7aff6a, transparent: true, opacity: .85 })); flame.position.set(0, topY + 75, 0); grp.add(flame);   // the shrine and its cursed flame
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xff3a2a }), glowM = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: .3 }), fire = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    for (const sd of [-1, 1]) { const x = sd * (L / 2 + 70), yTop = clear + 6;   // each doorway: a heavy lintel, two pillars, eyes above, torches either side
      box(30, 40, 2 * gapH + 40, x, yTop + 20, 0); for (const z of [-1, 1]) box(34, yTop, 30, x, yTop / 2, z * (gapH + 12));
      for (const z of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(6, 14, 26), eyeM); e.position.set(x + sd * 18, yTop + 70, z * 40); grp.add(e); const g2 = new THREE.Mesh(new THREE.SphereGeometry(24, 10, 8), glowM); g2.position.copy(e.position); grp.add(g2);
        const tc = box(8, 50, 8, x + sd * 14, 25, z * (gapH + 40)); const f = new THREE.Mesh(new THREE.ConeGeometry(7, 18, 6), fire); f.position.set(x + sd * 14, 60, z * (gapH + 40)); grp.add(f); } }
    grp.position.set(cx, base, cz); grp.rotation.y = -Math.atan2(uz, ux); scene.add(grp); roadObjs.push(grp);
  }
  function buildDam(b, t) {   // 🌊 the dam: a tall concrete wall with buttresses, a railed walkway on top under thick snow, and half-frozen waterfalls pouring down its road side, icicles hanging off the lip
    const g0 = h(b.x, b.y), grp = new THREE.Group(), a = b.a || 0, nx = -Math.sin(a), nz = Math.cos(a);
    let bd = 1e12, bp = null; for (let i = 0; i < t.N; i += 3) { const p = t.PTS[i], d = (p[0] - b.x) ** 2 + (p[1] - b.y) ** 2; if (d < bd) { bd = d; bp = p; } }
    const sg = Math.sign((bp[0] - b.x) * nx + (bp[1] - b.y) * nz) || 1, H = b.h, W = b.w, D = b.d;
    const tx = damTex().clone(); tx.needsUpdate = true; tx.repeat.set(Math.max(1, W / 220), Math.max(1, H / 220));
    const conc = new THREE.MeshLambertMaterial({ map: tx, emissive: 0x2a2a30 }), dark = new THREE.MeshLambertMaterial({ color: 0x8a8a90, emissive: 0x1a1a20 }), snow = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e });
    const put = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); grp.add(o); return o; };
    put(new THREE.BoxGeometry(W, H, D), conc, 0, H / 2, 0);
    for (let x = -W / 2 + 30; x <= W / 2 - 30; x += 90) { const bt = put(new THREE.BoxGeometry(22, H, 26), dark, x, H / 2, sg * (D / 2 + 9)); bt.scale.y = 1; }   // buttresses
    put(new THREE.BoxGeometry(W + 8, 10, D + 16), snow, 0, H + 4, 0);   // snow on the walkway
    for (let x = -W / 2; x <= W / 2; x += 18) put(new THREE.BoxGeometry(2, 14, 2), dark, x, H + 15, sg * (D / 2 + 4));   // the railing
    put(new THREE.BoxGeometry(W, 2, 2), dark, 0, H + 22, sg * (D / 2 + 4));
    const fall = ctex(128, 256, (g, w2, h2) => { g.fillStyle = "rgba(190,230,255,.75)"; g.fillRect(0, 0, w2, h2); for (let k = 0; k < 90; k++) { const x = Math.random() * w2, y = Math.random() * h2, l = 20 + Math.random() * 60; g.strokeStyle = `rgba(255,255,255,${.4 + Math.random() * .5})`; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + l); g.stroke(); } }, true);
    flowM.push(fall.offset ? fall : fall);
    const fm = new THREE.MeshLambertMaterial({ map: fall, transparent: true, opacity: .9, emissive: 0x3a5a7a, side: THREE.DoubleSide, depthWrite: false });
    for (let x = -W / 2 + 75; x <= W / 2 - 60; x += 90) { const cw = 46, pl = put(new THREE.PlaneGeometry(cw, H - 6), fm, x, H / 2, sg * (D / 2 + 23)); if (sg < 0) pl.rotation.y = Math.PI;
      const pool = put(new THREE.CylinderGeometry(cw * .7, cw * .8, 8, 16), new THREE.MeshLambertMaterial({ color: 0xcfeaff, emissive: 0x3a5a7a }), x, 3, sg * (D / 2 + 30)); pool.scale.z = .6; }   // a frozen splash where each one lands
    const icy = new THREE.MeshLambertMaterial({ color: 0xe8f6ff, emissive: 0x4a6a8a, transparent: true, opacity: .9 });
    for (let x = -W / 2 + 6; x <= W / 2 - 6; x += 11) { const l = 10 + ((x * 7) % 13 + 13) % 13 * 2, ic = put(new THREE.ConeGeometry(2.6, l, 6), icy, x, H - l / 2 - 1, sg * (D / 2 + 1)); ic.rotation.x = Math.PI; }   // icicles off the lip
    grp.rotation.y = -a; grp.position.set(b.x, g0 - 4, b.y); scene.add(grp); roadObjs.push(grp);
  }
  function buildCastle(b) {   // 🏰 the ice castle round the rink: chubby round towers with snowy blue cone roofs and glowing windows, walls with battlements
    const tx = castleT || (castleT = { tower: iceBrickTex(true), wall: iceBrickTex(false) }), g0 = h(b.x, b.y), grp = new THREE.Group();
    const ice = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x4a6a98 }), snow = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x7a8498 }), roof = new THREE.MeshLambertMaterial({ color: 0x6aa0f0, emissive: 0x1a3a78 });
    if (b.castle === "tower") {
      const R = b.w / 2, Hh = b.h, m = tx.tower.map.clone(), gl = tx.tower.glow.clone(); for (const q of [m, gl]) { q.needsUpdate = true; q.repeat.set(2, Math.max(1, Hh / 90)); }
      const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.1, Hh, 24), new THREE.MeshLambertMaterial({ map: m, emissive: 0xbfeeff, emissiveMap: gl })); body.position.y = Hh / 2; grp.add(body);
      for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, c = new THREE.Mesh(new THREE.BoxGeometry(R * .38, 16, R * .3), ice); c.position.set(Math.cos(a) * R * .95, Hh + 8, Math.sin(a) * R * .95); c.rotation.y = -a; grp.add(c); }   // battlements
      const cone = new THREE.Mesh(new THREE.ConeGeometry(R * 1.12, R * 1.9, 24), roof); cone.position.y = Hh + 16 + R * .95; grp.add(cone);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(R * .62, R * 1.05, 24), snow); cap.position.y = Hh + 16 + R * 1.9 - R * .52; grp.add(cap);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 1.08, 5, 8, 24), snow); rim.rotation.x = Math.PI / 2; rim.position.y = Hh + 17; grp.add(rim);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 26, 6), new THREE.MeshLambertMaterial({ color: 0xd8d8e8 })); pole.position.y = Hh + 16 + R * 1.9 + 12; grp.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), new THREE.MeshBasicMaterial({ color: 0xff7ab8, side: THREE.DoubleSide })); flag.position.set(10, Hh + 16 + R * 1.9 + 20, 0); grp.add(flag);
    } else {
      const m = tx.wall.map.clone(); m.needsUpdate = true; m.repeat.set(Math.max(1, b.w / 90), Math.max(1, b.h / 90));
      const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ map: m, emissive: 0x4a6a98 })); body.position.y = b.h / 2; grp.add(body);
      for (let x = -b.w / 2 + 10; x <= b.w / 2 - 6; x += 26) { const c = new THREE.Mesh(new THREE.BoxGeometry(14, 14, b.d + 2), ice); c.position.set(x, b.h + 7, 0); grp.add(c); }
      const sn = new THREE.Mesh(new THREE.BoxGeometry(b.w + 4, 5, b.d + 6), snow); sn.position.y = b.h + 1; grp.add(sn);
    }
    grp.rotation.y = -(b.a || 0); grp.position.set(b.x, g0 - 2, b.y); scene.add(grp); roadObjs.push(grp);
  }
  // 💎 gems: faceted six-sided crystals, shiny and see-through, glowing a little from inside (the same look everywhere in the crystal cave)
  const gemMats = {};
  const gemMat = c => gemMats[c] || (gemMats[c] = new THREE.MeshPhongMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(.42), specular: 0xffffff, shininess: 160, flatShading: true, transparent: true, opacity: .86 }));
  const gemCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false });
  function gem(c, hh, r) {   // one crystal: a tapering hexagonal prism with a pointed tip and a bright core
    const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(r * .82, r, hh * .74, 6), gemMat(c)), tip = new THREE.Mesh(new THREE.ConeGeometry(r * .82, hh * .26, 6), gemMat(c)), core = new THREE.Mesh(new THREE.CylinderGeometry(r * .25, r * .32, hh * .7, 6), gemCore);
    body.position.y = hh * .37; tip.position.y = hh * .74 + hh * .13; core.position.y = hh * .36; tip.rotation.y = body.rotation.y = Math.PI / 6; g.add(body, tip, core); return g;
  }
  function gemCluster(c, H, R, seed = 0) {   // a big crystal with smaller ones leaning out round its foot
    const g = new THREE.Group(); g.add(gem(c, H, R));
    for (let k = 0; k < 4; k++) { const a = k * 1.57 + seed, s = gem(c, H * (.32 + (k % 2) * .14), R * (.42 + (k % 2) * .1)); s.position.set(Math.cos(a) * R * .9, -2, Math.sin(a) * R * .9); s.rotation.set(Math.sin(a) * .55, 0, -Math.cos(a) * .55); g.add(s); }
    return g;
  }
  const glowDisc = (() => { let t = null; return () => t || (t = ctex(64, 64, (g, W) => { const gr = g.createRadialGradient(W / 2, W / 2, 2, W / 2, W / 2, W / 2); gr.addColorStop(0, "rgba(255,255,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, W); })); })();
  function addGlow(x, y, z, r, c) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ map: glowDisc(), color: c, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, y + 1.2, z); scene.add(m); roadObjs.push(m); }
  // 🧊 El Nath's ice stones (maplestory.io) made solid: each picture's outline cut out and given thickness, the painting on its front and back, frosty bevelled ice round the sides
  let stoneKey = null, solidKey = null; const stoneGeos = new Map();
  function stoneGeo(im, dk = .34) {
    const ck = im.src + "|" + dk; if (stoneGeos.has(ck)) return stoneGeos.get(ck);
    const W = im.width, H = im.height, c = canvas(W, H), g = c.getContext("2d"); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, W, H).data, L = [], R = [];
    const ra = [], rb = []; for (let y = 0; y < H; y++) { let a = -1, b = -1; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 90) { if (a < 0) a = x; b = x; } ra.push(a); rb.push(b); }
    const rows = ra.map((a, y) => y).filter(y => ra[y] >= 0), y0 = rows[0], y1 = rows[rows.length - 1], avg = (arr, y, r) => { let sm = 0, n = 0; for (let j = Math.max(y0, y - r); j <= Math.min(y1, y + r); j++) if (arr[j] >= 0) { sm += arr[j]; n++; } return sm / n; };   // (a smooth outline: each side averaged over nearby rows)
    for (let y = y0; y <= y1; y = y < y1 && y + 5 > y1 ? y1 : y + 5) { L.push([avg(ra, y, 4) - W / 2, H - y]); R.push([avg(rb, y, 4) + 1 - W / 2, H - y]); if (y === y1) break; }
    const sh = new THREE.Shape(); L.forEach(([x, y], k) => k ? sh.lineTo(x, y) : sh.moveTo(x, y)); for (let k = R.length - 1; k >= 0; k--) sh.lineTo(R[k][0], R[k][1]); sh.closePath();
    let cr = 0, cg = 0, cb = 0, cn = 0; for (let q = 0; q < d.length; q += 16) if (d[q + 3] > 200) { cr += d[q]; cg += d[q + 1]; cb += d[q + 2]; cn++; }   // the sides: the picture's own average colour, a little darker
    const side = new THREE.Color(Math.min(1, cr / cn / 255 * 1.02), Math.min(1, cg / cn / 255 * 1.02), Math.min(1, cb / cn / 255 * 1.06)).convertSRGBToLinear();
    const D = W * dk, geo = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: true, bevelThickness: D * .18, bevelSize: W * .025, bevelSegments: 3, curveSegments: 1 }); geo.translate(0, 0, -D / 2);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.repeat.set(1 / W, 1 / H); tx.offset.set(.5, 0); tx.magFilter = THREE.NearestFilter;
    const mats = [new THREE.MeshLambertMaterial({ map: tx, alphaTest: .35, emissive: 0x1a2c48 }), new THREE.MeshLambertMaterial({ color: side, emissive: 0x101820, flatShading: true })];
    const r = { geo, mats, H }; stoneGeos.set(ck, r); return r;
  }
  function iceStone(im, x, z, y, hh, face, lean = 0, dk) {   // one solid stone, hh tall, its painted front facing the angle `face`
    const s = stoneGeo(im, dk), m = new THREE.Mesh(s.geo, s.mats), k = hh / s.H; m.scale.set(k, k, k); m.position.set(x, y - 3, z); m.rotation.set(lean, Math.PI / 2 - face, 0); scene.add(m); roadObjs.push(m); return m;
  }
  function buildSolids(t) {   // maplestory.io objects made solid (rocks, dead trees, ice stones), wherever the track put them
    for (const o of t.solids) { const y = o.ri != null ? RE[o.ri % t.N] + o.dy : h(o.x, o.y); iceStone(t.solidImgs[o.k], o.x, o.y, y, o.h, o.fa, 0, o.depth); if (o.cross) iceStone(t.solidImgs[o.k], o.x, o.y, y, o.h, o.fa + Math.PI / 2, 0, o.depth); }   // (a tree: two thin cut-outs crossed, so it's full from every side)
  }
  function buildIceStones(t) {
    const ims = t.iceStones; let sd0 = 47; const rr = () => (sd0 = (sd0 * 16807) % 2147483647) / 2147483647;
    for (const o of t.props3d || []) if (o.stone) { iceStone(ims[Math.abs(Math.round(o.x + o.y)) % 6], o.x, o.y, h(o.x, o.y), (o.h || 70) * 1.15, o.fa); addGlow(o.x, h(o.x, o.y), o.y, (o.h || 70) * .55, 0x9fd8ff); }   // the stones standing in the road
    for (const cv of t.caves || []) if (cv.crystal) {
      const W = cv.half || 160, pt = (i, o) => { const p = t.PTS[i % t.N], q = t.PTS[(i + 2) % t.N], a = Math.atan2(q[1] - p[1], q[0] - p[0]); return [p[0] - Math.sin(a) * o, p[1] + Math.cos(a) * o, RE[i % t.N], a]; };
      for (let i = cv.a + 12; i <= cv.b - 12; i += 16 + Math.floor(rr() * 24)) { const sd = rr() < .5 ? -1 : 1, sz = .5 + rr() * rr() * 1.4, [x, z, base, a] = pt(i, sd * (W - 18 - sz * 6));   // along the walls, all sizes, facing the road
        iceStone(ims[Math.floor(rr() * 6)], x, z, base, 40 + sz * 40, a - sd * Math.PI / 2 + (rr() - .5) * .6); }
      for (const i of [cv.a, cv.b]) for (const sd of [-1, 1]) { const [x, z, base, a] = pt(i, sd * (W + 40)); iceStone(ims[sd > 0 ? 5 : 3], x, z, base, 130, a + (i === cv.a ? Math.PI : 0)); }   // big stones guarding each entrance
    }
  }
  function rockyCave(t, cv) {   // a cave, not a tube: a wide floor, uneven walls bulging in and out, a lumpy high roof; a snowy rock hill over it
    const W = cv.half || 160, HT = cv.height || 150, N = t.N, P = t.PTS, K = 30, seed = 13;
    const build = (dw, dh, amp, sd2, mat) => { const pos = [], uv = [], ix = []; let rows = 0, L = 0, prev = null;
      for (let i = cv.a; i <= cv.b; i += 2, rows++) {
        const p = P[i % N], q = P[(i + 2) % N], a = Math.atan2(q[1] - p[1], q[0] - p[0]), base = RE[i % N], nx = -Math.sin(a), nz = Math.cos(a); if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p;
        const wR = W * (1 + .14 * (vnoise(L / 260, 3.1, seed) - .5) * 2) + dw, hH = HT * (1 + .16 * (vnoise(L / 300, 7.7, seed) - .5) * 2) + dh, ends = Math.min(1, (i - cv.a) / 10, (cv.b - i) / 10);
        const push = (o, y, u) => { pos.push(p[0] + nx * o, base + y, p[1] + nz * o); uv.push(u, L / 140); };
        push(wR * 1.02, -70, 0);   // a skirt down into the ground, so no daylight shows under the walls
        for (let k = 0; k <= K; k++) { const th = Math.PI * k / K, bump = 1 + amp * (vnoise(k * .55 + L / 90, L / 70 + k * .21, sd2) - .5) * 2 * (.4 + .6 * ends), ro = -Math.cos(th) * wR * bump, y = Math.sin(th) * hH * bump * (k === 0 || k === K ? 0 : 1);
          push(ro, y - 4, k / K * 4); }
        push(-wR * 1.02, -70, 4);
      }
      const R = K + 3; for (let r = 0; r < rows - 1; r++) for (let k = 0; k < R - 1; k++) { const a0 = r * R + k, b0 = a0 + R; ix.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); scene.add(m); roadObjs.push(m); };
    build(0, 0, .2, seed, new THREE.MeshLambertMaterial({ map: caveTex(), color: 0x6a80b8, emissive: 0x0a1838, flatShading: true, side: THREE.DoubleSide }));   // the inside: dark rock-ice, faceted and uneven
    build(48, 56, .1, seed + 5, new THREE.MeshLambertMaterial({ color: 0xeef5fc, emissive: 0x2a3a50, flatShading: true, side: THREE.DoubleSide }));   // the snowy hill over it
    crystalCave(t, cv, W, HT);
  }
  function crystalCave(t, cv, R0, HT = R0 * .72) {   // 💎 the crystal cave: crystal clusters along the foot of both walls lighting it, icicles hanging from the roof, a crown of big clusters on the hill outside and a crystal gateway at each end
    const cols = [0x7fe8ff, 0xc4a4ff, 0x9fd8ff, 0xffb0e8], place = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); roadObjs.push(m); return m; };
    const icy = new THREE.MeshPhongMaterial({ color: 0xeaf6ff, emissive: 0x4a6a90, specular: 0xffffff, shininess: 120, flatShading: true, transparent: true, opacity: .85 });
    const pt = (i, o) => { const p = t.PTS[i % t.N], q = t.PTS[(i + 2) % t.N], a = Math.atan2(q[1] - p[1], q[0] - p[0]); return [p[0] - Math.sin(a) * o, p[1] + Math.cos(a) * o, RE[i % t.N], a]; };
    if (!t.iceStones) { let sd0 = 31; const rr = () => (sd0 = (sd0 * 16807) % 2147483647) / 2147483647;   // crystals tucked against the walls, far from the road: uneven gaps, all sizes from little to big
      for (let i = cv.a + 12; i <= cv.b - 12; i += 14 + Math.floor(rr() * 22)) { const sd = rr() < .5 ? -1 : 1, c = cols[Math.floor(rr() * 4)], sz = .45 + rr() * rr() * 1.6, [x, z, base, a] = pt(i, sd * (R0 - 8 - sz * 4)), g = gemCluster(c, 34 * sz + 10, 6 * Math.sqrt(sz) + 2, rr() * 6);
        g.rotation.set(-Math.sin(a) * sd * .22, rr() * 6, Math.cos(a) * sd * .22); place(g, x, base - 4, z); if (sz > .9) addGlow(x - Math.sin(a) * -sd * 12, base, z + Math.cos(a) * -sd * 12, 18 + sz * 12, c); } }
    for (let i = cv.a + 10, n = 0; i <= cv.b - 10; i += 18, n++) for (const off of [-.5, .5]) { const [x, z, base] = pt(i, off * R0), hh = 18 + (n * 7 % 3) * 6, ic = new THREE.Mesh(new THREE.ConeGeometry(3.5 + (n % 2), hh, 6), icy);   // icicles over the sides of the road
      ic.rotation.x = Math.PI; place(ic, x, base + Math.sqrt(1 - off * off) * HT * .8 - 6 - hh / 2, z); }
    if (cv.crown) for (let i = cv.a + 20, n = 0; i <= cv.b - 20; i += 34, n++) { const [x, z, base, a] = pt(i, (n % 2 ? 1 : -1) * R0 * .25), g = gemCluster(0xcfe4ff, 110 + (n % 3) * 30, 14, n); g.rotation.y = n; place(g, x, base + HT + 30, z); }   // a crown of big clusters along the hilltop
    if (!t.iceStones) for (const i of [cv.a, cv.b]) for (const sd of [-1, 1]) { const [x, z, base, a] = pt(i, sd * (R0 + 60)), g = gemCluster(sd > 0 ? 0x9fd8ff : 0xc4a4ff, 90, 12, sd); g.rotation.set(Math.sin(a) * sd * .18, 0, -Math.cos(a) * sd * .18); place(g, x, base - 6, z); addGlow(x, base, z, 46, sd > 0 ? 0x9fd8ff : 0xc4a4ff); }   // the gateway
  }
  function buildAurora(t) {   // 🌌 the northern lights: green and pink curtains rippling slowly across the night sky
    const tex = ctex(256, 256, (g, W, H) => {   // curtains of light: bright rays (green below, fading to pink at the top) with dark gaps between them
      for (let x = 0; x < W; x++) { const b = Math.pow(Math.abs(Math.sin(x * .13) * Math.sin(x * .047 + 1.3)), .7) * (.55 + .45 * Math.sin(x * .021)), gr = g.createLinearGradient(0, H, 0, 0);
        gr.addColorStop(0, "rgba(80,255,160,0)"); gr.addColorStop(.1, `rgba(90,255,170,${b})`); gr.addColorStop(.45, `rgba(110,240,200,${b * .6})`); gr.addColorStop(.8, `rgba(230,120,255,${b * .45})`); gr.addColorStop(1, "rgba(255,120,220,0)");
        g.fillStyle = gr; g.fillRect(x, 0, 1, H); } }, true);
    const C = WORLD / 2;
    [0, 1, 2, 3, 4, 5].map(n => [n * 1.047 + (n % 2) * .2, 1650 + (n % 3) * 180, 1 + (n % 2) * .15, n * 1.7]).forEach(([a0, R, k, ph]) => {
      const S = 60, g = new THREE.PlaneGeometry(1, 1, S, 1), pa = g.attributes.position, base = []; R *= .78;
      for (let v = 0; v < pa.count; v++) { const u = pa.getX(v) + .5, top = pa.getY(v) > 0, a = a0 + (u - .5) * 1.25, rr = R + Math.sin(u * 7 + ph) * 160, x = C + Math.cos(a) * rr * 1.5, z = C + Math.sin(a) * rr * 1.5, y = (top ? 950 : 380) * k + Math.sin(u * 5 + ph) * 80;
        pa.setXYZ(v, x, y, z); base.push([x, y, z, u, top ? 1 : .4]); }
      tex.repeat.set(2, 1); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.frustumCulled = false; m.renderOrder = 0; scene.add(m); roadObjs.push(m); auroraM.push({ m, base, ph });
    });
  }
  function buildFairy(L, t) {   // ✨ strings of coloured fairy lights on posts round the rink
    const cols = [0xff6a8a, 0xffd23f, 0x7fe8ff, 0x9dff8a, 0xc49cff], bulbs = [];
    if (L.sides) {   // posts along the road's edges, the lights strung between neighbours
      for (const side of L.sides) { let prev = null; side.forEach(([x, z], k) => { const y = h(x, z), p = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 70, 6), new THREE.MeshLambertMaterial({ color: 0x5a4a6a })); p.position.set(x, y + 35, z); scene.add(p); roadObjs.push(p);
        if (prev) for (let j = 1; j < 8; j++) { const f = j / 8; bulbs.push([prev[0] + (x - prev[0]) * f, prev[1] + (y - prev[1]) * f + 68 - Math.sin(f * Math.PI) * 14, prev[2] + (z - prev[2]) * f, cols[(k * 7 + j) % cols.length]]); } prev = [x, y, z]; }); }
      const m = new THREE.InstancedMesh(new THREE.SphereGeometry(3.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length), M = new THREE.Matrix4(), C = new THREE.Color();
      bulbs.forEach(([x, y, z, c], i) => { M.makeTranslation(x, y, z); m.setMatrixAt(i, M); m.setColorAt(i, C.setHex(c)); }); scene.add(m); roadObjs.push(m); return;
    }
    const n = 16, posts = [];
    for (let k = 0; k < n; k++) { const a = k / n * 6.283, x = L.cx + Math.cos(a) * (L.rx + 26), z = L.cy + Math.sin(a) * (L.ry + 22), y = h(x, z); let md = 1e9; for (let i = 0; i < t.N; i += 2) md = Math.min(md, Math.hypot(t.PTS[i][0] - x, t.PTS[i][1] - z)); if (md < t.ROAD / 2 + t.CURB + 16) { posts.push(null); continue; } posts.push([x, y, z]);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 70, 6), new THREE.MeshLambertMaterial({ color: 0x5a4a6a })); p.position.set(x, y + 35, z); scene.add(p); roadObjs.push(p); }
    for (let k = 0; k < n; k++) { const A = posts[k], B = posts[(k + 1) % n]; if (!A || !B) continue;
      for (let j = 1; j < 10; j++) { const f = j / 10, x = A[0] + (B[0] - A[0]) * f, z = A[2] + (B[2] - A[2]) * f, y = A[1] + (B[1] - A[1]) * f + 68 - Math.sin(f * Math.PI) * 18; bulbs.push([x, y, z, cols[(k * 9 + j) % cols.length]]); } }
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(3.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length), M = new THREE.Matrix4(), C = new THREE.Color();
    bulbs.forEach(([x, y, z, c], i) => { M.makeTranslation(x, y, z); m.setMatrixAt(i, M); m.setColorAt(i, C.setHex(c)); }); scene.add(m); roadObjs.push(m);
  }
  function freezieModel() {   // 🧊 a cute living ice block: a soft, squishy marshmallow-cube of ice, big sparkly eyes, rosy cheeks, a tiny smile, a little frosty tuft and stubby feet
    const g = new THREE.Group(), S1 = new THREE.SphereGeometry(1, 16, 12), bk = new THREE.MeshBasicMaterial({ color: 0x1a2a48 }), wh = new THREE.MeshBasicMaterial({ color: 0xffffff }), pink = new THREE.MeshBasicMaterial({ color: 0xff9ac4 });
    const ice = new THREE.MeshLambertMaterial({ color: 0xc8eeff, emissive: 0x4a8ac0, transparent: true, opacity: .94 });
    const bg = new THREE.SphereGeometry(1, 32, 24), pa = bg.attributes.position;   // a rounded cube: a sphere pushed out towards its corners
    for (let v = 0; v < pa.count; v++) { const f = q => Math.sign(q) * Math.pow(Math.abs(q), .55); pa.setXYZ(v, f(pa.getX(v)), f(pa.getY(v)), f(pa.getZ(v))); }
    bg.computeVertexNormals(); const body = new THREE.Mesh(bg, ice); body.scale.set(22, 20, 22); body.position.y = 24; g.add(body);
    const shine = new THREE.Mesh(S1, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 })); shine.scale.set(3, 6, 2); shine.position.set(14, 36, -15); shine.rotation.x = .4; g.add(shine);
    for (const [x, z, hh, r] of [[0, 0, 12, 5], [-5, 6, 8, 4], [4, -6, 9, 4]]) { const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 8), ice); c.position.set(x, 43 + hh / 2 - 1, z); c.rotation.set(z * .04, 0, -x * .05); g.add(c); }   // a little frosty tuft on top
    for (const z of [-1, 1]) {
      const e = new THREE.Mesh(S1, bk); e.scale.set(2.5, 7.5, 5.5); e.position.set(21, 27, z * 8.5); g.add(e);   // big oval eyes
      for (const [y, zz, r] of [[30, z * 7.4 - 1.6, 2.1], [25.5, z * 9.6 + .4, 1]]) { const h2 = new THREE.Mesh(S1, wh); h2.scale.setScalar(r); h2.position.set(23.3, y, zz); g.add(h2); }   // two sparkles in each
      const ch = new THREE.Mesh(S1, pink); ch.scale.set(1.2, 2.6, 4.2); ch.position.set(20.5, 19, z * 14); g.add(ch);   // rosy cheeks
      const ft = new THREE.Mesh(S1, ice); ft.scale.set(7, 4.5, 6); ft.position.set(5, 3.5, z * 10); g.add(ft);   // stubby feet
    }
    const sm = new THREE.Mesh(new THREE.TorusGeometry(3.4, .8, 6, 16, Math.PI), bk); sm.rotation.set(Math.PI, Math.PI / 2, 0); sm.position.set(22.3, 20.5, 0); g.add(sm);   // a tiny smile
    return g;
  }
  function houseTex(wall) {   // a timber-framed wall: plaster, dark beams, two windows glowing warm (the glow map lights only the windows)
    const draw = (g, W, H, glow) => { g.fillStyle = glow ? "#000" : wall; g.fillRect(0, 0, W, H);
      if (!glow) { g.fillStyle = "#6b4426"; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 12, W, 12); for (const x of [0, W / 2 - 5, W - 10]) g.fillRect(x, 0, 10, H); g.fillRect(0, H * .48, W, 7); }
      for (const x of [W * .25, W * .75]) { if (!glow) { g.fillStyle = "#5a3820"; g.fillRect(x - 22, H * .22 - 4, 44, 48); }
        g.fillStyle = glow ? "#fff" : "#ffd27a"; g.fillRect(x - 18, H * .22, 36, 40); if (!glow) { g.fillStyle = "#5a3820"; g.fillRect(x - 2, H * .22, 4, 40); g.fillRect(x - 18, H * .22 + 18, 36, 4);
          g.fillStyle = "#ffffff"; g.fillRect(x - 24, H * .22 + 42, 48, 7); } } };
    const mk = glow => ctex(256, 128, (g, W, H) => draw(g, W, H, glow));
    return { map: mk(false), glow: mk(true) };
  }
  // ❄️ the snowy world round an El Nath track: soft snow drifts heaped beside the road, a penguin slide's ice walls, chunky snow-capped mountains all round
  function buildSnowWorld(t) {
    const P = t.PTS, N = t.N, half = t.ROAD / 2 + t.CURB, tan = i => { const a = P[(i + N - 1) % N], b = P[(i + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const rd = (x, y) => { let m = 1e9; for (let i = 0; i < N; i += 2) { const dx = P[i][0] - x, dy = P[i][1] - y, d = dx * dx + dy * dy; if (d < m) m = d; } return Math.sqrt(m); };
    let sd0 = 11; const rnd = () => (sd0 = (sd0 * 16807) % 2147483647) / 2147483647;
    for (const c of t.chutes || []) for (const sd of [-1, 1]) {   // 🐧 the penguin slide: see-through ice walls along both sides, with a soft lip of snow on top
      const pos = [], top = [], WH = 38;
      for (let i = c.a; i <= c.b; i++) { const [tx, ty] = tan(i), p = P[i % N], o = sd * (half + 3), x = p[0] - ty * o, z = p[1] + tx * o, y = RE[i % N]; pos.push(x, y - 4, z, x, y + WH, z); top.push(new THREE.Vector3(x, y + WH + 2, z)); }
      const g = new THREE.BufferGeometry(), idx = []; for (let k = 0; k < pos.length / 6 - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const wall = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xbfe6ff, emissive: 0x3a6a9a, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false })); scene.add(wall); roadObjs.push(wall);
      const lip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(top), top.length * 2, 6, 8), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e })); scene.add(lip); roadObjs.push(lip);
    }
    if (t.drifts) {   // soft snow drifts heaped along the roadside (never on the road)
      const spots = [];
      for (let i = 0; i < N; i += 16) for (const sd of [-1, 1]) { if ((t.caves || []).some(c => i >= c.a - 12 && i <= c.b + 12) || (t.gaps || []).some(g => i >= g.a - 30 && i <= g.b + 20)) continue; const [tx, ty] = tan(i), w = 22 + rnd() * 26, o = sd * (half + 14 + w), p = P[i], x = p[0] - ty * o, z = p[1] + tx * o;
        if (rnd() < .35 || rd(x, z) < half + 10 + w) continue; spots.push([x, z, Math.atan2(ty, tx), 40 + rnd() * 60, 10 + rnd() * 14, w]); }
      const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8, 0, 6.283, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x505868 }), spots.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), U = new THREE.Vector3(0, 1, 0);
      spots.forEach(([x, z, a, l, hh, w], k) => { Q.setFromAxisAngle(U, -a); M.compose(new THREE.Vector3(x, h(x, z) - 2, z), Q, new THREE.Vector3(l, hh, w)); m.setMatrixAt(k, M); });
      scene.add(m); roadObjs.push(m);
    }
    if (t.peaks) {   // 🏔️ chunky, snow-capped mountains all round the valley (gaps between them, so the town and the forest show through)
      const C = WORLD / 2, R0 = WORLD * .72 + 700;
      for (let k = 0; k < 20; k++) { if (k % 5 === 2) continue; const a = k / 20 * 6.283 + rnd() * .15, rr = R0 + rnd() * 450, H = 480 + rnd() * 560, Rb = H * (.8 + rnd() * .3);
        const prof = [[1, 0], [.9, .16], [.74, .36], [.56, .56], [.38, .74], [.22, .88], [.09, .97], [0, 1]].map(([r, y]) => new THREE.Vector2(r * Rb, y * H)), g = new THREE.LatheGeometry(prof, 24);
        const pa = g.attributes.position, col = [], ph = rnd() * 6;
        for (let v = 0; v < pa.count; v++) { const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v), an = Math.atan2(z, x), j = 1 + Math.sin(an * 3 + ph) * .1 + Math.sin(an * 5 + ph * 2) * .06; pa.setX(v, x * j); pa.setZ(v, z * j);
          const sl = H * (.66 + Math.sin(an * 4 + ph) * .07 + Math.sin(an * 9 + ph) * .03), snowy = y > sl; col.push(...(snowy ? [1, 1, 1] : y > sl - H * .06 ? [.78, .84, .94] : [.4, .47, .62])); }
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
        const x = C + Math.cos(a) * rr, z = C + Math.sin(a) * rr, m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x404a5e, fog: false }));
        m.position.set(x, h(Math.max(0, Math.min(WORLD, x)), Math.max(0, Math.min(WORLD, z))) - 40, z); m.rotation.y = rnd() * 6; scene.add(m); roadObjs.push(m); }
    }
  }
  function stripeTex(cols) {   // the balloon's gores: tall stripes, a band of trim round the middle
    return ctex(512, 256, (g, W, H) => { const n = 16; for (let k = 0; k < n; k++) { g.fillStyle = cols[k % cols.length]; g.fillRect(k * W / n, 0, W / n + 1, H); }
      g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(0, H * .62, W, 6); g.fillStyle = "#f07ab0"; g.fillRect(0, H * .62 + 6, W, 4); });
  }
  function buildProp(o) {
    const g0 = h(o.x, o.y), grp = new THREE.Group(), L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0x2a2a2a });
    const put = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); grp.add(m); return m; };
    if (o.k === "gazebo") {   // a round white floor, six slim pillars, a pink dome with a white scalloped rim and a gold knob on top
      const wh = L(0xfbf7f2, 0x5a5652), pk = L(0xf07ab0, 0x3a1020), gd = L(0xffd75e, 0x403010);
      put(new THREE.CylinderGeometry(70, 74, 8, 32), wh, 0, 4, 0); put(new THREE.CylinderGeometry(62, 62, 3, 32), pk, 0, 9, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; put(new THREE.CylinderGeometry(4.5, 5.5, 96, 12), wh, Math.cos(a) * 58, 56, Math.sin(a) * 58); }
      put(new THREE.TorusGeometry(60, 4, 8, 40), pk, 0, 104, 0).rotation.x = Math.PI / 2;
      const dome = put(new THREE.SphereGeometry(76, 32, 14, 0, 6.283, 0, Math.PI / 2), pk, 0, 104, 0); dome.scale.y = .62;
      for (let k = 0; k < 18; k++) { const a = k / 18 * 6.283; put(new THREE.SphereGeometry(7, 10, 8), wh, Math.cos(a) * 74, 103, Math.sin(a) * 74); }
      put(new THREE.SphereGeometry(7, 14, 10), gd, 0, 104 + 76 * .62 + 5, 0);
      grp.position.set(o.x, g0, o.y);
    } else if (o.k === "hotair") {   // a teardrop envelope in pink, white and yellow stripes, ropes down to a wicker basket
      const prof = []; for (let k = 0; k <= 20; k++) { const t = k / 20, a = t * Math.PI; prof.push(new THREE.Vector2(Math.max(.01, Math.sin(a) * 58 * (t < .5 ? .25 + 1.5 * t : 1)), 40 + 130 * (1 - Math.cos(a)) / 2)); }
      const env = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), new THREE.MeshLambertMaterial({ map: stripeTex(["#ff7ab8", "#ffffff", "#ffd23f", "#ffffff"]), emissive: 0x404040 })); grp.add(env);
      put(new THREE.CylinderGeometry(15, 15, 5, 20), L(0xf07ab0, 0x3a1020), 0, 41, 0);
      put(new THREE.BoxGeometry(24, 16, 24), L(0xa0703c, 0x2a1a08), 0, 8, 0); put(new THREE.BoxGeometry(26, 3, 26), L(0x7a5028, 0x201005), 0, 16, 0);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const a = new THREE.Vector3(sx * 11, 16, sz * 11), b = new THREE.Vector3(sx * 13, 40, sz * 13), m = put(new THREE.CylinderGeometry(.8, .8, a.distanceTo(b), 4), L(0x6b4426), 0, 0, 0);
        m.position.copy(a).add(b).multiplyScalar(.5); m.lookAt(b); m.rotateX(Math.PI / 2); }
      const y = g0 + (o.z || 0); grp.position.set(o.x, y, o.y); balloonM.push({ g: grp, y, o });
    } else if (o.k === "icicle") {   // ❄️ a cluster of ice crystals: six-sided, pointed, see-through and faceted so they catch the light
      const H = 240 * (o.s || 1), mat = new THREE.MeshLambertMaterial({ color: 0xcfe2ff, emissive: 0x4a5a9a, transparent: true, opacity: .86, flatShading: true }), tip = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x7a8ac0, flatShading: true, transparent: true, opacity: .9 });
      const cr = (x, z, hh, r, tx, tz) => { const c = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, hh * .78, 6), mat), pt = new THREE.Mesh(new THREE.ConeGeometry(r, hh * .22, 6), tip);
        body.position.y = hh * .39; pt.position.y = hh * .78 + hh * .11; c.add(body, pt); c.position.set(x, -6, z); c.rotation.set(tx, Math.random() * 3, tz); grp.add(c); };
      cr(0, 0, H, H * .085, 0, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + .4, d = H * (.1 + (k % 2) * .05); cr(Math.cos(a) * d, Math.sin(a) * d, H * (.38 + ((k * 37) % 5) * .07), H * (.045 + (k % 3) * .01), Math.sin(a) * .35, -Math.cos(a) * .35); }
      grp.position.set(o.x, g0, o.y);
    } else if (o.k === "skijump") {   // 🎿 the ski jump's launch: wooden lattice towers either side of the take-off, flags on top, and strings of pennants across the road
      const half = o.half || 110, wood = L(0x8a5a32, 0x1a0a04), dark = L(0x5a3a1e, 0x100800), Ht = 130;
      for (const sd of [-1, 1]) { const z0 = sd * (half + 24);
        for (const [dx, dz] of [[-14, -10], [14, -10], [-14, 10], [14, 10]]) put(new THREE.BoxGeometry(5, Ht, 5), wood, dx, Ht / 2, z0 + dz);
        for (let y = 20; y < Ht; y += 26) { put(new THREE.BoxGeometry(34, 3, 3), dark, 0, y, z0 - 10); put(new THREE.BoxGeometry(34, 3, 3), dark, 0, y, z0 + 10); put(new THREE.BoxGeometry(3, 3, 24), dark, -14, y, z0); put(new THREE.BoxGeometry(3, 3, 24), dark, 14, y, z0);
          const d1 = put(new THREE.BoxGeometry(2, 30, 2), dark, 0, y + 13, z0 - 10); d1.rotation.z = (y / 26 % 2 ? 1 : -1) * .85; }
        put(new THREE.BoxGeometry(40, 6, 30), wood, 0, Ht + 3, z0); put(new THREE.BoxGeometry(42, 6, 32), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e }), 0, Ht + 8, z0);   // a snowy platform on top
        put(new THREE.CylinderGeometry(1.4, 1.4, 50, 6), dark, 0, Ht + 33, z0); const fl = put(new THREE.PlaneGeometry(30, 18), new THREE.MeshBasicMaterial({ color: sd > 0 ? 0xd8352d : 0x2f6fd8, side: THREE.DoubleSide }), -15, Ht + 48, z0); fl.rotation.y = Math.PI / 2 * 0; }
      const cols = [0xd8352d, 0xffffff, 0x2f6fd8, 0xffd23f];
      for (const [y, x] of [[Ht - 6, 0], [Ht - 30, 8]]) for (let k = 0; k < 14; k++) { const f = (k + .5) / 14, z = -(half + 24) + f * 2 * (half + 24), sag = Math.sin(f * Math.PI) * 18, tri = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 3), new THREE.MeshBasicMaterial({ color: cols[k % 4] }));
        tri.rotation.x = Math.PI; tri.position.set(x, y - sag - 6, z); grp.add(tri); }   // pennant bunting across the road
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y);
    } else if (o.k === "engate") {   // ⛩️ El Nath's town gate: two chunky stone towers with snowy pointed roofs, a timber beam across with a snow lip and red lanterns hanging under it
      const half = o.half || 120, stone = new THREE.MeshLambertMaterial({ map: rockTex(), color: 0xf0f2f8, emissive: 0x4a4e58 }), snow = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e }), roofM = L(0x3f6fae, 0x0a1a3a), wood = L(0x7a4a26, 0x1a0a04);
      for (const sd of [-1, 1]) { const z = sd * (half + 34); put(new THREE.BoxGeometry(56, 170, 56), stone, 0, 85, z); put(new THREE.BoxGeometry(64, 10, 64), wood, 0, 175, z);
        const rf = put(new THREE.ConeGeometry(50, 70, 4), roofM, 0, 215, z); rf.rotation.y = Math.PI / 4; const sc = put(new THREE.ConeGeometry(30, 40, 4), snow, 0, 236, z); sc.rotation.y = Math.PI / 4;
        put(new THREE.SphereGeometry(8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb040 }), 30, 120, z); }   // a lamp on each tower
      put(new THREE.BoxGeometry(24, 26, 2 * (half + 34)), wood, 0, 150, 0); put(new THREE.BoxGeometry(30, 12, 2 * (half + 40)), snow, 0, 168, 0);
      for (let k = -2; k <= 2; k++) { const z = k * half * .4; put(new THREE.CylinderGeometry(1, 1, 16, 4), wood, 0, 130, z); const ln = put(new THREE.CylinderGeometry(9, 9, 20, 12), L(0xe8443a, 0x401008), 0, 115, z); put(new THREE.SphereGeometry(5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }), 0, 115, z).scale.set(1.9, 1.5, 1.9); }
      for (let k = 0; k < 16; k++) { const z = -half - 30 + k * (2 * half + 60) / 15, l = 8 + (k * 7 % 4) * 4, ic = put(new THREE.ConeGeometry(2.5, l, 6), new THREE.MeshLambertMaterial({ color: 0xe8f6ff, emissive: 0x4a6a8a }), 13, 136 - l / 2, z); ic.rotation.x = Math.PI; }
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y);
    } else if (o.k === "swhotel") {   // 🏚 the old Sleepywood Hotel: three crooked storeys of dark timber, a sagging pointed roof, windows glowing sickly yellow and green (some dead), a porch with lanterns
      const S = o.s || 1, wood = L(0x5a4636, 0x0e0a06), dark = L(0x2e2420, 0x060404), roofM = L(0x2a2232, 0x08060c), win = new THREE.MeshBasicMaterial({ color: 0xffd27a }), win2 = new THREE.MeshBasicMaterial({ color: 0x9aff7a }), dead = new THREE.MeshBasicMaterial({ color: 0x141018 });
      const W = 260 * S, D = 150 * S, FH = 70 * S;
      for (let f = 0; f < 3; f++) { const w = W - f * 26, d2 = D - f * 14, b = put(new THREE.BoxGeometry(d2, FH, w), wood, f * 3, FH / 2 + f * FH, 0); b.rotation.z = (f - 1) * .025;   // each floor a little crooked
        put(new THREE.BoxGeometry(d2 + 8, 6, w + 8), dark, f * 3, (f + 1) * FH, 0);
        for (let k = 0; k < 5; k++) { const z = (k - 2) * w / 5.4, m = (k * 7 + f * 3) % 5 === 0 ? dead : (k + f) % 4 === 0 ? win2 : win; put(new THREE.BoxGeometry(2, FH * .42, w / 9), m, d2 / 2 + f * 3 + 1, FH * .55 + f * FH, z); put(new THREE.BoxGeometry(3, FH * .5, 3), dark, d2 / 2 + f * 3 + 2, FH * .55 + f * FH, z); } }
      const rf = put(new THREE.CylinderGeometry(0, 1, 1, 4, 1), roofM, 6, 3 * FH + 70 * S, 0); rf.rotation.y = Math.PI / 4; rf.scale.set((D - 20) * .78, 140 * S, (W - 40) * .74); rf.rotation.z = .05;
      put(new THREE.BoxGeometry(14, 60 * S, 14), dark, -D * .2, 3 * FH + 110 * S, W * .25);   // a crooked chimney
      put(new THREE.BoxGeometry(40 * S, 6, W * .6), dark, D / 2 + 20 * S, 40 * S, 0); for (const z of [-1, 1]) { put(new THREE.BoxGeometry(5, 40 * S, 5), dark, D / 2 + 38 * S, 20 * S, z * W * .28); put(new THREE.SphereGeometry(6, 8, 6), win, D / 2 + 38 * S, 44 * S, z * W * .28); }   // the porch and its lanterns
      put(new THREE.BoxGeometry(3, 44 * S, 30 * S), dark, D / 2 + 1, 22 * S, 0);   // the door
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y);
    } else if (o.k === "golem") {   // 🗿 a Stone Golem: a chunky, mossy block body, huge fists on long arms, a small head with glowing red eyes, moss and vines on its shoulders
      const st = new THREE.MeshLambertMaterial({ map: rockTex(), color: 0xd0c8b0, emissive: 0x3a362c, flatShading: true }), moss = L(0x5a8a44, 0x16240e), eye = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
      put(new THREE.BoxGeometry(70, 80, 90), st, 0, 95, 0).rotation.y = .05;   // body
      put(new THREE.BoxGeometry(60, 34, 70), st, 0, 30, 0);   // hips
      for (const z of [-1, 1]) { put(new THREE.BoxGeometry(30, 40, 30), st, 0, 10, z * 26);   // stubby legs
        const arm = put(new THREE.BoxGeometry(26, 80, 26), st, 4, 90, z * 62); arm.rotation.x = z * .12; put(new THREE.BoxGeometry(40, 40, 40), st, 10, 40, z * 66);   // long arms, huge fists
        put(new THREE.BoxGeometry(34, 10, 34), moss, 0, 138, z * 40); }   // moss on the shoulders
      put(new THREE.BoxGeometry(40, 34, 44), st, 10, 150, 0);   // the head
      for (const z of [-1, 1]) { put(new THREE.BoxGeometry(4, 6, 10), eye, 31, 154, z * 11); const gl = put(new THREE.SphereGeometry(9, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: .25 }), 34, 154, z * 11); gl.scale.set(.5, 1, 1); }
      put(new THREE.BoxGeometry(3, 4, 22), L(0x1a1814, 0x000000), 31, 140, 0);   // a grim mouth
      for (let k = 0; k < 4; k++) { const v = put(new THREE.CylinderGeometry(1.5, 1.5, 40 + k * 8, 4), moss, -20 + k * 12, 110, (k % 2 ? 1 : -1) * 44); v.rotation.x = .1; }   // hanging vines
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y); golemM.push({ g: grp, o, y: g0 });
    } else if (o.k === "xpillar" && o.stone) { return;   // (built from El Nath's ice stone pictures instead, in buildIceStones)
    } else if (o.k === "xpillar") {   // 💎 a crystal standing in the cave road: a tall faceted gem with little ones round its foot, and a pool of light under it
      const H = o.h || 70, c = [0x7fe8ff, 0xc4a4ff, 0xffb0e8][Math.abs(Math.round(o.x * .7 + o.y)) % 3], cl = gemCluster(c, H, H * .18, o.x * .01); grp.add(cl);
      grp.position.set(o.x, g0, o.y); addGlow(o.x, g0, o.y, H * .5, c);
    } else if (o.k === "snowman_big") {   // ⛄ a fat, cute snowman: a chubby body, a big round head, rosy cheeks, a little smile, shiny eyes, a red beanie with a bobble, a scarf and mittens
      const H = o.h || 120 * (o.s || .8), sn = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x505868 }), red = L(0xe8443a, 0x3a0808), coal = L(0x2a2a30, 0x000000), S1 = new THREE.SphereGeometry(1, 24, 16);
      const rb = H * .3, rh = H * .25, yb = rb * .92, yh = yb + rb * .78 + rh * .72;
      put(S1, sn, 0, yb, 0).scale.set(rb * 1.12, rb, rb * 1.12);   // the round, fat body
      put(S1, sn, 0, yh, 0).scale.set(rh * 1.05, rh, rh * 1.05);   // the big head
      for (const z of [-1, 1]) { put(S1, coal, rh * .9, yh + rh * .12, z * rh * .34).scale.set(rh * .1, rh * .15, rh * .1); put(S1, sn, rh * .97, yh + rh * .18, z * rh * .3).scale.setScalar(rh * .04);   // shiny eyes
        put(S1, L(0xff9ab8, 0x3a1020), rh * .8, yh - rh * .12, z * rh * .55).scale.set(rh * .08, rh * .1, rh * .16); }   // rosy cheeks
      const nose = put(new THREE.ConeGeometry(rh * .1, rh * .38, 10), L(0xff8a2a, 0x401a00), rh * 1.12, yh - rh * .02, 0); nose.rotation.z = -Math.PI / 2;
      for (let k = -2; k <= 2; k++) { const a = k * .22; put(S1, coal, rh * .93 * Math.cos(a * .6), yh - rh * .3 - Math.cos(a * 2) * rh * .06 + rh * .06, Math.sin(a) * rh * .55).scale.setScalar(rh * .045); }   // a little smile
      const hat = put(new THREE.SphereGeometry(rh * .92, 20, 10, 0, 6.283, 0, Math.PI / 2), red, 0, yh + rh * .45, 0); hat.scale.y = .8;   // the red beanie
      put(new THREE.TorusGeometry(rh * .88, rh * .14, 8, 24), sn, 0, yh + rh * .47, 0).rotation.x = Math.PI / 2; put(S1, sn, 0, yh + rh * 1.25, 0).scale.setScalar(rh * .22);   // its white band and bobble
      put(new THREE.TorusGeometry(rh * .82, rh * .16, 8, 24), red, 0, yh - rh * .78, 0).rotation.x = Math.PI / 2;   // the scarf
      const tail = put(new THREE.BoxGeometry(rh * .3, rh * .8, rh * .14), red, rh * .55, yh - rh * 1.15, rh * .5); tail.rotation.z = .25;
      for (let k = 0; k < 2; k++) put(S1, coal, rb * 1.1, yb + rb * .25 - k * rb * .35, 0).scale.setScalar(rb * .07);   // buttons
      for (const z of [-1, 1]) { const arm = put(new THREE.CylinderGeometry(rb * .05, rb * .06, rb * .8, 6), L(0x7a5030, 0x1a0a00), 0, yb + rb * .45, z * rb * 1.25); arm.rotation.x = z * 1.15;
        put(S1, red, 0, yb + rb * .7, z * rb * 1.58).scale.setScalar(rb * .14); }   // stubby arms with red mittens
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y);
    } else if (o.k === "igloo") {   // 🛖 a snow-block igloo with a little tunnel for a door
      const R = 70 * (o.s || 1), blk = new THREE.MeshLambertMaterial({ map: iglooTex(), emissive: 0x3a4250 });
      const dome = put(new THREE.SphereGeometry(R, 32, 12, 0, 6.283, 0, Math.PI / 2), blk, 0, -2, 0);
      const tun = put(new THREE.CylinderGeometry(R * .38, R * .38, R * .6, 16, 1, false, 0, Math.PI), blk, R * .95, -2, 0); tun.rotation.z = Math.PI / 2; tun.rotation.y = Math.PI / 2;
      const door = put(new THREE.CircleGeometry(R * .3, 16, 0, Math.PI), L(0x1a2a40, 0x050a14), R * 1.26, -1, 0); door.rotation.y = Math.PI / 2;
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y);
    } else if (o.k === "enhouse") {   // 🏠 a fat little El Nath house: timber walls, warm glowing windows, a thick roof of snow with icing drips, a chimney, a lantern by the door
      const S = o.s || 1, W = 150 * S, D = 110 * S, Hh = 70 * S, ov = 18 * S, sl = .62, rise = (D / 2 + ov) * Math.tan(sl), slope = (D / 2 + ov) / Math.cos(sl);
      const tx = houseTex(o.wall || "#f3e3c3"), wallM = new THREE.MeshLambertMaterial({ map: tx.map, emissive: o.glow || 0xffb050, emissiveMap: tx.glow }), plainM = L(new THREE.Color(o.wall || "#f3e3c3").getHex(), 0x3a3020);
      const snow = o.dark ? L(0x3a3046, 0x0c0814) : new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e }), roofM = L(o.roof || 0xd2602a, 0x301008), S1 = new THREE.SphereGeometry(1, 14, 10);   // (dark: mossy shingles instead of snow)
      put(new THREE.BoxGeometry(D, Hh, W), wallM, 0, Hh / 2, 0);
      const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, rise * .92); tri.closePath();
      for (const z of [-1, 1]) put(new THREE.ExtrudeGeometry(tri, { depth: 3, bevelEnabled: false }), plainM, 0, Hh, z * W / 2 - 1.5);
      for (const sd of [-1, 1]) {   // the two roof slopes, the snow lying thick on each, and icing drips along the eaves
        const r = put(new THREE.BoxGeometry(slope, 8 * S, W + 30 * S), roofM, sd * (D / 2 + ov) / 2, Hh + rise / 2, 0); r.rotation.z = -sd * sl;
        const sn = put(new THREE.BoxGeometry(slope + 6 * S, 13 * S, W + 36 * S), snow, sd * (D / 2 + ov) / 2 + sd * Math.sin(sl) * 9 * S, Hh + rise / 2 + Math.cos(sl) * 9 * S, 0); sn.rotation.z = -sd * sl;
        for (let z = -W / 2 - 12 * S; z <= W / 2 + 12 * S; z += 16 * S) put(S1, snow, sd * (D / 2 + ov + 2 * S), Hh - 1 * S, z).scale.set(6 * S, (6 + ((z * 7) % 5 + 5) % 5) * S, 7 * S);
      }
      const ridge = put(new THREE.CylinderGeometry(12 * S, 12 * S, W + 36 * S, 14), snow, 0, Hh + rise + 9 * S, 0); ridge.rotation.x = Math.PI / 2;
      put(new THREE.BoxGeometry(18 * S, 46 * S, 18 * S), L(0xb04a3a, 0x2a0a08), -D * .18, Hh + rise * .7 + 12 * S, W * .26);   // the chimney, with its own cap of snow
      put(S1, snow, -D * .18, Hh + rise * .7 + 36 * S, W * .26).scale.set(13 * S, 7 * S, 13 * S);
      put(new THREE.BoxGeometry(4 * S, 42 * S, 28 * S), L(0x7a4a26, 0x1a0a04), D / 2 + 1.5, 21 * S, 0);   // the door
      put(new THREE.CylinderGeometry(14 * S, 14 * S, 4 * S, 16, 1, false, 0, Math.PI), L(0x7a4a26, 0x1a0a04), D / 2 + 1.5, 42 * S, 0).rotation.set(0, 0, Math.PI / 2);
      put(S1, new THREE.MeshBasicMaterial({ color: 0xffb040 }), D / 2 + 7 * S, 48 * S, 24 * S).scale.setScalar(5 * S);   // a warm lantern by the door
      for (const z of [-1, 1]) put(S1, snow, D / 2 + 4 * S, 2, z * W * .38).scale.set(16 * S, 9 * S, 22 * S);   // snow heaped by the walls
      grp.rotation.y = -(o.fa || 0); grp.position.set(o.x, g0, o.y);
    } else return;
    scene.add(grp); roadObjs.push(grp);
  }
  function fountStep(now) {
    const F = fountM; for (const f of F.falls) { if (f.u) f.tx.offset.x = -now * f.sp; else f.tx.offset.y = now * f.sp; }
    F.wtx.offset.set(Math.sin(now * .3) * .03, now * .02);
    for (let k = 0; k < F.drops.length; k++) { const d = F.drops[k], t = (now * d.sp + d.ph) % 1; let r, y;
      if (d.top) { r = 4 + t * 26; y = 186 + t * 26 - t * t * 70; }   // spray off the top of the jet, raining back into the top bowl
      else { r = 72 + d.r * 10 + t * 8; y = 22 + Math.sin(t * Math.PI) * 14; }   // splashes where the curtain lands
      F.pos[k * 3] = F.x + Math.cos(d.a) * r; F.pos[k * 3 + 1] = F.g0 + y; F.pos[k * 3 + 2] = F.z + Math.sin(d.a) * r; }
    F.pts.geometry.attributes.position.needsUpdate = true;
  }
  let rockT = null, damT = null, goldT = null, faceT = null, thw = [], thFn = null, cartM = [], cartFn = null, fireM = [], fireFn = null, holeM = [], lapFn = null, clockM = null, fountM = null, balloonM = [], auroraM = [], flowM = [], gondM = [], golemM = [];
  // 🗿 a Thwomp's face: grey stone, heavy brows, glaring eyes and gritted teeth
  const faceTex = () => faceT || (faceT = (() => { const c = canvas(128, 128), g = c.getContext("2d"); g.fillStyle = "#8a8f9a"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(60,64,74,.35)"; for (let k = 0; k < 40; k++) g.fillRect((k * 37) % 128, (k * 53) % 128, 6, 3);
    g.strokeStyle = "#5a5f6a"; g.lineWidth = 4; g.strokeRect(4, 4, 120, 120);
    g.fillStyle = "#3a3e48"; g.beginPath(); g.moveTo(16, 30); g.lineTo(58, 44); g.lineTo(58, 52); g.lineTo(16, 40); g.fill(); g.beginPath(); g.moveTo(112, 30); g.lineTo(70, 44); g.lineTo(70, 52); g.lineTo(112, 40); g.fill();
    g.fillStyle = "#ffffff"; g.fillRect(24, 50, 28, 20); g.fillRect(76, 50, 28, 20); g.fillStyle = "#1a1d24"; g.fillRect(36, 54, 10, 14); g.fillRect(82, 54, 10, 14);
    g.fillStyle = "#1a1d24"; g.fillRect(26, 84, 76, 24); g.fillStyle = "#f4f4f0"; for (let x = 28; x < 100; x += 12) { g.beginPath(); g.moveTo(x, 84); g.lineTo(x + 10, 84); g.lineTo(x + 5, 96); g.fill(); g.beginPath(); g.moveTo(x, 108); g.lineTo(x + 10, 108); g.lineTo(x + 5, 97); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })());
  // 🛕 the golden temple: sandstone blocks with gold trim and carved bands
  const goldTex = () => goldT || (goldT = (() => { const c = canvas(256, 256), g = c.getContext("2d"), B = 64;
    for (let y = 0; y < 256; y += B / 2) for (let x = -B; x < 256; x += B) { const ox = x + ((y / (B / 2)) & 1) * B / 2; g.fillStyle = ["#c8a25a", "#b8914a", "#d4b06a"][((x + y) / 32 & 3) % 3]; g.fillRect(ox, y, B, B / 2); g.strokeStyle = "#7a5a2a"; g.lineWidth = 2; g.strokeRect(ox + 1, y + 1, B - 2, B / 2 - 2); }
    g.fillStyle = "#ffd23f"; g.fillRect(0, 120, 256, 8); g.fillStyle = "#8a6a2a"; for (let x = 4; x < 256; x += 24) { g.beginPath(); g.moveTo(x, 150); g.lineTo(x + 10, 140); g.lineTo(x + 20, 150); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })());
  // 🌊 the dam: pale concrete panels with water pouring down it in streams
  const damTex = () => damT || (damT = (() => { const c = canvas(256, 256), g = c.getContext("2d"); g.fillStyle = "#c9c6bf"; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(120,115,105,.6)"; g.lineWidth = 2; for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); } for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (const x of [40, 168]) { const gr = g.createLinearGradient(x - 18, 0, x + 18, 0); gr.addColorStop(0, "rgba(90,170,235,0)"); gr.addColorStop(.5, "rgba(120,200,255,.95)"); gr.addColorStop(1, "rgba(90,170,235,0)"); g.fillStyle = gr; g.fillRect(x - 18, 0, 36, 256);
      g.fillStyle = "rgba(255,255,255,.7)"; for (let y = 0; y < 256; y += 14) g.fillRect(x - 3 + ((y / 14) % 3) * 2, y, 3, 8); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })());
  const cliffCache = {};
  function cliffMats(kind) {
    let mode = "paint"; try { mode = localStorage.getItem("kart_cliff") || "paint"; } catch (e) {}   // (the guild picked the painted walls; "ms" = the maplestory.io ground)
    const prep = tx => { tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = aniso; return tx; };
    if (kind === "snow") { if (cliffCache.snow) return cliffCache.snow;   // 🏔️ El Nath's ravines: blue-grey crags streaked with frost, under a thick lip of snow with icicles
      let sd = 21; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      const fc = canvas(360, 120), f = fc.getContext("2d"); f.fillStyle = "#5f6a80"; f.fillRect(0, 0, 360, 120);
      for (let k = 0; k < 170; k++) { const x = rnd() * 360, y = rnd() * 120, r = 6 + rnd() * 18, c = ["#4a5468", "#77839a", "#3e4658", "#8a96ac", "#dfe9f6"][k % 5]; f.fillStyle = c; f.globalAlpha = k % 5 === 4 ? .45 : .85;
        for (const dx of [-360, 0, 360]) for (const dy of [-120, 0, 120]) { f.beginPath(); f.moveTo(x + dx - r, y + dy); f.lineTo(x + dx - r * .3, y + dy - r * .8); f.lineTo(x + dx + r, y + dy - r * .2); f.lineTo(x + dx + r * .4, y + dy + r * .7); f.closePath(); f.fill(); } }
      f.globalAlpha = 1; f.strokeStyle = "rgba(30,36,50,.5)"; f.lineWidth = 2; for (let k = 0; k < 10; k++) { const x = rnd() * 360; f.beginPath(); f.moveTo(x, 0); f.lineTo(x + (rnd() - .5) * 30, 60); f.lineTo(x + (rnd() - .5) * 40, 120); f.stroke(); }
      const tc = canvas(360, 88), g = tc.getContext("2d"); g.drawImage(fc, 0, 20); g.fillStyle = "#f4f8ff"; g.beginPath(); g.moveTo(0, 0); g.lineTo(360, 0); g.lineTo(360, 30);
      for (let x = 360; x >= 0; x -= 12) g.quadraticCurveTo(x - 6, 34 + rnd() * 8, x - 12, 30); g.closePath(); g.fill();
      g.fillStyle = "#dbe8f8"; for (let x = 4; x < 360; x += 14 + rnd() * 10) { const l = 8 + rnd() * 18; g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 3, 30 + l); g.lineTo(x + 6, 30); g.fill(); }   // icicles under the snow
      return cliffCache.snow = { top: prep(new THREE.CanvasTexture(tc)), fill: prep(new THREE.CanvasTexture(fc)), w: 300, lip: 72, fh: 100 }; }
    if (cliffCache[mode]) return cliffCache[mode];
    if (mode === "ms") {   // 🍄 Henesys's Singing Mushroom Forest ground (maplestory.io): the grassy lip and the dirt with mossy rocks
      const L = new THREE.TextureLoader();
      return cliffCache[mode] = { top: prep(L.load("media/kart/tiles/shroomCliffTop.webp")), fill: prep(L.load("media/kart/tiles/shroomCliffFill.webp")), w: 300, lip: 72, fh: 100 };
    }
    // the painted version: olive-brown earth with darker cracks, mossy tufts, and a grass lip with little flowers
    let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const fc = canvas(360, 120), f = fc.getContext("2d"); f.fillStyle = "#7d6a2c"; f.fillRect(0, 0, 360, 120);
    for (let k = 0; k < 140; k++) { const x = rnd() * 360, y = rnd() * 120, r = 4 + rnd() * 14; f.fillStyle = rnd() < .5 ? "rgba(70,55,20,.45)" : "rgba(160,140,70,.35)";
      for (const dx of [-360, 0, 360]) for (const dy of [-120, 0, 120]) { f.beginPath(); f.ellipse(x + dx, y + dy, r, r * .6, rnd() * 3, 0, 7); f.fill(); } }
    for (let k = 0; k < 5; k++) { const x = 30 + k * 70 + rnd() * 20, y = 20 + rnd() * 80; f.fillStyle = "#6b5a24"; f.beginPath(); f.ellipse(x, y + 5, 22, 10, 0, 0, 7); f.fill();
      f.fillStyle = "#4f9a2e"; f.beginPath(); f.ellipse(x, y, 20, 8, 0, 0, 7); f.fill(); f.fillStyle = "#7ccc48"; f.beginPath(); f.ellipse(x - 4, y - 3, 10, 4, 0, 0, 7); f.fill(); }
    const tc = canvas(360, 88), g = tc.getContext("2d"); g.fillStyle = "#54a038"; g.fillRect(0, 0, 360, 88); g.drawImage(fc, 0, 30);
    g.fillStyle = "#3f8a28"; g.fillRect(0, 22, 360, 10); for (let x = 0; x < 360; x += 4) { g.fillStyle = rnd() < .5 ? "#6cc040" : "#4f9a2e"; g.beginPath(); g.moveTo(x, 34); g.lineTo(x + 2, 14 + rnd() * 10); g.lineTo(x + 4, 34); g.fill(); }
    for (let k = 0; k < 14; k++) { g.fillStyle = ["#ffc8de", "#ffffff", "#ffe08a"][k % 3]; g.beginPath(); g.arc(rnd() * 360, 18 + rnd() * 10, 2, 0, 7); g.fill(); }
    return cliffCache[mode] = { top: prep(new THREE.CanvasTexture(tc)), fill: prep(new THREE.CanvasTexture(fc)), w: 300, lip: 72, fh: 100 };
  }
  const rockTex = () => rockT || (rockT = (() => { const c = canvas(256, 256), g = c.getContext("2d"); g.fillStyle = "#6d6670"; g.fillRect(0, 0, 256, 256);   // 🪨 a rock cave: grey-brown crags with frost
    let sd = 9; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 160; k++) { const x = rnd() * 256, y = rnd() * 256, r = 8 + rnd() * 24; g.fillStyle = ["#5a5360", "#7f7882", "#4a4450", "#8e8a96", "#dfe8f2"][k % 5]; g.globalAlpha = k % 5 === 4 ? .35 : .8;
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x - r * .3, y - r * .8); g.lineTo(x + r, y - r * .2); g.lineTo(x + r * .4, y + r * .7); g.closePath(); g.fill(); }
    g.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })());
  const caveTex = () => caveT || (caveT = (() => { const c = canvas(256, 256), g = c.getContext("2d"); g.fillStyle = "#4f9fd8"; g.fillRect(0, 0, 256, 256);
    let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 140; k++) { const x = rnd() * 256, y = rnd() * 256, r = 10 + rnd() * 26; g.fillStyle = ["#6fc0ee", "#3d86c4", "#9fdcff", "#5aaee2", "#c8efff"][k % 5]; g.globalAlpha = .75;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * .7, y); g.lineTo(x, y + r); g.lineTo(x - r * .7, y); g.closePath(); g.fill(); }
    g.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })());
  let mistT = null;
  const mistTex = () => mistT || (mistT = (() => { const c = canvas(256, 256), g = c.getContext("2d");
    for (let k = 0; k < 40; k++) { const x = 30 + Math.random() * 196, y = 30 + Math.random() * 196, r = 30 + Math.random() * 60, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })());
  const CAP = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const capTexs = {};
  function capTex(col) {
    if (capTexs[col]) return capTexs[col];
    const C = { o: ["#e8742a", "#ffa040"], g: ["#3e9e34", "#7fd862"], b: ["#2f7cd0", "#7ab8ff"], r: ["#b8281c", "#f04a32"], n: ["#5e3a1c", "#9a6a3a"], y: ["#d4920a", "#ffe45a"] }[col] || ["#e8742a", "#ffa040"], c = canvas(256, 128), g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, C[1]); gr.addColorStop(1, C[0]); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#fffaf0"; for (const [x, y, r] of [[28, 30, 22], [96, 62, 27], [168, 26, 19], [222, 76, 24], [60, 98, 15], [140, 104, 14], [250, 14, 13], [4, 74, 14], [196, 112, 10], [118, 18, 11]]) { g.beginPath(); g.ellipse(x, y, r, r * .82, 0, 0, 7); g.fill(); }   // big round spots, like a real toadstool
    g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, 118, 256, 10);   // a darker rim
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return capTexs[col] = t;
  }
  const DETAIL = (() => { const n = 64, d = new Uint8Array(n * n * 4); let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n * n; i++) { d[i * 4] = 140 + r() * 115; d[i * 4 + 1] = 120 + r() * 135; d[i * 4 + 2] = 128; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; })();
  // the sky: the track's sky picture with its horizon panorama (the town) wrapped around a huge cylinder that travels with the camera
  const SKY_R = 3000, SKY_H = 3600, SKY_BELOW = 450, SKY_PIC = 1350;   // the sky picture covers 1350 units above the horizon; above that, its own top colour
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
    const c = canvas(4096, 1024), g = c.getContext("2d"), hor = Math.round(1024 * (1 - SKY_BELOW / SKY_H));
    const pxU = 4096 / (2 * Math.PI * SKY_R) * 2, pyU = 1024 / SKY_H, ax = pxU / pyU;   // 2 repeats around
    const picH = Math.round(1024 * Math.min(SKY_H - SKY_BELOW - 200, t.theme.skyPic || SKY_PIC) / SKY_H), top = hor - picH;   // (a track can have a taller sky picture)
    let topCol = t.theme.sky || "#8fd0ff";
    if (t.sky) { try { const sc = canvas(16, 4), sg = sc.getContext("2d"); sg.drawImage(t.sky, 0, 0, t.sky.width, Math.max(1, t.sky.height * .04), 0, 0, 16, 4); const d = sg.getImageData(0, 0, 16, 4).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; topCol = `rgb(${r / n | 0},${gg / n | 0},${b / n | 0})`; } catch (e) {} }
    g.fillStyle = topCol; g.fillRect(0, 0, 4096, hor);
    if (t.sky) { const tile = t.theme.skyMirror ? t.sky : seamless(t.sky), sh = picH, n = Math.max(1, Math.round(4096 / (tile.width * sh / tile.height * ax))), sw = 4096 / n;   // the same way round every time (no mirrored copies), joins blended away
      for (let i = 0; i < n; i++) g.drawImage(tile, i * sw, top, sw + .5, sh);
      if (t.moon) { const mx = 1250, my = top + sh * .26, r = 70, gl = g.createRadialGradient(mx, my, r * .7, mx, my, r * 2.4);   // 🌕 El Nath's own full moon (maplestory.io), once (the sky goes round twice, so its twin is always behind you)
        gl.addColorStop(0, "rgba(255,248,200,.35)"); gl.addColorStop(1, "rgba(255,248,200,0)"); g.fillStyle = gl; g.fillRect(mx - r * 3, my - r * 3, r * 6, r * 6); g.drawImage(t.moon, mx - r, my - r, r * 2, r * 2); }
      const fade = g.createLinearGradient(0, top, 0, top + sh * .35); fade.addColorStop(0, topCol); fade.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = fade; g.fillRect(0, top, 4096, sh * .35); }   // the picture's top melts into the sky above it
    if (t.strip) { const sh = 420 * pyU, sw = 4096 / Math.max(1, Math.round(4096 / (t.strip.width * sh / t.strip.height * ax))); for (let x = 0; x < 4096; x += sw) g.drawImage(t.strip, x, hor + 6 - sh, sw + 1, sh); }
    g.fillStyle = t.theme.grass ? t.theme.grass[0] : "#4a8a3a"; g.fillRect(0, t.strip ? hor + 6 : hor, 4096, 1024);   // (no strip: the ground meets the picture, no dark gap)
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.repeat.x = -2; map.anisotropy = aniso;
    if (skyMesh) { scene.remove(skyMesh); skyMesh.material.map.dispose(); skyMesh.material.dispose(); }
    skyMesh = new THREE.Mesh(new THREE.CylinderGeometry(SKY_R, SKY_R, SKY_H, 64, 1, true), new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -1; scene.add(skyMesh);
  }
  function sync(t) {
    let built = false;
    if (key !== t.key) { key = t.key; stoneKey = null; solidKey = null; buildGround(t); skyRefs = []; built = true; }
    if (t.solids && t.solids.length && t.solids.every(o => t.solidImgs[o.k]) && solidKey !== key) { solidKey = key; buildSolids(t); }
    if (t.iceStones && t.iceStones.every(Boolean) && stoneKey !== key) { stoneKey = key; buildIceStones(t); }   // (once their pictures have loaded)
    if (skyRefs[0] !== t.sky || skyRefs[1] !== t.strip || skyRefs[2] !== t.moon || !skyMesh) { skyRefs = [t.sky, t.strip, t.moon]; buildSky(t); built = true; }
    lastT = t; if (built) applyLook(t);
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
    if (NG && blobI < BLOBN && (z || 0) < 30) { const w = Math.min(160, im.width * sc * .75); M4b.makeScale(w, 1, w * .5).setPosition(x, h(x, y) + .5, y); blobs.setMatrixAt(blobI++, M4b); }
  }

  // ---------------------------------------------------------------- item boxes: real spinning rainbow "?" cubes
  const qTex = (() => { const c = canvas(128, 128), g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
    g.font = "900 92px Ubuntu, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 8; g.strokeStyle = "rgba(60,40,80,.55)"; g.strokeText("?", 64, 70); g.fillStyle = "#fff"; g.fillText("?", 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const mdls = {};   // per-frame pools of moving 3D models (the living ice blocks)
  function mdl(kind, x, y, z, a, tt) {
    const P = mdls[kind] || (mdls[kind] = { list: [], i: 0 }); let g = P.list[P.i++];
    if (!g) { g = kind === "freezie" ? freezieModel() : kind === "snowball" ? snowballModel() : kind === "stoneball" ? snowballModel(true) : new THREE.Group(); scene.add(g); P.list.push(g); }
    g.visible = true;
    if (kind === "snowball" || kind === "stoneball") { g.position.set(x, h(x, y) + 30, y); g.rotation.set(tt * 4 + x * .01, -a, 0); return; }   // (a giant snowball rolls) const w = Math.sin(tt * 9 + x * .01); g.position.set(x, h(x, y) + (z || 0) + Math.abs(w) * 3, y); g.rotation.set(0, -a, w * .12); g.scale.set(1 + w * .04, 1 - w * .05, 1 + w * .04);
  }
  const boxes = []; let bi = 0;
  function box(x, y, tt, i, z = 0) {
    let b = boxes[bi++]; if (!b) { b = new THREE.Mesh(BOX, new THREE.MeshPhongMaterial({ map: qTex, transparent: true, opacity: .82, shininess: 90, emissive: 0x222222 })); scene.add(b); boxes.push(b); }
    b.visible = true; b.scale.setScalar(13); b.material.color.setHSL(((tt * .33 + i * .13) % 1), .85, .6);
    b.position.set(x, h(x, y) + 11 + z + Math.sin(tt * 3 + i) * 1.6, y); b.rotation.set(.35, tt * 1.6 + i, .2);
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
    root.traverse(q => { if (q.isMesh) { q.castShadow = !ghost; q.receiveShadow = true; } });
    return { root, tilt, body, wheels, ice, flames, driver, driverTex, paint, mats, ghost: !!ghost, faded: false, im: null, roll: 0, used: true };
  }
  const karts = new Map();
  function kart(r, o) {
    let m = karts.get(r);
    if (!m || m.color !== o.color) { if (m) scene.remove(m.root); m = makeKart(o.color, o.ghost, o.family); m.color = o.color; karts.set(r, m); }
    m.used = true; m.root.visible = true; m.me = !!o.me;
    if (!!o.boo !== !!m.booOn) { m.booOn = !!o.boo; if (!m.base) m.base = m.mats.map(mt => [mt.transparent, mt.opacity, mt.depthWrite]);   // 👻 Jr. Wraith: see-through
      m.mats.forEach((mt, i) => { const [tr, op, dw] = m.base[i]; mt.transparent = m.booOn || tr; mt.opacity = m.booOn ? .22 : op; mt.depthWrite = m.booOn ? false : dw; mt.needsUpdate = true; });
      m.driver.material.opacity = m.booOn ? .3 : (m.ghost ? .5 : 1); m.driver.material.transparent = true; m.faded = m.booOn; }
    const gx = r.x, gy = r.y, a = r.a || 0, ca = Math.cos(a), sa = Math.sin(a);
    const al = airLift(r); m.lift = m.lift == null ? al : m.lift + (al - m.lift) * Math.min(1, (o.dt || .016) * (al > m.lift ? 20 : 8));   // (eased, so landing off the road doesn't jump)
    m.root.position.set(gx, h(gx, gy) + m.lift, gy); m.root.rotation.y = -a;
    // lean with the ground: nose up on a climb, tipped on a side slope
    const f = h(gx + ca * 11, gy + sa * 11) - h(gx - ca * 11, gy - sa * 11), sd = h(gx - sa * 8, gy + ca * 8) - h(gx + sa * 8, gy - ca * 8);
    m.tilt.rotation.set(Math.atan2(sd, 16) * .9, 0, Math.atan2(f, 22));
    const t = performance.now() / 1000, spin = r.spin > 0 ? (.9 - r.spin) / .9 * Math.PI * 4 : 0, flip = r.flip > 0 ? (1 - r.flip / .4) * Math.PI * 2 : 0;
    const hop = r.hop > 0 ? Math.sin((r.hop / .18) * Math.PI) * 4 : 0, lift = r.rescue > 0 ? (r.rescue > .7 ? (1.4 - r.rescue) / .7 : r.rescue / .7) * 40 : 0;
    m.body.position.y = Math.max(0, r.z || 0) + hop + lift;
    m.body.rotation.set(flip, -((r.drift || 0) * .34 + (r.steer || 0) * .07) - spin, 0, "YXZ");
    if (r.glide && !m.wing) { const g = new THREE.Group(), cloth = new THREE.MeshLambertMaterial({ color: 0xffcf3a, side: THREE.DoubleSide }), geo = new THREE.BufferGeometry();   // 🪁 a hang-glider over the kart
      geo.setAttribute("position", new THREE.Float32BufferAttribute([14, 33, 0, -12, 30, -30, -12, 30, 30, 14, 33, 0, -12, 30, 30, -6, 31.5, 0, 14, 33, 0, -6, 31.5, 0, -12, 30, -30], 3)); geo.computeVertexNormals();   // (just over the driver's head)
      g.add(new THREE.Mesh(geo, cloth)); for (const z of [-5, 5]) { const st = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x555b66 })); st.scale.set(1.5, 19, 1.5); st.position.set(-4, 21, z); g.add(st); }
      m.body.add(g); m.wing = g; }
    if (m.wing) m.wing.visible = !!r.glide;
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
    if (clockM) { const now = performance.now() / 1000, T = clockM.t;
      for (const q of clockM.gears) q.grp.rotation.y = -now * q.g.w;
      for (const q of clockM.hands) { const a = T.handAng(q.hd, now); q.m.position.set(T.lake.cx + Math.cos(a) * q.hd.len / 2, q.y, T.lake.cy + Math.sin(a) * q.hd.len / 2); q.m.rotation.y = -a; }
      for (const q of clockM.pends) { const s = Math.sin(now * q.p.sp + q.p.ph); q.grp.rotation.x = -Math.asin(Math.max(-1, Math.min(1, s * q.p.amp / 300))); } }   // (the bob is where the game thinks it is)
    if (fireFn) { const now = performance.now() / 1000; for (const q of fireM) { const z = fireFn(q.b, now), p = ((now + q.b.ph) % q.b.T) / q.b.T; q.m.visible = z > 0; q.m.position.set(q.b.x, q.g + 18 + Math.max(0, z), q.b.y); q.sh.visible = p > .55 && p < .92; q.sh.position.set(q.b.x, q.g + 1.3, q.b.y); q.sh.material.opacity = .15 + .5 * Math.min(1, (p - .55) / .3); } }
    if (fountM) fountStep(performance.now() / 1000);
    for (const f of flowM) f.offset.y = performance.now() / 1000 * .22;
    for (const q of golemM) { const z = q.o.sz || 0; q.g.position.y = q.y + z * .55; q.g.rotation.z = z > 1 ? Math.sin(z * .05) * .06 : 0; }   // 🗿 the Golems' stomp
    if (gondM.length) { const now = performance.now() / 1000; for (const q of gondM) { const f = ((now * q.sp + q.ph) % 2), u = f < 1 ? f : 2 - f, L = q.line, p = L.a.clone().lerp(L.b, u); p.addScaledVector(L.off, f < 1 ? 1 : -1); q.g.position.copy(p); q.g.rotation.z = Math.sin(now * 1.3 + q.ph) * .04; } }   // 🚡 gondolas gliding up one cable and down the other   // the dam's half-frozen waterfalls, trickling slowly
    if (auroraM.length) { const now = performance.now() / 1000; for (const q of auroraM) { const pa = q.m.geometry.attributes.position; for (let v = 0; v < pa.count; v++) { const b = q.base[v]; pa.setY(v, b[1] + Math.sin(now * .5 + b[3] * 3 + q.ph) * 40 * b[4]); pa.setZ(v, b[2] + Math.sin(now * .35 + b[3] * 5 + q.ph) * 90); } pa.needsUpdate = true; q.m.material.opacity = .62 + Math.sin(now * .7 + q.ph) * .15; } }
    for (const q of balloonM) q.g.position.y = q.y + Math.sin(performance.now() / 1000 * 2 + q.o.x) * (q.o.bob || 0);   // the balloons sway up and down
    if (lapFn) { const l = lapFn(); for (const q of holeM) q.g.visible = l >= q.hl.lap; }
    if (cartFn) { const now = performance.now() / 1000; for (const q of cartM) { const p = cartFn(q.c, now); q.g.position.set(p.x, h(p.x, p.y), p.y); q.g.rotation.y = -p.a; } }
    if (thFn) { const now = performance.now() / 1000; for (const q of thw) { const z = thFn(q.th, now); q.m.position.set(q.th.x, q.g + 31 + z, q.th.y); q.sh.position.set(q.th.x, q.g + 1.2, q.th.y); q.sh.material.opacity = .15 + .4 * (1 - Math.min(1, z / 150)); } }
    VW = o.W; VH = o.H; pi = 0; bi = 0; for (const k in mdls) mdls[k].i = 0; for (const m of karts.values()) m.used = false;
    const a = k.a || 0;
    if (cam.yaw == null || o.snap) cam.yaw = a;
    let d = a - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * Math.min(1, o.dt * 7);   // the camera swings round a moment after the kart
    const dist = 58 + 9 * (o.fov || 0), up = 34 + Math.min(k.z || 0, 260) * .95;   // rises with you in the air (big mushroom bounces too)   // up high and looking down at the road, like Mario Kart Tour
    const gx = k.x - Math.cos(cam.yaw) * dist, gz = k.y - Math.sin(cam.yaw) * dist;
    const lift = airLift(k); cam.lift = o.snap || cam.lift == null ? lift : cam.lift + (lift - cam.lift) * Math.min(1, o.dt * (lift > cam.lift ? 20 : 6));
    const kh = h(k.x, k.y) + cam.lift, base = Math.max(kh, h(gx, gz) - 6), want = base + up;   // (flying off the road: follow the road's height, not the ravine under you)
    // the ground part eases (hills, bumps); the jump / glide height follows almost at once, or a fast take-off leaves the camera level with the kart
    const zu = up - 34; cam.base = o.snap || cam.base == null ? base : cam.base + (base - cam.base) * Math.min(1, o.dt * 6); cam.zu = o.snap || cam.zu == null ? zu : cam.zu + (zu - cam.zu) * Math.min(1, o.dt * 16);
    cam.y = cam.base + 34 + cam.zu;
    camera.position.set(gx, Math.max(cam.y, h(gx, gz) + 5), gz);
    look.set(k.x + Math.cos(cam.yaw) * 56, Math.max(h(k.x + Math.cos(cam.yaw) * 56, k.y + Math.sin(cam.yaw) * 56), kh - 40) * .5 + kh * .5 + 2 + Math.min(k.z || 0, 260) * .95, k.y + Math.sin(cam.yaw) * 56);   // rises with you in a jump (no tilting up at the sky)
    if (o.intro != null && o.intro < 1 && o.grid) {   // before the start: from in front of the grid (everyone facing you), swooping up and round to behind your kart
      const [qx, qy, qa] = o.grid, e = o.intro * o.intro * (3 - 2 * o.intro), fx = qx + Math.cos(qa) * 170, fz = qy + Math.sin(qa) * 170;
      tmp.set(fx, h(fx, fz) + 38, fz).lerp(camera.position, e); tmp.y += Math.sin(Math.PI * e) * 45; camera.position.copy(tmp);
      tmp.set(qx - Math.cos(qa) * 20, h(qx, qy) + 10, qy - Math.sin(qa) * 20).lerp(look, e); look.copy(tmp);
      cam.yaw = a; cam.y = want; cam.base = base; cam.zu = zu;
    }
    shake = o.shake || 0; if (shake > 0) camera.position.add(tmp.set((Math.random() - .5) * shake * 6, (Math.random() - .5) * shake * 6, (Math.random() - .5) * shake * 6));
    if (window.__camOv) { const c = window.__camOv; camera.position.set(c[0], c[1], c[2]); look.set(c[3], c[4], c[5]); if (scene.fog) { scene.__fog = scene.fog; scene.fog = null; } }   // (a dev hook: a fixed camera with no haze, for overview pictures)
    else if (scene.__fog) { scene.fog = scene.__fog; scene.__fog = null; }
    camera.lookAt(look);
    if (NG) { const fx = Math.round((k.x + Math.cos(cam.yaw) * 260) / 8) * 8, fz = Math.round((k.y + Math.sin(cam.yaw) * 260) / 8) * 8, fy = Math.round(kh / 8) * 8, D = mood.dir;   // the shadow box sits just ahead of you
      sun.target.position.set(fx, fy, fz); sun.position.set(fx + D[0] * 1500, fy + D[1] * 1500, fz + D[2] * 1500); }
    blobI = 0;
    cam.roll = (cam.roll || 0) + ((o.roll || 0) - (cam.roll || 0)) * Math.min(1, o.dt * 6); if (cam.roll) camera.rotateZ(cam.roll);   // leans into a drift
    camera.fov = 60 + 13 * (o.fov || 0); camera.aspect = VW / VH; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    if (skyMesh) skyMesh.position.set(camera.position.x, camera.position.y + SKY_H / 2 - SKY_BELOW, camera.position.z);
    if (skyMesh) skyMesh.visible = !window.__camOv || !!window.__camSky;
  }
  // a rival between the camera and your kart turns see-through, so it never blocks your view
  function fadeBlockers() {
    let me = null; for (const m of karts.values()) if (m.me && m.used) me = m; if (!me) return;
    const dMe = tmp.copy(me.root.position).sub(camera.position).dot(fwd);
    for (const m of karts.values()) { if (m === me || !m.used || m.booOn) continue;
      if (!m.base) m.base = m.mats.map(mt => [mt.transparent, mt.opacity, mt.depthWrite]);
      const d = tmp.copy(m.root.position).sub(camera.position).dot(fwd), lat = tmp.addScaledVector(fwd, -d).length(), block = m.ghost ? d < dMe + 15 : d > 0 && d < dMe - 6 && lat < 30;   // ghosts fade whenever they're level with you or behind
      if (block !== m.faded) { m.faded = block; m.mats.forEach((mt, i) => { const [tr, op, dw] = m.base[i];
        mt.transparent = block || tr; mt.opacity = block ? (m.ghost ? .1 : .3) : op; mt.depthWrite = block ? false : dw; mt.needsUpdate = true; }); } }
  }
  function end() {
    fadeBlockers();
    const nowS = performance.now() / 1000, cdt = Math.min(.05, nowS - (capT || nowS)); capT = nowS;
    for (const c of caps) { const p = c.pad; if (p.squash > 0) p.squash = Math.max(0, p.squash - cdt * 2.2); const q = p.squash || 0;
      c.m.scale.y = (c.h || 13) * (1 - .55 * q * Math.cos((1 - q) * 10)); }   // squash, then wobble back
    for (let i = pi; i < pool.length; i++) pool[i].visible = false;
    for (let i = bi; i < boxes.length; i++) boxes[i].visible = false;
    for (const k in mdls) { const P = mdls[k]; for (let i = P.i; i < P.list.length; i++) P.list[i].visible = false; }
    for (const [r, m] of karts) if (!m.used) { m.root.visible = false; if (r.gone || r.dead) { scene.remove(m.root); karts.delete(r); } }
    blobs.count = blobI; blobs.instanceMatrix.needsUpdate = true;
    draw(); perfCheck();
  }
  // where a world spot shows up on the screen (in the game's 320-wide units), and how many screen units one world unit is there
  function proj(x, y, z = 0, lift = 0) {
    tmp.set(x, h(x, y) + z + lift, y); const d = tmp.clone().sub(camera.position).dot(fwd); if (d < 4) return null;
    tmp.project(camera); const f = VH / 2 / Math.tan(camera.fov * Math.PI / 360);
    return { sx: (tmp.x + 1) / 2 * VW, sy: (1 - tmp.y) / 2 * VH, sc: f / d, d };
  }
  // is a spot hidden behind a hill?
  function hidden(x, y, z = 4) {   // (z: height above the ground there)
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, ty = h(x, y) + z;
    for (let i = 1; i < 10; i++) { const t = i / 10, px = cx + (x - cx) * t, pz = cz + (y - cz) * t; if (h(px, pz) > cy + (ty - cy) * t + 2) return true; }
    return false;
  }
  function resize(w, hh) { renderer.setSize(w, hh, false); ppSize(); }
  function clearKarts() { for (const m of karts.values()) scene.remove(m.root); karts.clear(); cam.yaw = null; }
  const snap = () => { draw(); return renderer.domElement; };   // (testing) the 3D picture, read right after drawing it
  const liftOf = r => { const m = karts.get(r); return m && m.lift != null ? m.lift : airLift(r); };   // how high above the ground a kart is drawn (for the 2D bits on top: name tags, held items)
  return { snap, sync, begin, end, spr, box, mdl, kart, proj, hidden, h, liftOf, camera, setQuality, get quality() { return Q; }, get ng() { return NG; }, tune: o => { if (!mood) return; Object.assign(mood, o); sun.color.setHex(mood.sun); sun.intensity = mood.sunI; sun.position.set(...mood.dir); hemi.color.setHex(mood.sky); hemi.groundColor.setHex(mood.gnd); hemi.intensity = mood.hemiI; return { ...mood }; }, resize, clearKarts, renderer, scene, reset: () => { key = null; }, get key() { return key; } };
}
