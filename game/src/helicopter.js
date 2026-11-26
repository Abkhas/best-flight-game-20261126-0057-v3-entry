// helicopter.js — the rescue helicopter, built from parts: red/white fuselage,
// glass cockpit, tail boom + tail rotor, spinning main rotor, skids, winch
// drum + cable + hook, and a survivor on the hook. No imported models.

import * as THREE from 'three';

function liveryTexture() {
  // Fuselage side livery: white band, red stripe, "SUMMIT LIFT" in stencil caps.
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e8eef4'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#c0272d'; g.fillRect(0, 84, 512, 20);
  g.fillStyle = '#1a2230'; g.font = 'bold 52px "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SUMMIT LIFT', 256, 46);
  g.font = 'bold 22px "Courier New", monospace';
  g.fillStyle = '#c0272d';
  g.fillText('RESCUE · 07', 256, 116);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roofTexture() {
  // Roof livery: red plate, "SUMMIT LIFT" running nose-to-tail so it reads
  // from the chase camera behind and above the heli.
  const c = document.createElement('canvas'); c.width = 256; c.height = 470;
  const g = c.getContext('2d');
  g.fillStyle = '#c0272d'; g.fillRect(0, 0, 256, 470);
  g.fillStyle = '#ffffff'; g.font = 'bold 46px "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.translate(128, 235); g.rotate(-Math.PI / 2);
  g.fillText('SUMMIT LIFT', 0, 0); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildHelicopter() {
  const heli = new THREE.Group();
  const white = new THREE.MeshPhongMaterial({ color: 0xe8eef4, specular: 0xc8d8e8, shininess: 80 });
  const red = new THREE.MeshPhongMaterial({ color: 0xc0272d, specular: 0xdd8888, shininess: 60 });
  const dark = new THREE.MeshPhongMaterial({ color: 0x232a36, specular: 0x556677, shininess: 50 });
  const glass = new THREE.MeshPhongMaterial({
    color: 0x1a2e42, specular: 0xffffff, shininess: 160, transparent: true, opacity: 0.55,
  });

  // fuselage: rounded body (box + nose cone), white with a red belly stripe
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 7.2), white);
  body.position.set(0, 0.4, 0); heli.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 10), white);
  nose.scale.set(1, 0.78, 1.1); nose.position.set(0, 0.35, -3.4); heli.add(nose);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.5, 6.4), red);
  belly.position.set(0, -0.85, 0.2); heli.add(belly);
  // livery plates on both flanks
  const liv = liveryTexture();
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6),
      new THREE.MeshBasicMaterial({ map: liv }));
    plate.position.set(s * 1.72, 0.55, 0.2);
    plate.rotation.y = s * Math.PI / 2;
    heli.add(plate);
  }
  // roof livery plate: the one that reads from the chase camera
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 5.5),
    new THREE.MeshBasicMaterial({ map: roofTexture() }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, 1.72, 0.2);
  heli.add(roof);
  // glass cockpit bubble + nose searchlight
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), glass);
  cockpit.scale.set(0.95, 0.72, 1.05); cockpit.position.set(0, 0.75, -3.1); heli.add(cockpit);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  lamp.position.set(0, -0.6, -4.6); heli.add(lamp);
  const beamLight = new THREE.PointLight(0xfff2c0, 20, 60);
  beamLight.position.set(0, -0.6, -4.6); heli.add(beamLight);

  // tail boom + fin + tail rotor (spins)
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 7.5, 10), red);
  boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.7, 7.2); heli.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 2.2), red);
  fin.position.set(0, 1.9, 10.6); heli.add(fin);
  const tailRotor = new THREE.Group();
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 0.3), dark);
    blade.rotation.z = a; tailRotor.add(blade);
  }
  tailRotor.position.set(0.6, 1.6, 10.6); tailRotor.rotation.y = Math.PI / 2; heli.add(tailRotor);

  // main rotor mast + hub + two long blades + blur disc
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.9, 8), dark);
  mast.position.set(0, 2.45, 0); heli.add(mast);
  // unlit light-grey blades: a Phong underside goes near-black in the
  // cockpit view (sun above, dark ambient below) and reads as glitch bars.
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0xb8c0cc });
  const rotor = new THREE.Group();
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.07, 0.35), bladeMat);
    blade.position.x = s * 4.8; rotor.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.9), red);
    tip.position.x = s * 9.2; rotor.add(tip);
  }
  rotor.position.set(0, 3.4, 0); heli.add(rotor);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(9.6, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 3.42; heli.add(disc);

  // skids
  for (const s of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 7.6, 6), dark);
    skid.rotation.x = Math.PI / 2; skid.position.set(s * 1.5, -1.55, 0); heli.add(skid);
    for (const z of [-2.4, 2.4]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6), dark);
      strut.position.set(s * 1.5, -1.05, z); heli.add(strut);
    }
  }
  // winch drum under the belly + cable + hook (cable scales with length)
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10), dark);
  drum.rotation.z = Math.PI / 2; drum.position.set(0, -1.15, 1.2); heli.add(drum);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xdddddd }));
  cable.position.set(0, -1.7, 1.2); cable.visible = false; heli.add(cable);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.12, 6, 12),
    new THREE.MeshPhongMaterial({ color: 0xffd27f }));
  hook.position.set(0, -2.2, 1.2); hook.visible = false; heli.add(hook);
  // survivor on the hook: orange suit capsule + helmet
  const survivor = new THREE.Group();
  const suit = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 8),
    new THREE.MeshPhongMaterial({ color: 0xff7a2a, shininess: 30 }));
  survivor.add(suit);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshPhongMaterial({ color: 0xffe9a8 }));
  helmet.position.y = 0.85; survivor.add(helmet);
  survivor.position.set(0, -2.9, 1.2); survivor.visible = false; heli.add(survivor);

  // nav lights: red port, green starboard, white tail strobe
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
  navL.position.set(-1.75, 0.2, -1); heli.add(navL);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x33ff66 }));
  navR.position.set(1.75, 0.2, -1); heli.add(navR);
  const navT = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  navT.position.set(0, 2.6, 10.8); heli.add(navT);

  heli.userData = { rotor, tailRotor, cable, hook, survivor, navT, disc };
  return heli;
}

