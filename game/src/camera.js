// camera.js — three cameras, one pilot. Chase is the default: the whole
// airframe against the peaks. Cockpit rides the nose with the lit panel.
// Winch-cam looks straight DOWN at the ring — the view that proves the hover.

import * as THREE from 'three';

export const CAM_MODES = ['chase', 'cockpit', 'winch'];

export function makeCamera() {
  return new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 9000);
}

// cam: THREE camera, s: flight state, mode, t: seconds, target: ring/pad pos
export function updateCamera(cam, s, mode, t, snap = false, target = null) {
  const hdg = s.heading;
  const fwd = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
  const right = new THREE.Vector3(Math.cos(hdg), 0, Math.sin(hdg));
  const up = new THREE.Vector3(0, 1, 0);

  if (mode === 'cockpit') {
    // Pilot's eye: at the glass nose, high over the skids — the nose drops
    // away below, the ring and the pad ahead stay in view.
    const eye = new THREE.Vector3(s.x, s.y, s.z)
      .addScaledVector(fwd, 2.6)
      .addScaledVector(up, 1.1);
    const look = new THREE.Vector3(s.x, s.y, s.z)
      .addScaledVector(fwd, 60)
      .addScaledVector(up, Math.sin(s.pitch) * 30 - 8);
    cam.position.copy(eye);
    cam.up.set(Math.sin(s.bank), Math.cos(s.bank), 0);
    cam.lookAt(look);
  } else if (mode === 'winch') {
    // Winch-cam: high above the heli, looking straight down at the ring —
    // the hover error reads as the ring drifting under the crosshair.
    const tx = target ? target.x : s.x, tz = target ? target.z : s.z;
    const eye = new THREE.Vector3(s.x, s.y + 26, s.z + 10);
    cam.position.copy(eye);
    cam.up.set(0, 0, -1);
    cam.lookAt(tx, (target ? target.y : s.y - 20), tz);
  } else if (mode === 'chase') {
    // 3/4 rear view: far enough that the 19 m rotor fits, offset to the
    // starboard flank so the SUMMIT LIFT livery reads — and the camera
    // leans toward the next target (ring / pad), so the lit target ahead
    // stays in frame instead of dropping below it.
    const eye = new THREE.Vector3(s.x, s.y, s.z)
      .addScaledVector(fwd, -36)
      .addScaledVector(right, 16)
      .addScaledVector(up, 12);
    const look = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(fwd, 25);
    if (target) look.lerp(new THREE.Vector3(target.x, target.y, target.z), 0.2);
    if (snap) cam.position.copy(eye); else cam.position.lerp(eye, 0.4);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
  } else {
    // orbit: wide, high circle around the heli — peaks, ring and pad in frame
    const a = t * 0.1;
    cam.position.set(s.x + Math.sin(a) * 70, s.y + 22, s.z + Math.cos(a) * 70);
    cam.up.set(0, 1, 0);
    cam.lookAt(s.x, s.y + 1, s.z);
  }
}
