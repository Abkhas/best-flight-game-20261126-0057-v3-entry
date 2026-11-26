// terrain.js — the world: snowy high peaks at dawn, a ridge rescue ring, a
// lit hospital helipad, a valley pad, storm sky. Everything the heli flies
// over lives here. groundHeight(x, z) is the single source of truth for the
// terrain surface — the flight model, the winch and the camera all read it.

import * as THREE from 'three';

export const PAD = { x: 0, z: -640, y: 62, r: 42 };        // hospital helipad
export const VALLEY_PAD = { x: 420, z: 120, y: 38, r: 34 }; // valley pad (ferry)
export const RING_A = { x: 0, z: -260, y: 118, r: 40 };     // ridge rescue ring
export const RING_B = { x: -330, z: -430, y: 96, r: 34 };   // medevac ledge
export const RING_C = { x: 310, z: -170, y: 104, r: 34 };   // blizzard ridge
export const RING_D = { x: 0, z: -640, y: 62, r: 40 };     // base pad ring (ferry pickup)

// --- deterministic pseudo-noise (seeded, so the terrain never moves) ---
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function smooth(t) { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }

// Peaks: a ring of big gaussians around the valley, so the heli always flies
// between recognisable summits. The valley floor runs north-south (z axis).
function peakHeight(x, z) {
  let h = 0;
  const peaks = [
    [-700, -700, 260, 520], [650, -800, 300, 560], [-950, -150, 320, 480],
    [900, -250, 340, 540], [-550, 450, 280, 430], [750, 550, 300, 470],
    [-250, -950, 260, 500], [180, -1050, 300, 520], [1100, 150, 320, 460],
    [-1150, 250, 300, 440], [0, 900, 340, 420], [-420, 950, 280, 400],
  ];
  for (const [px, pz, pr, ph] of peaks) {
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    h += ph * Math.exp(-d2 / (pr * pr));
  }
  // rolling foothills + fine ridge noise
  h += 26 * noise(x * 0.004, z * 0.004) + 9 * noise(x * 0.02, z * 0.02);
  // the valley floor itself: a gentle bowl, lowest along the flight corridor
  h += 14 * Math.abs(x) / 900;
  return h;
}

function flatBlend(x, z, cx, cz, r, y) {
  const d = Math.hypot(x - cx, z - cz);
  return smooth((d - r * 0.55) / (r * 0.75));
}

export function groundHeight(x, z) {
  let h = peakHeight(x, z);
  // flatten a shelf at each rescue ring and each pad, so the ring reads as a
  // ridge shelf and the pad as a built plateau — never a slope.
  for (const s of [RING_A, RING_B, RING_C]) {
    const b = flatBlend(x, z, s.x, s.z, s.r, s.y);
    h = s.y * (1 - b) + h * b;
  }
  for (const p of [PAD, VALLEY_PAD]) {
    const b = flatBlend(x, z, p.x, p.z, p.r, p.y);
    h = p.y * (1 - b) + h * b;
  }
  return h;
}

function gradientTexture(stops, w = 16, h = 512) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowSprite(color = '#ffd27f') {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, color); grad.addColorStop(0.35, color + 'aa'); grad.addColorStop(1, color + '00');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A floating place-name label: gold stencil text on a dark pill, always
// facing the camera. Names are what turn terrain into a PLACE (C1).
function makeLabel(text, scale = 1) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(3,7,15,0.72)';
  g.beginPath(); g.roundRect(6, 10, 500, 76, 14); g.fill();
  g.strokeStyle = 'rgba(255,210,127,0.85)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#ffd27f'; g.font = 'bold 44px "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  sp.scale.set(110 * scale, 20.6 * scale, 1);
  return sp;
}