// Place the heli group from the flight state. Forward is -z in model space.
export function poseHelicopter(heli, s) {
  heli.position.set(s.x, s.y, s.z);
  heli.rotation.order = 'YXZ';
  heli.rotation.y = s.heading;
  heli.rotation.x = -s.pitch;
  heli.rotation.z = s.bank;
}

// Rotor spin + strobe + winch cable geometry. cableLen in metres (0 = stowed).
export function animateHelicopter(heli, s, cableLen, t) {
  const u = heli.userData;
  const spin = 9 + s.collective * 14; // rad/s, faster with collective
  u.rotor.rotation.y += spin * 0.016;
  u.tailRotor.rotation.x += spin * 2.2 * 0.016;
  u.navT.visible = (t % 1.1) < 0.12;
  u.disc.material.opacity = 0.05 + s.collective * 0.03;
  if (cableLen > 0.2) {
    u.cable.visible = true; u.hook.visible = true;
    u.cable.scale.y = cableLen;
    u.cable.position.y = -1.15 - cableLen / 2;
    u.hook.position.y = -1.15 - cableLen;
    u.survivor.position.y = -1.15 - cableLen - 0.9;
    // the hook sways a little in the rotor wash
    const sway = Math.sin(t * 2.4) * 0.25;
    u.hook.position.x = sway; u.survivor.position.x = sway;
  } else {
    u.cable.visible = false; u.hook.visible = false;
  }
  u.survivor.visible = s.survivorOnHook;
}
