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
  // ✨ three.js's own add-ons (loaded in the background; if they can't load, everything still works the old way): a studio environment for
  // real reflections on gold, glass and paint, film-quality bloom, and rounded boxes for the karts
  const FX = { env: null, composer: null, bloom: null, RoundBox: null, ready: false };
  Promise.all([import("three/addons/environments/RoomEnvironment.js"), import("three/addons/postprocessing/EffectComposer.js"), import("three/addons/postprocessing/RenderPass.js"), import("three/addons/postprocessing/UnrealBloomPass.js"), import("three/addons/postprocessing/OutputPass.js"), import("three/addons/geometries/RoundedBoxGeometry.js")])
    .then(([RE_, EC, RP, UB, OP, RB]) => { const pm = new THREE.PMREMGenerator(renderer); FX.env = pm.fromScene(new RE_.RoomEnvironment(), .04).texture; pm.dispose(); scene.environment = FX.env; scene.environmentIntensity = .35;
      FX.composer = new EC.EffectComposer(renderer); FX.composer.addPass(new RP.RenderPass(scene, camera)); FX.bloom = new UB.UnrealBloomPass(new THREE.Vector2(512, 512), .4, .35, .92); FX.composer.addPass(FX.bloom); FX.composer.addPass(new OP.OutputPass());
      FX.RoundBox = RB.RoundedBoxGeometry; FX.ready = true; karts.forEach(m => scene.remove(m.root)); karts.clear(); if (lastT) { key = null; } })
    .catch(e => console.info("Family Kart: extra 3D effects unavailable", e));

  // ---------------------------------------------------------------- ✨ the next-gen look (an experiment, switched off): the sun
  // casts real shadows, every picture standing in the world gets a soft shadow on the ground, the picture goes through filmic colour, bright
  // things glow, and each cup has its own light and colour grade. Quality: 2 = computers, 1 = phones, 0 = off (the old look).
  let Q = (() => { try { const v = localStorage.getItem("kart_q"); return v != null ? +v : A.touch ? 1 : 2; } catch (e) { return A.touch ? 1 : 2; } })(), NG = false, mood = null;
  const MOODS = {
    henesys: { sun: 0xffe6c4, sunI: 2.4, dir: [-.6, .55, .5], sky: 0xd8eaff, gnd: 0x5e6a48, hemiI: 1.05, exp: 1, sat: 1.04, con: 1.06, warm: .02, vig: .26, bloom: .45, thr: .95 },
  };
  // ✨ the clean look (a track opts in with theme.clean): soft sun shadows that follow you, filmic colour, a gentle glow, a calm sky-blue haze
  const CLEAN_MOOD = { sun: 0xfff0d8, sunI: 2.6, dir: [.32, .78, -.54], sky: 0xcfe8ff, gnd: 0x7aa05a, hemiI: 1.15, exp: 1, sat: 1.02, con: 1.04, warm: .01, vig: .14, bloom: .3, thr: .9 };
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
    if (renderer.toneMapping !== THREE.NoToneMapping) renderer.toneMapping = THREE.NoToneMapping;
    if (!(NG && Q >= 1) || (lastT && lastT.theme.skyroad)) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }   // (the Star Road: no screen effects, the plain picture)
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
    const clean = t.theme.clean ? { ...CLEAN_MOOD, ...(typeof t.theme.clean === "object" ? t.theme.clean : {}) } : null, want = Q >= 1 && clean ? clean : Q >= 1 && all && !!MOODS[t.cup] ? MOODS[t.cup] : null, was = NG;   // (off by default: the guild preferred the original look; localStorage kart_ng = "all" to try it)
    NG = !!want; mood = want; blobs.visible = NG;
    if (NG) { sun.color.setHex(mood.sun); sun.intensity = mood.sunI; sun.position.set(...mood.dir); hemi.color.setHex(mood.sky); hemi.groundColor.setHex(mood.gnd); hemi.intensity = mood.hemiI;
      sun.castShadow = true; const ms = Q >= 2 ? 2048 : 1024; if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
    else { hemi.color.setHex(OLD_LIGHT.hemiSky); hemi.groundColor.setHex(OLD_LIGHT.hemiGnd); hemi.intensity = OLD_LIGHT.hemiI; sun.color.setHex(OLD_LIGHT.sun); sun.intensity = OLD_LIGHT.sunI; sun.position.copy(OLD_LIGHT.pos); sun.target.position.set(0, 0, 0); sun.castShadow = false; }
    camera.far = t.theme.skyroad ? 20000 : 7000; camera.near = t.theme.skyroad ? 2 : 1; camera.updateProjectionMatrix();
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
  let waterP = null, waterL = 0, tideFn = null, lapGapM = [];
  let HG = new Float32Array(GN * GN), terrain = null, plain = null, skyMesh = null, skyDome = null, key = null, skyRefs = [], RE = null;   // RE: the road's height at each track point
  // 🪁 in the air (a jump, a glide, a mushroom bounce) a kart's height counts from the road it left, not from whatever is below it (a ravine,
  // the slope far under a glide): off the road the ground can be far lower. How far above the ground that puts it:
  let bridgeG = [];
  // 🌈 the sky road: the road floats in the air (and crosses over itself), so karts ride on the road's own height and banking at their place on
  // the track (r.idx), not on the ground under them
  let SKY = false, BANKS = null, SPTS = null;
  const surfY = (x, y, idx) => { const n = RE.length, i = ((Math.floor(idx) % n) + n) % n, p = SPTS[i];   // (smooth: the exact spot between the two nearest road points, so the height glides instead of stepping)
    let j = (i + 1) % n, q = SPTS[j], dx = q[0] - p[0], dy = q[1] - p[1], f = ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1);
    if (f < 0) { j = (i + n - 1) % n; q = SPTS[j]; dx = q[0] - p[0]; dy = q[1] - p[1]; f = ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1); }
    f = Math.max(0, Math.min(1, f)); const q0 = SPTS[(i + n - 2) % n], q1 = SPTS[(i + 2) % n], a = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]), dn = -(x - p[0]) * Math.sin(a) + (y - p[1]) * Math.cos(a);
    const bank = BANKS ? BANKS[i] + (BANKS[j] - BANKS[i]) * f : 0; return RE[i] + (RE[j] - RE[i]) * f - bank * Math.max(-210, Math.min(210, dn)); };
  const surfAt = (x, y, idx) => { const n = SPTS.length, c = Math.round(idx); let bj = c, bd = 1e18; for (let k = -5; k <= 5; k++) { const j = (((c + k) % n) + n) % n, p = SPTS[j], d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; bj = j; } } return surfY(x, y, bj); };   // (a spot a little way from the kart: measured on its own stretch of road, so the kart tilts with the real slope)
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
    if (t.PTS[0].length > 2) { for (let i = 0; i < N; i++) E[i] = t.PTS[i][2] * (t.theme.hills ?? 1);   // a track with its own planned hills
      if (t.theme.skyroad) { const W2 = 34, src = E.slice(), wt = []; let ws = 0; for (let k = -W2; k <= W2; k++) { const w = Math.exp(-(k * k) / (2 * (W2 / 2.2) ** 2)); wt.push(w); ws += w; }   // (the floating road's climbs and dips eased into long smooth curves: no kinks at the crests)
        for (let i = 0; i < N; i++) { let sum = 0; for (let k = -W2; k <= W2; k++) sum += src[(i + k + N) % N] * wt[k + W2]; E[i] = sum / ws; } }
      return E; }
    let mx = 0; for (let i = 1; i < N; i++) mx = Math.max(mx, Math.abs(E[i] - E[i - 1]) / t.SPC);
    const k = Math.min(1, .13 / (mx || 1)) * hills; for (let i = 0; i < N; i++) E[i] *= k;
    return E;
  }
  function buildGround(t) {
    if (t.WORLD && t.WORLD !== WORLD) { WORLD = t.WORLD; const n = Math.round(WORLD / (WORLD > 3200 ? 12 : 8)); G = WORLD / n; GN = n + 1; HG = new Float32Array(GN * GN); }   // (a big world gets a coarser ground grid, so it stays light)
    const E = profile(t); RE = E; SKY = !!t.theme.skyroad; SPTS = t.PTS; BANKS = null; const wsum = new Float64Array(GN * GN), hsum = new Float64Array(GN * GN), dmin = new Float32Array(GN * GN).fill(1e9), near = new Int32Array(GN * GN).fill(-1);
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
    if (t.theme.bank) {   // ✨ banked corners: the outside of every bend rises (up to ~9°), like a real circuit; it fades into the grass beyond the verge
      const P = t.PTS, n = t.N, ang = i => { const a = P[(i + n - 4) % n], b = P[(i + 4) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); }, KAP = new Float32Array(n);
      for (let i = 0; i < n; i++) { let d = ang((i + 5) % n) - ang((i + n - 5) % n); d = Math.atan2(Math.sin(d), Math.cos(d)); KAP[i] = d / (10 * t.SPC); }
      const KS = new Float32Array(n); for (let i = 0; i < n; i++) { let sum = 0; for (let k = -12; k <= 12; k++) sum += KAP[(i + k + n) % n]; KS[i] = sum / 25; }
      const B = t.theme.bank === true ? 40 : t.theme.bank; const BM = t.theme.bankMax || .22; BANKS = new Float32Array(n); for (let i = 0; i < n; i++) BANKS[i] = Math.max(-BM, Math.min(BM, KS[i] * B));
      for (let o = 0; o < GN * GN; o++) { const ni = near[o]; if (ni < 0) continue; const d = Math.sqrt(dmin[o]); if (d > edge + 260) continue;
        const p = P[ni], p0 = P[(ni + n - 1) % n], p1 = P[(ni + 1) % n], tx = p1[0] - p0[0], tz = p1[1] - p0[1], tl = Math.hypot(tx, tz) || 1, cx = (o % GN) * G - p[0], cz = Math.floor(o / GN) * G - p[1], dn = (-tz * cx + tx * cz) / tl;
        const slope = Math.max(-BM, Math.min(BM, KS[ni] * B)); HG[o] -= slope * Math.max(-(edge + 60), Math.min(edge + 60, dn)) * smooth(edge + 260, edge + 40, d); } }
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
      const wp = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 2 * F, WORLD + 2 * F), wm); wp.rotation.x = -Math.PI / 2; wp.position.set(WORLD / 2, t.water.level, WORLD / 2); waterP = wp; waterL = t.water.level; wp.renderOrder = 2; plain.add(wp); }
    scene.add(plain);
    gapsBuilt = t.gaps || [];
    if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.map.dispose(); terrain.material.dispose(); }
    terrain = new THREE.Mesh(geo, mat); scene.add(terrain);
    if (t.theme.space) { terrain.visible = false; for (const m of plain.children) if (!m.userData.keep) m.visible = false; }
    if (t.theme.skyroad) {   // 🏙 far below the sky road: a huge city of lights at night (streets of warm lamps, glowing blocks, dark parks)
      let lo = 1e9; for (let i = 0; i < t.N; i++) lo = Math.min(lo, E[i]);
      const tx = ctex(1024, 1024, (g, W) => { g.fillStyle = "#06121a"; g.fillRect(0, 0, W, W); let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
        for (let k = 0; k < 160; k++) { const x = rnd() * W, y = rnd() * W, r = 30 + rnd() * 110, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rnd() < .7 ? "rgba(255,170,80,.22)" : "rgba(120,200,255,.16)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        for (let y = 0; y < W; y += 16 + (rnd() * 3 | 0)) { g.fillStyle = "rgba(255,200,120,.45)"; for (let x = 0; x < W; x += 3) if (rnd() < .55) g.fillRect(x, y, 1.4, 1.4); }   // the streets
        for (let x = 0; x < W; x += 22 + (rnd() * 6 | 0)) { g.fillStyle = "rgba(255,215,150,.4)"; for (let y = 0; y < W; y += 3) if (rnd() < .5) g.fillRect(x, y, 1.4, 1.4); }
        for (let k = 0; k < 16000; k++) { g.fillStyle = ["#ffd9a0", "#fff4d8", "#ffb46a", "#bfe4ff"][k & 3]; g.globalAlpha = .5 + rnd() * .5; const sz = rnd() < .1 ? 2.2 : 1.3; g.fillRect(rnd() * W, rnd() * W, sz, sz); } g.globalAlpha = 1; }, true);
      tx.repeat.set(14, 14); const city = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 9, WORLD * 9), new THREE.MeshBasicMaterial({ map: tx, fog: false, color: 0xa8a8a8 }));
      city.rotation.x = -Math.PI / 2; city.position.set(WORLD / 2, lo - 1500, WORLD / 2); city.userData.keep = true; plain.add(city);
      const haze = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 9, WORLD * 9), new THREE.MeshBasicMaterial({ map: glowDisc(), color: 0xffa860, transparent: true, opacity: .1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));   // a warm glow hanging over the city
      haze.rotation.x = -Math.PI / 2; haze.position.set(WORLD / 2, lo - 1380, WORLD / 2); haze.userData.keep = true; plain.add(haze); }   // 🌌 in space there's no ground: the road floats over the stars
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
    else if (style === "rainbow64") {   // 🌈 the star road: big glowing glass tiles in deep rainbow colours, darker toward their edges, a grid of light dots that glows brightest in the middle, a glossy sheen, and dark seams with a fine gold line
      const cols = ["#e8324a", "#f07a2a", "#e8b428", "#3cc060", "#1fb4a8", "#2a92e8", "#3c56e0", "#8c44e0", "#e03ca4"], C = 6, R = 4, tw = U / C, thh = 192 / R;
      g.fillStyle = "#120c22"; g.fillRect(0, 0, U, 192);
      for (let row = 0; row < R; row++) for (let c = 0; c < C; c++) { const col = cols[(c + row * 3) % cols.length], x = c * tw + 1.6, y = row * thh + 1.6, w = tw - 3.2, hh = thh - 3.2, cx = x + w / 2, cy = y + hh / 2;
        g.fillStyle = col; g.fillRect(x, y, w, hh);
        const vg = g.createRadialGradient(cx, cy, w * .15, cx, cy, w * .8); vg.addColorStop(0, "rgba(255,255,255,.16)"); vg.addColorStop(.5, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(8,4,24,.72)"); g.fillStyle = vg; g.fillRect(x, y, w, hh);
        for (let dy = 2.2; dy < hh - 1; dy += 3.1) for (let dx = 2.2; dx < w - 1; dx += 3.1) { const e = 1 - Math.min(1, Math.hypot(x + dx - cx, y + dy - cy) / (w * .62)); g.fillStyle = `rgba(255,255,240,${.12 + .4 * e})`; g.fillRect(x + dx, y + dy, 1.1, 1.1); }   // the dotted glass, brightest in the middle
        const sh = g.createLinearGradient(x, y, x + w * .7, y + hh); sh.addColorStop(0, "rgba(255,255,255,.22)"); sh.addColorStop(.35, "rgba(255,255,255,.04)"); sh.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = sh; g.fillRect(x, y, w, hh); }
      g.strokeStyle = "rgba(255,200,110,.55)"; g.lineWidth = .7; for (let c = 0; c <= C; c++) { g.beginPath(); g.moveTo(c * tw, 0); g.lineTo(c * tw, 192); g.stroke(); } for (let row = 0; row <= R; row++) { g.beginPath(); g.moveTo(0, row * thh); g.lineTo(U, row * thh); g.stroke(); }   // the fine gold line in each seam
    }
    else if (style === "asphalt") {   // 🛣 a clean asphalt road (drawn): soft grey with gentle blotches and fine grit, darker worn lanes, crisp white edge lines and a yellow centre dash
      g.fillStyle = "#5b5f68"; g.fillRect(0, 0, U, 192);
      for (let k = 0; k < 40; k++) { const x = r() * U, y = r() * 192, rad = 14 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() < .5 ? "rgba(40,42,48,.16)" : "rgba(120,124,132,.12)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      const grit = ["#4a4e56", "#6d717b", "#7d818a", "#3f424a", "#62666f"]; for (let k = 0; k < 9000; k++) { g.fillStyle = grit[k % 5]; const sz = .3 + r() * .5; g.fillRect(r() * U, r() * 192, sz, sz); }
      for (const u0 of [.3, .7]) { const gr = g.createLinearGradient(U * (u0 - .12), 0, U * (u0 + .12), 0); gr.addColorStop(0, "rgba(30,30,36,0)"); gr.addColorStop(.5, "rgba(30,30,36,.15)"); gr.addColorStop(1, "rgba(30,30,36,0)"); g.fillStyle = gr; g.fillRect(U * (u0 - .12), 0, U * .24, 192); }
      g.fillStyle = "#f2f2ee"; g.fillRect(U * .03, 0, U * .022, 192); g.fillRect(U * .948, 0, U * .022, 192);
      g.fillStyle = "#ffd54a"; g.fillRect(U / 2 - 1.6, 20, 3.2, 70); g.fillRect(U / 2 - 1.6, 116, 3.2, 70);
    }
    else if (style === "toyplates") {   // 🧸 Ludibrium's toy road: soft cream plastic plates laid in rows, a few in pastel colours, each with its little round studs
      g.fillStyle = "#a99fbe"; g.fillRect(0, 0, U, 192); const pal = ["#d9d1e6", "#d2dbe6", "#ddd3c6", "#d9d1e6", "#d2dbe6", "#f4a9c2", "#9fdcbe", "#a9c4f4", "#f4d779", "#c6aef4"];
      for (let y = 0, row = 0; y < 192; y += 24, row++) for (let x = -(row & 1) * 12; x < U; ) { const w = 24 + Math.floor(r() * 2) * 24, c0 = r() < .72 ? pal[Math.floor(r() * 5)] : pal[5 + Math.floor(r() * 5)];
        g.fillStyle = c0; rr(x + 1, y + 1, w - 2, 22, 3); g.fill(); g.fillStyle = "rgba(255,255,255,.45)"; rr(x + 2, y + 1.6, w - 4, 2, 1); g.fill(); g.fillStyle = "rgba(80,60,110,.16)"; rr(x + 2, y + 20, w - 4, 2, 1); g.fill();
        for (let sx = x + 6; sx < x + w - 2; sx += 12) for (const sy of [y + 6.5, y + 17.5]) { g.fillStyle = "rgba(80,60,110,.14)"; g.beginPath(); g.arc(sx + .6, sy + .8, 3.6, 0, 7); g.fill(); g.fillStyle = c0; g.beginPath(); g.arc(sx, sy, 3.4, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.arc(sx - 1, sy - 1, 1.3, 0, 7); g.fill(); }
        x += w; }
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
    if (style !== "planks" && style !== "toy" && style !== "toyplates" && style !== "asphalt" && style !== "rainbow64" && style !== "farm" && style !== "garden") { g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(3, 0, 2.2, 192); g.fillRect(U - 5.2, 0, 2.2, 192); }   // edge lines
    if (style !== "planks" && style !== "farm" && style !== "garden" && style !== "icy") { g.fillStyle = th.line || "rgba(255,255,255,.8)"; for (let y = 0; y < 192; y += 48) g.fillRect(U / 2 - 1.5, y + 14, 3, 20); }   // centre dashes
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  }
  const curbTex = cc => { const c = canvas(8, 64), g = c.getContext("2d"); g.fillStyle = cc[0]; g.fillRect(0, 0, 8, 32); g.fillStyle = cc[1]; g.fillRect(0, 32, 8, 32);
    g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0, 30, 8, 2); g.fillRect(0, 62, 8, 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t; };
  function ribbon(pts, closed, Wd, roadMat, curbMat, lift, skip = [], bare = [], yf = null) {
    const skipped = i => skip.some(g => i >= g.a && i < g.b), noCurb = i => skipped(i) || bare.some(g => i >= g.a && i < g.b);   // (bare: no curbs, e.g. across a frozen rink)
    const n = pts.length, ang = i => { const a = pts[closed ? (i + n - 2) % n : Math.max(0, i - 2)], b = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const L = [0]; for (let i = 1; i <= n; i++) { if (i === n && !closed) break; const p = pts[i % n], q = pts[i - 1]; L.push(L[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1])); }
    const tot = L[L.length - 1], rv = closed ? Math.max(1, Math.round(tot / 192)) / tot : 1 / 192, rc = closed ? Math.max(1, Math.round(tot / 32)) / tot : 1 / 32;
    const KR = new Float32Array(n).fill(1e9);   // on a bend tighter than the road is wide, the inside edge pinches in, so the road never folds over itself
    { const kp = new Float32Array(n); for (let i = 0; i < n; i++) { if (!closed && (i < 4 || i > n - 5)) continue; const a1 = ang((i + n - 4) % n), a2 = ang((i + 4) % n), p1 = pts[(i + n - 4) % n], p2 = pts[(i + 4) % n]; let d = a2 - a1; d = Math.atan2(Math.sin(d), Math.cos(d)); kp[i] = d / (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1); }
      for (let i = 0; i < n; i++) { let m = 0; for (let k = -6; k <= 6; k++) { const v = kp[closed ? (i + k + n) % n : Math.max(0, Math.min(n - 1, i + k))]; if (Math.abs(v) > Math.abs(m)) m = v; } if (Math.abs(m) > 1e-6) KR[i] = Math.sign(m) * .82 / Math.abs(m); } }
    const rows = closed ? n + 1 : n, K = 8, at = (i, o) => { const p = pts[i % n], a = ang(i % n), lim = KR[i % n]; if (o * lim > 0 && Math.abs(o) > Math.abs(lim)) o = lim; return [p[0] - Math.sin(a) * o, p[1] + Math.cos(a) * o]; };
    // road surface
    const P = [], UV = [], I = [];
    const Y = (x, y, i) => yf ? yf(x, y, i % n) : h(x, y);
    for (let i = 0; i < rows; i++) for (let k = 0; k <= K; k++) { const [x, y] = at(i, -Wd / 2 + Wd * k / K); P.push(x, Y(x, y, i) + lift, y); UV.push(k / K, L[i] * rv); }
    for (let i = 0; i < rows - 1; i++) if (!skipped(i)) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + K + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }   // wound so the surface faces up
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(I); geo.computeVertexNormals();
    // curbs: a low red-and-white kerb each side, with a little wall down to the grass
    const CP = [], CU = [], CI = [], CUR = A.CURB || 14;
    for (const sd of [-1, 1]) {
      const base = CP.length / 3, prof = [[Wd / 2, lift], [Wd / 2, lift + 1.6], [Wd / 2 + CUR, lift + 1.6], [Wd / 2 + CUR + 1.5, -1.5]];
      for (let i = 0; i < rows; i++) for (const [o, dz] of prof) { const [x, y] = at(i, sd * o); CP.push(x, Y(x, y, i) + dz, y); CU.push(.5, L[i] * rc); }
      for (let i = 0; i < rows - 1; i++) if (!noCurb(i)) for (let k = 0; k < 3; k++) { const a = base + i * 4 + k, b = a + 4; CI.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(CP, 3)); cg.setAttribute("uv", new THREE.Float32BufferAttribute(CU, 2)); cg.setIndex(CI);
    const road = new THREE.Mesh(geo, roadMat), curb = new THREE.Mesh(cg, curbMat); scene.add(road, curb); roadObjs.push(road, curb);
    if (yf) {   // 🌈 a floating road has a body: gold sides and a dark underside, so it reads as a solid ribbon in the air (and from below where it crosses)
      const SP = [], SI = [], T0 = 9, ow = Wd / 2 + CUR + 1.5;
      for (let i = 0; i < rows; i++) for (const o of [-ow, ow]) for (const dz of [-1.5, -T0]) { const [x, y] = at(i, o); SP.push(x, Y(x, y, i) + dz, y); }
      for (let i = 0; i < rows - 1; i++) if (!skipped(i)) { const a = i * 4, b = a + 4; SI.push(a, b, a + 1, a + 1, b, b + 1, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(SP, 3)); sg.setIndex(SI); sg.computeVertexNormals();
      const body = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0x3a3050, emissive: 0x0c0a18, side: THREE.DoubleSide })); scene.add(body); roadObjs.push(body); }
    return [road, curb];
  }
  function roadMat(tex, decal, glow) {
    const w = WORLD;
    const m = glow === 2 ? new THREE.MeshStandardMaterial({ map: tex, roughness: .92, metalness: 0, envMapIntensity: .08, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }) : new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });   // (the star road's glass tiles are glossy: they catch reflections)
    if (glow) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = tex; m.emissiveIntensity = glow === 2 ? .5 : .55; }   // (Rainbow Road's tiles glow)
    m.onBeforeCompile = sh => { sh.uniforms.decal = { value: decal };
      sh.vertexShader = "varying vec2 vWXZ;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vWXZ = position.xz;");
      sh.fragmentShader = "uniform sampler2D decal; varying vec2 vWXZ;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        `#include <map_fragment>\n vec4 dc = texture2D(decal, vec2(vWXZ.x / ${w.toFixed(1)}, 1.0 - vWXZ.y / ${w.toFixed(1)})); diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);`)
        .replace("#include <emissivemap_fragment>", glow ? "#include <emissivemap_fragment>\n totalEmissiveRadiance *= (1.0 - dc.a);" : "#include <emissivemap_fragment>"); };   // (on a glowing road, what's painted on it, like a hole, doesn't glow)
    m.customProgramCacheKey = () => "road" + w + (glow ? "g" + glow : "");   // (the world size is baked into the shader, so tracks of different sizes need their own)
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
    if (th.skyroad) { cm.emissive = new THREE.Color(0xffc040); cm.emissiveIntensity = .95; }   // (the sky road's edges glow gold)
    // where a second road (a fork) leaves and rejoins, neither road has curbs across the other: the junction stays open and clean
    const mainBare = [...(t.bare || [])], altBare = [];
    if (t.AN > 1) {
      const runs = (n, test) => { const out = []; for (let i = 0; i < n; i++) if (test(i)) { const l = out[out.length - 1]; if (l && l.b === i) l.b = i + 1; else out.push({ a: i, b: i + 1 }); } return out; };
      const near = (x, y, P, lo, hi, d) => { for (let k = Math.max(0, lo); k < Math.min(P.length, hi); k += 2) if (Math.hypot(P[k][0] - x, P[k][1] - y) < d) return true; return false; };
      const reach = t.ROAD / 2 + t.ALT_ROAD / 2 + t.CURB * 2 + 6;
      altBare.push(...runs(t.AN, j => near(t.ALT[j][0], t.ALT[j][1], t.PTS, t.FORK_A - 80, t.FORK_B + 80, t.ROAD / 2 + t.CURB + t.ALT_ROAD / 2)));
      mainBare.push(...runs(t.N, i => (Math.abs(i - t.FORK_A) < 70 || Math.abs(i - t.FORK_B) < 70) && near(t.PTS[i][0], t.PTS[i][1], t.ALT, 0, t.AN, reach)));
    }
    const mainMat = roadMat(surfaceTex(RS, th, t.ROAD), decal, RS === "rainbow64" ? 2 : RS === "rainbow" || RS === "pastel");
    if (th.clean && !th.skyroad) { const n = t.N, P = t.PTS, ang = i => { const a = P[(i + n - 3) % n], b = P[(i + 3) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); }, bend = new Uint8Array(n);   // ✨ kerbs only round the corners (none down the straights), like a real circuit
      for (let i = 0; i < n; i++) { let d = ang((i + 4) % n) - ang((i + n - 4) % n); d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) / (8 * t.SPC) > 1 / 700) for (let k = -26; k <= 26; k++) bend[(i + k + n) % n] = 1; }
      for (let i = 0; i < n; ) { if (bend[i]) { i++; continue; } let j = i; while (j < n && !bend[j]) j++; mainBare.push({ a: i, b: j }); i = j; } }
    ribbon(t.PTS, !t.OPEN, t.ROAD, mainMat, cm, .5, [...(t.gaps || []), ...(t.hide || [])], mainBare, SKY ? (x, y, i) => surfY(x, y, i) : null);
    lapGapM = []; tideFn = t.tideAt || null; if (!t.water) waterP = null;
    for (const g of (t.gaps || []).filter(g => g.lap)) { const rm = mainMat.clone(), cmm = cm.clone(), ms = ribbon(t.PTS, !t.OPEN, t.ROAD, rm, cmm, .5, [{ a: -1, b: g.a }, { a: g.b, b: t.N + 2 }], []); lapGapM.push({ g, ms }); }   // 🪵 boardwalk that collapses on a later lap
    phantomM = []; for (const g of (t.gaps || []).filter(g => g.phantom)) {   // 👻 the vanishing roads: the same road, on its own, fading in and out
      const rm = mainMat.clone(), cmm = cm.clone(); for (const m of [rm, cmm]) { m.transparent = true; m.depthWrite = false; }
      const meshes = ribbon(t.PTS, !t.OPEN, t.ROAD, rm, cmm, .5, [{ a: -1, b: g.a }, { a: g.b, b: t.N + 2 }], []); phantomM.push({ g, mats: [rm, cmm], fn: t.phantomAt }); }
    fakeM = []; for (const f of t.fakes || []) {   // 🌟 the golden roads that aren't there: a shimmering strip off over the abyss
      const pos = [], idx = [], W2 = t.ROAD * .45; f.forEach(([x, z], k) => { const nx = k < f.length - 1 ? f[k + 1][0] - x : x - f[k - 1][0], nz = k < f.length - 1 ? f[k + 1][1] - z : z - f[k - 1][1], l = Math.hypot(nx, nz) || 1, ox = -nz / l * W2, oz = nx / l * W2, y = h(f[0][0], f[0][1]) + 1;
        pos.push(x + ox, y, z + oz, x - ox, y, z - oz); if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ map: fakeTex(), color: 0xffe08a, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(g, mat); scene.add(m); roadObjs.push(m); fakeM.push({ m, mat, x: f[3][0], z: f[3][1] }); }
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
      if (cv.girders) { const cols = [0xff6a8a, 0x5ab4ff, 0xffd23f, 0x6ad89a, 0xb48aff], ox = t.ROAD / 2 + t.CURB + 26, ph = 150;   // 🏭 the factory hall: colourful steel girders arching over the road, a lamp under every other one (no roof: you see the sky)
        for (let i = cv.a + 4, n = 0; i < cv.b - 2; i += 14, n++) { const p = t.PTS[i % t.N], q = t.PTS[(i + 2) % t.N], p0 = t.PTS[(i - 2 + t.N) % t.N], a = Math.atan2(q[1] - p0[1], q[0] - p0[0]), g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: cols[n % 5], emissive: new THREE.Color(cols[n % 5]).multiplyScalar(.15) });
          g.position.set(p[0], RE[i % t.N] - 4, p[1]); g.rotation.y = -a;
          for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(14, ph, 14), m); post.position.set(0, ph / 2, sd * ox); g.add(post); const br = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 8), m); br.position.set(0, ph - 26, sd * (ox - 22)); br.rotation.x = sd * .78; g.add(br); }
          const beam = new THREE.Mesh(new THREE.BoxGeometry(16, 16, ox * 2 + 18), m); beam.position.y = ph + 6; g.add(beam);
          if (n % 2 === 0) { const l = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); l.position.y = ph - 14; g.add(l); const cord = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 18, 4), new THREE.MeshLambertMaterial({ color: 0x333333 })); cord.position.y = ph - 3; g.add(cord); }
          scene.add(g); roadObjs.push(g); }
        continue; }
      const R0 = cv.half || t.ROAD / 2 + t.CURB + 14, HTR = cv.half ? .85 : .72, EXT = cv.half ? .2 : 0;   // (the crystal cave is a big one)
      shell(R0, cv.star ? new THREE.MeshBasicMaterial({ map: starTex(), side: THREE.DoubleSide }) : cv.temple ? new THREE.MeshLambertMaterial({ map: goldTex(), side: THREE.DoubleSide, emissive: 0x3a2a10 }) : cv.rock ? new THREE.MeshLambertMaterial({ map: rockTex(), side: THREE.DoubleSide, color: t.theme.cave ? 0xd8b070 : cv.warm ? 0xb08870 : 0xffffff, emissive: t.theme.cave ? 0x3a2408 : cv.warm ? 0x2a120a : 0x2a2630 }) : cv.crystal ? new THREE.MeshLambertMaterial({ map: caveTex(), color: 0x5a6fa8, side: THREE.DoubleSide, emissive: 0x0a1838 }) : new THREE.MeshLambertMaterial({ map: caveTex(), side: THREE.DoubleSide, emissive: 0x1d4f7a }), HTR, EXT);   // (the crystal cave is dark inside: its glowing crystals light it)   // the crystal (or rock) inside
      shell(R0 + 16, cv.crystal ? new THREE.MeshLambertMaterial({ color: 0xbfdcff, side: THREE.DoubleSide, emissive: 0x2a4a7a, flatShading: true }) : new THREE.MeshLambertMaterial({ color: cv.temple ? 0xb89a5a : cv.mound != null ? cv.mound : 0xeef5fc, side: THREE.DoubleSide, emissive: cv.temple ? 0x2a2010 : cv.warm ? 0x1a0e08 : 0x2a3a50 }), HTR + .08, EXT);
      if (cv.crystal) crystalCave(t, cv, R0, R0 * HTR);                // a mound of snow over it
      if (cv.timber) { const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a30, emissive: 0x2a1406, flatShading: true }), lamp = new THREE.MeshBasicMaterial({ color: 0xffc860 }), ox = R0 * .74, ph = R0 * HTR * .66;   // ⛏ timber mine supports every few metres, with a lamp hanging from every other one
        for (let i = cv.a + 6, n = 0; i < cv.b - 4; i += 12, n++) { const p = t.PTS[i % t.N], q = t.PTS[(i + 2) % t.N], p0 = t.PTS[(i - 2 + t.N) % t.N], a = Math.atan2(q[1] - p0[1], q[0] - p0[0]), base = RE[i % t.N], g = new THREE.Group(); g.position.set(p[0], base - 6, p[1]); g.rotation.y = -a;
          for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(12, ph + 10, 12), wood); post.position.set(0, (ph + 10) / 2, sd * ox); g.add(post); const br = new THREE.Mesh(new THREE.BoxGeometry(8, 44, 8), wood); br.position.set(0, ph - 14, sd * (ox - 18)); br.rotation.x = sd * .8; g.add(br); }
          const beam = new THREE.Mesh(new THREE.BoxGeometry(14, 12, ox * 2 + 16), wood); beam.position.y = ph + 8; g.add(beam);
          if (n % 2 === 0) { const l = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), lamp); l.position.y = ph - 8; g.add(l); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xffa040, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.set(90, 90, 1); gl.position.y = ph - 8; g.add(gl); }
          scene.add(g); roadObjs.push(g); } }
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
      const g = new THREE.Group(), lava = new THREE.Mesh(new THREE.CircleGeometry(hl.r, 28), new THREE.MeshBasicMaterial(hl.water ? { color: 0x101a2a } : t.tiles && t.tiles.moltenRock ? { map: (() => { const tx = new THREE.CanvasTexture(t.tiles.moltenRock); tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(hl.r / 60, hl.r / 40); return tx; })() } : { color: 0xff5a1a })), rim = new THREE.Mesh(new THREE.RingGeometry(hl.r, hl.r + (hl.water ? 6 : 10), hl.water ? 9 : 28), new THREE.MeshBasicMaterial({ color: hl.water ? 0x4a3420 : 0x2a1a14 }));   // (a rotten hole: dark water, splintered edges)
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
    { const done = new Set(), iron = new THREE.MeshLambertMaterial({ color: 0x8a8a90, emissive: 0x1a1a1c }), wood = new THREE.MeshLambertMaterial({ color: 0x4a3420, emissive: 0x0a0604 });   // 🛤 the rails the carts run on
      for (const c of t.carts || []) { const key = c.a + "," + c.b + "," + c.o; if (done.has(key)) continue; done.add(key); const P = t.PTS, N = t.N, sl = [];
        for (const sd of [-11, 11]) { const pts = []; for (let i = c.a; i <= c.b; i += 2) { const p = P[i % N], q = P[(i + 2) % N], a = Math.atan2(q[1] - p[1], q[0] - p[0]), o = (c.o || 0) + sd, x = p[0] - Math.sin(a) * o, z = p[1] + Math.cos(a) * o; pts.push(new THREE.Vector3(x, h(x, z) + 1.6, z)); if (sd < 0 && (i - c.a) % 4 === 0) sl.push([p[0] - Math.sin(a) * (c.o || 0), p[1] + Math.cos(a) * (c.o || 0), a]); }
          if (pts.length > 1) { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 1.4, 4), iron); scene.add(m); roadObjs.push(m); } }
        const im = new THREE.InstancedMesh(BOX, wood, sl.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), U = new THREE.Vector3(0, 1, 0);
        sl.forEach(([x, z, a], n) => { Q.setFromAxisAngle(U, -a); M.compose(new THREE.Vector3(x, h(x, z) + .6, z), Q, new THREE.Vector3(5, 1.6, 30)); im.setMatrixAt(n, M); }); scene.add(im); roadObjs.push(im); } }
    for (const c of t.carts || []) { const g = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x6a4424 }), gold = new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x6a4a00 }), iron = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
      const tub = new THREE.Mesh(BOX, wood); tub.scale.set(40, 18, 26); tub.position.y = 14; g.add(tub); const ore = new THREE.Mesh(new THREE.SphereGeometry(14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold); ore.scale.set(1.3, .8, .85); ore.position.y = 23; g.add(ore);
      for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) { const w = new THREE.Mesh(CYL, iron); w.scale.set(5, 3, 5); w.rotation.x = Math.PI / 2; w.position.set(x, 5, z); g.add(w); }
      scene.add(g); roadObjs.push(g); cartM.push({ c, g }); }
    thw = []; thFn = t.thz || null;
    for (const th of t.thwomps || []) { if (th.golem) { const m = fireGolemModel(); m.rotation.y = -(th.ra || 0) + Math.PI; scene.add(m); roadObjs.push(m);   // 🔥 a Fire Golem instead of a stone block (it faces the karts coming at it)
        const sh = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; scene.add(sh); roadObjs.push(sh);
        const ring = new THREE.Mesh(new THREE.RingGeometry(.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; scene.add(ring); roadObjs.push(ring);
        thw.push({ th, m, sh, ring, g: h(th.x, th.y), golem: true }); continue; }
      const fm = new THREE.MeshLambertMaterial({ map: faceTex(), color: th.col || 0xffffff, emissive: th.col ? 0x202020 : 0 }), top = new THREE.MeshLambertMaterial({ color: th.col || 0x7a7f8a });
      const m = new THREE.Mesh(BOX, [fm, fm, top, top, fm, fm]); m.scale.set(74, 62, 74); m.rotation.y = -(th.a || 0); scene.add(m); roadObjs.push(m);
      const sh = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; scene.add(sh); roadObjs.push(sh);
      thw.push({ th, m, sh, g: h(th.x, th.y) }); }
    buildGeysers(t); buildZakum(t); buildToy(t); buildGreenery(t); buildStar(t); awakeK = 0; lavaLk = null;
    if (t.lake && t.lake.kind === "lava") { const L = t.lake, hs = []; for (let a = 0; a < 6.283; a += .2) for (const r of [.3, .6, .9]) hs.push(h(L.cx + Math.cos(a) * L.rx * r, L.cy + Math.sin(a) * L.ry * r)); hs.sort((p, q) => p - q);   // 🔥 a lake of glowing lava filling the hollow (the banks stand out of it as rock)
      let rmin = 1e9; for (let i = 0; i < t.N; i++) if (((t.PTS[i][0] - L.cx) / L.rx) ** 2 + ((t.PTS[i][1] - L.cy) / L.ry) ** 2 < 1.2) rmin = Math.min(rmin, RE[i]);   // (well below the bridge)
      const lv = L.level ?? Math.min(hs[Math.floor(hs.length * .3)] + 12, rmin - 55), tx = lavaSeaTex();
      tx.repeat.set(L.rx / 160, L.ry / 160); const m = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ map: tx })); m.rotation.x = -Math.PI / 2; m.scale.set(L.rx * 1.25, L.ry * 1.25, 1); m.position.set(L.cx, lv, L.cy); scene.add(m); roadObjs.push(m);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: glowDisc(), color: 0xff6a1a, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false })); gl.rotation.x = -Math.PI / 2; gl.scale.set(L.rx * 1.6, L.ry * 1.6, 1); gl.position.set(L.cx, lv + 3, L.cy); scene.add(gl); roadObjs.push(gl);
      lavaLk = { tx, m, lv }; }
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
    balloonM = []; flowM = []; golemM = []; flameM = []; for (const o of t.props3d || []) buildProp(o);
    bridgeG = (t.gaps || []).filter(g => g.kind === "bridge"); buildRopeBridges(t);
    gondM = []; if (t.cave) buildCave(t); if (t.trunk) buildTrunk(t.trunk); if (t.temple) buildTemple(t, t.temple); if (t.cable) buildCableCar(t.cable); for (const f of t.icefalls || []) buildIcefall(f); for (const l of t.ledges || []) if (l.side && l.wall) buildCliffWall(t, l);
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
      if (g.lava) { const sz = Math.max(900, Math.hypot(p1.x - p0.x, p1.y - p0.y) + 500), tx = lavaSeaTex(); tx.repeat.set(sz / 260, sz / 260); const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ map: tx, color: 0xffb070 })); m.rotation.x = -Math.PI / 2; m.position.set(mx, base - (g.depth ?? 320) + 30, my); scene.add(m); roadObjs.push(m); continue; }   // 🔥 a fissure with lava glowing at the bottom
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
    for (const g of bridgeG) { const half = g.deck + 6, pts = []; if (g.phantom) continue;
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
  let fakeT = null; const fakeTex = () => fakeT || (fakeT = ctex(64, 64, (g, W) => { g.fillStyle = "#c89a40"; g.fillRect(0, 0, W, W); g.fillStyle = "#e8c070"; for (let y = 0; y < W; y += 16) for (let x = (y / 16 % 2) * 8; x < W; x += 16) g.fillRect(x + 1, y + 1, 14, 14); }, true));   // (a golden cobbled road, like the real one)
  let caveMat = null, caveRoof = null;
  function caveSkin(im) { const mk = rep => { const tx = new THREE.CanvasTexture(im); tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(rep, rep); return tx; };
    if (caveRoof) { caveRoof.map = mk(4); caveRoof.color.setHex(0xa88a60); caveRoof.needsUpdate = true; } if (caveMat) { caveMat.map = mk(1); caveMat.color.setHex(0xffffff); caveMat.needsUpdate = true; } }
  function buildCave(t) {   // ⛏ the gold mine: a rock roof over everything with stalactites, stalagmite columns, glittering gold crystals, timber supports over the road with lanterns
    let lo = 1e9, hi = -1e9; for (let i = 0; i < t.N; i++) { lo = Math.min(lo, RE[i]); hi = Math.max(hi, RE[i]); } const top = hi + 560, rock = caveRoof = new THREE.MeshBasicMaterial({ map: rockTex(), color: 0x8a6a40, side: THREE.DoubleSide, fog: false });   // (the roof shows the cave picture, unfogged: it's what you see overhead)
    caveMat = new THREE.MeshLambertMaterial({ map: rockTex(), color: 0x8a6a40, emissive: 0x2a1a06 });
    if (t.sky) caveSkin(t.sky);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, WORLD * 3, 40, 40), rock), pa = roof.geometry.attributes.position; for (let v = 0; v < pa.count; v++) pa.setZ(v, Math.sin(pa.getX(v) * .004) * 60 + Math.sin(pa.getY(v) * .005) * 60);
    roof.geometry.computeVertexNormals(); roof.rotation.x = Math.PI / 2; roof.position.set(WORLD / 2, top, WORLD / 2); scene.add(roof); roadObjs.push(roof);
    let sd = 41; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647, cone = new THREE.ConeGeometry(1, 1, 7), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), U = new THREE.Vector3(1, 0, 0);
    const stal = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ map: rockTex(), color: 0x9a7a4a, emissive: 0x1a1006 }), 360); Q.setFromAxisAngle(U, Math.PI);
    for (let n = 0; n < 360; n++) { const x = rnd() * WORLD, z = rnd() * WORLD, L2 = 60 + rnd() * 220, r = 10 + rnd() * 26; M.compose(new THREE.Vector3(x, top - L2 / 2 + 20, z), Q, new THREE.Vector3(r, L2, r)); stal.setMatrixAt(n, M); } scene.add(stal); roadObjs.push(stal);
    const col = (x, z) => { const g = h(x, z), hh = top - g; const m = new THREE.Mesh(new THREE.CylinderGeometry(40, 70, hh, 9), caveMat); m.position.set(x, g + hh / 2, z); scene.add(m); roadObjs.push(m); };
    for (let n = 0, tries = 0; n < 18 && tries < 400; tries++) { const x = rnd() * WORLD, z = rnd() * WORLD; let md = 1e9; for (let i = 0; i < t.N; i += 4) md = Math.min(md, Math.hypot(t.PTS[i][0] - x, t.PTS[i][1] - z)); if (md > t.ROAD / 2 + 220) { col(x, z); n++; } }   // great rock columns from floor to roof
    for (let n = 0, tries = 0; n < 26 && tries < 500; tries++) { const x = rnd() * WORLD, z = rnd() * WORLD; let md = 1e9; for (let i = 0; i < t.N; i += 4) md = Math.min(md, Math.hypot(t.PTS[i][0] - x, t.PTS[i][1] - z)); if (md < t.ROAD / 2 + 90 || md > t.ROAD / 2 + 420) continue;
      const g = gemCluster(0xffc840, 40 + rnd() * 70, 8 + rnd() * 8, rnd() * 6); g.position.set(x, h(x, z) - 4, z); scene.add(g); roadObjs.push(g); addGlow(x, h(x, z), z, 60, 0xffc040); n++; }   // gold crystals in the rock
    const beam = new THREE.MeshLambertMaterial({ color: 0x6a4424, emissive: 0x140a04 }), lamp = new THREE.MeshBasicMaterial({ color: 0xffc860 }), half = t.ROAD / 2 + t.CURB + 12;
    for (const sp of t.supports || []) for (let i = sp.a; i <= sp.b; i += 22) { const P = t.PTS, N = t.N, p = P[i % N], q = P[(i + 2) % N], a = Math.atan2(q[1] - p[1], q[0] - p[0]), y = RE[i % N], g2 = new THREE.Group();   // timber frames across the road
      for (const s2 of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(10, 120, 10), beam); post.position.set(0, 60, s2 * half); g2.add(post); const br = new THREE.Mesh(new THREE.BoxGeometry(6, 40, 6), beam); br.position.set(0, 104, s2 * (half - 14)); br.rotation.x = s2 * .8; g2.add(br); }
      const top2 = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 2 * half + 20), beam); top2.position.y = 124; g2.add(top2); const lm = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), lamp); lm.position.set(0, 108, 0); g2.add(lm);
      g2.position.set(p[0], y, p[1]); g2.rotation.y = -a; scene.add(g2); roadObjs.push(g2); }
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
  function tntModel() {   // 🧨 a TNT block: red sides with a white band reading TNT, a dark top, a fuse with a spark
    const g = new THREE.Group(), tex = ctex(128, 128, (c, W) => { c.fillStyle = "#d8302a"; c.fillRect(0, 0, W, W); c.fillStyle = "#b02018"; for (let x = 0; x < W; x += 32) c.fillRect(x, 0, 4, W); c.fillStyle = "#f4f0e8"; c.fillRect(0, 44, W, 40);
      c.fillStyle = "#1a1a1a"; c.font = "900 34px Ubuntu, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("TNT", W / 2, 65); });
    const side = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a0806 }), topM = new THREE.MeshLambertMaterial({ color: 0x5a4a3a, emissive: 0x100a06 }); side.userData.e0 = 0x2a0806; topM.userData.e0 = 0x100a06;
    const b = new THREE.Mesh(new THREE.BoxGeometry(34, 34, 34), [side, side, topM, topM, side, side]); b.position.y = 17; g.add(b);
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 14, 5), new THREE.MeshLambertMaterial({ color: 0x3a3a3a })); fuse.position.set(4, 40, 3); fuse.rotation.z = .4; g.add(fuse);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd860 })); spark.position.set(7, 47, 3); spark.visible = false; g.add(spark);
    g.userData.flash = [side, topM]; g.userData.spark = spark; return g;
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
    if (o.k === "zkpillar") {   // 🔥 a ruined basalt column of the Golem Gauntlet: a chunky stepped base, an eight-sided shaft with a gold band, and a brazier of fire on top (some are broken off halfway, smouldering)
      const rk = lavaMat(), gd = L(0xd8a040, 0x4a3010), H0 = o.broken ? 95 : 170;
      put(new THREE.CylinderGeometry(34, 38, 18, 8), rk, 0, 9, 0); put(new THREE.CylinderGeometry(28, 32, 14, 8), rk, 0, 25, 0);
      const sh = put(new THREE.CylinderGeometry(20, 24, H0, 8), rk, 0, 32 + H0 / 2, 0); if (o.broken) sh.rotation.z = .08;
      put(new THREE.CylinderGeometry(25, 25, 8, 8), gd, 0, 32 + H0 * .62, 0);
      const fl = [];
      if (!o.broken) { put(new THREE.CylinderGeometry(30, 24, 10, 8), rk, 0, 32 + H0 + 5, 0); const bowl = put(new THREE.CylinderGeometry(30, 16, 18, 10, 1, true), gd, 0, 32 + H0 + 19, 0); bowl.material = bowl.material.clone(); bowl.material.side = THREE.DoubleSide;
        put(new THREE.CircleGeometry(26, 12), new THREE.MeshBasicMaterial({ color: 0xff7a1a }), 0, 32 + H0 + 24, 0).rotation.x = -Math.PI / 2;
        for (const [x, z, hh, r] of [[0, 0, 46, 15], [-9, 6, 30, 9], [8, -7, 32, 9], [6, 9, 24, 7]]) for (const [c, k] of [[0xff5a1a, 1], [0xffd23f, .55]]) { const m = put(new THREE.ConeGeometry(r * k, hh * k, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9 }), x, 32 + H0 + 24 + hh * k / 2, z); fl.push({ m, ph: x * 3 + z + o.x }); }
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xff7a2a, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.set(130, 130, 1); gl.position.set(0, 32 + H0 + 40, 0); grp.add(gl); fl.push({ m: gl, ph: o.y, glow: true }); }
      else for (let k = 0; k < 4; k++) { const r = put(new THREE.DodecahedronGeometry(10 + k * 3, 0), rk, (k - 1.5) * 22, 8, 30 + (k % 2) * 12); r.rotation.set(k, k * 2, 0); }   // its broken top lying beside it
      grp.position.set(o.x, g0, o.y); flameM.push(...fl);
    } else if (o.k === "gazebo") {   // a round white floor, six slim pillars, a pink dome with a white scalloped rim and a gold knob on top
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
  let rockT = null, damT = null, goldT = null, faceT = null, thw = [], thFn = null, cartM = [], cartFn = null, fireM = [], fireFn = null, holeM = [], lapFn = null, clockM = null, fountM = null, balloonM = [], auroraM = [], flowM = [], gondM = [], golemM = [], phantomM = [], fakeM = [], flameM = [];
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
    if (t.theme.nightsky) { topCol = t.theme.sky; const gr = g.createLinearGradient(0, 0, 0, hor); gr.addColorStop(0, "#03141a"); gr.addColorStop(.55, topCol); gr.addColorStop(1, "#1d5560"); g.fillStyle = gr; g.fillRect(0, 0, 4096, hor + 2);   // 🌌 a deep teal night sky full of stars
      let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647; for (let k = 0; k < 1400; k++) { const y = rnd() * hor * .95, a = .25 + rnd() * .75 * (1 - y / hor * .6); g.fillStyle = `rgba(255,${235 + rnd() * 20 | 0},${200 + rnd() * 55 | 0},${a})`; const sz = rnd() < .06 ? 2.2 : 1.1; g.fillRect(rnd() * 4096, y, sz, sz); }
      for (const [mx, my] of [[900, hor * .32]]) { const gl = g.createRadialGradient(mx, my, 10, mx, my, 120); gl.addColorStop(0, "rgba(240,250,255,.9)"); gl.addColorStop(.2, "rgba(220,240,255,.35)"); gl.addColorStop(1, "rgba(200,230,255,0)"); g.fillStyle = gl; g.fillRect(mx - 120, my - 120, 240, 240); g.fillStyle = "#f4fbff"; g.beginPath(); g.arc(mx, my, 22, 0, 7); g.fill(); } }   // 🌕 the moon
    if (t.sky && !t.theme.nightsky) { const tile = t.theme.skyMirror ? t.sky : seamless(t.sky), sh = picH, n = Math.max(1, Math.round(4096 / (tile.width * sh / tile.height * ax))), sw = 4096 / n;   // the same way round every time (no mirrored copies), joins blended away
      for (let i = 0; i < n; i++) g.drawImage(tile, i * sw, top, sw + .5, sh);
      if (t.moon) { const mx = 1250, my = top + sh * .26, r = 70, gl = g.createRadialGradient(mx, my, r * .7, mx, my, r * 2.4);   // 🌕 El Nath's own full moon (maplestory.io), once (the sky goes round twice, so its twin is always behind you)
        gl.addColorStop(0, "rgba(255,248,200,.35)"); gl.addColorStop(1, "rgba(255,248,200,0)"); g.fillStyle = gl; g.fillRect(mx - r * 3, my - r * 3, r * 6, r * 6); g.drawImage(t.moon, mx - r, my - r, r * 2, r * 2); }
      if (!t.theme.skyFull) { const fade = g.createLinearGradient(0, top, 0, top + sh * .35); fade.addColorStop(0, topCol); fade.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = fade; g.fillRect(0, top, 4096, sh * .35); } }   // the picture's top melts into the sky above it (unless it covers it all: the Golden Cave)
    if (t.strip && !t.theme.nightsky) { const sh = 420 * pyU, sw = 4096 / Math.max(1, Math.round(4096 / (t.strip.width * sh / t.strip.height * ax))); for (let x = 0; x < 4096; x += sw) g.drawImage(t.strip, x, hor + 6 - sh, sw + 1, sh); }
    g.fillStyle = t.theme.grass ? t.theme.grass[0] : "#4a8a3a"; g.fillRect(0, t.strip ? hor + 6 : hor, 4096, 1024);
    if (t.theme.nightsky) { const gr = g.createLinearGradient(0, hor, 0, 1024); gr.addColorStop(0, "#2a5a60"); gr.addColorStop(.08, "#183a40"); gr.addColorStop(1, "#08161c"); g.fillStyle = gr; g.fillRect(0, hor, 4096, 1024 - hor);   // 🏙 the city's lights reaching to the horizon, misty far away
      let sd = 21; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647; for (let k = 0; k < 9000; k++) { const v = rnd(), y = hor + 1 + v * v * (1024 - hor); g.fillStyle = ["#ffcf8a", "#fff0d0", "#ffa860", "#bfe0ff"][k & 3]; g.globalAlpha = .25 + rnd() * .55 * (1 - v * .5); g.fillRect(rnd() * 4096, y, 1.3, 1); } g.globalAlpha = 1;
      const gl = g.createLinearGradient(0, hor - 30, 0, hor + 40); gl.addColorStop(0, "rgba(255,190,120,0)"); gl.addColorStop(.5, "rgba(255,190,120,.22)"); gl.addColorStop(1, "rgba(255,190,120,0)"); g.fillStyle = gl; g.fillRect(0, hor - 30, 4096, 70); }   // (no strip: the ground meets the picture, no dark gap)
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.repeat.x = -2; map.anisotropy = aniso;
    if (skyMesh) { scene.remove(skyMesh); skyMesh.material.map.dispose(); skyMesh.material.dispose(); }
    skyMesh = new THREE.Mesh(new THREE.CylinderGeometry(SKY_R, SKY_R, SKY_H, 64, 1, true), new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -1; scene.add(skyMesh);
    if (skyDome) { scene.remove(skyDome); skyDome.geometry.dispose(); skyDome.material.dispose(); skyDome = null; }
    if (t.theme.clean) { const zen = new THREE.Color(t.theme.zenith || 0x3f86e0), hc = new THREE.Color(topCol);   // ✨ above the painted sky: a smooth gradient dome (no hard rim when the low camera looks up)
      skyDome = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * 1.3, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { hc: { value: hc }, zc: { value: zen } },
        vertexShader: "varying float vy; void main() { vy = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
        fragmentShader: "uniform vec3 hc, zc; varying float vy; void main() { gl_FragColor = vec4(mix(hc, zc, smoothstep(.62, .98, vy)), 1.); }" }));
      skyDome.renderOrder = -2; scene.add(skyDome); }
    if (caveMat && t.sky) caveSkin(t.sky);   // ⛏ the cave picture on the roof and the columns too
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
    if (!g) { g = kind === "freezie" ? freezieModel() : kind === "snowball" ? snowballModel() : kind === "stoneball" ? snowballModel(true) : kind === "tnt" ? tntModel() : kind === "rock" ? rockModel() : new THREE.Group(); scene.add(g); P.list.push(g); }
    g.visible = true;
    if (kind === "tnt") { const lit = z < 0; g.position.set(x, h(x, y) + (lit ? Math.abs(Math.sin(tt * 30)) * 2 : 0), y); g.rotation.set(0, -a, 0); const s2 = lit ? 1 + Math.abs(Math.sin(tt * 18)) * .08 : 1; g.scale.set(s2, s2, s2); for (const m of g.userData.flash) m.emissive.setHex(lit && Math.sin(tt * 22) > 0 ? 0xffffff : m.userData.e0); g.userData.spark.visible = lit; if (lit) g.userData.spark.scale.setScalar(.7 + Math.random() * .8); return; }   // 🧨 (lit: it flashes white, swells and sparks)
    if (kind === "rock") { g.position.set(x, h(x, y) + 22 + (z || 0), y); g.rotation.set(tt * 5 + x, tt * 3, 0); return; }   // 🪨 a lava rock falling from the mine roof
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
  const RBC = {};
  function makeKart(color, ghost, family) {
    const o = ghost ? { transparent: true, opacity: .42, depthWrite: false } : {};
    const P2 = FX.ready, phys = (c, x) => new THREE.MeshPhysicalMaterial({ color: c, ...x, ...o });   // (with the studio reflections loaded: glossy clear-coat paint and real metal)
    const paint = P2 ? phys(color, { roughness: .32, metalness: .12, clearcoat: 1, clearcoatRoughness: .07 }) : mat(color, { shininess: 80, specular: 0x666666, ...o }), dark = P2 ? phys(0x23202a, { roughness: .55, metalness: .3 }) : mat(0x23202a, o), tire = P2 ? phys(0x18161c, { roughness: .85 }) : mat(0x18161c, { shininess: 10, ...o }),
      gold = P2 ? phys(0xf0b83a, { roughness: .2, metalness: 1 }) : mat(0xe8b43a, { shininess: 90, specular: 0x886622, ...o }), white = P2 ? phys(0xffffff, { roughness: .3, clearcoat: .6 }) : mat(0xffffff, o), metal = P2 ? phys(0xc0c6d0, { roughness: .18, metalness: 1 }) : mat(0x9aa0aa, { shininess: 100, specular: 0xaaaaaa, ...o }), trim = family ? gold : white;
    const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group(); root.add(tilt); tilt.add(body);
    const add = (m, w, hh, d, x, y, z) => { let me; if (FX.RoundBox && w > 1.5 && hh > 1.5 && d > 1.5) { const k = w + "," + hh + "," + d; const geo = RBC[k] || (RBC[k] = new FX.RoundBox(w, hh, d, 2, Math.min(w, hh, d) * .3)); me = new THREE.Mesh(geo, m); } else { me = new THREE.Mesh(BOX, m); me.scale.set(w, hh, d); } me.position.set(x, y, z); body.add(me); return me; };   // (rounded edges, like a real toy kart)
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
    const H = SKY && r.idx != null ? (x, y) => surfAt(x, y, r.idx) : h;   // (on the sky road: the road's own height, even where it crosses itself)
    m.root.position.set(gx, (SKY && r.idx != null ? surfY(gx, gy, r.idx) : h(gx, gy)) + (SKY ? 0 : m.lift), gy); m.root.rotation.y = -a;
    // lean with the ground: nose up on a climb, tipped on a side slope
    const f = H(gx + ca * 11, gy + sa * 11) - H(gx - ca * 11, gy - sa * 11), sd = H(gx - sa * 8, gy + ca * 8) - H(gx + sa * 8, gy - ca * 8);
    m.tilt.rotation.set(Math.atan2(sd, 16) * (SKY ? 1 : .9), 0, Math.atan2(f, 22));
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
  let lavaRk = null;
  function lavaRockTex() {   // 🔥 black basalt cracked through with glowing lava: [the rock picture, the glow only (for emissiveMap)]
    if (lavaRk) return lavaRk; let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647, cracks = [];
    for (let n = 0; n < 9; n++) { let x = rnd() * 256, y = rnd() * 256, a = rnd() * 6.3; const pts = [[x, y]]; for (let q = 0; q < 7; q++) { a += (rnd() - .5) * 1.4; x += Math.cos(a) * 18; y += Math.sin(a) * 18; pts.push([x, y]); } cracks.push(pts); }
    const lines = (g, glow) => { for (const [w, c] of glow ? [[9, "rgba(255,90,10,.35)"], [4, "#ff8a1a"], [1.6, "#ffe080"]] : [[4, "#ff7a1a"], [1.6, "#ffd860"]]) { g.strokeStyle = c; g.lineWidth = w; g.lineCap = "round"; for (const pts of cracks) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); } } };
    sd = 7; const rock = ctex(256, 256, (g, W) => { g.fillStyle = "#2c2422"; g.fillRect(0, 0, W, W); for (let n = 0; n < 160; n++) { const v = 30 + rnd() * 40 | 0; g.fillStyle = `rgb(${v + 6},${v},${v - 4})`; g.beginPath(); g.arc(rnd() * W, rnd() * W, 4 + rnd() * 16, 0, 7); g.fill(); } lines(g, false); });
    const glow = ctex(256, 256, (g, W) => { g.fillStyle = "#000"; g.fillRect(0, 0, W, W); lines(g, true); });
    return (lavaRk = [rock, glow]);
  }
  const lavaMat = (o = {}) => new THREE.MeshLambertMaterial({ map: lavaRockTex()[0], emissiveMap: lavaRockTex()[1], emissive: 0xffffff, flatShading: true, ...o });
  function fireGolemModel() {   // 🔥 a cute, chubby Fire Golem: a round lump of black lava rock with glowing cracks, big angry-cute glowing eyes, a pout, stubby fists, a little flame tuft on top
    const g = new THREE.Group(), S1 = new THREE.SphereGeometry(1, 16, 12), rk = lavaMat(), bk = new THREE.MeshBasicMaterial({ color: 0x1a0a06 }), eyeM = new THREE.MeshBasicMaterial({ color: 0xffe27a }), hot = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
    const bg = new THREE.SphereGeometry(1, 28, 20), pa = bg.attributes.position;   // a rounded, lumpy block
    for (let v = 0; v < pa.count; v++) { const f = q => Math.sign(q) * Math.pow(Math.abs(q), .6), x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v), n = 1 + .05 * Math.sin(x * 7 + z * 5) * Math.cos(y * 6); pa.setXYZ(v, f(x) * n, f(y) * n, f(z) * n); }
    bg.computeVertexNormals(); const body = new THREE.Mesh(bg, rk); body.scale.set(37, 31, 37); body.position.y = 33; g.add(body);
    for (const z of [-1, 1]) {
      const e = new THREE.Mesh(S1, eyeM); e.scale.set(3, 9, 7); e.position.set(35, 40, z * 12); g.add(e);   // big glowing eyes
      const pu = new THREE.Mesh(S1, bk); pu.scale.set(2, 5, 3.6); pu.position.set(37, 38, z * 10.5); g.add(pu);   // pupils looking up the road
      const sp = new THREE.Mesh(S1, new THREE.MeshBasicMaterial({ color: 0xffffff })); sp.scale.setScalar(1.6); sp.position.set(38.6, 41, z * 9.6); g.add(sp);
      const br = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 15), bk); br.position.set(35, 52, z * 12); br.rotation.x = z * .42; g.add(br);   // grumpy brows
      const ch = new THREE.Mesh(S1, hot); ch.scale.set(1.5, 3.6, 5.6); ch.position.set(33.5, 29, z * 21); g.add(ch);   // glowing cheeks
      const fi = new THREE.Mesh(S1, rk); fi.scale.set(13, 12, 13); fi.position.set(14, 12, z * 41); g.add(fi);   // big round fists (they hit the ground first)
      const ft = new THREE.Mesh(S1, rk); ft.scale.set(11, 7, 10); ft.position.set(4, 5, z * 16); g.add(ft); }
    const mo = new THREE.Mesh(new THREE.TorusGeometry(4.5, 1.1, 6, 16, Math.PI), hot); mo.rotation.set(0, Math.PI / 2, 0); mo.position.set(36, 24, 0); g.add(mo);   // a pout (a little upside-down smile)
    const fl = []; for (const [x, z, hh, r] of [[0, 0, 30, 10], [-8, 9, 20, 7], [-6, -10, 22, 7], [7, 4, 16, 6]]) for (const [c, k] of [[0xff5a1a, 1], [0xffd23f, .55]]) {   // a flickering flame tuft
      const m = new THREE.Mesh(new THREE.ConeGeometry(r * k, hh * k, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .92 })); m.position.set(x, 62 + hh * k / 2, z); g.add(m); fl.push({ m, hh: hh * k, ph: x + z }); }
    g.userData.fl = fl; g.userData.body = body; return g;
  }
  function rockModel() { const geo = new THREE.DodecahedronGeometry(24, 1), pa = geo.attributes.position; for (let v = 0; v < pa.count; v++) { const k = 1 + .18 * Math.sin(pa.getX(v) * .4 + pa.getY(v) * .3) * Math.cos(pa.getZ(v) * .35); pa.setXYZ(v, pa.getX(v) * k, pa.getY(v) * k * .85, pa.getZ(v) * k); } geo.computeVertexNormals(); const g = new THREE.Group(); g.add(new THREE.Mesh(geo, lavaMat())); return g; }
  function lavaSeaTex() { return ctex(256, 256, (g, W) => { g.fillStyle = "#e8481a"; g.fillRect(0, 0, W, W);   // smooth churning lava: soft bright and dark blobs (drawn wrapped round, so it tiles seamlessly) and glowing veins
    const wrap = f => { for (const dx of [-W, 0, W]) for (const dy of [-W, 0, W]) f(dx, dy); };
    for (let n = 0; n < 70; n++) { const x = Math.random() * W, y = Math.random() * W, r = 10 + Math.random() * 36, c0 = n % 3 ? "rgba(255,200,70,.8)" : "rgba(140,20,0,.6)"; wrap((dx, dy) => { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); gr.addColorStop(0, c0); gr.addColorStop(1, "rgba(255,120,30,0)"); g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); }); }
    g.lineWidth = 3; g.lineCap = "round"; for (let n = 0; n < 26; n++) { const pts = [[Math.random() * W, Math.random() * W]]; for (let q = 0; q < 5; q++) pts.push([pts[q][0] + (Math.random() - .5) * 50, pts[q][1] + (Math.random() - .5) * 50]); const c = n % 2 ? "#ffe27a" : "#ffb040"; wrap((dx, dy) => { g.strokeStyle = c; g.beginPath(); pts.forEach(([x, y], q) => q ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)); g.stroke(); }); } }, true); }
  function lavaFlowTex() { return ctex(64, 256, (g, W, H) => { const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, "#ff5a10"); gr.addColorStop(.5, "#ffc040"); gr.addColorStop(1, "#ff5a10"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let n = 0; n < 40; n++) { g.fillStyle = n % 3 ? "rgba(255,240,170,.7)" : "rgba(170,30,0,.6)"; g.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 6, 14 + Math.random() * 30); } }, true); }
  let geyM = [], steamM = [], geyFn = null, lavaLk = null;
  function buildGeysers(t) {   // 🌋 geysers: a mound of black lava rock round a bubbling pool, which shoots a column of lava sky-high when it erupts; 💨 steam vents puff white clouds
    geyM = []; steamM = []; geyFn = t.geyserAt || null; const ft = lavaFlowTex();
    for (const ge of t.geysers || []) { const R = ge.r || 36, g0 = h(ge.x, ge.y), grp = new THREE.Group(); grp.position.set(ge.x, g0, ge.y); scene.add(grp); roadObjs.push(grp);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 4, 8, 6, 18), lavaMat()); rim.rotation.x = Math.PI / 2; rim.position.y = 2; grp.add(rim);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(R, 20), new THREE.MeshBasicMaterial({ color: 0xff6a1a })); pool.rotation.x = -Math.PI / 2; pool.position.y = 1.5; grp.add(pool);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(R * 2.4, 24), new THREE.MeshBasicMaterial({ map: glowDisc(), color: 0xff6a1a, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 2.5; grp.add(glow);
      const tx = ft.clone(); tx.needsUpdate = true; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(2, 1.5);
      const fadeTx = ctex(8, 128, (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(.25, "rgba(255,255,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,1)"); g.fillStyle = gr; g.fillRect(0, 0, W, H); });   // (the jet fades out at its top)
      const col = new THREE.Group(), jet = (r0, r1, c, op) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 1, 16, 1, true), new THREE.MeshBasicMaterial({ map: tx, alphaMap: fadeTx, color: c, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.position.y = .5; col.add(m); return m; };
      jet(R * .75, R * .5, 0xff5a1a, .75); jet(R * .4, R * .28, 0xffe090, .9); grp.add(col);   // an orange jet round a white-hot core
      const cap = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xffa040, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })); grp.add(cap);
      const blobs = Array.from({ length: 8 }, (_, k) => { const m = new THREE.Mesh(new THREE.SphereGeometry(5 + k % 3 * 2, 8, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffc040 : 0xff5a1a })); grp.add(m); return { m, a: k / 8 * 6.283, sp: 50 + k * 9 }; });
      geyM.push({ ge, col, cap, glow, pool, tx, blobs, R }); }
    for (const sv of t.steams || []) { const g0 = h(sv.x, sv.y), puffs = [];
      for (let k = 0; k < 7; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf4f6fa, emissive: 0x8a8e98, transparent: true, opacity: .5, depthWrite: false })); scene.add(m); roadObjs.push(m); puffs.push({ m, ph: k / 7, dx: (Math.random() - .5) * 30, dz: (Math.random() - .5) * 30 }); }
      steamM.push({ sv, g0, puffs }); }
  }
  // 🗿 Zakum: the giant stone idol rising out of the lava sea - a fat stone body and head, a gold belt and chest disc, a scowling face with big glowing eyes and a
  // glowing mouth, gold earrings, and a golden sun-crown fanning out behind its head. Its arms are separate (they come up out of the lava by the road).
  const stoneMat = () => new THREE.MeshLambertMaterial({ map: rockTex(), color: 0xc0ae98, emissive: 0x2a1c14, flatShading: true });
  function squircle(w, hh, d, pw = .6) { const g = new THREE.SphereGeometry(1, 28, 20), pa = g.attributes.position; for (let v = 0; v < pa.count; v++) { const f = q => Math.sign(q) * Math.pow(Math.abs(q), pw); pa.setXYZ(v, f(pa.getX(v)) * w / 2, f(pa.getY(v)) * hh / 2, f(pa.getZ(v)) * d / 2); } g.computeVertexNormals(); return g; }
  function zakumModel() {
    const g = new THREE.Group(), st = stoneMat(), gd = new THREE.MeshLambertMaterial({ color: 0xffc23a, emissive: 0x6a4000, flatShading: true }), dk = new THREE.MeshBasicMaterial({ color: 0x1a0c08 }), eyeM = new THREE.MeshBasicMaterial({ color: 0xffe060 }), hot = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    const put = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    put(new THREE.CylinderGeometry(190, 230, 90, 8), st, 0, 20, 0);   // the plinth, half sunk in the lava
    put(squircle(300, 280, 230), st, 0, 200, 0);   // a fat body
    put(new THREE.CylinderGeometry(156, 156, 34, 16), gd, 0, 150, 0).scale.set(1, 1, .8);   // gold belt
    put(new THREE.CylinderGeometry(48, 48, 10, 20), gd, 118, 230, 0).rotation.z = Math.PI / 2;   // the chest disc
    put(new THREE.CylinderGeometry(26, 26, 12, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a }), 122, 230, 0).rotation.z = Math.PI / 2;
    put(squircle(240, 200, 210), st, 0, 420, 0);   // the head
    put(new THREE.BoxGeometry(18, 168, 186), gd, 116, 425, 0);   // a gold mask over the face: outlined eyes with glowing pupils, a scowling brow, a stone mouth full of teeth
    const eyes = [];
    for (const z of [-1, 1]) { const o = put(new THREE.SphereGeometry(1, 18, 12), dk, 124, 448, z * 46); o.scale.set(4, 25, 33);
      const w = put(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d8 }), 127, 448, z * 46); w.scale.set(4, 20, 28);
      const e = put(new THREE.SphereGeometry(1, 14, 10), eyeM, 130, 444, z * 42); e.scale.set(4, 11, 11); eyes.push(e);
      const br = put(new THREE.BoxGeometry(14, 16, 76), dk, 128, 482, z * 46); br.rotation.x = z * .38;
      const ear = put(new THREE.TorusGeometry(26, 7, 8, 18), gd, 0, 380, z * 118); ear.rotation.y = Math.PI / 2; }
    put(new THREE.BoxGeometry(10, 44, 120), dk, 125, 378, 0);
    const mouth = put(new THREE.BoxGeometry(10, 18, 104), hot, 128, 376, 0);   // (it glows when he wakes)
    for (let k = -2.5; k <= 2.5; k++) { put(new THREE.BoxGeometry(8, 12, 15), new THREE.MeshLambertMaterial({ color: 0xf4ecd8, emissive: 0x3a3428 }), 131, 393, k * 19); put(new THREE.BoxGeometry(8, 10, 15), new THREE.MeshLambertMaterial({ color: 0xf4ecd8, emissive: 0x3a3428 }), 131, 361, k * 19); }
    put(new THREE.CylinderGeometry(124, 124, 30, 16), gd, 0, 510, 0).scale.set(1, 1, .9);   // the crown band
    put(new THREE.OctahedronGeometry(26), new THREE.MeshBasicMaterial({ color: 0xff3a2a }), 120, 512, 0);
    for (let k = 0; k < 13; k++) { const a = -Math.PI / 2 + (k / 12 - .5) * Math.PI * 1.15 + Math.PI / 2, c = put(new THREE.ConeGeometry(26, 170, 6), gd, -30, 520 + Math.cos(a - Math.PI / 2) * 0, 0);   // the sun-crown fanned out behind its head
      const ang = (k / 12 - .5) * 2.4; c.position.set(-40, 520 + Math.cos(ang) * 120, Math.sin(ang) * 160); c.rotation.x = ang; }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xff6a1a, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(560, 200, 1); glow.position.y = 10; g.add(glow);
    const fl = []; for (let k = 0; k < 9; k++) { const ang = (k / 8 - .5) * 2.2, m = new THREE.Mesh(new THREE.ConeGeometry(30, 160, 8), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffd23f : 0xff4a1a, transparent: true, opacity: .9 })); m.position.set(-50, 540 + Math.cos(ang) * 210, Math.sin(ang) * 230); m.rotation.x = ang; m.visible = false; g.add(m); fl.push({ m, ang, ph: k }); }   // flames bursting from the crown when he wakes
    const eyeGl = eyes.map(e => { const s2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xffd060, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })); s2.scale.set(60, 60, 1); s2.position.copy(e.position).x += 12; g.add(s2); return s2; });
    g.userData = { eyeM, eyeGl, mouth, glow, fl }; return g;
  }
  function zakArm(L) {   // one of Zakum's stone arms: shoulder at the origin, pointing up +Y: upper arm, elbow, forearm, a gold cuff, and a big open hand
    const g = new THREE.Group(), st = stoneMat(), gd = new THREE.MeshLambertMaterial({ color: 0xffc23a, emissive: 0x6a4000, flatShading: true }), u = L / 300;
    const put = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    put(new THREE.CylinderGeometry(30 * u, 36 * u, 120 * u, 10), st, 0, 60 * u, 0); put(new THREE.SphereGeometry(34 * u, 12, 10), st, 0, 125 * u, 0);
    put(new THREE.CylinderGeometry(26 * u, 30 * u, 110 * u, 10), st, 0, 185 * u, 0); put(new THREE.CylinderGeometry(32 * u, 32 * u, 22 * u, 12), gd, 0, 238 * u, 0);
    put(new THREE.BoxGeometry(70 * u, 50 * u, 24 * u), st, 0, 270 * u, 0).rotation.y = Math.PI / 2;   // the palm (flat, so it lies flat on the road)
    for (let k = 0; k < 4; k++) put(new THREE.BoxGeometry(12 * u, 36 * u, 14 * u), st, 0, 310 * u, (k - 1.5) * 17 * u);
    put(new THREE.BoxGeometry(12 * u, 30 * u, 14 * u), st, 0, 262 * u, 44 * u).rotation.x = -.7;
    return g;
  }
  // 🌠 the Star Road's set pieces (all drawn): the golden ring gate over the line, glowing star railings by the start, fireworks bursting over the
  // city, neon constellations of MapleStory things in the sky, slowly turning rainbow coils and glowing star medallions floating round the course
  let starFx = null;
  function starShape(ro, ri, n = 5) { const sh = new THREE.Shape(); for (let k = 0; k <= n * 2; k++) { const a = Math.PI / 2 + k * Math.PI / n, r = k % 2 ? ri : ro; k ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return sh; }
  function buildStar(t) {
    starFx = null; if (!t.theme.skyroad) return;
    const n = t.N, P = t.PTS, ang = i => { const a = P[(i + n - 2) % n], b = P[(i + 2) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc860, metalness: 1, roughness: .22, emissive: 0x3a2404, envMapIntensity: 1.2 }), glowGold = new THREE.MeshStandardMaterial({ color: 0xffe08a, metalness: .6, roughness: .3, emissive: 0xffb84a, emissiveIntensity: 1.1 }), white = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
    const grp = new THREE.Group(); scene.add(grp); roadObjs.push(grp);
    // the start gate: a gigantic golden wheel over the line - a thick bronze-and-gold rim with star reliefs, five round star lamps standing on it,
    // spokes carrying chequered flags and white flame shapes, a glowing hub ring, and the FAMILY KART banner curving across the middle
    const bronze = new THREE.MeshStandardMaterial({ color: 0x4a3214, metalness: .85, roughness: .38, emissive: 0x120a02 });
    const ringAt = (i, R, cy, build) => { const k = ((i % n) + n) % n, [x, z] = P[k], a = ang(k), g = new THREE.Group(); g.position.set(x, RE[k], z); g.rotation.y = -a + Math.PI / 2; grp.add(g); build(g, R, cy); return g; };
    ringAt(0, t.ROAD / 2 + 120, (t.ROAD / 2 + 120) * .6, (g, R, cy) => {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 26, 18, 96), bronze); rim.position.y = cy; g.add(rim);
      for (const [rr, tt] of [[R + 26, 6], [R - 26, 6], [R * .46, 9]]) { const q = new THREE.Mesh(new THREE.TorusGeometry(rr, tt, 10, 96), gold); q.position.y = cy; g.add(q); }
      for (let k = 0; k < 16; k++) { const a2 = k / 16 * Math.PI * 2; if (Math.sin(a2) < -.3) continue; const st = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(13, 6), { depth: 4, bevelEnabled: true, bevelSize: 1, bevelThickness: 1 }), gold); st.position.set(Math.cos(a2) * R, cy + Math.sin(a2) * R, 24); st.rotation.z = a2; g.add(st); }
      const lampTex = ctex(128, 128, (c, W) => { const gr = c.createRadialGradient(W / 2, W / 2, 4, W / 2, W / 2, W / 2); gr.addColorStop(0, "#ffffff"); gr.addColorStop(.75, "#fff4d8"); gr.addColorStop(1, "#e8c070"); c.fillStyle = gr; c.fillRect(0, 0, W, W); c.fillStyle = "#3a2608"; c.beginPath(); for (let k = 0; k <= 10; k++) { const a3 = -Math.PI / 2 + k * Math.PI / 5, r3 = k % 2 ? 18 : 42; c.lineTo(W / 2 + Math.cos(a3) * r3, W / 2 + 4 + Math.sin(a3) * r3); } c.fill(); });
      for (const deg of [90, 50, 130, 12, 168]) { const a2 = deg * Math.PI / 180, lamp = new THREE.Group(); lamp.position.set(Math.cos(a2) * (R + 30), cy + Math.sin(a2) * (R + 30), 0); lamp.rotation.z = a2 - Math.PI / 2; g.add(lamp);   // the round star lamps on the rim
        const body = new THREE.Mesh(new THREE.CylinderGeometry(44, 44, 30, 32), bronze); body.rotation.x = Math.PI / 2; body.position.y = 30; lamp.add(body);
        const rimL = new THREE.Mesh(new THREE.TorusGeometry(44, 6, 8, 32), gold); rimL.position.set(0, 30, 16); lamp.add(rimL);
        const face = new THREE.Mesh(new THREE.CircleGeometry(39, 32), new THREE.MeshBasicMaterial({ map: lampTex })); face.position.set(0, 30, 16.5); lamp.add(face); const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -16.5; lamp.add(back); }
      const flame = new THREE.Shape(); flame.moveTo(0, 0); flame.quadraticCurveTo(18, 30, 4, 70); flame.quadraticCurveTo(-4, 40, -16, 52); flame.quadraticCurveTo(-14, 20, 0, 0);
      const flameM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: .9, side: THREE.DoubleSide });
      const flagTex = ctex(64, 64, (c, W) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? "#141414" : "#ffffff"; c.fillRect(x * 16, y * 16, 16, 16); } });
      for (let k = 0; k < 10; k++) { const a2 = (k / 10) * Math.PI * 2 + Math.PI / 10; if (Math.sin(a2) < -.2) continue; const r0 = R * .48, r1 = R - 24, mid = (r0 + r1) / 2;   // spokes
        const sp = new THREE.Mesh(new THREE.BoxGeometry(r1 - r0, 16, 14), bronze); sp.position.set(Math.cos(a2) * mid, cy + Math.sin(a2) * mid, 0); sp.rotation.z = a2; g.add(sp);
        if (k % 2) { const f = new THREE.Mesh(new THREE.ShapeGeometry(flame), flameM); f.position.set(Math.cos(a2) * (mid - 10), cy + Math.sin(a2) * (mid - 10), 9); f.rotation.z = a2 - Math.PI / 2; f.scale.setScalar(1.3); g.add(f); }
        else { const fl = new THREE.Mesh(new THREE.PlaneGeometry(56, 40), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide })); fl.position.set(Math.cos(a2) * (r1 - 40), cy + Math.sin(a2) * (r1 - 40), 9); fl.rotation.z = a2 - Math.PI / 2; g.add(fl); } }
      const banTex = ctex(1024, 160, (c, W, H) => { c.fillStyle = "#2a1406"; c.fillRect(0, 0, W, H); c.strokeStyle = "#ffd86a"; c.lineWidth = 10; c.strokeRect(5, 5, W - 10, H - 10); const gr = c.createLinearGradient(0, 30, 0, 130); gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#ffe0a0"); c.fillStyle = gr; c.font = "900 112px Ubuntu, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("FAMILY KART", W / 2, H / 2 + 6); });
      const ban = new THREE.Mesh(new THREE.CylinderGeometry(R * .7, R * .7, 52, 48, 1, true, -.62, 1.24), new THREE.MeshBasicMaterial({ map: banTex, side: THREE.DoubleSide })); ban.rotation.x = Math.PI / 2; ban.rotation.y = Math.PI; ban.position.set(0, cy - R * .7 + R * .82, 18); g.add(ban);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xffc870, transparent: true, opacity: .1, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(R * 2.4, R * 2.4, 1); glow.position.y = cy; g.add(glow); });
    // enormous rainbow rings floating beside the course, tilted every which way (a big one just left of the start, more further off)
    { const rtx = surfaceTex("rainbow64", t.theme, 180); rtx.wrapS = rtx.wrapT = THREE.RepeatWrapping; rtx.repeat.set(36, 2);
      const rm = new THREE.MeshStandardMaterial({ map: rtx, emissive: 0xffffff, emissiveMap: rtx, emissiveIntensity: .55, roughness: .3, metalness: .05, side: THREE.DoubleSide });
      const [sx, sz] = P[0], a0 = ang(0), fw = [Math.cos(a0), Math.sin(a0)], lt = [Math.sin(a0), -Math.cos(a0)];
      for (const [lat, fwd, up, R, tube, rx, ry] of [[-760, 520, 120, 360, 46, 1.25, .5], [980, 1500, 300, 300, 40, .4, 1.1], [-1500, 2300, 420, 420, 50, .9, -.4], [1500, -900, 260, 330, 42, 1.4, .2]]) {
        const m = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 20, 96), rm); m.position.set(sx + lt[0] * lat + fw[0] * fwd, RE[0] + up, sz + lt[1] * lat + fw[1] * fwd); m.rotation.set(rx, ry - a0, .3); grp.add(m); } }
    // the second arch down the start straight: a gold ring with a band of chequered lights
    ringAt(150, t.ROAD / 2 + 70, (t.ROAD / 2 + 70) * .55, (g, R, cy) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 14, 14, 80), gold); ring.position.y = cy; g.add(ring);
      const chk = ctex(512, 32, (c, W, H) => { for (let k = 0; k < 32; k++) for (let j = 0; j < 2; j++) { c.fillStyle = (k + j) % 2 ? "#141008" : "#fff4d8"; c.fillRect(k * 16, j * 16, 16, 16); } }, true); chk.repeat.set(5, 1);
      const band = new THREE.Mesh(new THREE.TorusGeometry(R - 22, 9, 6, 80), new THREE.MeshBasicMaterial({ map: chk })); band.position.y = cy; g.add(band);
      for (let k = 0; k < 18; k++) { const a2 = k / 18 * Math.PI * 2; if (Math.sin(a2) < -.35) continue; const b = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), glowGold); b.position.set(Math.cos(a2) * (R + 18), cy + Math.sin(a2) * (R + 18), 0); g.add(b); } });
    // glowing star railings: a continuous band of tall gold star outlines standing shoulder to shoulder along the edge (two sizes, overlapping),
    // along both sides of the start straight and on the outside of two bends - just the stars, glowing
    { const rail = new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: .5, roughness: .35, emissive: 0xffb848, emissiveIntensity: .85 });
      const outline = (ro, ri) => { const o = starShape(ro, ri), h2 = new THREE.Path(starShape(ro * .76, ri * .7).getPoints().reverse()); o.holes.push(h2); return new THREE.ExtrudeGeometry(o, { depth: 2, bevelEnabled: true, bevelThickness: 1, bevelSize: .8, bevelSegments: 2, curveSegments: 3 }); };
      const big = outline(17, 8), small = outline(12, 5.6);
      const runs = [[n - 110, n + 14, 0], [Math.round(n * .34), Math.round(n * .43), 1], [Math.round(n * .56), Math.round(n * .62), 1]], inGap = k => (t.gaps || []).some(g => k >= g.a - 4 && k <= g.b + 4);
      const outer = k => { let d = ang((k + 6) % n) - ang((k + n - 6) % n); d = Math.atan2(Math.sin(d), Math.cos(d)); return d > 0 ? -1 : 1; };
      const place = (geo, step, off, hy, cnt) => { const inst = new THREE.InstancedMesh(geo, rail, cnt), M4 = new THREE.Matrix4(), Qn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), Sc = new THREE.Vector3(1, 1, 1); let c0 = 0;
        for (const [ra, rb, only] of runs) { const side0 = only ? outer(((Math.round((ra + rb) / 2) % n) + n) % n) : 0; for (let i = ra + off; i < rb; i += step) { const k = ((Math.round(i) % n) + n) % n; if (inGap(k)) continue; const a = ang(k);
          for (const sd of only ? [side0] : [-1, 1]) { const o = sd * (t.ROAD / 2 + t.CURB + 2), x = P[k][0] - Math.sin(a) * o, z = P[k][1] + Math.cos(a) * o, y = surfY(x, z, k); if (c0 >= cnt) break; Qn.setFromAxisAngle(up, -a); M4.compose(V.set(x, y + hy, z), Qn, Sc); inst.setMatrixAt(c0++, M4); } } }
        inst.count = c0; inst.instanceMatrix.needsUpdate = true; grp.add(inst); };
      const tot = runs.reduce((q, [a, b]) => q + (b - a), 0); place(big, 5, 0, 17, Math.ceil(tot / 5) * 2 + 8); place(small, 5, 2.5, 11, Math.ceil(tot / 5) * 2 + 8); }
    { const chk = ctex(128, 128, (c, W) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? "#2c2c26" : "#4e4c40"; c.fillRect(x * 32, y * 32, 32, 32); c.fillStyle = "rgba(255,240,200,.08)"; c.fillRect(x * 32 + 2, y * 32 + 2, 28, 3); } }, true);   // 🏁 the golden chequered start, as its own crisp strip on the road
      const SP = [], UV = [], IX = [], A0 = -95, A1 = 1, Wd = t.ROAD; let L = 0, prev = null;
      for (let i = A0; i <= A1; i++) { const k = ((i % n) + n) % n, a = ang(k), p = P[k]; if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; for (let q = 0; q <= 6; q++) { const o = -Wd / 2 + Wd * q / 6, x = p[0] - Math.sin(a) * o, z = p[1] + Math.cos(a) * o; SP.push(x, surfY(x, z, k) + 1.2, z); UV.push(q / 6 * 3, L / (Wd / 3)); } }
      for (let r0 = 0; r0 < A1 - A0; r0++) for (let q = 0; q < 6; q++) { const a = r0 * 7 + q, b = a + 7; IX.push(a, a + 1, b, a + 1, b + 1, b); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(SP, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(IX); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: chk, roughness: .25, metalness: .2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 })); grp.add(m); }
    // ⚡ dash panels (blue glass with bright chevrons racing forward) and the glider ramp (a raised blue ramp with white wing stripes)
    const dashTex = ctex(128, 128, (c, W) => { const gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, "#0a6aff"); gr.addColorStop(.5, "#3ad8ff"); gr.addColorStop(1, "#0a6aff"); c.fillStyle = gr; c.fillRect(0, 0, W, W); c.strokeStyle = "#ffffff"; c.lineWidth = 10; c.lineJoin = "round"; for (const y0 of [20, 84]) { c.beginPath(); c.moveTo(18, y0 + 30); c.lineTo(64, y0); c.lineTo(110, y0 + 30); c.stroke(); } }, true);
    const glideTex = ctex(128, 128, (c, W) => { c.fillStyle = "#1a4ad8"; c.fillRect(0, 0, W, W); for (let k = 0; k < 4; k++) { c.fillStyle = k % 2 ? "#ffffff" : "#5ab8ff"; c.fillRect(0, k * 32 + 8, W, 14); } c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(0, 0, 8, W); c.fillRect(W - 8, 0, 8, W); }, true);
    const dashM = [];
    for (const pd of t.dashPads || []) { const glide = pd.t === "glide", tx = (glide ? glideTex : dashTex).clone(); tx.needsUpdate = true; tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      const SP = [], UV = [], IX = [], w = pd.w || t.ROAD, cols = 4; let L = 0, prev = null;
      for (let q = 0; q <= pd.len * 2; q++) { const fi = pd.i + q / 2, k = ((Math.floor(fi) % n) + n) % n, a = ang(k), p0 = P[k], p1 = P[(k + 1) % n], f = fi - Math.floor(fi), px = p0[0] + (p1[0] - p0[0]) * f, pz = p0[1] + (p1[1] - p0[1]) * f; if (prev) L += Math.hypot(px - prev[0], pz - prev[1]); prev = [px, pz];
        const rise = glide ? Math.sin(Math.min(1, q / (pd.len * 2)) * Math.PI / 2) * 6 : 0;
        for (let c2 = 0; c2 <= cols; c2++) { const o = (pd.o || 0) - w / 2 + w * c2 / cols, x = px - Math.sin(a) * o, z = pz + Math.cos(a) * o; SP.push(x, surfY(x, z, k) + 2 + rise, z); UV.push(c2 / cols * (w / 64), L / 64); } }
      for (let r0 = 0; r0 < pd.len * 2; r0++) for (let c2 = 0; c2 < cols; c2++) { const a = r0 * (cols + 1) + c2, b = a + cols + 1; IX.push(a, a + 1, b, a + 1, b + 1, b); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(SP, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(IX); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12 })); grp.add(m); if (!glide) dashM.push(tx); }
    // floating rainbow coils and star medallions round the course (never over the road)
    const far = (x, z, d) => { for (let i = 0; i < n; i += 6) if (Math.hypot(P[i][0] - x, P[i][1] - z) < d) return false; return true; };
    const rbTex = ctex(16, 256, (c, W, H) => { const cs = ["#ff3b4e", "#ff8a2a", "#ffd23a", "#4fe06a", "#2fd6c8", "#4a6aff", "#a65aff"]; cs.forEach((cl, k) => { c.fillStyle = cl; c.fillRect(0, k * H / 7, W, H / 7 + 1); }); }, true);
    let sd = 9; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647, coils = [];
    for (let k = 0, tries = 0; k < 0 && tries < 400; tries++) { const x = rnd() * WORLD, z = rnd() * WORLD; if (!far(x, z, 520)) continue; k++;
      const R = 90 + rnd() * 70, turns = 3 + rnd() * 3, Hh = 240 + rnd() * 260, pts = []; for (let q = 0; q <= 120; q++) { const u = q / 120, a2 = u * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a2) * R, u * Hh, Math.sin(a2) * R)); }
      const tx = rbTex.clone(); tx.needsUpdate = true; tx.repeat.set(1, 1); const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 360, 16, 10), new THREE.MeshBasicMaterial({ map: tx }));
      let base = 0; { let bi = 0, bd = 1e12; for (let i = 0; i < n; i += 4) { const d = (P[i][0] - x) ** 2 + (P[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } base = RE[bi]; }
      m.position.set(x, base - 150 + rnd() * 300, z); m.rotation.set(rnd() * .6 - .3, rnd() * 6, rnd() * .6 - .3); grp.add(m); coils.push({ m, sp: (rnd() - .5) * .3 }); }
    const meds = [];
    for (const fr of [.1, .93]) { const i = Math.round(n * fr), a = ang(i), [x, z] = P[i], R = t.ROAD / 2 + 110, g = new THREE.Group(), wm = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });   // 🌟 the giant glowing star rings you drive through
      g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 9, 10, 72), wm)); const pts = starShape(R * .78, R * .36).getPoints().map(p => new THREE.Vector3(p.x, p.y, 0)); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0), 200, 6, 6, true), wm));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xfff0c8, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(R * 3, R * 3, 1); g.add(halo);
      g.position.set(x, RE[i] + R * .82, z); g.rotation.y = -a + Math.PI / 2; grp.add(g); }
    for (let k = 0, tries = 0; k < 0 && tries < 400; tries++) { const i = Math.floor(rnd() * n), a = ang(i), sd2 = rnd() < .5 ? -1 : 1, o = sd2 * (t.ROAD / 2 + 260 + rnd() * 300), x = P[i][0] - Math.sin(a) * o, z = P[i][1] + Math.cos(a) * o; if (!far(x, z, 200)) continue; k++;
      const g = new THREE.Group(), ring = new THREE.Mesh(new THREE.TorusGeometry(110, 7, 10, 48), new THREE.MeshBasicMaterial({ color: 0xfff2c8 })), st = new THREE.Mesh(new THREE.ShapeGeometry(starShape(80, 34)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, side: THREE.DoubleSide }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xfff0c0, transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(300, 300, 1);
      g.add(ring, st, halo); g.position.set(x, RE[i] + 140 + rnd() * 200, z); g.rotation.y = rnd() * 6; grp.add(g); meds.push({ g, sp: .4 + rnd() * .4 }); }
    // neon constellations of MapleStory things, high in the sky all round
    const shapes = {
      leaf: [[0, 1], [.18, .62], [.42, .78], [.36, .5], [.7, .55], [.5, .3], [.62, .12], [.2, .18], [.1, -.05], [.05, -.4], [0, -.4], [-.05, -.4], [-.1, -.05], [-.2, .18], [-.62, .12], [-.5, .3], [-.7, .55], [-.36, .5], [-.42, .78], [-.18, .62], [0, 1]],
      shroom: [[-.9, .1], [-.8, .5], [-.45, .85], [0, .95], [.45, .85], [.8, .5], [.9, .1], [.4, .05], [.35, -.6], [-.35, -.6], [-.4, .05], [-.9, .1]],
      slime: [[-.8, -.5], [-.85, -.1], [-.55, .35], [-.15, .7], [0, .95], [.15, .7], [.55, .35], [.85, -.1], [.8, -.5], [-.8, -.5]],
      star: Array.from({ length: 11 }, (_, k) => { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? .4 : 1; return [Math.cos(a) * r, Math.sin(a) * r]; }),
      pig: [[-.9, .2], [-.7, .7], [-.4, .55], [0, .7], [.4, .55], [.7, .7], [.9, .2], [.7, -.4], [0, -.65], [-.7, -.4], [-.9, .2]],
    };
    const extra = { shroom: [[[-.5, .5], [-.3, .62]], [[.2, .7], [.5, .55]], [[-.15, -.15], [-.15, -.3]], [[.15, -.15], [.15, -.3]]], slime: [[[-.3, .1], [-.3, -.05]], [[.3, .1], [.3, -.05]], [[-.25, -.25], [0, -.32], [.25, -.25]]], pig: [[[-.15, -.15], [.15, -.15], [.15, -.4], [-.15, -.4], [-.15, -.15]], [[-.4, .15], [-.4, 0]], [[.4, .15], [.4, 0]]] };
    const cols = { leaf: 0xff7a3a, shroom: 0xffa040, slime: 0x6aff8a, star: 0xfff06a, pig: 0xff8ac8 }, cons = [];
    Object.keys(shapes).forEach((k, q) => { const a = q / 5 * Math.PI * 2 + .4, D = WORLD * .62 + 1400, cx = WORLD / 2 + Math.cos(a) * D, cz = WORLD / 2 + Math.sin(a) * D, S = 700, g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: cols[k], transparent: true, opacity: .9, fog: false });
      for (const line of [shapes[k], ...(extra[k] || [])]) { const pts = line.map(([u, v]) => new THREE.Vector3(u * S, v * S, 0)); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", .1), pts.length * 8, 9, 6), mat));
        for (const p of pts) { const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: cols[k], transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); dot.scale.set(90, 90, 1); dot.position.copy(p); g.add(dot); } }
      g.position.set(cx, 1600 + q * 160, cz); g.lookAt(WORLD / 2, 1600, WORLD / 2); grp.add(g); cons.push({ g, mat, ph: q }); });
    // fireworks: a pool of bursts going off over the city
    const FN = 6, PN = 160, bursts = [];
    for (let b = 0; b < FN; b++) { const geo = new THREE.BufferGeometry(), pos = new Float32Array(PN * 3); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 26, map: glowDisc(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), pts = new THREE.Points(geo, mat); pts.frustumCulled = false; grp.add(pts);
      bursts.push({ pts, pos, mat, vel: new Float32Array(PN * 3), t: 9, life: 2.2, c: new THREE.Vector3() }); }
    const slimes = (t.rollers || []).map(() => { const m = slimeModel(); scene.add(m); roadObjs.push(m); return m; });
    starFx = { coils, meds, cons, bursts, next: 0, rnd, slimes, rollerAt: t.rollerAt, rollers: t.rollers || [], dashM };
  }
  function slimeModel() {   // 💧 a giant cute slime: a glossy blue drop with a pointy top, big shiny eyes, rosy cheeks and a smile
    const g = new THREE.Group(), body = new THREE.MeshPhysicalMaterial({ color: 0x4aa8ff, emissive: 0x0a2a5a, roughness: .15, metalness: 0, clearcoat: 1, transparent: true, opacity: .93 }), S1 = new THREE.SphereGeometry(1, 20, 14);
    const b = new THREE.Mesh(S1, body); b.scale.set(46, 38, 46); b.position.y = 38; g.add(b); const tip = new THREE.Mesh(new THREE.ConeGeometry(18, 34, 16), body); tip.position.y = 84; g.add(tip);
    const wh = new THREE.MeshBasicMaterial({ color: 0xffffff }), ink = new THREE.MeshBasicMaterial({ color: 0x14203a }), pk = new THREE.MeshBasicMaterial({ color: 0xff9ac4 });
    for (const z of [-1, 1]) { const e = new THREE.Mesh(S1, ink); e.scale.set(4, 9, 7); e.position.set(43, 46, z * 14); g.add(e); const sp = new THREE.Mesh(S1, wh); sp.scale.setScalar(2.4); sp.position.set(46, 50, z * 12); g.add(sp); const ch = new THREE.Mesh(S1, pk); ch.scale.set(2, 4, 6); ch.position.set(41, 34, z * 26); g.add(ch); }
    const sm = new THREE.Mesh(new THREE.TorusGeometry(7, 1.8, 6, 14, Math.PI), ink); sm.rotation.set(Math.PI, Math.PI / 2, 0); sm.position.set(45, 34, 0); g.add(sm);
    const hl = new THREE.Mesh(S1, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 })); hl.scale.set(8, 14, 6); hl.position.set(28, 62, -22); g.add(hl);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(46, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35, depthWrite: false })); sh.rotation.x = -Math.PI / 2; g.userData.sh = sh; g.add(sh); g.userData.body = [b, tip]; return g; }
  function starStep(now, dt, cx, cy, cz) {
    if (!starFx) return; const F = starFx;
    F.rollers.forEach((b, k) => { const q = F.rollerAt(b, now), m = F.slimes[k], y = surfY(q.x, q.y, q.i), sq = q.z < 10 ? 1 - (10 - q.z) / 10 * .25 : 1 + Math.min(.12, q.z / 400); m.position.set(q.x, y + q.z, q.y); m.rotation.y = -q.a; m.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); m.userData.sh.position.y = -q.z + 1.5; m.userData.sh.scale.setScalar(1 - Math.min(.6, q.z / 160)); });
    for (const tx of F.dashM) tx.offset.y = -now * 2.2;   // the chevrons race forward
    for (const c of F.coils) c.m.rotation.y += c.sp * dt; for (const m of F.meds) m.g.rotation.y += m.sp * dt;
    for (const c of F.cons) c.mat.opacity = .65 + .3 * Math.sin(now * 1.3 + c.ph);
    F.next -= dt; if (F.next <= 0) { F.next = .5 + F.rnd() * .9; const b = F.bursts.find(q => q.t > q.life) || F.bursts[0], a = F.rnd() * 6.28, d = 900 + F.rnd() * 1800;   // a new firework somewhere round you
      b.c.set(cx + Math.cos(a) * d, cy + 250 + F.rnd() * 650, cz + Math.sin(a) * d); b.t = 0; b.mat.color.setHSL(F.rnd(), .9, .62); const sp = 260 + F.rnd() * 180;
      for (let k = 0; k < b.pos.length / 3; k++) { const u = F.rnd() * 2 - 1, th = F.rnd() * 6.28, r = Math.sqrt(1 - u * u), s2 = sp * (.85 + F.rnd() * .3); b.vel[k * 3] = r * Math.cos(th) * s2; b.vel[k * 3 + 1] = u * s2; b.vel[k * 3 + 2] = r * Math.sin(th) * s2; b.pos[k * 3] = b.c.x; b.pos[k * 3 + 1] = b.c.y; b.pos[k * 3 + 2] = b.c.z; } }
    for (const b of F.bursts) { if (b.t > b.life) { b.mat.opacity = 0; continue; } b.t += dt; const drag = Math.exp(-1.6 * dt);
      for (let k = 0; k < b.pos.length / 3; k++) { b.vel[k * 3] *= drag; b.vel[k * 3 + 1] = b.vel[k * 3 + 1] * drag - 90 * dt; b.vel[k * 3 + 2] *= drag; b.pos[k * 3] += b.vel[k * 3] * dt; b.pos[k * 3 + 1] += b.vel[k * 3 + 1] * dt; b.pos[k * 3 + 2] += b.vel[k * 3 + 2] * dt; }
      b.pts.geometry.attributes.position.needsUpdate = true; b.mat.opacity = Math.max(0, 1 - b.t / b.life) ** .7; b.mat.size = 70 + b.t * 30; }
  }
  // 🌳 the clean look's greenery: chubby flat-shaded 3D trees in groves (round ones and pines), and little grass tufts and flower clumps by the road -
  // all instanced (a handful of draw calls), coloured from one small palette of greens
  function buildGreenery(t) {
    const trees = t.trees3d || [], tufts = t.tufts3d || []; if (!trees.length && !tufts.length) return;
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sv = new THREE.Vector3(), C = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = 0; scene.add(m); roadObjs.push(m); return m; };
    const add = (m, x, y, z, sx, sy, sz, rot, col) => { Q.setFromAxisAngle(up, rot); M4.compose(V.set(x, y, z), Q, Sv.set(sx, sy, sz)); m.setMatrixAt(m.count, M4); if (col != null) m.setColorAt(m.count, C.setHex(col)); m.count++; };
    const flat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true }), leafM = new THREE.MeshLambertMaterial({ flatShading: true });
    const round = trees.filter(o => o.k !== "pine"), pines = trees.filter(o => o.k === "pine");
    const trunk = inst(new THREE.CylinderGeometry(.55, .75, 1, 7), flat(0x7a5232), trees.length), blob = inst(new THREE.IcosahedronGeometry(1, 1), leafM, round.length * 3), cone = inst(new THREE.ConeGeometry(1, 1, 7), leafM, pines.length * 3);
    for (const o of round) { const s = o.s, g0 = h(o.x, o.y) - 2; add(trunk, o.x, g0 + 22 * s, o.y, 9 * s, 44 * s, 9 * s, o.r);
      add(blob, o.x, g0 + 62 * s, o.y, 36 * s, 32 * s, 36 * s, o.r, o.c); add(blob, o.x + 16 * s, g0 + 52 * s, o.y + 10 * s, 22 * s, 20 * s, 22 * s, o.r + 1, o.c2); add(blob, o.x - 14 * s, g0 + 76 * s, o.y - 8 * s, 20 * s, 18 * s, 20 * s, o.r + 2, o.c2); }
    for (const o of pines) { const s = o.s, g0 = h(o.x, o.y) - 2; add(trunk, o.x, g0 + 14 * s, o.y, 7 * s, 28 * s, 7 * s, o.r);
      for (let k = 0; k < 3; k++) add(cone, o.x, g0 + (40 + k * 28) * s, o.y, (34 - k * 9) * s, (46 - k * 6) * s, (34 - k * 9) * s, o.r + k, k === 1 ? o.c2 : o.c); }
    for (const m of [trunk, blob, cone]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    const blade = inst(new THREE.ConeGeometry(1, 1, 4), leafM, tufts.length * 3), petal = inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true, emissive: 0x222222 }), tufts.length);
    for (const o of tufts) { const g0 = h(o.x, o.y) - 1;
      if (o.f) { add(petal, o.x, g0 + 6, o.y, 4.5, 3.5, 4.5, o.r, o.f); for (let k = 0; k < 2; k++) add(blade, o.x + (k ? 3 : -3), g0 + 4, o.y + (k ? -2 : 2), 1.6, 9, 1.6, o.r + k, o.c); }
      else for (let k = 0; k < 3; k++) add(blade, o.x + Math.cos(k * 2.1 + o.r) * 4, g0 + 5, o.y + Math.sin(k * 2.1 + o.r) * 4, 2, 10 + k * 3, 2, o.r + k, o.c); }
    for (const m of [blade, petal]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  // 🏭 the Toy Factory in 3D: conveyor belts (a ribbon over the road whose chevrons scroll the way it carries you), the toy train's level crossing
  // (rails across the road, striped barriers with flashing lights, and a cute chubby toy train), and the giant toy bricks the cranes drop
  let beltM = [], trainM = [], tdropM = [], trainFn = null, tdropFn = null;
  function stripGeo(t, a, b, o, w, lift) { const P = [], UV = [], IX = []; let L = 0, prev = null;
    for (let i = a; i <= b; i++) { const k = ((i % t.N) + t.N) % t.N, p = t.PTS[k], q0 = t.PTS[(k + t.N - 2) % t.N], q1 = t.PTS[(k + 2) % t.N], an = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]), nx = -Math.sin(an), ny = Math.cos(an), y = RE[k] + lift, cx = p[0] + nx * o, cy = p[1] + ny * o;
      if (prev) L += Math.hypot(cx - prev[0], cy - prev[1]); prev = [cx, cy]; P.push(cx - nx * w / 2, y, cy - ny * w / 2, cx + nx * w / 2, y, cy + ny * w / 2); UV.push(0, L / w, 1, L / w); }
    for (let q = 0; q < (b - a) * 2; q += 2) IX.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(IX); geo.computeVertexNormals(); return geo; }
  function beltTex(side) { return ctex(128, 128, (g, W) => { g.fillStyle = "#3a3a44"; g.fillRect(0, 0, W, W); for (let y = 0; y < W; y += 8) { g.fillStyle = y % 16 ? "#34343e" : "#42424c"; g.fillRect(0, y, W, 4); }   // dark rubber with yellow chevrons
    g.save(); if (side) { g.translate(W / 2, W / 2); g.rotate(side > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(-W / 2, -W / 2); } g.strokeStyle = "#ffd23f"; g.lineWidth = 12; g.lineJoin = "round"; for (const y0 of [24, 88]) { g.beginPath(); g.moveTo(22, y0 + 26); g.lineTo(64, y0 - 6); g.lineTo(106, y0 + 26); g.stroke(); } g.restore(); }, true); }
  function trainModel() {   // 🚂 a cute toy train: a chubby engine (red boiler with a smiley face, a gold-rimmed stack, a yellow cab) and two wagons full of toy balls
    const g = new THREE.Group(), L = (c, e = 0x202020) => new THREE.MeshLambertMaterial({ color: c, emissive: e }), S1 = new THREE.SphereGeometry(1, 14, 10), put = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    const blk = L(0x2a2a36), gold = L(0xffc83a, 0x5a4000), wh = new THREE.MeshBasicMaterial({ color: 0xffffff }), ink = new THREE.MeshBasicMaterial({ color: 0x1a1a2a }), pink = new THREE.MeshBasicMaterial({ color: 0xff9ac4 });
    put(new THREE.BoxGeometry(120, 18, 56), L(0x3a6ad8, 0x10204a), 100, 22, 0);   // engine chassis
    const boil = put(new THREE.CylinderGeometry(27, 27, 78, 20), L(0xe8423a, 0x3a0a08), 112, 56, 0); boil.rotation.z = Math.PI / 2;
    put(new THREE.CylinderGeometry(27, 27, 4, 20), gold, 152, 56, 0).rotation.z = Math.PI / 2; put(new THREE.CylinderGeometry(9, 12, 30, 12), blk, 128, 96, 0); put(new THREE.CylinderGeometry(14, 14, 6, 12), gold, 128, 112, 0);
    put(new THREE.BoxGeometry(44, 56, 60), L(0xffd23f, 0x4a3a00), 56, 60, 0); put(new THREE.BoxGeometry(58, 8, 70), L(0x3a6ad8, 0x10204a), 56, 92, 0);   // the cab and its roof
    for (const z of [-1, 1]) { const e = put(S1, wh, 154, 64, z * 10); e.scale.set(2, 7, 6); const pu = put(S1, ink, 155.5, 62, z * 9); pu.scale.set(1.5, 4, 3.4); const ch = put(S1, pink, 154, 50, z * 17); ch.scale.set(1, 3, 4); }
    const sm = put(new THREE.TorusGeometry(6, 1.6, 6, 14, Math.PI), ink, 155, 50, 0); sm.rotation.set(Math.PI, Math.PI / 2, 0);
    for (const x of [70, 105, 140]) for (const z of [-1, 1]) { const w = put(new THREE.CylinderGeometry(14, 14, 6, 16), blk, x, 14, z * 30); w.rotation.x = Math.PI / 2; put(new THREE.CylinderGeometry(6, 6, 7, 10), gold, x, 14, z * 30).rotation.x = Math.PI / 2; }
    const wag = [[0x46c06a, -20], [0x9a5ae8, -120]];
    for (const [c, x] of wag) { put(new THREE.BoxGeometry(84, 40, 56), L(c, 0x182818), x, 38, 0); for (const z of [-1, 1]) for (const dx of [-26, 26]) { const w = put(new THREE.CylinderGeometry(12, 12, 6, 14), blk, x + dx, 12, z * 30); w.rotation.x = Math.PI / 2; }
      for (let k = 0; k < 7; k++) put(new THREE.SphereGeometry(11, 12, 8), L([0xff5a6a, 0x5ab4ff, 0xffd23f, 0x6ae08a, 0xff9ad8][k % 5], 0x202020), x - 28 + (k % 4) * 18, 62 + (k > 3 ? 6 : 0), (k % 2 ? 10 : -10)); }
    put(new THREE.BoxGeometry(14, 6, 6), blk, 30, 22, 0); put(new THREE.BoxGeometry(14, 6, 6), blk, -70, 22, 0);   // couplings
    const puffs = Array.from({ length: 5 }, (_, k) => { const m = new THREE.Mesh(S1, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9a9aa8, transparent: true, opacity: .7, depthWrite: false })); g.add(m); return { m, ph: k / 5 }; });
    g.userData.puffs = puffs; return g; }
  function brickModel(c) { const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(.18) }), b = new THREE.Mesh(new THREE.BoxGeometry(84, 54, 84), m); b.position.y = 27; g.add(b);
    for (const x of [-21, 21]) for (const z of [-21, 21]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 11, 18), m); st.position.set(x, 59, z); g.add(st); }
    const sh = new THREE.Mesh(new THREE.BoxGeometry(84.5, 3, 84.5), new THREE.MeshLambertMaterial({ color: new THREE.Color(c).multiplyScalar(.7) })); sh.position.y = 1.5; g.add(sh); return g; }
  function buildToy(t) {
    beltM = []; trainM = []; tdropM = []; trainFn = t.trainAt || null; tdropFn = t.tdropAt || null;
    for (const b of t.belts || []) { const tx = beltTex(b.side || 0); tx.repeat.set(1, 1); const w = b.w || 80, m = new THREE.Mesh(stripGeo(t, b.a, b.b, b.o || 0, w, 1.6), new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
      scene.add(m); roadObjs.push(m); for (const sd of [-1, 1]) { const e = new THREE.Mesh(stripGeo(t, b.a, b.b, (b.o || 0) + sd * (w / 2 + 3), 7, 3), new THREE.MeshLambertMaterial({ color: 0xc8ccd8, emissive: 0x2a2c34, side: THREE.DoubleSide })); scene.add(e); roadObjs.push(e); }
      beltM.push({ b, tx, w }); }
    for (const tr of t.trains || []) { const grp = new THREE.Group(), ry = RE[tr.i % t.N] + 1.6, ca = Math.cos(tr.a), sa = Math.sin(tr.a), P = (along, lat) => [tr.x + ca * along + tr.nx * lat, tr.y + sa * along + tr.ny * lat];
      const steel = new THREE.MeshLambertMaterial({ color: 0xb8bcc8, emissive: 0x30323a }), wood = new THREE.MeshLambertMaterial({ color: 0x8a5a34, emissive: 0x201008 });
      const RL = tr.rail || 1000; for (const sd of [-1, 1]) { const [x, y] = P(0, sd * RL), gy = h(x, y), por = new THREE.Group(), pm = new THREE.MeshLambertMaterial({ color: sd > 0 ? 0xff8ab0 : 0x8ac8ff, emissive: 0x2a2030 });   // a toy tunnel at each end of the line (the train comes out of one and goes into the other)
        const body = new THREE.Mesh(new THREE.BoxGeometry(160, 150, 120), pm); body.position.y = 75; por.add(body); const roof = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 160, 16, 1, false, 0, Math.PI), pm); roof.rotation.z = Math.PI / 2; roof.position.y = 150; por.add(roof);
        const hole = new THREE.Mesh(new THREE.PlaneGeometry(100, 110), new THREE.MeshBasicMaterial({ color: 0x14101c })); hole.position.set(0, 55, -sd * 61); hole.rotation.y = sd > 0 ? Math.PI : 0; por.add(hole); por.position.set(x, gy, y); por.rotation.y = Math.atan2(tr.nx, tr.ny); scene.add(por); roadObjs.push(por); }
      for (let lat = -RL; lat <= RL; lat += 34) { const [x, y] = P(0, lat), onRoad = Math.abs(lat) < t.ROAD / 2 + t.CURB + 10, gy = onRoad ? ry : h(x, y) + 2; const sl = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 64), wood); sl.position.set(x, gy, y); sl.rotation.y = Math.atan2(ca, sa); scene.add(sl); roadObjs.push(sl);
        for (const sd of [-1, 1]) { const [rx, rz] = P(sd * 20, lat); const rl = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 36), steel); rl.position.set(rx, gy + 3.5, rz); rl.rotation.y = Math.atan2(tr.nx, tr.ny); scene.add(rl); roadObjs.push(rl); } }
      const train = trainModel(); train.rotation.y = -Math.atan2(tr.ny, tr.nx); scene.add(train); roadObjs.push(train); train.visible = false;
      const gates = [], armTex = ctex(128, 16, (g, W, H) => { for (let x = 0; x < W; x += 32) { g.fillStyle = (x / 32) % 2 ? "#ffffff" : "#e8322a"; g.fillRect(x, 0, 32, H); } });
      for (const sd of [-1, 1]) { const lat = sd * (t.ROAD / 2 + t.CURB + 22), along = sd * 60, [x, y] = P(along, lat), gy = h(x, y), post = new THREE.Group(); post.position.set(x, gy, y); scene.add(post); roadObjs.push(post);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 80, 8), steel); pole.position.y = 40; post.add(pole); const head = new THREE.Mesh(new THREE.BoxGeometry(10, 18, 40), new THREE.MeshLambertMaterial({ color: 0x2a2a30 })); head.position.y = 84; post.add(head);
        const lights = [-1, 1].map(k => { const l = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshBasicMaterial({ color: 0x401010 })); l.position.set(0, 84, k * 12); post.add(l); return l; });
        const pivot = new THREE.Group(); pivot.position.y = 50; post.add(pivot); const arm = new THREE.Mesh(new THREE.BoxGeometry(t.ROAD / 2 + 26, 7, 7), new THREE.MeshLambertMaterial({ map: armTex, emissive: 0x2a2a2a })); arm.position.x = (t.ROAD / 2 + 26) / 2; pivot.add(arm);
        post.rotation.y = -Math.atan2(-sd * tr.ny, -sd * tr.nx); gates.push({ pivot, lights }); }   // (each arm reaches in across its half of the road)
      trainM.push({ tr, train, gates, ry }); }
    const cols = [0xe8423a, 0x3a7ae8, 0xffc83a, 0x46c06a, 0xa05ae8];
    for (const [n, d] of (t.tdrops || []).entries()) { const br = brickModel(cols[n % cols.length]); br.rotation.y = -d.a; scene.add(br); roadObjs.push(br);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false })); sh.rotation.set(-Math.PI / 2, 0, -d.a); scene.add(sh); roadObjs.push(sh);
      const ring = new THREE.Mesh(new THREE.RingGeometry(56, 64, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); ring.rotation.set(-Math.PI / 2, 0, 0); ring.rotation.z = -d.a; scene.add(ring); roadObjs.push(ring);
      const gy = RE[d.i % t.N]; sh.position.set(d.x, gy + 2, d.y); ring.position.set(d.x, gy + 2.5, d.y);
      { const gr = new THREE.Group(), yel = new THREE.MeshLambertMaterial({ color: 0xffc23a, emissive: 0x3a2a00 }), dk = new THREE.MeshLambertMaterial({ color: 0x3a3a48 }), [cx, cz] = [t.PTS[d.i % t.N][0], t.PTS[d.i % t.N][1]], ox = t.ROAD / 2 + t.CURB + 30, H = 300;   // 🏗 a yellow gantry crane over the drop, a hook hanging over where the brick will land
        gr.position.set(cx, gy - 4, cz); gr.rotation.y = -d.a; for (const sd of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(18, H, 18), yel); leg.position.set(0, H / 2, sd * ox); gr.add(leg); const ft = new THREE.Mesh(new THREE.BoxGeometry(40, 10, 30), dk); ft.position.set(0, 5, sd * ox); gr.add(ft); }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 24, ox * 2 + 30), yel); beam.position.y = H; gr.add(beam); const trolley = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), dk); trolley.position.set(0, H - 20, d.o || 0); gr.add(trolley);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1, 6), dk); cable.position.set(0, H - 30, d.o || 0); gr.add(cable); scene.add(gr); roadObjs.push(gr); tdropM.push({ d, br, sh, ring, gy, cable, H }); } }
  }
  function toyStep3(now) {
    for (const q of beltM) { const v = (q.b.side ? 0 : q.b.dir || 1) * now * 1.4, u = q.b.side ? q.b.side * now * 1.2 : 0; q.tx.offset.set(-u, -v); }
    for (const q of trainM) { const s2 = trainFn(q.tr, now); q.train.visible = s2.s != null; if (s2.s != null) { q.train.position.set(q.tr.x + q.tr.nx * s2.s, q.ry, q.tr.y + q.tr.ny * s2.s); for (const p of q.train.userData.puffs) { const u = (now * .9 + p.ph) % 1; p.m.position.set(128 - u * 90, 118 + u * 80, (p.ph - .5) * 20); p.m.scale.setScalar(8 + u * 18); p.m.material.opacity = .7 * (1 - u); } }
      const down = s2.down ? Math.min(1, (s2.p - .5) / .06) : s2.p > .95 ? 0 : 0; for (const gt of q.gates) { gt.pivot.rotation.z = (1 - down) * Math.PI / 2 * .95; gt.lights.forEach((l, k) => l.material.color.setHex(s2.flash && (Math.floor(now * 3) + k) % 2 ? 0xff2a1a : 0x401010)); } }
    for (const q of tdropM) { const s2 = tdropFn(q.d, now), z = Math.min(s2.z, q.H - 90); q.br.position.set(q.d.x, q.gy + z, q.d.y); q.br.visible = true; const hold = s2.p < .22 || s2.p > .85, cl = hold ? Math.max(4, q.H - 30 - (z + 60)) : 4; q.cable.scale.y = cl; q.cable.position.y = q.H - 30 - cl / 2; const sq = s2.p >= .3 && s2.p < .34 ? 1 - .2 * Math.sin((s2.p - .3) / .04 * Math.PI) : 1; q.br.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      q.sh.material.opacity = s2.warn ? .15 + .45 * (s2.p / .3) : 0; q.ring.material.opacity = s2.warn ? .4 + .5 * Math.abs(Math.sin(now * 12)) : 0; }
  }
  let armM = [], armFn = null, zakM = null, awakeFn = null, seaM = null;
  function buildZakum(t) {
    armM = []; armFn = t.armAt || null; awakeFn = t.awake || null; zakM = null; seaM = null;
    if (t.sea != null && t.theme.heat) { const tx = lavaSeaTex(); tx.repeat.set(t.WORLD / 300, t.WORLD / 300); const m = new THREE.Mesh(new THREE.PlaneGeometry(t.WORLD * 1.6, t.WORLD * 1.6), new THREE.MeshBasicMaterial({ map: tx, color: 0xff9a60 })); m.rotation.x = -Math.PI / 2; m.position.set(t.WORLD / 2, t.sea + 4, t.WORLD / 2); scene.add(m); roadObjs.push(m); seaM = { m, tx }; }   // 🌋 a glowing, churning lava sea
    if (t.zakum) { const z = zakumModel(); z.position.set(t.zakum.x, (t.sea ?? h(t.zakum.x, t.zakum.y)) - 10, t.zakum.y); z.scale.setScalar(t.zakum.s || 1); z.rotation.y = -(t.zakum.fa || 0); scene.add(z); roadObjs.push(z); zakM = z; }
    for (const a of t.arms || []) { const outer = new THREE.Group(), pivot = new THREE.Group(), arm = zakArm(a.len + 20); pivot.add(arm); outer.add(pivot); outer.rotation.y = -a.ang; scene.add(outer); roadObjs.push(outer);
      const base = RE[a.i % t.N] - 12, mx = (a.x + a.ex) / 2, my = (a.y + a.ey) / 2;
      const warn = new THREE.Mesh(new THREE.PlaneGeometry(a.len + 40, 80), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); warn.rotation.set(-Math.PI / 2, 0, -a.ang); warn.position.set(mx, RE[a.i % t.N] + 3, my); scene.add(warn); roadObjs.push(warn);
      const splash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDisc(), color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); splash.position.set(a.x, base + 20, a.y); splash.scale.set(220, 160, 1); scene.add(splash); roadObjs.push(splash);
      armM.push({ a, outer, pivot, base, warn, splash, L: a.len + 20 }); }
  }
  let awakeK = 0;
  function zakumStep(now, dt) {
    if (seaM) seaM.tx.offset.set(now * .01, Math.sin(now * .25) * .04);
    for (const q of armM) { const s2 = armFn(q.a, now); q.outer.position.set(q.a.x, q.base - (1 - s2.up) * (q.L + 60), q.a.y); q.pivot.rotation.z = -s2.fall * Math.PI / 2;
      q.warn.material.opacity = s2.warn ? .25 + .3 * Math.abs(Math.sin(now * 14)) : 0; q.splash.material.opacity = s2.up > 0 && s2.up < 1 ? .9 : 0; }
    const aw = awakeFn && awakeFn() ? 1 : 0; awakeK += (aw - awakeK) * Math.min(1, dt * 1.5);
    if (zakM) { const u = zakM.userData; u.eyeM.color.setRGB(1, .88 - .7 * awakeK, .38 - .3 * awakeK); for (const e of u.eyeGl) { e.material.color.copy(u.eyeM.color); const k = 60 + awakeK * (200 + 50 * Math.sin(now * 12)); e.scale.set(k, k, 1); } u.glow.material.opacity = .4 + .3 * awakeK + .1 * Math.sin(now * 2);
      u.mouth.material.color.setRGB(1, .48 - .3 * awakeK + .2 * awakeK * Math.sin(now * 9), .1); for (const f of u.fl) { f.m.visible = awakeK > .3; f.m.scale.set(1, (.6 + .5 * Math.abs(Math.sin(now * 7 + f.ph))) * awakeK, 1); } }
    if (awakeK > .01) { hemi.color.setRGB(1, .75 - .35 * awakeK, .6 - .4 * awakeK); }   // the whole place glows red once Zakum is awake
  }
  function geyserStep(now) {
    for (const q of geyM) { const e = geyFn ? geyFn(q.ge, now) : 0, er = e >= .9 || (e > 0 && e < 1 && q.last >= .9), H = e > .3 ? 60 + 260 * e : 0;   // e: 0 calm, up to .3 rumbling, 1 erupting
      q.tx.offset.y = -now * 1.6; q.col.visible = q.cap.visible = H > 0; q.col.scale.set(1 + .08 * Math.sin(now * 30), H, 1 + .08 * Math.cos(now * 27)); q.cap.position.y = H * .85; q.cap.scale.setScalar(q.R * (3 + .5 * Math.sin(now * 20)));
      const rum = e > 0 && e <= .3 ? 1 : 0; q.glow.material.opacity = .45 + (rum ? .4 * Math.abs(Math.sin(now * 18)) : 0) + e * .3; q.pool.position.y = 1.5 + rum * Math.abs(Math.sin(now * 25)) * 3;   // it rumbles and glows before it blows
      for (const b of q.blobs) { b.m.visible = H > 0; const u = (now * 1.3 + b.a) % 1; b.m.position.set(Math.cos(b.a) * u * 90, H * .7 + Math.sin(u * Math.PI) * 90, Math.sin(b.a) * u * 90); } q.last = e; }   // lava flung out of the top
    for (const q of steamM) for (const p of q.puffs) { const u = (now * .55 + p.ph) % 1; p.m.position.set(q.sv.x + p.dx * u, q.g0 + 6 + u * 150, q.sv.y + p.dz * u); p.m.scale.setScalar(10 + u * 34); p.m.material.opacity = .55 * (1 - u) * Math.min(1, u * 6); }
  }
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
    if (phantomM.length || fakeM.length) { const now = performance.now() / 1000; for (const q of phantomM) { const a = q.fn ? q.fn(q.g, now) : 1; for (const m of q.mats) { m.opacity = a; m.visible = a > .02; } }
      for (const q of fakeM) { const d = Math.hypot(k.x - q.x, k.y - q.z); q.mat.opacity = Math.min(1, Math.max(0, (d - 120) / 260)) * (.75 + .25 * Math.sin(now * 5)); } }   // (a phantom road melts away as you get close)
    if (flameM.length) { const now = performance.now() / 1000; for (const f of flameM) if (f.glow) f.m.material.opacity = .5 + .15 * Math.sin(now * 9 + f.ph); else f.m.scale.set(1, .8 + .3 * Math.sin(now * 12 + f.ph), 1); }   // 🔥 braziers flicker
    for (const q of golemM) { const z = q.o.sz || 0; q.g.position.y = q.y + z * .55; q.g.rotation.z = z > 1 ? Math.sin(z * .05) * .06 : 0; }   // 🗿 the Golems' stomp
    if (gondM.length) { const now = performance.now() / 1000; for (const q of gondM) { const f = ((now * q.sp + q.ph) % 2), u = f < 1 ? f : 2 - f, L = q.line, p = L.a.clone().lerp(L.b, u); p.addScaledVector(L.off, f < 1 ? 1 : -1); q.g.position.copy(p); q.g.rotation.z = Math.sin(now * 1.3 + q.ph) * .04; } }   // 🚡 gondolas gliding up one cable and down the other   // the dam's half-frozen waterfalls, trickling slowly
    if (auroraM.length) { const now = performance.now() / 1000; for (const q of auroraM) { const pa = q.m.geometry.attributes.position; for (let v = 0; v < pa.count; v++) { const b = q.base[v]; pa.setY(v, b[1] + Math.sin(now * .5 + b[3] * 3 + q.ph) * 40 * b[4]); pa.setZ(v, b[2] + Math.sin(now * .35 + b[3] * 5 + q.ph) * 90); } pa.needsUpdate = true; q.m.material.opacity = .62 + Math.sin(now * .7 + q.ph) * .15; } }
    for (const q of balloonM) q.g.position.y = q.y + Math.sin(performance.now() / 1000 * 2 + q.o.x) * (q.o.bob || 0);   // the balloons sway up and down
    if (lapFn) { const l = lapFn(); for (const q of holeM) q.g.visible = l >= q.hl.lap; for (const q of lapGapM) for (const m of q.ms) m.visible = l < q.g.lap; }
    if (waterP && tideFn) waterP.position.y = waterL + tideFn(performance.now() / 1000);   // 🌊 the tide
    if (cartFn) { const now = performance.now() / 1000; for (const q of cartM) { const p = cartFn(q.c, now); q.g.position.set(p.x, h(p.x, p.y), p.y); q.g.rotation.y = -p.a; } }
    if (geyM.length || steamM.length) geyserStep(performance.now() / 1000);
    if (beltM.length || trainM.length || tdropM.length) toyStep3(performance.now() / 1000);
    if (starFx) starStep(performance.now() / 1000, o.dt || .016, k.x, SKY && k.idx != null ? surfY(k.x, k.y, k.idx) : 0, k.y);
    if (armM.length || zakM || seaM) zakumStep(performance.now() / 1000, o.dt || .016);
    if (lavaLk) { const now = performance.now() / 1000; lavaLk.tx.offset.set(now * .012, Math.sin(now * .3) * .03); lavaLk.m.position.y = lavaLk.lv + Math.sin(now * .8) * 2; }   // the lava slowly churns
    if (thFn) { const now = performance.now() / 1000; for (const q of thw) { const z = thFn(q.th, now); if (q.golem) { const p = ((now + q.th.ph) % q.th.T) / q.th.T, land = p >= .55 && p < .75 ? (p - .55) / .2 : -1;   // 💥 it lands with a squash and a ring of fire
        q.m.position.set(q.th.x, q.g + z, q.th.y); q.m.scale.set(1, land >= 0 && land < .3 ? 1 - .22 * Math.sin(land / .3 * Math.PI) : z > 0 ? 1.06 : 1, 1); for (const f of q.m.userData.fl) f.m.scale.y = .8 + .3 * Math.sin(now * 14 + f.ph);
        q.ring.visible = land >= 0; if (land >= 0) { q.ring.position.set(q.th.x, q.g + 3, q.th.y); q.ring.scale.setScalar(36 + land * 240); q.ring.material.opacity = (1 - land) * .9; } }
      else q.m.position.set(q.th.x, q.g + 31 + z, q.th.y); q.sh.position.set(q.th.x, q.g + 1.2, q.th.y); q.sh.material.opacity = .15 + .4 * (1 - Math.min(1, z / 150)); } }
    VW = o.W; VH = o.H; pi = 0; bi = 0; for (const k in mdls) mdls[k].i = 0; for (const m of karts.values()) m.used = false;
    const a = k.a || 0;
    if (cam.yaw == null || o.snap) cam.yaw = a;
    let d = a - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * Math.min(1, o.dt * 7);   // the camera swings round a moment after the kart
    const CU = 34, dist = 58 + 9 * (o.fov || 0), up = CU + Math.min(k.z || 0, 260) * .95;   // (the same camera on every track: the user's favourite - keep it)   // rises with you in the air (big mushroom bounces too)   // up high and looking down at the road, like Mario Kart Tour
    const gx = k.x - Math.cos(cam.yaw) * dist, gz = k.y - Math.sin(cam.yaw) * dist;
    const lift = airLift(k); cam.lift = o.snap || cam.lift == null ? lift : cam.lift + (lift - cam.lift) * Math.min(1, o.dt * (lift > cam.lift ? 20 : 6));
    const kh = SKY && k.idx != null ? surfY(k.x, k.y, k.idx) : h(k.x, k.y) + cam.lift, base = SKY ? kh : Math.max(kh, h(gx, gz) - 6), want = base + up;   // (flying off the road: follow the road's height, not the ravine under you)
    // the ground part eases (hills, bumps); the jump / glide height follows almost at once, or a fast take-off leaves the camera level with the kart
    const zu = up - CU; cam.base = o.snap || cam.base == null ? base : cam.base + (base - cam.base) * Math.min(1, o.dt * 6); cam.zu = o.snap || cam.zu == null ? zu : cam.zu + (zu - cam.zu) * Math.min(1, o.dt * 16);
    cam.y = cam.base + CU + cam.zu;
    camera.position.set(gx, SKY ? cam.y : Math.max(cam.y, h(gx, gz) + 5), gz);
    look.set(k.x + Math.cos(cam.yaw) * 56, Math.max(SKY && k.idx != null ? surfY(k.x + Math.cos(cam.yaw) * 56, k.y + Math.sin(cam.yaw) * 56, k.idx + 9) : h(k.x + Math.cos(cam.yaw) * 56, k.y + Math.sin(cam.yaw) * 56), kh - 40) * .5 + kh * .5 + 2 + Math.min(k.z || 0, 260) * .95, k.y + Math.sin(cam.yaw) * 56);   // rises with you in a jump (no tilting up at the sky)
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
    if (skyDome) { skyDome.position.copy(camera.position); skyDome.visible = skyMesh.visible; }
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
  return { snap, sync, begin, end, spr, box, mdl, kart, proj, hidden, h, liftOf, camera, surf: (x, y, i) => surfY(x, y, i), setQuality, get quality() { return Q; }, get ng() { return NG; }, tune: o => { if (!mood) return; Object.assign(mood, o); sun.color.setHex(mood.sun); sun.intensity = mood.sunI; sun.position.set(...mood.dir); hemi.color.setHex(mood.sky); hemi.groundColor.setHex(mood.gnd); hemi.intensity = mood.hemiI; return { ...mood }; }, resize, clearKarts, renderer, scene, reset: () => { key = null; }, get key() { return key; } };
}
