// Example custom component for the GLB Turntable Viewer.
//
// A component is how you show the viewer something a sidecar can't describe:
// your own shader, your own animated surface, even your own geometry.
// It is a single JavaScript file (or a folder of them) that exports one
// function: createComponent(ctx).
//
// Try this one:   ?component=./components/example-shader-orb.js
// or drag this file onto the viewer page.
//
// What ctx gives you:
//   ctx.THREE      the three.js library (use this — do not import your own copy)
//   ctx.renderer   the viewer's WebGLRenderer (for texture settings if needed)
//   ctx.scene      the scene (rarely needed; your object is added for you)
//   ctx.camera     the camera (rarely needed; use `framing` below instead)
//   ctx.assetPath  the URL folder this file loaded from — load textures
//                  relative to it, e.g. ctx.assetPath + 'my-texture.jpg'
//
// What you return:
//   object    a THREE.Object3D — shown INSTEAD of the current model, spinning
//             on the viewer's turntable (the Spin slider works on it), OR
//   material  a THREE.Material — applied to the currently loaded model
//   update    optional, called every frame with seconds elapsed — this is
//             where animated shaders advance
//   dispose   optional, called when the component is unloaded
//   framing   optional { heightFraction, verticalCenter } — how big and where
//             on screen, e.g. { heightFraction: 0.4, verticalCenter: 0.45 }
//             means "40% of the viewport tall, centered 45% from the top"

export async function createComponent(ctx) {
  const { THREE } = ctx;

  // Custom shader: a flowing two-tone gradient driven by time and the
  // surface normal. Nothing here is possible with a sidecar — that is the
  // point of a component.
  const uniforms = {
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color('#46e0c2') },
    uColorB: { value: new THREE.Color('#7a5cff') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        float band = sin(vPos.y * 6.0 + uTime * 1.5) * 0.5 + 0.5;
        float rim  = pow(1.0 - abs(vNormal.z), 2.0);          // edge glow
        vec3 col   = mix(uColorA, uColorB, band) + rim * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const geometry = new THREE.TorusKnotGeometry(0.5, 0.17, 220, 32);
  const mesh = new THREE.Mesh(geometry, material);

  return {
    object: mesh,
    framing: { heightFraction: 0.4, verticalCenter: 0.45 },
    update(dt) {
      uniforms.uTime.value += dt;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
