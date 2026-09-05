// "prism" — the third example icon, so the demo flow has three things to
// collect. Procedural again (no asset files), with a controller that turns it
// slowly: a landed icon is only still because the sequence takes it out of the
// update path, and this icon proves it.
import * as THREE from 'three';

export function loadIconGeometry() {
  return Promise.resolve(new THREE.OctahedronGeometry(0.52, 0));
}

export class IconController {
  constructor() { this.t = 0; }
  setSheetFrames() {}            // present for API compatibility
  update(dt) { this.t += dt; }
}

export function createIconObject({ geometry }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffb35c', metalness: 0.1, roughness: 0.12,
    transmission: 0.55, thickness: 0.9, ior: 1.6, clearcoat: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    group: mesh,
    update(dt, controller) {
      const t = controller?.t ?? 0;
      mesh.rotation.y = t * 0.55;
      mesh.rotation.z = Math.sin(t * 0.7) * 0.18;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

export const LAYOUT = { iconHeightFraction: 0.38, verticalCenter: 0.45 };
