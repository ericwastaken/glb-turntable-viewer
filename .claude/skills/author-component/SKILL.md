---
name: author-component
description: Write, run, and verify a custom component module for this viewer — a JS file exporting createComponent(ctx) that returns an object, a material, or a pack of icons. Use when asked to add a new visual effect, custom shader, custom geometry, or any look a sidecar cannot express.
---

# Authoring a component module

A component is the escape hatch for looks a sidecar JSON cannot describe. It
is one ES module exporting `createComponent(ctx)`. No build step, no bundler.

Full contract reference: `AGENT.md` §6. Working example to copy:
`components/example-shader-orb.js`. Consumer code: `activateComponent()` and
`applyComponentApi()` in `index.html`.

## Step 1 — decide which shape you are returning

| Return | Use when | Constraint |
|---|---|---|
| `{ object }` | You are supplying the thing on screen (geometry + material) | Replaces the loaded model entirely; parented under the spin pivot |
| `{ material }` | You are re-skinning whatever model is loaded | **A model must already be on screen** or it fails with a status-line message |
| `{ icons }` | You are building a multi-icon pack | Use the `author-icon-pack` skill instead — do not hand-write this |

`object` is checked before `material`, so returning both silently ignores the
material.

## Step 2 — write the file

Start from this skeleton (verified to run as written — it loads, renders, and
frames correctly):

```js
export async function createComponent(ctx) {
  const { THREE } = ctx;
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; void main(){ gl_FragColor = vec4(vec3(0.5+0.5*sin(uTime)),1.0); }`,
  });
  const geometry = new THREE.TorusKnotGeometry(0.5, 0.17, 220, 32);
  return {
    object: new THREE.Mesh(geometry, material),
    framing: { heightFraction: 0.4, verticalCenter: 0.45 },
    update(dt) { uniforms.uTime.value += dt; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
```

Rules that are easy to get wrong:

- **Use `ctx.THREE`.** Never `import * as THREE from 'three'` in a *component*
  (icon modules inside a pack are the exception — see the pack skill). A second
  three.js instance produces objects the viewer's scene graph rejects.
- **Load assets from `ctx.assetPath`**, which always ends in `/`:
  `ctx.assetPath + 'textures/base.jpg'`. Never a hard-coded absolute path — the
  same module must work from a folder and from inside a zip.
- **`update(dt)` receives seconds**, not milliseconds, and is the only place
  animation should advance. Do not start your own `requestAnimationFrame` loop
  or `setInterval`.
- **Always implement `dispose()`** and free every geometry, material, and
  texture you created. Components get unloaded and reloaded repeatedly.
- **`framing.heightFraction`** is the object's height as a fraction of the
  viewport (0.05–1); **`verticalCenter`** is where its center sits measured
  from the top (0.5 = middle). Omit `framing` and generic bounding-box framing
  applies.
- **`pointer: { down(x,y), move(x,y), up() }`** takes over dragging: camera
  rotation is disabled (zoom still works) and canvas pointer events go to you
  in client pixel coordinates.
- **`background: { image }` or `{ color }`** overrides the page backdrop while
  loaded, and is restored on unload.

## Step 3 — colour correctness (this is the usual bug)

three.js r152+ has ColorManagement on by default and this build
(r170, working space `srgb-linear`) is no exception, so:

- `new THREE.Color('#808080')` gives `rgb ≈ 0.2159`, **not** `0.502`. A raw
  `ShaderMaterial` compositing in display space will render dark.
- Pin display-space values explicitly:
  `new THREE.Color().setHex(0x808080, THREE.LinearSRGBColorSpace)` → `0.502`.
- There is **no post-processing pass** in this app and three.js applies no
  sRGB encode to raw `ShaderMaterial` output. Emit display-ready colour; do
  not pre-invert for an encode that never happens. (This is why the pack
  loader passes `srgbOutput: false`.)

`MeshStandardMaterial` / `MeshPhysicalMaterial` handle all of this for you —
only raw shaders need the care.

## Step 4 — run it

```bash
python3 -m http.server 8000
```

- Single file: `http://localhost:8000/?component=./components/your-file.js`,
  or drag the file onto the page.
- Folder package with relative imports: put the folder under the served root
  and use `?component=./your-folder/entry.js`. **Dropping a file with relative
  imports fails** — a blob URL cannot resolve them.
- Cross-origin URLs are rejected by design (`loadComponentURL()` compares
  origins). Do not try to work around it.

## Step 5 — verify

Use the `verify-in-browser` skill. The short version:

```js
const c = window.viewer.component;
c.kind;                  // 'object' | 'material'
Object.keys(c.api);      // what you returned
c.api.update(1.0);       // advance a second deterministically
```

**Do not `await sleep(2000)` and then read a rotation** — in a hidden browser
pane `requestAnimationFrame` is paused and you will read `0` from working code.
Also read `document.getElementById('status').textContent`: nearly every failure
in this app is reported there rather than thrown, with the real error in
`console.error`.

## Step 6 — before you finish

- **Handing it to someone**: a single file can just be sent — they drop it on
  the page. A folder package needs the whole folder plus a served root, and
  `?component=./that-folder/entry.js`.
- **Nothing persists.** The component is gone on reload; the URL is the only
  way to get back to it.
- Bundled components live in `components/` and are described in `README.md`'s
  "Custom components" section — that is where one contributed back would
  naturally go.
- Keep it product-neutral: this repo is public. No client, brand, or
  engagement references in code, comments, filenames, or example assets.
