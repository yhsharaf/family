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

  // ---------------------------------------------------------------- ✨ the next-gen look (a prototype, on Oink Oink Meadows for now): the sun
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
    const want = Q >= 1 && (t.key === "henesys" || all) && !!MOODS[t.cup] ? MOODS[t.cup] : null, was = NG;
    NG = !!want; mood = want; blobs.visible = NG;
    if (NG) { sun.color.setHex(mood.sun); sun.intensity = mood.sunI; sun.position.set(...mood.dir); hemi.color.setHex(mood.sky); hemi.groundColor.setHex(mood.gnd); hemi.intensity = mood.hemiI;
      sun.castShadow = true; const ms = Q >= 2 ? 2048 : 1024; if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
    else { hemi.color.setHex(OLD_LIGHT.hemiSky); hemi.groundColor.setHex(OLD_LIGHT.hemiGnd); hemi.intensity = OLD_LIGHT.hemiI; sun.color.setHex(OLD_LIGHT.sun); sun.intensity = OLD_LIGHT.sunI; sun.position.copy(OLD_LIGHT.pos); sun.target.position.set(0, 0, 0); sun.castShadow = false; }
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
  const airLift = r => { if (!(r.z > 0) || !RE || r.idx == null) return 0; const g = h(r.x, r.y), e = RE[Math.max(0, Math.min(RE.length - 1, r.idx | 0))]; return Math.max(0, e - g); };
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
    for (const l of t.ledges || []) for (let o = 0; o < GN * GN; o++) { const n = near[o]; if (n >= l.a && n <= l.b && Math.sqrt(dmin[o]) > edge + 14) HG[o] -= (t.theme.ledgeDrop ?? 260) * smooth(edge + 14, edge + 60, Math.sqrt(dmin[o])); }   // ⛏️ no railings: a sheer drop into the dark beside the road
    if (t.sea != null) {   // 🌋 a flat sea (of lava) everywhere off the road, which stands above it on its own rock
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const o = j * GN + i; if (Math.sqrt(dmin[o]) > edge + 14) HG[o] = t.sea; }
      mean = t.sea;
    }
    if (t.water) {   // 🌊 a lake: the bed lies deep under the water everywhere, and the boardwalk stands on its own piles above it
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const o = j * GN + i, d = Math.sqrt(dmin[o]); if (d > edge + 14) HG[o] = t.water.bed; }   // (a lip a couple of cells wide, so the road edge never sags)
      mean = t.water.bed;
    }
    const DIP = new Float32Array(GN * GN); for (let o = 0; o < GN * GN; o++) DIP[o] = 5 * smooth(edge + 24, edge + 4, Math.sqrt(dmin[o]));   // the ground sinks a little under the road, so it never pokes through
    for (const g of t.gaps || []) { const depth = g.kind === "water" ? 70 : 320;   // 🍄 a gorge (deep, misty) or the park pond
      for (let o = 0; o < GN * GN; o++) if (near[o] >= g.a && near[o] < g.b) DIP[o] = Math.max(DIP[o], depth * smooth(520, 430, Math.sqrt(dmin[o]))); }
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
      const shell = (R0, mat, ht) => { const K = 18, P = [], UV = [], IX = []; let rows = 0, L = 0;
        for (let i = cv.a; i <= cv.b; i += 2, rows++) {
          const p = t.PTS[i % t.N], q = t.PTS[(i + 2) % t.N], a = Math.atan2(q[1] - p[1], q[0] - p[0]), base = h(p[0], p[1]); if (rows) L += 2 * t.SPC;
          for (let k = 0; k <= K; k++) { const th2 = Math.PI * k / K, o = -Math.cos(th2) * R0, y = Math.sin(th2) * R0 * ht; P.push(p[0] - Math.sin(a) * o, base + y - 6, p[1] + Math.cos(a) * o); UV.push(k / K * 3, L / 160); }
        }
        for (let r = 0; r < rows - 1; r++) for (let k = 0; k < K; k++) { const a = r * (K + 1) + k, b = a + K + 1; IX.push(a, b, a + 1, a + 1, b, b + 1); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); geo.setIndex(IX); geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mat); scene.add(m); roadObjs.push(m); };
      const R0 = t.ROAD / 2 + t.CURB + 14;
      shell(R0, cv.star ? new THREE.MeshBasicMaterial({ map: starTex(), side: THREE.DoubleSide }) : cv.temple ? new THREE.MeshLambertMaterial({ map: goldTex(), side: THREE.DoubleSide, emissive: 0x3a2a10 }) : cv.rock ? new THREE.MeshLambertMaterial({ map: rockTex(), side: THREE.DoubleSide, emissive: 0x2a2630 }) : new THREE.MeshLambertMaterial({ map: caveTex(), side: THREE.DoubleSide, emissive: 0x1d4f7a }), .72);   // the crystal (or rock) inside
      shell(R0 + 16, new THREE.MeshLambertMaterial({ color: cv.temple ? 0xb89a5a : cv.mound != null ? cv.mound : 0xeef5fc, side: THREE.DoubleSide, emissive: cv.temple ? 0x2a2010 : 0x2a3a50 }), .8);                // a mound of snow over it
      if (cv.rock || cv.temple || cv.star) continue;
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
    for (const b of t.buildings || []) {
      if (b.ice || b.dam || b.stone) {   // a wall or tower of ice blocks, the concrete dam, or a stone pillar (no roof)
        const T0 = b.dam ? damTex() : b.stone ? rockTex() : iceTex(), U = b.dam ? 220 : b.stone ? 120 : 90, V = b.dam ? 220 : b.stone ? 120 : 45, em = b.dam ? 0x3a3a38 : b.stone ? 0x2a2630 : 0x3a5f80;
        const tx = T0.clone(); tx.needsUpdate = true; tx.repeat.set(Math.max(1, b.w / U), Math.max(1, b.h / V));
        const tz = T0.clone(); tz.needsUpdate = true; tz.repeat.set(Math.max(1, b.d / U), Math.max(1, b.h / V));
        const mx = new THREE.MeshLambertMaterial({ map: tx, emissive: em }), mz = new THREE.MeshLambertMaterial({ map: tz, emissive: em }), top = new THREE.MeshLambertMaterial({ color: b.dam ? 0xb8b4ac : b.stone ? 0x7a7480 : 0xeaf6ff, emissive: em });
        const m = new THREE.Mesh(BOX, [mz, mz, top, top, mx, mx]); m.scale.set(b.w, b.h, b.d); m.rotation.y = -(b.a || 0); m.position.set(b.x, h(b.x, b.y) + b.h / 2 - 4, b.y); scene.add(m); roadObjs.push(m);
        continue;
      }
      const gnd = h(b.x, b.y), wallM = new THREE.MeshBasicMaterial({ map: windowsTex(b.wall, Math.max(2, Math.round(b.w / 70)), 2) }), plain = new THREE.MeshBasicMaterial({ color: new THREE.Color(b.wall).multiplyScalar(.92) }), roofM = new THREE.MeshBasicMaterial({ color: b.roof });   // shown in their true colours: a white house with a pink roof, even in shade
      const body = new THREE.Mesh(BOX, [plain, plain, plain, plain, wallM, wallM]); body.scale.set(b.w, b.h, b.d); body.position.set(b.x, gnd + b.h / 2, b.y); scene.add(body); roadObjs.push(body);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), roofM); roof.rotation.y = Math.PI / 4; roof.scale.set(b.w * .74, b.h * .55, b.d * .9); roof.position.set(b.x, gnd + b.h + b.h * .275, b.y); scene.add(roof); roadObjs.push(roof);
      if (b.tower) { const tw = new THREE.Mesh(BOX, [plain, plain, plain, plain, wallM, wallM]); tw.scale.set(b.w * .22, b.h * 1.6, b.d * 1.1); tw.position.set(b.x, gnd + b.h * .8, b.y - 4); scene.add(tw); roadObjs.push(tw);
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
        const dh = 10 + c.r * .08, dome = new THREE.Mesh(CAP, new THREE.MeshPhongMaterial({ map: capTex(c.col), shininess: c.gold ? 90 : 50, specular: c.gold ? 0xfff0a0 : 0x333333, emissive: c.gold ? 0x6a4800 : 0x000000 }));   // (the golden ones glow) dome.scale.set(c.r, dh, c.r); grp.add(dome);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r * .9, 6, 40), new THREE.MeshLambertMaterial({ color: { g: 0x2f7a2a, r: 0xa8321e, b: 0x235fa8, o: 0xb85a1a, n: 0x4a2c14, y: 0xb8860b }[c.col] || 0xa8321e })); rim.position.y = -2; grp.add(rim);
        const under = new THREE.Mesh(new THREE.CylinderGeometry(c.r * .88, c.r * .3, 14, 32), new THREE.MeshLambertMaterial({ color: 0xf2e2b8 })); under.position.y = -12; grp.add(under);
        const sl = depth + 10 + lift, stem = new THREE.Mesh(new THREE.CylinderGeometry(c.r * .17, c.r * .22, sl, 20), new THREE.MeshLambertMaterial({ color: 0xf0d77a })); stem.position.y = -sl / 2 - 12; grp.add(stem);
        scene.add(grp); roadObjs.push(dome, rim, under, stem); extraObjs.push(grp); caps.push({ m: dome, pad: c, h: dh });
      }
      // what's down there: drifting mist in the gorge, water in the pond
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
  const windowsTex = (wall, cols, rows) => { const c = canvas(256, 128), g = c.getContext("2d"); g.fillStyle = wall; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const x = (i + .5) * 256 / cols - 12, y = (j + .5) * 128 / rows - 18; g.fillStyle = "#8fd0ff"; g.fillRect(x, y, 24, 34); g.fillStyle = wall; g.fillRect(x + 11, y, 2, 34); g.fillRect(x, y + 16, 24, 2); g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(x - 2, y + 34, 28, 3); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const hedgeTex = () => hedgeT || (hedgeT = (() => { const c = canvas(128, 128), g = c.getContext("2d"); g.fillStyle = "#3f9a34"; g.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 700; k++) { const v = Math.random(); g.fillStyle = v < .4 ? "#2f7d28" : v < .75 ? "#56b848" : "#78d066"; g.beginPath(); g.ellipse(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 4, 1.5 + Math.random() * 3, Math.random() * 3, 0, 7); g.fill(); }
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
  let rockT = null, damT = null, goldT = null, faceT = null, thw = [], thFn = null, cartM = [], cartFn = null, fireM = [], fireFn = null, holeM = [], lapFn = null, clockM = null;
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
    g.fillStyle = "#fffaf0"; for (const [x, y, r] of [[30, 40, 16], [100, 70, 20], [170, 35, 14], [220, 85, 18], [65, 100, 11], [140, 108, 10], [250, 20, 9], [5, 80, 10]]) { g.beginPath(); g.ellipse(x, y, r, r * .8, 0, 0, 7); g.fill(); }
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
    if (t.sky) { const tile = seamless(t.sky), sh = picH, n = Math.max(1, Math.round(4096 / (tile.width * sh / tile.height * ax))), sw = 4096 / n;   // the same way round every time (no mirrored copies), joins blended away
      for (let i = 0; i < n; i++) g.drawImage(tile, i * sw, top, sw + .5, sh);
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
    if (key !== t.key) { key = t.key; buildGround(t); skyRefs = []; built = true; }
    if (skyRefs[0] !== t.sky || skyRefs[1] !== t.strip || !skyMesh) { skyRefs = [t.sky, t.strip]; buildSky(t); built = true; }
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
      geo.setAttribute("position", new THREE.Float32BufferAttribute([14, 33, 0, -12, 30, -30, -12, 30, 30, 14, 33, 0, -12, 30, 30, -6, 31.5, 0, 14, 33, 0, -6, 31.5, 0, -12, 30, -30], 3));   // (just over the driver's head) geo.computeVertexNormals();
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
    if (lapFn) { const l = lapFn(); for (const q of holeM) q.g.visible = l >= q.hl.lap; }
    if (cartFn) { const now = performance.now() / 1000; for (const q of cartM) { const p = cartFn(q.c, now); q.g.position.set(p.x, h(p.x, p.y), p.y); q.g.rotation.y = -p.a; } }
    if (thFn) { const now = performance.now() / 1000; for (const q of thw) { const z = thFn(q.th, now); q.m.position.set(q.th.x, q.g + 31 + z, q.th.y); q.sh.position.set(q.th.x, q.g + 1.2, q.th.y); q.sh.material.opacity = .15 + .4 * (1 - Math.min(1, z / 150)); } }
    VW = o.W; VH = o.H; pi = 0; bi = 0; for (const m of karts.values()) m.used = false;
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
    camera.lookAt(look);
    if (NG) { const fx = Math.round((k.x + Math.cos(cam.yaw) * 260) / 8) * 8, fz = Math.round((k.y + Math.sin(cam.yaw) * 260) / 8) * 8, fy = Math.round(kh / 8) * 8, D = mood.dir;   // the shadow box sits just ahead of you
      sun.target.position.set(fx, fy, fz); sun.position.set(fx + D[0] * 1500, fy + D[1] * 1500, fz + D[2] * 1500); }
    blobI = 0;
    cam.roll = (cam.roll || 0) + ((o.roll || 0) - (cam.roll || 0)) * Math.min(1, o.dt * 6); if (cam.roll) camera.rotateZ(cam.roll);   // leans into a drift
    camera.fov = 60 + 13 * (o.fov || 0); camera.aspect = VW / VH; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    if (skyMesh) skyMesh.position.set(camera.position.x, camera.position.y + SKY_H / 2 - SKY_BELOW, camera.position.z);
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
  return { snap, sync, begin, end, spr, box, kart, proj, hidden, h, liftOf, camera, setQuality, get quality() { return Q; }, get ng() { return NG; }, tune: o => { if (!mood) return; Object.assign(mood, o); sun.color.setHex(mood.sun); sun.intensity = mood.sunI; sun.position.set(...mood.dir); hemi.color.setHex(mood.sky); hemi.groundColor.setHex(mood.gnd); hemi.intensity = mood.hemiI; return { ...mood }; }, resize, clearKarts, renderer, scene, reset: () => { key = null; }, get key() { return key; } };
}
