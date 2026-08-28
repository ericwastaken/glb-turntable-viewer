# GLB Turntable Viewer (three.js)

**▶ View this live: https://ericwastaken.github.io/glb-turntable-viewer/**

A single static page that spins a GLB model over a starfield, rendered with
self-hosted three.js. No CDN, no build step, no licenses. Everything needed is
in this folder.

## Where to start

**Designer? You want the easy path:**
[**Icon packs (zip)**](#icon-packs-zip-the-no-tools-workflow-for-designers) —
drag one zip onto the page, no tools, no code. Jump straight to the
[30-second try-it](#try-it-in-30-seconds) with a downloadable example, the
step-by-step [packaging walkthrough](#packaging-a-multi-icon-zip-step-by-step),
[loading it on the page](#loading-it-on-the-page), or the
[standard exports table](#standard-exports) to hand to whoever builds your
icon code.

Full contents:

1. [Run it locally](#run-it-locally) — serve the folder, open the page
2. [What's in the page](#whats-in-the-page) — models, sidecars, pivot, spin
3. [Files](#files) — what's in this repo
4. [Custom components](#custom-components-looks-a-sidecar-cant-describe) —
   single .js modules for looks a sidecar can't describe (developer path) ·
   [learn more](#learn-more-its-all-just-threejs)
5. [**Icon packs (zip)**](#icon-packs-zip-the-no-tools-workflow-for-designers)
   — the no-tools designer path:
   [try it](#try-it-in-30-seconds) ·
   [layout](#zip-layout) ·
   [standard exports](#standard-exports) ·
   [packaging](#packaging-a-multi-icon-zip-step-by-step) ·
   [loading](#loading-it-on-the-page)
6. [Known limits](#known-limits-deliberate-its-a-proof-of-concept)

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
A component is ordinary [three.js](https://threejs.org) code in a thin
wrapper: anything three.js can do, a component can do — only the entry
function below is specific to this viewer ([learn more](#learn-more-its-all-just-threejs)).

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

### Learn more: it's all just three.js

Everything inside a component — geometry, materials, shaders, motion — is
plain three.js, and it's documented far better elsewhere than we could here:

- [three.js manual](https://threejs.org/manual/) — learn from zero: scenes,
  meshes, materials, and the animation loop (the `update(dt)` of the world).
- [three.js API docs](https://threejs.org/docs/) — the reference. The two
  usual entry points:
  [`MeshPhysicalMaterial`](https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial)
  for standard looks and
  [`ShaderMaterial`](https://threejs.org/docs/#api/en/materials/ShaderMaterial)
  for fully custom ones.
- [three.js examples](https://threejs.org/examples/) — hundreds of live demos
  of what's possible, each with its source code.
- [The Book of Shaders](https://thebookofshaders.com/) — a gentle,
  designer-friendly introduction to GLSL, for looks like the shader-orb
  example and beyond.

## Icon packs (zip): the no-tools workflow for designers

A whole package — multiple icons, each with its own code and assets — travels
as **one zip you drag onto the page**. No server, no build tools, no editing
code. Under the hood the viewer unzips in the browser (self-hosted fflate) and
serves the contents from a tiny service worker, so the package's relative
imports and asset paths work untouched; nothing is uploaded anywhere.

### Try it in 30 seconds

Download
[`components/example-pack.zip`](https://ericwastaken.github.io/glb-turntable-viewer/components/example-pack.zip)
(4 KB — two procedural icons, no asset files) and drag it onto
[the viewer](https://ericwastaken.github.io/glb-turntable-viewer/). The
dropdown switches to the pack's icons ("twist" and "gem") plus an
"⏏ Unload zip" entry. While a pack is loaded, the turntable and sidecar
controls hide — a pack owns its own motion, materials, and framing.

Its source is [`components/example-pack/`](components/example-pack/): copy
that folder as the skeleton for a real pack. `icons/twist` is the minimal
icon (two required exports); `icons/gem` adds the optional motion controller.

### Zip layout

```
my-icons.zip
├── component.js       ← the universal pack loader: copy components/pack.component.js, never edit it
├── icons.json         ← {"icons": ["nameA", "nameB"]} — the only file you maintain
└── icons/
    ├── nameA/
    │   ├── src/       ← the icon's code (index.js must have the standard exports below)
    │   └── assets/    ← that icon's model + textures
    └── nameB/ ...
```

### Standard exports

Each icon's `icons/<name>/src/index.js` must export
(aliases of its own functions are fine):

| export | required | what it is |
|---|---|---|
| `createIconObject({ geometry, textures, srgbOutput })` | yes | builds and returns the icon (an Object3D or `{ group }`) |
| `loadIconGeometry({ path })` | yes | loads the icon's geometry from `path` |
| `loadIconTextures({ path, renderer })` | no | loads the icon's textures |
| `IconController` | no | motion/animation controller with `update(dt)` |
| `LAYOUT` | no | `{ iconHeightFraction, verticalCenter }` framing |

### Packaging a multi-icon zip, step by step

1. Make a folder for the pack. Copy `component.js` into it from
   [`components/pack.component.js`](components/pack.component.js) — this file
   is universal and is never edited.
2. For each icon, add a folder under `icons/` containing `src/index.js` with
   the standard exports (table above) and, if it loads files, an `assets/`
   folder next to it. Start from
   [`components/example-pack/icons/`](components/example-pack/icons/).
3. List the icon folder names in `icons.json`:
   `{"icons": ["nameA", "nameB"]}`.
4. Right-click the pack folder → **Compress** (macOS) / **Send to →
   Compressed folder** (Windows).

### Loading it on the page

Drag the zip anywhere onto the viewer (or use the
Load… button). The model dropdown switches to the pack's icons, plus an
"⏏ Unload zip (back to samples)" entry that restores everything. While a pack
is loaded the turntable spin, pivot, and sidecar controls hide — the pack owns
its own motion, materials, and framing. Loading any other model or a new zip
also exits the pack.

Adding an icon to an existing pack: drop its folder under `icons/`, add its
name to `icons.json`, re-compress, drag the new zip onto the page.

The trust note above applies doubly to zips: the pack runs real code —
only load packs from people you trust.

Works on any static host (GitHub Pages included) and localhost. Requires a
normal browser window — some private windows block service workers, and the
viewer will say so rather than fail silently.

## Known limits (deliberate; it's a proof of concept)

- No Draco/meshopt decoders: use uncompressed GLB files, or add `DRACOLoader`
  plus the wasm decoder to `vendor/`.
- No KTX2 texture support (same deal: add `KTX2Loader` if needed).
