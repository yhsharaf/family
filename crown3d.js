// 👑 PREVIEW (?crown3d): the home page's Family crown as a solid 3D pixel crown (one little cube per pixel of media/crown.png),
// with each merged guild's logo as a thick spinning pixel coin flying the infinity (∞) loop through it, in front one way, behind the other.
import * as THREE from "three";

export function start(host) {
  const M = (window.MERGES || []).filter(g => g.emblem);
  const cv = document.createElement("canvas"); cv.className = "c3dcanvas"; host.appendChild(cv); host.classList.add("c3d");
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a7a66, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(30, 60, 80); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffe2a8, .8); rim.position.set(-60, 20, -40); scene.add(rim);

  // a picture → one cube per opaque pixel (depth cubes thick), centred on its own middle
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const voxels = (im, depth) => {
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height).data, cells = [];
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const k = (y * im.width + x) * 4; if (d[k + 3] > 128) cells.push([x, y, d[k], d[k + 1], d[k + 2]]); }
    const mesh = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial(), cells.length * depth), m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (const [x, y, r, gg, b] of cells) {
      col.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace);
      for (let z = 0; z < depth; z++) { m4.makeTranslation(x - im.width / 2 + .5, im.height / 2 - y - .5, z - depth / 2 + .5); mesh.setMatrixAt(n, m4); mesh.setColorAt(n, col); n++; }
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; return mesh;
  };
  const loadImg = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const tag = text => {   // the guild's name on a little paper tag, always facing the camera
    const c = document.createElement("canvas"), g = c.getContext("2d"); g.font = "700 40px Ubuntu, sans-serif";
    const w = Math.ceil(g.measureText(text).width) + 36; c.width = w; c.height = 64;
    g.font = "700 40px Ubuntu, sans-serif"; g.fillStyle = "#fcfaf4"; g.strokeStyle = "#d7cdbc"; g.lineWidth = 3;
    g.beginPath(); g.roundRect(2, 4, w - 4, 56, 18); g.fill(); g.stroke(); g.fillStyle = "#2d2832"; g.textBaseline = "middle"; g.fillText(text, 18, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false })); sp.scale.set(w / 64 * 6, 6, 1); return sp;
  };

  const crown = new THREE.Group(); scene.add(crown);
  const coins = [];
  loadImg("media/crown.png").then(im => { if (im) crown.add(voxels(im, 6)); });
  M.forEach(g => loadImg(g.emblem).then(im => { if (!im) return;
    const coin = new THREE.Group(), body = voxels(im, 3); body.scale.setScalar(.55); coin.add(body); scene.add(coin);
    const label = tag(g.guild); scene.add(label); coins.push({ coin, label }); }));

  let W = 0, H = 0;
  const size = () => {
    const R = Math.min(170, innerWidth * .38); W = Math.round(2 * R + 140); H = 300;
    if (cv.width !== Math.round(W * renderer.getPixelRatio())) { renderer.setSize(W, H, false); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    camera.aspect = W / H; camera.updateProjectionMatrix();
    const ppu = 4, dist = H / (2 * Math.tan(15 * Math.PI / 180) * ppu);   // (4 px per pixel-cube: the crown is as big as the old 128 px picture)
    camera.position.set(0, dist * .18, dist); camera.lookAt(0, 0, 0);
    return R / ppu;
  };
  const t0 = performance.now();
  const frame = now => {
    requestAnimationFrame(frame);
    if (!host.offsetParent) return;
    const A = size(), t = (now - t0) / 1000;
    crown.rotation.y = Math.sin(t * .7) * .55; crown.position.y = Math.sin(t * 5.7) * 1.4;
    coins.forEach(({ coin, label }, k) => {
      const a = t / 10 * Math.PI * 2 + k * Math.PI * 2 / coins.length;
      coin.position.set(A * Math.sin(a), -4 + A * .32 * Math.sin(2 * a), 26 * Math.cos(a));   // (∞ on screen; nearest at the crossing in front, farthest behind)
      coin.rotation.y = t * 3.2;
      label.position.copy(coin.position); label.position.y -= 12;
    });
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
