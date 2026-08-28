# GLB Turntable Viewer (three.js)

**▶ View this live: https://ericwastaken.github.io/glb-turntable-viewer/**

A single static page that spins a GLB model over a starfield, rendered with
self-hosted three.js. No CDN, no build step, no licenses. Everything needed is
in this folder.

## Run it locally

Any static server works (ES modules won't load from file://):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. For static hosting, upload this folder as-is.

## What's in the page

- **Model picker**: seven bundled Khronos sample models, mostly glass
  (glTF transmission/volume) tests like the dragon and the mosquito in amber,
  plus the classic DamagedHelmet PBR test.
- **Load .glb button + drag-and-drop**: drop any GLB straight onto the page to
  preview it. Also `?model=models/yourfile.glb` works.
- **Spin slider + pause**: rotation is done in code (requestAnimationFrame),
  so no baked animation is needed for turntable moves. If a GLB does contain
  embedded animations, the page detects and plays them, and says so in the
  status line.
- **Pivot selector**: choose the vertical axis the model spins around —
  "Center" (through the middle of the visible bounding box, the default) or
  "As exported" (the model file's own origin). A manual axis can be forced
  with `?pivot=x,y,z` in model units.
- **Sidecar material settings**: effects that don't survive a glTF export
  (e.g. glass/transmission looks) can be described in a sidecar JSON with any
  filename. The sidecar is always explicit — pass `?sidecar=path/to/file.json`
  in the URL, multi-select it together with the model in the file dialog, or
  drag-drop it (with the model or on its own). One sidecar can serve several
  models: it stays loaded across model switches until cleared. When one is
  loaded, an "Apply sidecar settings" checkbox toggles between as-exported and
  sidecar materials. Schema: `{"materials": {"<mesh name>" or "*":
  {MeshPhysicalMaterial props, colors as hex strings}}}`; keys starting with
  `_` are comments.
- **Sidecar editor**: the "Sidecar…" button opens an in-page JSON editor with
  live linting — JSON validity plus three.js validity (known
  MeshPhysicalMaterial properties, value types, 0–1 ranges, and whether mesh
  names exist in the current model). Apply is blocked while errors remain, and
  a "three.js docs" button opens the MeshPhysicalMaterial reference.
- **Bundled example**: the "Glass dragon + example sidecar (emerald)" dropdown
  entry loads the dragon together with
  [`sidecars/example-emerald-glass.json`](sidecars/example-emerald-glass.json),
  so the same model can be viewed with and without sidecar settings via the
  checkbox. The example also demonstrates per-mesh targeting (a named mesh
  entry plus a `"*"` fallback).
- **Lighting**: procedurally generated RoomEnvironment IBL + ACES tone
  mapping, which is what makes PBR/glass materials read correctly.
- Backdrop/stage meshes bundled inside sample models (names matching
  backdrop/stage/floor/ground) are hidden automatically so only the hero
  object shows.

## Files

| Path | What |
|---|---|
| `index.html` | The whole page (markup, styles, and module script). |
| `vendor/` | three.js 0.170.0 (MIT) + GLTFLoader, OrbitControls, RoomEnvironment, self-hosted. |
| `models/` | Sample models from [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets): glass/transmission tests (DragonAttenuation, MosquitoInAmber, GlassVaseFlowers, GlassHurricaneCandleHolder, IridescentDishWithOlives, DispersionTest) plus DamagedHelmet (PBR). |

## Custom components (looks a sidecar can't describe)

A sidecar covers everything three.js's standard materials can do. When a look
needs more than that — your own shader, animated texture layers, even your own
geometry — you can hand the viewer a **component**: a JavaScript file that
exports one function. No build tools, no bundler, no pull request needed.

**Start from the working example**:
[`components/example-shader-orb.js`](components/example-shader-orb.js) — open
[`?component=./components/example-shader-orb.js`](./?component=./components/example-shader-orb.js)
to see it run, then copy the file and change what it returns. Every field is
explained in its comments.

The contract, in short:

```js
export async function createComponent(ctx) {
  // ctx = { THREE, renderer, scene, camera, assetPath }
  return {
    object,      // a THREE.Object3D shown on the turntable (instead of a model), OR
    material,    // a THREE.Material applied to the currently loaded model
    update(dt),  // optional: advance animations, called every frame
    dispose(),   // optional: cleanup on unload
    framing,     // optional: { heightFraction: 0.4, verticalCenter: 0.45 }
  };
}
```

**Already have code that builds a three.js object?** Wrap it — do not rewrite
it. A minimal adapter next to your existing files:

```js
import { buildMyThing } from './my-existing-code.js';

export async function createComponent(ctx) {
  const thing = await buildMyThing(ctx.THREE, ctx.assetPath);
  return {
    object: thing.group,
    update: (dt) => thing.tick?.(dt),
    dispose: () => thing.cleanup?.(),
  };
}
```

**How to run yours** (folder packages with multiple files and textures):

1. Put your folder next to the viewer's files (or anywhere under the folder
   you serve).
2. Serve the whole thing — `npx serve .` or
   `python3 -m http.server 8000` — and open the viewer through that server.
3. Add `?component=./your-folder/adapter.js` to the viewer URL.
4. To hand it back, zip the folder and send it — the recipient does the same
   three steps.

Single-file components (like the example) can simply be **drag-dropped onto
the page** — no server path needed. Folder packages must use the URL route,
because a dropped file can't resolve its relative imports.

**A note on trust:** a component is real code running in your browser with
the same powers as the DevTools console. The viewer only loads components
from its own address (relative paths) or from files you explicitly pick or
drop — never from remote URLs — so nothing can run without you choosing it.
Only load component files from people you trust.

## Known limits (deliberate; it's a proof of concept)

- No Draco/meshopt decoders: use uncompressed GLB files, or add `DRACOLoader`
  plus the wasm decoder to `vendor/`.
- No KTX2 texture support (same deal: add `KTX2Loader` if needed).
