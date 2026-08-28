// "twist" — the smallest possible icon: procedural geometry, a standard
// material, no controller (it sits still; drag to orbit it). Demonstrates
// the two REQUIRED standard exports plus the optional LAYOUT.
import * as THREE from 'three';

// Required. Normally loads a .glb from `path` (e.g. with GLTFLoader) —
// this example generates geometry instead, so the pack needs no asset files.
export function loadIconGeometry() {
  return Promise.resolve(new THREE.TorusKnotGeometry(0.42, 0.13, 200, 32));
}

// Required. Build and return the icon (an Object3D, or { group } like here).
export function createIconObject({ geometry }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#46e0c2', metalness: 0, roughness: 0.05,
    transmission: 0.9, thickness: 1.2, ior: 1.45, clearcoat: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    group: mesh,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// Optional framing: fraction of viewport height, and vertical center from top.
export const LAYOUT = { iconHeightFraction: 0.4, verticalCenter: 0.45 };
