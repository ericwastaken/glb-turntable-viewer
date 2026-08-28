// "gem" — an icon that brings its own motion via the optional IconController.
// The pack loader calls controller.update(dt) then icon.update(dt, controller)
// every frame; everything about the movement lives here, in the icon.
import * as THREE from 'three';

export function loadIconGeometry() {
  return Promise.resolve(new THREE.IcosahedronGeometry(0.5, 0));
}

// Optional. Owns time/animation state; no rendering, no DOM.
export class IconController {
  constructor() { this.t = 0; }
  setSheetFrames() {}          // present for API compatibility
  update(dt) { this.t += dt; }
}

export function createIconObject({ geometry }) {
  const material = new THREE.MeshStandardMaterial({
    color: '#7a5cff', metalness: 0.6, roughness: 0.25,
    flatShading: true, emissive: '#1b1040',
  });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    group: mesh,
    update(dt, controller) {
      const t = controller?.t ?? 0;
      mesh.rotation.y = t * 0.8;
      mesh.rotation.x = Math.sin(t * 0.9) * 0.25;
      const s = 1 + Math.sin(t * 2) * 0.05;   // gentle breathing
      mesh.scale.set(s, s, s);
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

export const LAYOUT = { iconHeightFraction: 0.35, verticalCenter: 0.45 };
