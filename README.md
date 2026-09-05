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
   [loading](#loading-it-on-the-page) ·
   [sequences](#sequences-choreographing-an-icons-entrance--and-a-collect-flow)
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
- **Background**: a 2D image layer behind the transparent canvas, never scene
  geometry, so orbiting the camera can't move it (the same layering a real
  page uses). Default is `backgrounds/starfield-default.jpg`, a synthetic
  starfield generated for this project (no external assets or licenses). The
  **Stars** checkbox turns it off; drop or pick any `.png/.jpg/.webp` to use
  your own (a chip removes it); `?bg=path/to/image.jpg` works too
  (same-origin only). Packs can ship their own background (see below).
- **Loading curtain**: an opaque layer that is up before the first paint and
  comes down as soon as there is something to see — for a pack with a
  sequence, the instant its first step can draw; the remaining icons keep
  loading behind it. A pack can restyle it (`loading:` in `icons.yml`: a
  ground colour, an optional image, `animation: pulse | none`); the viewer's
  own default is a near-black ground and a soft pulsing disc. There is no
  spinner and no progress bar, by decision. It also carries the rotation
  prompt below.
- **Lighting**: procedurally generated RoomEnvironment IBL + ACES tone
  mapping, which is what makes PBR/glass materials read correctly.
- Backdrop/stage meshes bundled inside sample models (names matching
  backdrop/stage/floor/ground) are hidden automatically so only the hero
  object shows.

## Files

| Path | What |
|---|---|
| `index.html` | The page (markup, styles, and module script). |
| `sequence.js` | Plays a pack's optional `sequence.yml` (entrance choreography and multi-step collect flows); loaded only when a pack has one. |
| `vendor/` | three.js 0.170.0 (MIT) + GLTFLoader, OrbitControls, RoomEnvironment; fflate (MIT) for zips; js-yaml 5.4.1 (MIT) for pack manifests and sequences; Anime.js 4.5.0 (MIT) for sequence timelines. All self-hosted. |
| `backgrounds/` | `starfield-default.jpg` — synthetic starfield (generated, 4096×2732), the default backdrop. |
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
    background,  // optional: { image: url } or { color: '#05061a' } — shown behind the canvas
    pointer,     // optional: { down(x,y), move(x,y), up() } — take over drags (camera stops orbiting)
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
(11 KB — three procedural icons, the pack's own background, and a three-step
sequence; no per-icon asset files) and drag it onto
[the viewer](https://ericwastaken.github.io/glb-turntable-viewer/). The
dropdown switches to the pack's icons ("twist", "gem" and "prism") plus an
"⏏ Unload zip" entry. While a pack is loaded, the turntable and sidecar
controls hide — a pack owns its own motion, materials, and framing.

Its source is [`components/example-pack/`](components/example-pack/): copy
that folder as the skeleton for a real pack. `icons/twist` is the minimal
icon (two required exports); `icons/gem` and `icons/prism` add the optional
motion controller.

### Zip layout

```
my-icons.zip
├── component.js       ← the universal pack loader: copy components/pack.component.js, never edit it
├── icons.yml          ← icons: [nameA, nameB]   background: backgrounds/sky.jpg   sequence: sequence.yml
│                        (also optional: loading: { ground, image, animation } — the loading curtain)
├── sequence.yml       ← optional: how icons ENTER, and how a tap collects them
├── backgrounds/       ← optional images referenced from icons.yml
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
| `IconController` | no | motion controller with `update(dt)`; if it also has `pointerDown/pointerMove/pointerUp`, drags are routed to it so the icon spins while the camera and backdrop stay still |
| `LAYOUT` | no | `{ iconHeightFraction, verticalCenter }` framing |

### Packaging a multi-icon zip, step by step

1. Make a folder for the pack. Copy `component.js` into it from
   [`components/pack.component.js`](components/pack.component.js) — this file
   is universal and is never edited.
2. For each icon, add a folder under `icons/` containing `src/index.js` with
   the standard exports (table above) and, if it loads files, an `assets/`
   folder next to it. Start from
   [`components/example-pack/icons/`](components/example-pack/icons/).
3. List the icon folder names in `icons.yml`:
   ```yaml
   icons:
     - nameA
     - nameB
   ```
4. Right-click the pack folder → **Compress** (macOS) / **Send to →
   Compressed folder** (Windows).

### Backgrounds in a pack

Add `background: backgrounds/sky.jpg` to `icons.yml` (an image path inside
the zip, or a CSS color like `"#05061a"`) for a pack-wide backdrop, and
optionally per-icon overrides:

```yaml
backgrounds:
  nameB: backgrounds/alt.jpg
```
 The viewer shows it while the pack is loaded and restores its own on
unload. Keep images web-sized: a 2732-px-tall JPEG (tablet height) at quality
~80 stays under 1 MB for most starfields. The example pack ships one
(`backgrounds/dusk.jpg`).

### Loading it on the page

Drag the zip anywhere onto the viewer (or use the
Load… button). The model dropdown switches to the pack's icons, plus an
"⏏ Unload zip (back to samples)" entry that restores everything. While a pack
is loaded the turntable spin, pivot, and sidecar controls hide — the pack owns
its own motion, materials, and framing. Loading any other model or a new zip
also exits the pack.

Add **`?dev=1`** while you are authoring: it re-fetches the sequence runtime on
every load and ignores a pack's saved `resume:` step, so a reload always shows
your latest edit from the beginning. (A pack's `icons.yml` and `sequence.yml`
are never cached, dev mode or not.)

Add **`?dev=mobile`** — the flags compose, so `?dev=1,mobile` is both — to get a
**phone-sized, letterboxed stage inside your desktop window**, with a small bar
that reports the size the page is actually composing against and flips the
simulated orientation. The whole app measures that stage rather than the
window, so a portrait layout, a rotation prompt and a swipe all behave exactly
as they would on a device; the wheel is mapped onto the swipe gesture so a
trackpad can drive it. The stage is clamped to your window rather than scaled,
so make the window tall enough (1280x940 comfortably holds 375x812).

Add **`?ui=0`** to hide every viewer control — picker, buttons, sequence
transport, status line, links — so the page shows only what the pack draws.
Handy for showing a pack as the page it is meant to be, and for screenshots.

If the pack folder is already on a server, it can also be loaded unzipped with
`?component=./my-pack/component.js` — handy while you are building it. That
route behaves the same way (same icon dropdown, same hidden controls); the zip
is simply what makes the pack portable.

Adding an icon to an existing pack: drop its folder under `icons/`, add its
name to `icons.yml`, re-compress, drag the new zip onto the page.

### Sequences: choreographing an icon's entrance — and a collect flow

A pack may ship a **`sequence.yml`** — a small, commented YAML file that says
how an icon *arrives*: the 3D icon fading and swelling in, lines of copy
resolving over the canvas, a call-to-action appearing, all timed in seconds.
Add an `advance` verb and it becomes a **flow**: tapping the call-to-action
sends the icon flying into a slot, where it stays, and brings the next icon in
behind it. Name the file from the manifest and the viewer plays it:

```yaml
# icons.yml
sequence: sequence.yml
```

```yaml
# sequence.yml (abridged — the example pack's file is fully commented)
version: 1
ease: { swell: &swell outCubic }
resume: { minutes: 60 }            # optional; see "What it stores" below
input:  { zoom: false, drag: icon, swipe: up }   # optional; these are the defaults
orientation: any                   # optional; portrait | landscape | any
stage:
  hud:     { slot:  { type: slots, count: 3, top: 0.14, size: 0.075,
                      portrait: { size: 0.12, top: 0.11 } } }
  icon:    { ref: current }
  overlay:
    line1: { type: text, top: 0.735, size: 0.05 }
    cta:   { type: button, top: 0.905, size: 0.055, text: "→", persist: true,
             portrait: { size: 0.085, top: 0.88 } }
steps:
  - id: one
    icon: twist
    copy: { line1: "FIRST LINE OF COPY" }
    timeline: &entrance
      - { id: icon-in, target: icon,  at: 0.2, timing: { dur: 0.7, ease: *swell }, channels: { fade: [0, 1], scale: [0.52, 1] } }
      - { id: copy-in, target: line1, at: 0.4, timing: { dur: 1.0, ease: outQuart }, channels: { blur: [12, 0], wipe: [0, 1], fade: [0, 1] } }
      - label: copy-settled
      - { id: cta-in,  target: cta,   at: copy-settled + 0.8, timing: { dur: 0.2, ease: *swell }, channels: { fade: [0, 1], rise: [14, 0], bloom: [0, 1] } }
    exit:
      - { id: copy-out, target: line1, at: 0, timing: { dur: 0.28 }, channels: { fade: [1, 0], blur: [0, 10] } }
      - { id: collect,  target: icon,  to: slot1, at: 0.1, timing: { dur: 0.6, ease: *swell },
          land: { mode: object, face: front, fit: 0.72, after: glyph } }
    on: { cta.tap: { do: advance } }
    end: hold

  - id: two
    icon: gem
    overlap: 0.35                  # start this entrance 0.35 s before the last exit ends
    copy: { line1: "A SECOND ICON" }
    timeline: *entrance
    exit:
      - { id: collect, target: icon, to: slot2, at: 0.1, timing: { dur: 0.6, ease: *swell },
          land: { mode: glyph, fit: 0.72 } }
    on: { cta.tap: { do: restart } }
    end: hold
```

- The 3D icon gets `fade`, `scale`, `rise`; 2D text and buttons get `fade`,
  `rise`, `blur`, `wipe`, `bloom`. Times are seconds; `at:` can be a number,
  `after`, or `label + 0.3`. Easings are Anime.js names or `cubic-bezier()`.
- **Slots** are a row of rings with three states — dim and empty (`pending`),
  bright and empty (`next`, where the current icon will land), and bright with
  the icon's 2D mark in it (`filled`). Each ring is a target in its own right
  (`slot1`, `slot2`, …).
- **`to:` sends the icon to any 2D element**, in a straight line, shrinking so
  it fits inside. It can stay there as the real 3D object (frozen, facing
  front), become a flat mark, or land as the object and cross-fade to the mark
  a beat later. A landed object is **anchored to its ring every frame**, so it
  stays put and stays the right size when the visitor zooms, resizes the
  window, or turns their phone.
- **The marks are free.** Give an icon a `glyphs:` entry in `icons.yml` and
  that image is used; give it nothing and the viewer renders one for you,
  offscreen, before the flow starts.
- **The sequence never owns spin.** Your icon's own controller keeps turning
  it; there is no rotation channel. An icon on its way into a slot is the
  exception: it leaves the animation loop as the flight begins and the flight
  turns it to face front, by the shortest way round, so it arrives square
  instead of snapping at the end.
- **One declaration for what a finger may do.** `input: { zoom, drag, swipe }`
  — sequence-wide, and any step may override it. `zoom` is **off by default**
  for a pack (a pack composes a fixed frame, and a scroll-wheel dolly is not
  part of it); `drag` is `icon` (hit-tested, below), `camera` (orbit) or
  `none`; `swipe: up` lets a flick fire the same call-to-action the button
  does. A swipe is judged by the shape of the gesture — predominantly
  vertical, far enough, fast enough — so one that starts on the icon still
  counts, and a slower or rounder one is still just a drag.
- **A pack can ask to be held the right way up.** `orientation: portrait` (or
  `landscape`) curtains the stage, shows a rotate glyph and pauses the
  sequence where it stands until the device comes back; nothing advances
  behind the curtain and it resumes at exactly the same moment. It is
  **advisory** — no web page can turn a phone, and mobile Safari has no
  orientation-lock API at all — so this prompts rather than forces. It is
  decided by aspect ratio, so a narrow desktop window behaves like a phone.
  `?orientation=any` switches it off for a review pass.
- **Portrait sizing.** Any overlay element can carry a `portrait: { … }` block
  overriding its placement (`top`, `left`, `size`, `gap`, `ring`, `weight`,
  `tracking`) when the stage is taller than it is wide. It exists because
  overlay type is sized in `vmin` while the 3D icon is framed against the
  stage's height: those agree on a desktop and differ by more than 2x on a
  phone, so rings and buttons authored on a laptop read as specks otherwise.
  The numbers are yours to choose — the viewer will not guess them.
- **Drags are hit-tested.** A press picks the nearest icon actually under it —
  the big one, or one already sitting in a ring — and only that one turns; a
  press on empty canvas turns nothing.
  Let go and the icon springs back to face front; `rest: { spring: false }`
  leaves it where it was left, and a step can override the sequence's default.
  This works for an icon with no controller of its own — the viewer owns it.
- Fading works out of the box for icons built from three.js standard
  materials. An icon with its own shader material should expose `setFade(v)`
  on the object it returns; otherwise the fade is skipped and the console says
  so once.
- A ▶/⏸ button and a scrub slider appear in the HUD while a sequence is
  loaded, for design review. Text is real, selectable DOM.
- No `sequence:` key → nothing changes; existing packs are untouched.

**What it stores.** The viewer normally stores nothing at all. The one
exception is a pack that opts in with `resume: { minutes: 60 }`: while a flow
is running, one small `localStorage` record — which step you are on, which
icons you have collected, and when — is kept under
`glb-viewer:seq:<pack name>`, so reloading picks up where you left off. It is
written only when you actually advance or restart, it expires after the
declared idle window, and it is discarded outright if the pack's
`sequence.yml` has changed underneath it. A pack without `resume:` writes
nothing, and nothing is ever sent anywhere.

The full schema, channel tables, and a deterministic way to verify a sequence
live in [`AGENT.md`](AGENT.md) §12. `validate-pack.py` checks `sequence.yml`
too (it needs PyYAML for that part).

**Deprecated: `icons.json`.** Older packs used a JSON manifest with the same
keys. It still loads today (with a console warning) and will be unsupported in
a future version — rename it to `icons.yml`; the content is already valid YAML.

The trust note above applies doubly to zips: the pack runs real code —
only load packs from people you trust.

Works on any static host (GitHub Pages included) and localhost. Requires a
normal browser window — some private windows block service workers, and the
viewer will say so rather than fail silently.

## Known limits (deliberate; it's a proof of concept)

- No Draco/meshopt decoders: use uncompressed GLB files, or add `DRACOLoader`
  plus the wasm decoder to `vendor/`.
- No KTX2 texture support (same deal: add `KTX2Loader` if needed).
- Sequences never own rotation, and have no keyframes beyond `[from, to]`,
  no camera moves, and no `goto` — steps run in order, or restart.
- The rotation prompt is advisory: browsers do not let a page turn a device,
  and the viewer does not pretend otherwise.
- The loading curtain reports no progress. A pack's total work is not known in
  advance, and a fake bar would be worse than a quiet wait.