// A flat ribbon hugging the terrain (river / road): a triangle strip whose
// vertices sit just above groundHeight, so the line reads at any distance.
function ribbon(path, width, yOff, color, opacity = 0.95) {
  const pts = [];
  for (let i = 0; i < path.length; i++) {
    const [x, z] = path[i];
    pts.push([x, groundHeight(x, z) + yOff, z]);
  }
  const posArr = new Float32Array(pts.length * 2 * 3);
  const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i];
    const [nx, , nz] = pts[Math.min(i + 1, pts.length - 1)];
    const [px, , pz] = pts[Math.max(i - 1, 0)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const ox = -dz * width / 2, oz = dx * width / 2;
    posArr.set([x + ox, y, z + oz], i * 6);
    posArr.set([x - ox, y, z - oz], i * 6 + 3);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: opacity < 1, opacity, side: THREE.DoubleSide,
  }));
}

export function buildWorld(scene) {
  const world = {
    tick: () => {}, rings: [], pads: [], beam: null, storm: null,
    groundHeight, markNext: null, setWeather: null, clouds: [],
  };

  // --- dawn storm sky: indigo overhead, ember band on the horizon ---
  const skyTex = gradientTexture([
    [0.0, '#04060f'], [0.40, '#0d1730'], [0.60, '#2a3458'],
    [0.70, '#8a4a38'], [0.76, '#e08a4e'], [0.82, '#4a2f3a'], [1.0, '#070a14'],
  ]);
  const sky = new THREE.Mesh(
    new THREE.CylinderGeometry(3600, 3600, 1700, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  sky.position.y = 300; scene.add(sky);

  // low sun + cold moonlight + ambient, bright enough that the snow READS
  const sun = new THREE.DirectionalLight(0xffd9b8, 1.0);
  sun.position.set(-900, 260, 700); scene.add(sun);
  const moonLight = new THREE.DirectionalLight(0x8fb4e8, 1.2);
  moonLight.position.set(-600, 900, -1200); scene.add(moonLight);
  scene.add(new THREE.AmbientLight(0x46587a, 2.2));
  scene.fog = new THREE.Fog(0x1a2233, 500, 3000);
  world.setWeather = (mode) => {
    if (mode === 'whiteout') { scene.fog.near = 120; scene.fog.far = 900; scene.fog.color.set(0x8a94a8); }
    else if (mode === 'storm') { scene.fog.near = 320; scene.fog.far = 2100; scene.fog.color.set(0x232c40); }
    else { scene.fog.near = 500; scene.fog.far = 3000; scene.fog.color.set(0x1a2233); }
  };

  // --- terrain: displaced plane, vertex-coloured snow / rock / pine ---
  const SIZE = 4200, SEG = 96;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const snow = new THREE.Color(0xe6edf5), snowShade = new THREE.Color(0xc3d2e6);
  const rock = new THREE.Color(0x565e6a), rockDark = new THREE.Color(0x2e3238);
  const pine = new THREE.Color(0x1d3325);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);
    const n = noise(x * 0.02, z * 0.02);
    const n2 = noise(x * 0.008 + 7, z * 0.008 + 3); // big drift patches
    const c = new THREE.Color();
    if (h > 300) c.copy(snow).lerp(snowShade, n * 0.5 + n2 * 0.25);
    else if (h > 150) c.copy(snow).lerp(rock, 0.10 + n * 0.15);
    else if (h > 60) c.copy(snow).lerp(pine, 0.18 + n * 0.25);
    else c.copy(snow).lerp(rockDark, n * 0.3);
    if (n2 > 0.68) c.lerp(new THREE.Color(0xbfd4ea), 0.45); // blue snow drifts
    else if (n2 < 0.25) c.lerp(new THREE.Color(0xf4ead8), 0.25); // warm dawn snow
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 18, specular: 0x8a9abb, flatShading: true,
  }));
  scene.add(terrain);

  // --- pine forest: dark green cones on the lower slopes, alive not empty ---
  const trunkMat = new THREE.MeshPhongMaterial({ color: 0x3a2a1e });
  const pineMat = new THREE.MeshPhongMaterial({ color: 0x1e3a28, shininess: 8 });
  const snowPineMat = new THREE.MeshPhongMaterial({ color: 0x2c4a34, shininess: 8 });
  const treeGeo = new THREE.ConeGeometry(4, 16, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.7, 0.9, 4, 5);
  let trees = 0;
  const plantTree = (x, z, s) => {
    const h = groundHeight(x, z);
    if (h < 30 || h > 170) return;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 2; t.add(trunk);
    const c1 = new THREE.Mesh(treeGeo, pineMat); c1.position.y = 10; t.add(c1);
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 6), snowPineMat); c2.position.y = 16; t.add(c2);
    t.scale.setScalar(s); t.position.set(x, h, z);
    scene.add(t); trees++;
  };
  for (let i = 0; i < 420 && trees < 190; i++) {
    const x = (hash(i, 7) - 0.5) * 3000, z = (hash(i, 13) - 0.5) * 3000;
    const h = groundHeight(x, z);
    if (h < 30 || h > 170) continue;
    // keep the flight corridor and the pads clear
    if (Math.abs(x) < 90 && z > -720 && z < 220) continue;
    if (Math.hypot(x - PAD.x, z - PAD.z) < 70) continue;
    if (Math.hypot(x - VALLEY_PAD.x, z - VALLEY_PAD.z) < 60) continue;
    plantTree(x, z, 0.8 + hash(i, 29) * 0.9);
  }
  // dense forest patch on the lower east slope — a forest, not three pines
  for (let i = 0; i < 60 && trees < 240; i++) {
    const a = hash(i, 41) * Math.PI * 2, r = Math.sqrt(hash(i, 43)) * 130;
    const x = 300 + Math.cos(a) * r * 1.2, z = 330 + Math.sin(a) * r * 0.8;
    plantTree(x, z, 0.9 + hash(i, 47) * 0.8);
  }

  // --- storm clouds: big dark translucent billboards drifting overhead ---
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0x2c3648, transparent: true, opacity: 0.55, depthWrite: false, fog: false,
  });
  for (let i = 0; i < 12; i++) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(90 + hash(i, 3) * 120, 10, 8), cloudMat);
    cl.scale.y = 0.28;
    cl.position.set((hash(i, 5) - 0.5) * 3200, 480 + hash(i, 11) * 220, (hash(i, 17) - 0.5) * 3200);
    cl.userData.vx = 4 + hash(i, 23) * 6;
    scene.add(cl); world.clouds.push(cl);
  }

  // --- the river + the road: two lines that make the valley a PLACE ---
  // The river winds down the valley floor east of the flight corridor; the
  // road runs west of it. Both are wide, bright ribbons — they must read at
  // contact-sheet scale, not as sub-pixel noise.
  const riverPath = [];
  for (let z = -1000; z <= 800; z += 50) riverPath.push([95 + 45 * Math.sin(z * 0.0032) + 15 * Math.sin(z * 0.011), z]);
  scene.add(ribbon(riverPath, 10, 0.7, 0x2568a8));
  const roadPath = [];
  for (let z = -1000; z <= 800; z += 50) roadPath.push([-155 + 25 * Math.sin(z * 0.002 + 1.3), z]);
  scene.add(ribbon(roadPath, 8, 0.5, 0x2e2b28));
  // road centre dashes: pale quads every 26 m along the road
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c4 });
  for (let z = -980; z <= 780; z += 26) {
    const x = -155 + 25 * Math.sin(z * 0.002 + 1.3);
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 5), dashMat);
    d.rotation.x = -Math.PI / 2; d.rotation.z = 0.2;
    d.position.set(x, groundHeight(x, z) + 0.9, z);
    scene.add(d);
  }

  // --- PINEHOLLOW village: a cluster of houses with lit windows, east of
  // the valley pad — the named town on the cover ---
  const houseCols = [0x6a5a48, 0x5a6a7a, 0x7a6a5a, 0x4a5a6a];
  const winMat2 = new THREE.MeshBasicMaterial({ color: 0xffca6a });
  for (let i = 0; i < 14; i++) {
    const x = 580 + (hash(i, 53) - 0.5) * 140, z = 280 + (hash(i, 59) - 0.5) * 120;
    const h = groundHeight(x, z);
    const g2 = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 7),
      new THREE.MeshPhongMaterial({ color: houseCols[i % 4] }));
    walls.position.y = 2.5; g2.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.8, 4, 4),
      new THREE.MeshPhongMaterial({ color: 0x3a2e26 }));
    roof.position.y = 7; roof.rotation.y = Math.PI / 4; g2.add(roof);
    for (const wx of [-2.2, 2.2]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), winMat2);
      w.position.set(wx, 2.8, -3.55); w.rotation.y = Math.PI; g2.add(w);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ffca6a'), transparent: true, opacity: 0.5, depthWrite: false,
    }));
    glow.scale.set(16, 16, 1); glow.position.y = 4; g2.add(glow);
    g2.position.set(x, h, z);
    g2.rotation.y = hash(i, 61) * Math.PI;
    scene.add(g2);
  }
  const pineLabel = makeLabel('PINEHOLLOW', 1.1);
  pineLabel.position.set(580, groundHeight(580, 280) + 52, 280);
  scene.add(pineLabel);

  // --- the storm front: a dark wall of cloud in the north, with its name ---
  const frontMat = new THREE.MeshBasicMaterial({ color: 0x131b2b, transparent: true, opacity: 0.95, fog: false });
  for (let i = 0; i < 9; i++) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(150 + hash(i, 67) * 110, 10, 8), frontMat);
    cl.scale.y = 0.5;
    cl.position.set(-1200 + i * 300, 360 + hash(i, 71) * 160, -1150 - hash(i, 73) * 120);
    scene.add(cl);
  }
  const frontLabel = makeLabel('STORM FRONT', 1.3);
  frontLabel.position.set(0, 580, -1120);
  scene.add(frontLabel);

  // --- rescue rings: dashed gold torus + light beam + pulsing glow ---
  function buildRing(site, label) {
    const g = new THREE.Group();
    g.position.set(site.x, site.y + 0.6, site.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.55, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd27f }),
    );
    ring.rotation.x = Math.PI / 2; g.add(ring);
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(10.4, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.1; g.add(inner);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 5, 260, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 130; g.add(beam);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ffd27f'), transparent: true, opacity: 0.9, depthWrite: false,
    }));
    glow.scale.set(46, 46, 1); glow.position.y = 4; g.add(glow);
    // beacon mast + red strobe at the ring edge
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 7, 6),
      new THREE.MeshPhongMaterial({ color: 0x222222 }));
    mast.position.set(13, 3.5, 0); g.add(mast);
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3333 }));
    strobe.position.set(13, 7.4, 0); g.add(strobe);
    g.userData = { strobe, glow, beam, label, site };
    scene.add(g);
    return { mesh: g, site, label, passed: false, strobe, glow, beam };
  }
  world.rings = [buildRing(RING_A, 'RIDGE'), buildRing(RING_B, 'LEDGE'), buildRing(RING_C, 'BLIZZARD'), buildRing(RING_D, 'BASE')];

  // --- hospital helipad: lit slab, H marking, edge lights, hospital block ---
  function buildPad(p, label, cross) {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 2.4, 8),
      new THREE.MeshPhongMaterial({ color: 0x2a2f38, shininess: 40 }));
    slab.position.y = 0.4; g.add(slab);
    const top = new THREE.Mesh(new THREE.CircleGeometry(p.r - 2, 8),
      new THREE.MeshPhongMaterial({ color: 0x3d4450, shininess: 30 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 1.7; g.add(top);
    // H marking: two bars + crossbar, bright white-yellow
    const hMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (const dx of [-7, 7]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 20), hMat);
      bar.position.set(dx, 1.85, 0); g.add(bar);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(17, 0.3, 3), hMat);
    crossbar.position.set(0, 1.85, 0); g.add(crossbar);
    // edge lights: amber ring of small glowing spheres
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb03a }));
      l.position.set(Math.cos(a) * (p.r - 1), 2.2, Math.sin(a) * (p.r - 1));
      g.add(l);
    }
    // pad floodlight glow
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ffb03a'), transparent: true, opacity: 0.55, depthWrite: false,
    }));
    glow.scale.set(p.r * 2.6, p.r * 2.6, 1); glow.position.y = 6; g.add(glow);
    if (cross) {
      // hospital block beside the pad: lit windows + red-cross sign
      const hosp = new THREE.Mesh(new THREE.BoxGeometry(46, 20, 26),
        new THREE.MeshPhongMaterial({ color: 0x8a94a4, shininess: 20 }));
      hosp.position.set(-p.r - 34, 10, 18); g.add(hosp);
      const winMat = new THREE.MeshBasicMaterial({ color: 0xffca6a });
      for (let wy = 5; wy <= 15; wy += 5) for (let wx = -20; wx <= 20; wx += 8) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), winMat);
        w.position.set(-p.r - 34 + wx, wy, 31.2); g.add(w);
      }
      const sign = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      sign.position.set(-p.r - 34, 26, 31.2); g.add(sign);
      const cr1 = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xcc2222 }));
      cr1.position.set(-p.r - 34, 26, 31.8); g.add(cr1);
      const cr2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 8, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xcc2222 }));
      cr2.position.set(-p.r - 34, 26, 31.8); g.add(cr2);
    }
    // windsock: orange cone on a pole, shows the wind the pilot fights
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 12, 6),
      new THREE.MeshPhongMaterial({ color: 0x888888 }));
    pole.position.set(p.r - 6, 6, p.r - 8); g.add(pole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
    sock.rotation.z = Math.PI / 2; sock.position.set(p.r - 10, 11, p.r - 8); g.add(sock);
    g.userData.label = label;
    scene.add(g);
    return { mesh: g, pad: p, label };
  }
  world.pads = [buildPad(PAD, 'SUMMIT BASE · HELIPAD 07', true), buildPad(VALLEY_PAD, 'VALLEY PAD', false)];
  const padBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 10, 300, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide }),
  );
  padBeacon.position.set(PAD.x, PAD.y + 150, PAD.z);
  scene.add(padBeacon);
  // place-name labels over the two pads
  const baseLabel = makeLabel('SUMMIT BASE', 1.1);
  baseLabel.position.set(PAD.x, PAD.y + 58, PAD.z);
  scene.add(baseLabel);
  const valleyLabel = makeLabel('VALLEY PAD', 0.9);
  valleyLabel.position.set(VALLEY_PAD.x, VALLEY_PAD.y + 42, VALLEY_PAD.z);
  scene.add(valleyLabel);

  // --- the next-target marker: a slim gold beam over the target ---
  // (the gold diamond was removed: at 2.5 m it read as a giant kite on the
  // cover and a gold pyramid filling the cockpit view. The beam + ring
  // already mark the target.)
  const markerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 2.5, 300, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
  );
  scene.add(markerBeam);
  world.markNext = (target) => {
    if (!target) { markerBeam.visible = false; return; }
    markerBeam.visible = true;
    markerBeam.position.set(target.x, target.y + 150, target.z);
  };

  world.tick = (t) => {
    for (const cl of world.clouds) {
      cl.position.x += cl.userData.vx * 0.016;
      if (cl.position.x > 1800) cl.position.x = -1800;
    }
    for (const r of world.rings) {
      r.strobe.material.color.setHex((t % 1.2) < 0.15 ? 0xff3333 : 0x551111);
      const p = 0.75 + Math.sin(t * 3) * 0.25;
      r.glow.material.opacity = p;
      r.mesh.children[0].scale.setScalar(1 + Math.sin(t * 2) * 0.03);
    }
  };
  return world;
}
