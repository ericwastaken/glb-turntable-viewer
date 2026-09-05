# AGENT.md — using this viewer

Instructions for an AI coding agent (Claude Code or similar) helping someone
**use** this viewer: look at a model, write a sidecar, write a component, build
an icon pack. Everything below was checked against the source in this repo and,
where it says "verified", exercised in a browser.

This file describes the viewer's contracts and behaviour. It does not tell you
how the viewer itself may be developed — that is the repo owner's call, not a
rule for you.

---

## 1. What this viewer is

A **single static HTML page** that loads a `.glb` model, spins it on a
turntable over a 2D background, and renders it with self-hosted three.js
(r170). It also accepts three kinds of user-supplied extension:

| Extension | What it is | How it arrives |
|---|---|---|
| **Sidecar** | A JSON file of `MeshPhysicalMaterial` property overrides applied to the loaded model's meshes | `?sidecar=`, file picker, drag-drop, or typed into the in-page editor |
| **Component** | An ES module exporting `createComponent(ctx)` — arbitrary three.js code (custom shaders, custom geometry) | `?component=` (same-origin path), or drag-drop a single file |
| **Icon pack** | A `.zip` holding several icons, each with its own code and assets | Drag-drop / file picker; unzipped in-browser and served from a service worker |

Live build: https://ericwastaken.github.io/glb-turntable-viewer/

Facts that shape everything you do with it:

- **Fully static, no build step.** There is nothing to install and nothing to
  compile. Editing a file *is* deploying it.
- **Must be served over HTTP.** ES modules, the import map, and the service
  worker all fail from `file://`. See §3.
- **Nothing is uploaded.** Zips are unzipped in the page; dropped files become
  blob URLs. Everything stays in the browser.
- **Everything the page does is plain three.js**, exposed rather than wrapped.
  If you know three.js, you already know how to write a component.

---

## 2. Start here — pick your route

| You want to… | Go to |
|---|---|
| Just look at a GLB on the turntable | §3 (serve it), then drop the file on the page — or §4 `?model=` |
| Try material overrides on a model without touching the model | §5 — sidecars |
| Write custom three.js code (a shader, custom geometry, your own motion) | §6 — components |
| Preview or build a designer's multi-icon pack | §7 — icon packs |
| Choreograph an icon's entrance — fade/scale in, lines of copy, a call-to-action | §12 — sequences |
| Check that the thing you just authored actually works | §8 — verifying |
| Explain why something looks wrong | §9 — troubleshooting by symptom |

---

## 3. Running it locally

The app is static; any HTTP server works. **It will not work from `file://`.**

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

`.claude/launch.json` declares this as the `viewer` configuration for agent
tooling that reads launch configs. If your harness's launch.json lives
elsewhere, just run the command above.

Everything your component or pack loads must be **under the folder you serve**,
because components and backgrounds are same-origin only (§4).

---

## 4. URL parameters

Five, all read once at boot from `location.search`. There is no parameter that
loads a zip — a zip arrives only by drop or the file picker (§7).

| Parameter | Accepts | Example | Constraints / notes |
|---|---|---|---|
| `?model=` | Path or URL to a `.glb` / `.gltf` | `?model=models/DamagedHelmet.glb` | Handed to `GLTFLoader` with **no origin check**, so a cross-origin URL would additionally need CORS from that host. Adds a dropdown row labelled `<filename> (URL)`. |
| `?sidecar=` | Path or URL to a sidecar `.json` | `?sidecar=sidecars/example-emerald-glass.json` | `fetch`ed with no origin check (CORS applies). Linted on arrival; a sidecar with lint *errors* is still applied and the status line says to open the editor. Applied **before** the model loads, then re-matched against the new meshes by `prepareSidecar()`. |
| `?component=` | Relative path to an ES module | `?component=./components/example-shader-orb.js` | **Same-origin only** — `loadComponentURL()` rejects any other origin outright with a status-line message. Loaded **after** the model finishes loading, so `?model=…&component=…` works for a `{ material }` component. |
| `?bg=` | Relative path to an image | `?bg=backgrounds/starfield-default.jpg` | **Same-origin only** — a cross-origin value is refused and the default backdrop stays. A component's or pack's own background overrides this while loaded. |
| `?pivot=` | Exactly three comma-separated finite numbers, `x,y,z`, in model units | `?pivot=0,0.5,0` | Forces the spin axis, overriding the Pivot dropdown. The model is positioned at the negation of this vector. Anything that is not three finite numbers (`?pivot=0,0.5`, `?pivot=a,b,c`) is **silently ignored** and the dropdown's mode applies. |

All five combine. Verified together against a live server:
`?model=models/DamagedHelmet.glb&sidecar=sidecars/example-emerald-glass.json&pivot=0,0.5,0&bg=backgrounds/starfield-default.jpg`
loaded the helmet, applied the sidecar's `"*"` fallback colour, set
`model.position` to `[0, -0.5, 0]`, and swapped the backdrop.

Useful single-purpose routes:

| URL | Exercises |
|---|---|
| `/` | Default model + starfield |
| `/?model=models/DragonAttenuation.glb&sidecar=sidecars/example-emerald-glass.json` | Sidecar system |
| `/?component=./components/example-shader-orb.js` | Single-file component |
| `/?component=./components/example-pack/component.js` | A pack, **without** the zip/service-worker layer |

---

## 5. Sidecars — material overrides in JSON

A sidecar is JSON applied on top of a model's exported materials. Use it when
you want a different look without re-exporting the model.

```json
{
  "materials": {
    "Dragon": { "color": "#7fe0b0", "transmission": 0.95, "ior": 1.5 },
    "*":       { "color": "#ffb04d", "metalness": 0.9 }
  }
}
```

- Keys are **mesh names**; `"*"` is the fallback for meshes with no entry of
  their own. Keys starting with `_` are comments (at any level).
- Values are **`MeshPhysicalMaterial` properties**. `buildMaterial()` creates a
  fresh `MeshPhysicalMaterial` and assigns any `k in m` property; the five in
  `COLOR_PROPS` (`color`, `attenuationColor`, `emissive`, `sheenColor`,
  `specularColor`) are wrapped in `new THREE.Color(v)`.
- An entry with only comment keys is a **no-op placeholder** — it names the
  mesh without overriding it, and `"*"` then applies.
- Sidecars are **sticky**: one stays loaded across model switches and is
  re-matched against the new meshes.
- Sidecars are **never inferred** from the model filename. Pass one explicitly
  (`?sidecar=`, picker, drop, or the editor).
- Any filename works, and one sidecar can serve several models.

### The in-page editor and its linter

The **Sidecar…** button opens a JSON editor with live linting.
`lintSidecar(text)` returns `{ ok, msgs, spec }` and gates the **Apply** button
on `ok` (no `error`-level messages). It checks JSON validity, root shape,
unknown root keys, target shape, whether a named mesh exists in the current
model, and per-property types against `PROP_TYPES`.

**`PROP_TYPES` is an allowlist of 28 properties, and it is smaller than
`MeshPhysicalMaterial`.** A property that is real three.js but missing from
that table lints as a *warning* ("not a known … property") **and still applies
at runtime**, because `buildMaterial()` only checks `k in m`. So a warning here
is not necessarily a problem with your sidecar.

If a mesh name warns as unknown, check the actual names first:

```js
const names = []; window.viewer.model.traverse(o => o.isMesh && names.push(o.name)); names;
```

---

## 6. Components — custom three.js code

A component is the escape hatch for looks a sidecar cannot describe. Read the
real thing at `components/example-shader-orb.js`.

A component is an ES module with exactly one required export:

```js
export async function createComponent(ctx) { … }
```

### What `ctx` contains

```js
{ THREE, renderer, scene, camera, assetPath }
```

- `THREE` — the viewer's three.js namespace. **Use this**; importing your own
  copy gives you a second, incompatible instance.
- `renderer` — the live `WebGLRenderer` (needed for e.g. `getMaxAnisotropy()`).
- `scene`, `camera` — rarely needed; your object is parented for you and
  framing is declarative (below).
- `assetPath` — the URL of the folder the module was loaded from, with a
  trailing slash. Load relative assets as `ctx.assetPath + 'tex.jpg'`. For a
  dropped single file it is `'./'`; for `?component=./a/b.js` it is the
  absolute URL of `./a/`; inside a zip it is the `zipfs/<id>/` base.

### What you return

```js
return {
  object,      // THREE.Object3D — REPLACES the model, added under the spin pivot
  material,    // THREE.Material — applied to every mesh of the CURRENT model
  update(dt),  // optional; called every frame with seconds since last frame
  dispose(),   // optional; called on unload
  framing,     // optional { heightFraction, verticalCenter }
  background,  // optional { image: url } or { color: '#05061a' }
  pointer,     // optional { down(x,y), move(x,y), up() }
  setFade(v),  // optional; 0–1 opacity setter a sequence calls (§12)
  glyph,       // optional URL of a 2D mark a sequence drops into a slot (§12.6)
  sequence,    // optional { file, doc } — a parsed sequence.yml to play (§12)
};
```

Verified specifics:

- **`object` and `material` are mutually exclusive**, and `object` wins —
  `applyComponentApi()` checks `api.object` first. Returning neither (and no
  `icons`) is an error the page reports in the status line.
- **`object` mode removes the loaded model** (`pivot.remove(current)`), resets
  `pivot.rotation`, and calls `frameComponent(api)`.
- **`material` mode requires a model already on screen**, otherwise it fails
  with *"provides a material — load a model first."* Originals are restored on
  unload.
- **`update(dt)`** is called from `renderer.setAnimationLoop`, wrapped in
  `try/catch` — a throwing `update` logs to console and does not stop the
  loop, so a silently-dead animation may be a thrown error. Check the console.
- **`framing.heightFraction`** = the object's height as a fraction of viewport
  height (clamped to 0.05–1). **`framing.verticalCenter`** = where its center
  sits, as a fraction from the top (default 0.5). Omit `framing` entirely and
  generic bounding-box framing is used instead.
- **`background`** wins over the user's stars/custom background while the
  component is loaded, and is restored on unload.
- **`pointer`** disables `OrbitControls` rotation (zoom still works) and routes
  `pointerdown/move/up/cancel` on the canvas to your handlers, in client pixel
  coordinates. The status line switches to "drag to spin the icon". **With a
  sequence loaded this is superseded**: one hit-testing router owns the canvas
  and forwards a drag to your handlers only when the press actually landed on
  your icon (§12.12). An icon with no `pointer` at all becomes draggable there,
  turned by the runtime.
- **`{ icons: {…} }`** is the fourth return shape — see §7. It is checked
  before `object`/`material`.
- **`sequence`** (only meaningful with `object`) makes the page wrap `object`
  in a Group, frame it at rest, then play the sequence on that wrapper and a
  2D overlay (§12). The stock pack loader sets it from the manifest; a
  single-file component may set it too. `setFade(v)` is how the sequence fades
  the object; without it the page fades standard materials itself (§12).
- **`glyph`** is the URL of a flat 2D mark for this icon, which a sequence
  shows in a slot once the icon has been collected (§12.6). The stock loader
  sets it from the manifest's `glyphs:` map; with no glyph the viewer derives
  one by rendering the icon offscreen at preload, so a pack never has to ship
  one.
- The **spin slider still applies** to a single-file component's `object` (the
  page rotates the pivot). A pack is different: it enters pack mode, which
  zeroes the slider — see §7.
- **Do not start your own `requestAnimationFrame` loop or `setInterval`.**
  Advance everything from `update(dt)`, which receives *seconds*.
- **Always implement `dispose()`** and free every geometry, material, and
  texture you created. Components are unloaded and reloaded repeatedly.

### Minimal working example (from `components/example-shader-orb.js`)

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

Run it: `http://localhost:8000/?component=./components/example-shader-orb.js`

### How yours gets in

- **Single file, no relative imports** — drag it onto the page, or use
  `?component=./path/to/file.js`.
- **A folder with several files** — put the folder under the folder you serve
  and use `?component=./your-folder/entry.js`. **Dropping a file that has
  relative imports fails**, because a blob URL cannot resolve them.
- **Remote URLs are rejected.** `loadComponentURL()` compares origins and
  refuses anything that is not this site's own address. A component runs with
  full page privileges, like pasting into the DevTools console; that check is
  why it is safe to hand someone a URL. Do not try to work around it.

---

## 7. Icon packs — the zip workflow

An icon pack is a folder (usually shipped as a `.zip`) containing several
icons. The whole pack is driven by one stock loader,
`components/pack.component.js`, which **every pack copies in byte-for-byte**.
See §14 for why your copy must stay unedited.

### Zip layout

```
my-pack.zip
├── component.js        ← copy of components/pack.component.js, unedited
├── icons.yml           ← the manifest
├── sequence.yml        ← optional entrance choreography, named from icons.yml (§12)
├── backgrounds/        ← optional images referenced from icons.yml
└── icons/
    ├── nameA/
    │   ├── src/index.js    ← the standard exports (below)
    │   └── assets/         ← that icon's model + textures (optional)
    └── nameB/…
```

```bash
cp components/pack.component.js my-pack/component.js
```

### `icons.yml`

```yaml
# Comments are fine — this is YAML.
icons:
  - twist
  - gem
background: backgrounds/dusk.jpg          # optional, pack-wide
backgrounds:                              # optional, per icon
  gem: backgrounds/alt.jpg
glyphs:                                   # optional, per icon 2D mark (§12.6)
  twist: glyphs/twist.png
sequence: sequence.yml                    # optional, choreography (§12)
```

- `icons` — **required**, non-empty list of folder names under `icons/`. An
  icon folder not listed here is never loaded. **Order matters when the pack's
  sequence is a multi-step flow**: the viewer loads the first icon in this
  list, so putting the flow's first step's icon first means nothing has to be
  swapped at load (§12.7).
- `sequence` — optional path, relative to `component.js`, of a YAML file the
  viewer plays as each icon's entrance (§12). The loader fetches and parses it
  once and hands it to every icon as `api.sequence = { file, doc }`; the page
  does the rest. No key → no sequence → the pack behaves exactly as before. A
  missing or unparsable file fails the pack at load, in the status line.
- `background` — optional, pack-wide. Either a path inside the zip, or a CSS
  color. `resolveBackground()` treats a value as a color if it matches
  `/^(#|rgb|hsl)/i` or is a single all-alpha word (`"black"`); anything else
  is resolved as a path relative to `component.js`.
- `backgrounds` — optional per-icon overrides, same value rules; falls back to
  `background`.
- `glyphs` — optional per-icon 2D mark: a path inside the pack (never a
  colour), resolved relative to `component.js` and forwarded to the icon as
  `api.glyph`. A sequence shows it in a slot once that icon has been collected;
  an icon with no entry gets one **derived** by the viewer, so this key is
  never required (§12.6).

Keep background images web-sized — roughly a 2732-px-tall JPEG at quality ~80.

The loader parses the manifest with the vendored `js-yaml` (imported through
the page's import map, the same way icon modules import `three`).

> **Deprecated: `icons.json`.** Older packs used a JSON manifest with the same
> keys. It still loads today, with a console warning, and **will be unsupported
> in a future version.** Migrate by renaming the file to `icons.yml` — YAML is a
> superset of JSON, so the existing content is already valid. `validate-pack.py`
> warns on an `icons.json` and, if both files are present, tells you the JSON is
> being ignored.

### Standard exports (`icons/<name>/src/index.js`)

| Export | Required | Signature / shape |
|---|---|---|
| `createIconObject` | **yes** | `({ geometry, textures, srgbOutput }) => Object3D \| { group, update?, dispose?, frameCount? }` |
| `loadIconGeometry` | **yes** | `({ path }) => Promise<BufferGeometry>` |
| `loadIconTextures` | no | `({ path, renderer }) => Promise<any>` — result passed straight to `createIconObject` |
| `IconController` | no | class; `new IconController()`, then `update(dt)` each frame. `setSheetFrames(frameCount)` is called if present. If it also has `pointerDown/pointerMove/pointerUp`, drags are routed to it |
| `LAYOUT` | no | `{ iconHeightFraction, verticalCenter }` — mapped to the component `framing` |

Loader behaviour worth knowing (all in `buildIcon()`):

- `path` for both loaders is `icons/<name>/assets/` as an absolute URL, with a
  trailing slash. It is passed even if the folder does not exist. Never
  hard-code a path — the same module must work from a folder and from a zip.
- `createIconObject` is called with **`srgbOutput: false`**. The viewer renders
  straight to the canvas with no post-processing; see §10.6.
- The returned value may be an `Object3D` **or** an object with `.group`; the
  loader does `icon.group ?? icon`.
- Per frame the loader calls `controller.update(dt)` then
  `icon.update(dt, controller)`. With no controller it calls `icon.update(dt)`.
  So an icon's `update` signature is `(dt, controller?)`.
- `dispose()` on your returned object is called on unload.
- If your returned object has **`setFade(v)`** (0–1), the loader forwards it as
  `api.setFade` so a sequence can fade the icon through your own material
  (the only route for a raw `ShaderMaterial`). Standard-material icons need
  nothing — the page fades them itself (§12).
- The manifest's `glyphs:` entry for your icon, if any, is forwarded as
  `api.glyph` (§12.6). Nothing in your module has to know about it.
- **Icon modules may `import * as THREE from 'three'`** — the bare specifier
  resolves through the *page's* import map to `./vendor/three.module.min.js`,
  so every icon shares the viewer's single three.js instance. Both bundled
  example icons do this. Do not vendor your own three.js into a pack, and do
  not rewrite these imports to relative paths.

### Minimal working icon (from `components/example-pack/icons/twist/src/index.js`)

```js
import * as THREE from 'three';

export function loadIconGeometry() {
  return Promise.resolve(new THREE.TorusKnotGeometry(0.42, 0.13, 200, 32));
}

export function createIconObject({ geometry }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#46e0c2', metalness: 0, roughness: 0.05,
    transmission: 0.9, thickness: 1.2, ior: 1.45, clearcoat: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return { group: mesh, dispose() { geometry.dispose(); material.dispose(); } };
}

export const LAYOUT = { iconHeightFraction: 0.4, verticalCenter: 0.45 };
```

Adding motion — this is `icons/gem/src/index.js`; the loader calls
`controller.update(dt)` and then `icon.update(dt, controller)` every frame:

```js
export class IconController {
  constructor() { this.t = 0; }
  setSheetFrames() {}            // present for API compatibility
  update(dt) { this.t += dt; }
}
// …and inside createIconObject's return value:
//   update(dt, controller) { mesh.rotation.y = (controller?.t ?? 0) * 0.8; }
```

### Validate before you zip

```bash
python3 .claude/tools/validate-pack.py my-pack/          # a folder
python3 .claude/tools/validate-pack.py my-pack.zip       # or the zip
```

Stdlib Python 3, no install. It checks the entry module, that your
`component.js` still matches the repo's copy, the manifest shape, that every
listed icon has `src/index.js` exporting both required functions, that
background paths exist in the pack, and warns about unlisted icon folders and
oversized assets, and that every `glyphs:` path is in the pack. If the manifest
names a `sequence`, it checks the file exists and validates its structure (§12)
— including slot declarations, `to:`/`land:` targets and modes, the `advance` /
`restart` verbs, every step's `icon:`, and the `resume:` block. **That part
needs PyYAML** (`pip install pyyaml`); without it the validator says so in a
warning and skips only the sequence. Exit 0 = clean, 1 = errors, 2 = could not
open.

### Packaging

macOS: right-click the pack folder → **Compress**. Windows: **Send to →
Compressed folder**. Or:

```bash
cd my-pack && zip -qr ../my-pack.zip . -x '.DS_Store'
```

Both shapes load — see *How a zip is actually loaded* below, step 3.

### How a zip is actually loaded (`loadZipFile()`)

1. `fflate.unzipSync` in the page — nothing is uploaded.
2. Junk is dropped: folder records, `__MACOSX/`, `._*`, `.DS_Store`.
3. If every entry sits under one top-level folder, that folder is stripped
   (this is what Finder's *Compress* produces, so both shapes work).
4. Entry point = `component.js` at the root, else exactly one `*.component.js`.
   Zero or more than one → error in the status line.
5. `sw.js` is registered, the cache `zipfs` is **cleared**, and every file is
   `cache.put` at `<page dir>/zipfs/<id>/<path>`.
6. `import(base + entry)` runs the loader; relative imports and asset paths
   resolve naturally because they are ordinary same-origin URLs.
7. `enterPackMode()` adds `zipmode` (which hides the turntable/sidecar
   controls) and zeroes `#speed` — **a pack owns its own motion**. `enterPack()`
   calls it too, so a pack loaded with `?component=` gets exactly the same mode;
   the only thing the zip route adds is the unzip + cache + service-worker
   layer. The user's spin value is remembered on the first call and restored by
   `unloadZip()`.

### Previewing a pack while you build it

`?component=./my-pack/component.js` exercises the loader, the manifest, every
icon, framing, and backgrounds, and works in an automation pane. Pack mode is
identical to the zip route (`zipmode` set, spin slider zeroed, dropdown
swapped). What it leaves untested is only fflate, the `zipfs` cache, and the
service worker — so a pack you intend to hand to someone still has to be
dropped as a zip once, in a real browser window (§10.2).

Only **one** pack is resident at a time (§11).

---

## 8. Verifying your own component / pack / sidecar

There are no automated tests. You verify by serving the page (§3) and
inspecting it. Do not report your component or pack as working on the strength
of a code read.

`window.viewer` is the debug handle, defined at the very bottom of
`index.html`:

```js
window.viewer = { THREE, scene, camera, renderer, pivot, controls,
                  get model(), get component(), get sequence() };
```

`viewer.component` is `{ name, api, kind, root, seq }` where `kind` is
`'object'` or `'material'`, `api` is exactly what `createComponent()` returned,
`root` is what sits under the pivot (`api.object`, or the wrapper Group a
sequence animates), and `seq` is the running sequence or `null`.
`viewer.sequence` is the same `seq` (§12).

### Your component

```js
const c = window.viewer.component;
c.kind;                       // 'object'
Object.keys(c.api);           // ['object','framing','update','dispose']
c.api.framing;                // { heightFraction: 0.4, verticalCenter: 0.45 }
c.api.update(1.0);            // advance one second, deterministically
c.api.object.rotation.y;      // read the result
```

**Do not verify motion with `await sleep(n)` and then read a rotation.** See
§10.1 — drive `update(dt)` yourself.

### Your sidecar

```js
const out = [];
window.viewer.model.traverse(o => o.isMesh && out.push(
  [o.name, o.material.type, '#' + o.material.color.getHexString(), o.material.transmission]));
out;
```

The status line also reports it: `• sidecar <name> ON`, `• sidecar <name> off
(as exported)`, or `• sidecar <name> matches no meshes` — that last one means
your mesh names are wrong.

### Your pack

Load it by URL first (`?component=./my-pack/component.js`) and assert:

```js
document.body.classList.contains('zipmode');                  // true
document.getElementById('speed').value;                       // '0'
[...document.getElementById('modelSelect').options].map(o => o.value);
// ['zipicon:twist', 'zipicon:gem', '__unloadzip__']
```

Then drop the real zip, in a real browser window, and assert additionally:

```js
(await (await caches.open('zipfs')).keys()).map(r => r.url);
// .../zipfs/<id>/component.js, .../icons.yml, .../icons/<name>/src/index.js, …
navigator.serviceWorker.controller;                            // non-null
```

The cache entries and `navigator.serviceWorker.controller` are what only a
real zip produces. Simulating the drop from a console:

```js
const blob = await (await fetch('/my-pack.zip')).blob();
const dt = new DataTransfer();
dt.items.add(new File([blob], 'my-pack.zip', { type: 'application/zip' }));
window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
```

Unloading is worth checking too (select `⏏ Unload …` in the dropdown):
`unloadZip()` restores the saved dropdown and the exact row that was selected,
the saved spin value, and the page's own background.

### Your sequence

Never judge a sequence by waiting — in a hidden pane the render loop does not
advance it. Scrub it deterministically and read the results (full recipe in
§12.11):

```js
const s = window.viewer.sequence;          // null if the icon has no sequence
await s.ready;                             // preload + glyph capture, in a flow
s.duration;                                // e.g. 3 — the CURRENT phase
s.pause(); s.seek(0);                      // the t=0 pose
window.viewer.component.root.scale.x;      // e.g. 0.52 — the wrapper, not the icon
[...document.querySelectorAll('#fg [data-seq]')].map(e => [e.dataset.seq, e.style.opacity, e.style.clipPath]);
s.seek(3.0);                               // the held final frame
// a flow (a step whose `on:` uses advance): drive it, don't click and hope
s.flow && s.advance(); s.step; s.slots;    // 'two', [{icon:'twist', as:'object'}, null, null]
```

**Serve with cache-busting headers, or hard-reload after every edit.** A stale
`sequence.js` out of the browser cache looks exactly like a bug in your
sequence — and is the most expensive false lead in this repo.

### Always read the status line and the console

```js
document.getElementById('status').textContent;
```

Nearly every failure path reports there rather than throwing (§10.8), often
with the real error only in `console.error`.

### And check a phone-sized viewport

The page has a `@media (max-width: 640px)` layout (compact HUD, bottom-sheet
editor). If your component or pack does its own framing, emulate a phone
viewport and confirm the subject is still in frame — see §10.4.

---

## 9. Troubleshooting by symptom

| Symptom | Likely cause | Detail |
|---|---|---|
| **"It renders dark."** Your shader colours come out much darker than the hex you typed | `new THREE.Color(hex)` is linearized by ColorManagement | §10.5 |
| **"It renders dark"** and you pre-inverted for an sRGB encode | There is no post-processing pass; nothing encodes your raw shader output | §10.6, §11 |
| **"Off-frame on a phone."** Subject looks fine on the dev machine, cropped on a device | `setSize(w, h, false)` in a harness, or CSS size not set — canvas lays out at backing-store size on DPR ≥ 2 | §10.4 |
| **"My pack didn't load."** Dropdown never switched | Entry point missing or ambiguous (needs `component.js` at the root, or exactly one `*.component.js`) | §7 — *How a zip is actually loaded*, step 4 |
| **"One of my icons is missing."** The folder is in the zip | `icons.yml` drives the list, not the folder contents | §10.9 |
| **"Nothing animates in my test"** but it looks fine in a real window | `requestAnimationFrame` is paused in a hidden/headless pane | §10.1 |
| **"Nothing animates"** in a real window either | Your `update` is throwing; the loop catches and keeps going | §6, §10.8 — read `console.error` |
| **"The zip drop does nothing."** Status mentions ServiceWorker registration | Service workers blocked in this browsing context | §10.2 — use a normal window, or preview via `?component=` |
| **"Part of my model vanished."** | Backdrop-hiding is name-based | §10.12 |
| **"My sidecar property lints as unknown"** but works | `PROP_TYPES` is a smaller allowlist than `MeshPhysicalMaterial` | §5 |
| **"My sidecar does nothing."** Status says *matches no meshes* | Mesh names don't match, and there is no `"*"` fallback with properties | §5, §8 |
| **"My component says 'load a model first'."** | You returned `{ material }` with no model on screen | §6 |
| **"My dropped folder-component can't find its imports."** | A blob URL cannot resolve relative imports | §6 |
| **"My remote component/background URL is refused."** | Same-origin only, by design | §4 |
| **"Filenames with spaces broke my pack."** They didn't | Spaces are handled end-to-end | §10.3 — look elsewhere |
| **"My second pack replaced my first."** | Only one pack is resident at a time | §11 |
| **"Nothing I set survives a reload."** | There is no persistence at all | §11 — put it in the URL (§4) |
| **"My icon is invisible / tiny after the pack loads"** in a pane | The pack has a sequence, whose t=0 pose is faded-out and small; a hidden pane never advances it | §10.13 — `viewer.sequence.seek(t)` |
| **"My sequence's copy never appears."** Status names `sequence.yml` | A load-time error: undeclared target, unknown label, bad ease, wrong channel for the layer, a `to:` that names nothing | §12 — the message names the track |
| **"My edit to `sequence.js` had no effect."** | The browser served the cached module | §12.11 — hard-reload, or serve with `Cache-Control: no-store` |
| **"The collected icon lands but keeps spinning."** | It is still in the update path; its controller reassigns rotation every frame | §12.6 — a landing leaves the update path as the flight *begins* |
| **"The collected icon jumps as it lands."** | Something is assigning rotation at touchdown instead of tweening to rest across the flight | §12.6 — the turn is derived from `t`, on the shortest path |
| **"The collected icons slide out of their rings when I zoom."** | Their world position was solved once instead of re-solved from the ring's rect every frame | §12.6 — and the standing check in the `verify-in-browser` skill |
| **"Dragging the big icon spun the collected ones too."** or "I can't grab a collected object" | Drags are hit-tested per press; check `hit.padding` and `viewer.sequence.grabbed` | §12.12 |
| **"My icon won't stay where I dragged it."** | Spring-back is on by default | §12.12 — `rest: { spring: false }`, sequence-wide or per step |
| **"A collected ring shows a broken image."** | Its glyph could not be derived, or the icon has no `glyphs:` entry and renders to nothing offscreen | §12.6 — ship a `glyphs:` image for that icon |
| **"My flow resumed on the wrong step / did not resume."** | The saved state is discarded whenever `sequence.yml` moves on, and the TTL is an idle window | §12.8 |
| **"My icon fades to nothing but still spins / my spin is gone."** | The sequence does not own spin; a `spin` channel does not exist. The icon's own controller owns rotation | §12 |

---

## 10. Gotchas that will bite you while authoring

1. **A hidden/headless browser pane pauses `requestAnimationFrame` and
   throttles timers.** `renderer.setAnimationLoop` never fires, so
   `await sleep(2000)` then reading `pivot.rotation.y` returns `0` and
   "nothing animates" is a false negative. (Re-confirmed in this repo: with
   `document.hidden === true`, 2.5 s of wall clock left the shader orb's
   `uTime` uniform at exactly `0`, while `component.api.update(1.0)` moved it
   to exactly `1`.) **Test motion deterministically by calling `update(dt)`
   directly.** In such a pane `innerWidth`/`innerHeight` can also be `0`,
   which makes the canvas `0×0` — that is the pane, not your code.

2. **Service workers may be blocked in an automation pane**, which kills the
   whole zip path with *"Zip loading unavailable: Failed to register a
   ServiceWorker … An unknown error occurred when fetching the script."*
   (Re-confirmed in this repo.) This is the browsing context, not the code —
   the same drop succeeds in a normal browser window. Verify the zip layer in
   a real window; preview the pack loader in the pane via
   `?component=./your-pack/component.js`.

3. **Filenames with spaces inside a pack zip work.** Both the cache key
   (`cache.put(base + p, …)`, where `base` is a `URL` href) and the service
   worker's lookup (`cache.match(e.request.url)`) go through the same URL
   normalization, so `backgrounds/dusk sky.jpg` is stored and fetched as
   `…/backgrounds/dusk%20sky.jpg` and resolves. Verified end-to-end with
   spaces in both a background filename and an icon folder name. Do not rename
   files to work around a problem you have not actually observed.

4. **`renderer.setSize(w, h, false)` will break phones.** The third argument
   is `updateStyle`; passing `false` skips setting the canvas's CSS
   width/height, so the canvas lays out at its *backing-store* size — 2x too
   large on any `devicePixelRatio >= 2` screen, pushing the subject off frame.
   Authors on DPR-1 machines never see it. The viewer calls
   `setSize(innerWidth, innerHeight)` (updateStyle defaults to `true`), so the
   canvas correctly gets both `width`/`height` attributes and `style.width`/
   `style.height`. **Set the CSS size explicitly in any standalone harness you
   write**, and check all four are populated:

   ```js
   const cv = window.viewer.renderer.domElement;
   [cv.width, cv.height, cv.style.width, cv.style.height];
   ```

5. **three.js r152+ ColorManagement linearizes `new THREE.Color(hex)`.**
   Re-verified live in this build (r170, `ColorManagement.enabled === true`,
   working space `srgb-linear`): `new THREE.Color('#808080')` yields
   `rgb ≈ 0.21586`, not `0.502`. A raw `ShaderMaterial` that composites in
   display space therefore comes out visibly dark. Pin the value explicitly:

   ```js
   new THREE.Color().setHex(0x808080, THREE.LinearSRGBColorSpace);  // -> 0.50196
   ```

   `MeshStandardMaterial` / `MeshPhysicalMaterial` handle all of this for you —
   only raw shaders need the care.

6. **Components rendering straight to canvas should treat `srgbOutput` as
   `false`.** The pack loader passes exactly that. There is no
   `EffectComposer`/`OutputPass` in this app (verified: no post-processing
   modules are vendored at all), and three.js applies **no** sRGB encode to raw
   `ShaderMaterial` output, so an icon that pre-inverts for a downstream encode
   renders dark. Emit display-ready color.

7. **A pack behaves identically whichever way it arrives, but only a real zip
   exercises the zip layer.** Both routes call `enterPackMode()`, so the
   dropdown swap, `zipmode`, and the zeroed spin slider are the same for
   `?component=…/component.js` and for a dropped zip (verified in both). What
   the URL route cannot test is fflate, the `zipfs` cache, and the service
   worker. One cosmetic difference: the unload row reads *"⏏ Unload pack"* on
   the URL route and *"⏏ Unload zip"* for a dropped zip — the word comes from
   how the pack arrived.

8. **The status line is the error channel.** Almost nothing throws to the
   user — bad component, bad sidecar, missing `icons.yml`, blocked service
   worker all end up as text in `#status`, sometimes with the real error only
   in `console.error`. Read both.

9. **`icons.yml` drives the icon list, not the folder contents.** An icon
   folder present in the zip but missing from `icons.yml` is silently
   ignored. `validate-pack.py` warns about this.

10. **Vendored three.js is minified.** `vendor/three.module.min.js` is not
    readable source. Check API behaviour against the three.js docs for **r170**
    (confirm at runtime with `window.viewer.THREE.REVISION`), or against the
    unminified example modules in `vendor/loaders`, `vendor/controls`,
    `vendor/utils`.

11. **`unloadZip()` clears the entire `zipfs` cache**, and so does loading a
    new zip. See §11.

12. **Backdrop-hiding is name-based.** `setModel()` hides any object whose
    name matches `/backdrop|stage|floor|ground/i`. A legitimately-named mesh
    in your model will vanish. Bear it in mind before debugging "my model is
    missing a part".

13. **A pack with a sequence starts at its t=0 pose — typically invisible and
    small — and only the render loop advances it.** In a hidden pane (gotcha
    1) that means the icon *stays* invisible and the copy never appears; that
    is the pane, not the pack. Drive it: `viewer.sequence.seek(3.0)` shows the
    held final frame, and `seek(t)` at any `t` is exact (§12). Framing is
    solved at rest pose *before* the t=0 pose is applied, so the camera is
    right even though the icon is at 48 % — do not "fix" framing from a t=0
    screenshot.

---

## 11. What this viewer does not do

Verified against the source. Do not attempt these — they are not there to find.

- **No transport for embedded glTF clips.** They are detected and *all* of
  them are auto-played on an `AnimationMixer` at load
  (`gltf.animations.forEach(clip => mixer.clipAction(clip).play())`), and the
  status line reports the count. There is no play/pause/scrub/select control
  for them. The **Pause** button pauses only the turntable spin — the mixer
  keeps advancing. (The ▶/⏸ + slider that appears with a pack sequence
  drives *that sequence* only — §12.)
- **No post-processing.** No `EffectComposer`, no `OutputPass`, no bloom pass,
  no pass chain of any kind beyond the renderer's own ACES tone mapping.
  Nothing from three's `postprocessing` examples is vendored. This is why
  `srgbOutput` is `false` (§10.6), and why a sequence's `bloom` channel is a
  CSS glow on 2D elements, not a render pass.
- **One icon pack resident at a time.** `unloadZip()` deletes every key in the
  `zipfs` cache, and loading a new zip clears it first. Two packs cannot
  coexist, and a pack cannot reference another pack's files.
- **Sequences are choreography, not a general animation system.** No `spin` /
  rotation channel (ever — §12), no keyframes beyond `[from, to]`, no camera
  moves, no springs, no `goto` verb. Step-to-step transitions exist, but only
  in one direction and only through `advance` / `restart` (§12.7). See §12 for
  the exact vocabulary.
- **No persistence, unless a pack asks for it.** No cookies and no server. Spin
  speed, pivot mode, the loaded sidecar, the custom background, and the loaded
  pack are all lost on reload; the only way to restore those is the URL (§4).
  The single exception is a sequence's opt-in `resume:` block, which stores one
  small `localStorage` record of where the visitor is in a flow — off unless the
  pack declares it (§12.8).
- **No Draco / meshopt / KTX2 decoding.** Use uncompressed GLB. (Also noted in
  README's "Known limits".)
- **No URL route for a zip.** A zip arrives only by drop or file picker.
- **No cross-origin loading** of components or backgrounds (§4).
- **No upload of anything, anywhere.** That is a feature, not a limit.

---

## 12. Sequences — a pack's choreography (`sequence.yml`)

A **sequence** is a small YAML file that describes how an icon *arrives*: the
3D icon fading and swelling in, lines of 2D copy resolving over the canvas, a
call-to-action appearing — timed in seconds, with named easings and labels.
Add an `advance` verb and it becomes a **flow**: tap, the icon flies into a
slot and stays there, and the next icon enters behind it. It is optional,
lives at the pack root, and is named from the manifest:

```yaml
# icons.yml
sequence: sequence.yml
```

No key → no sequence → the pack behaves exactly as it always did. The
worked example is `components/example-pack/sequence.yml`; run it with
`?component=./components/example-pack/component.js`.

What it is **not** (each was decided, not forgotten — §11): it is not a
general animation DSL, it never owns spin, it does not move the camera, and it
has no keyframes beyond `[from, to]`.

### 12.1 Layer model

Four layers, back to front. Each has a different owner and a different set of
channels that are physically possible on it, which is why targets are declared
per layer rather than in one flat list.

| Layer | What it is | Who owns it | What a sequence may do |
|---|---|---|---|
| **background** | `#bg`, the 2D backdrop behind the canvas | The page / the pack's `background:` | Nothing (not a target) |
| **hud** | `slots` — a row of collection rings (and the deprecated `pips`) | Created from `stage.hud` | Static `initial:` state; 2D channels; receives a collected icon |
| **icon** | The 3D icon, under a **wrapper Group** | The pack (look, idle spin) — the sequence gets the wrapper, and routes drags | `fade`, `scale`, `rise`, `to:` (a move to a 2D element), and the wrapper's drag yaw/pitch (§12.12) |
| **overlay** | `#fg` — 2D text and buttons above the canvas | Created from `stage.overlay` | `fade`, `rise`, `blur`, `wipe`, `bloom` |

`#fg` is a fixed, viewport-sized DOM layer above the canvas (real text:
selectable, accessible), `pointer-events: none` except on elements a step
binds an action to, and emptied whenever the icon or pack unloads. **It is
built once and lives for the whole flow** — slots have to accumulate, and a
call-to-action a visitor is about to tap must never be rebuilt under their
finger.

**Spin is still structurally unavailable as a channel.** A pack's controller
*assigns* `rotation.y` every frame from its own config, so anything a sequence
wrote to that property would be overwritten before render. There is no `spin`,
`yaw`, or `rotation` channel, and there never will be. `scale`/`rise` go on the
wrapper Group the page puts around `api.object`, never on the icon's own object.

Rotation is nonetheless written in exactly two places, and both are designed
around that fact:

- **A landing** (§12.6) owns the icon's own rotation for the whole flight. The
  icon leaves the update path at the *first frame of the flight*, not at
  touchdown, so exactly one thing is writing rotation at any instant.
- **A drag** (§12.12) writes yaw and pitch on the **wrapper**, which is a
  different property from the one a controller writes. The two compose: a
  dragged icon keeps its own idle spin and turns with the finger at once.

**Framing is solved at rest pose, once, before the t=0 pose is applied, and
never re-solved** — not even when a flow swaps to a different icon.
`frameComponent()` measures the object's *current* bounding box; an entrance
that starts at `scale: 0.52` would otherwise be framed against a shrunken box.
Verified: `camera.position` and `controls.target` are identical before and
after `seek(0)`. A flow's icons therefore share the first icon's framing.

### 12.2 The file, completely

```yaml
version: 1                                # required; this viewer plays version 1

# Named easings — YAML anchors, so a review note changes one line.
# Any Anime.js name (linear, outCubic, inOutQuart, outBack, …), a PARAMETRISED
# one (outBack(0.8), outElastic(1, 0.4)), a real spring
# (spring(stiffness, damping) or spring(mass, stiffness, damping, velocity)), or
# cubic-bezier(a, b, c, d).
ease:
  swell:   &ease-swell   outCubic
  resolve: &ease-resolve outQuart
  leave:   &ease-leave   inQuad

# Capabilities this sequence needs. The only one today is icon.fade and the
# only degrade is scale-only: if an icon cannot fade, the fade is dropped for
# that icon, everything else plays, the console warns once per icon.
requires:
  icon.fade: { degrade: scale-only }

# OPT-IN persistence (§12.8). Absent — or `minutes: 0` — means NOTHING is
# written to the visitor's browser.
resume:
  minutes: 60                             # idle window; TTL runs from the last state change
  id: example-pack                        # localStorage key; defaults to the pack's name

# How big a grab zone each icon gets, as a fraction of its projected radius
# (§12.12). A press is hit-tested; a press that hits nothing rotates nothing.
hit:
  padding: 0.25                           # default 0.25

# What happens when a dragged icon is let go (§12.12). The RUNTIME owns this,
# so an icon with no controller of its own still comes back. A step may
# override the whole block with a `rest:` of its own.
rest:
  spring: true                            # default true; false = leave it where it was left
  dur: 0.5                                # seconds (default 0.5)
  ease: outBack(0.9)                      # any sequence ease (default outBack(0.9))

# Every name a track may target. Positions are viewport fractions of the
# element's CENTER (like framing.verticalCenter); size is font size as a
# fraction of the viewport's SHORTER side (vmin), so copy that fits a
# landscape desktop still fits a portrait phone.
stage:
  hud:
    # `count` rings. Each ring is separately addressable as a `to:`
    # destination under the element's name plus a 1-based index —
    # here slot1, slot2, slot3.
    slot: { type: slots, count: 3, top: 0.14, size: 0.075, gap: 0.45,
            color: "#e9e3f4", dim: "#e9e3f433" }
  icon:
    ref: current                          # `current` = every icon; a flow requires `current`
  overlay:
    line1: { type: text, top: 0.735, size: 0.05, weight: 700, tracking: 0.12 }
    line2: { type: text, top: 0.805, size: 0.05, weight: 700, tracking: 0.12 }
    # persist: once it has arrived it is never hidden and never re-animated,
    # so the tap target does not move between steps.
    cta:   { type: button, top: 0.905, size: 0.055, text: "→", color: "#9cc3ff",
             persist: true }

# State at frame 0 — not motion. Slots take `filled` (a count, or a list of
# icon names); any target may also take channel values here (e.g. line1: { fade: 0 }).
initial:
  slot: { filled: 0 }

steps:
  # A flow step names the icon it shows: the sequence drives the viewer, not
  # the other way round. The entrance is anchored so every step reuses it.
  - id: one
    icon: twist
    copy:
      line1: "FIRST LINE OF COPY"
      line2: "SECOND LINE OF COPY"
    timeline: &entrance
      - id: icon-entrance
        target: icon
        at: 0.2                           # seconds, absolute
        timing: { dur: 0.7, ease: *ease-swell }
        channels: { fade: [0, 1], scale: [0.52, 1] }
      - id: copy-resolve
        target: [line1, line2]            # a list + stagger = one gesture down a list
        at: 0.4
        stagger: 0.6
        timing: { dur: 1.0, ease: *ease-resolve }
        channels: { blur: [12, 0], wipe: [0, 1], fade: [0, 1] }
      - label: copy-settled               # = end of the previous track (2.0 s)
      - id: cta-in
        target: cta
        at: copy-settled + 0.8            # 2.8 s, and it follows the copy if the copy moves
        timing: { dur: 0.2, ease: *ease-swell }
        channels: { fade: [0, 1], rise: [14, 0], bloom: [0, 1] }

    # `exit:` plays when this step is LEFT. Same grammar as `timeline:`, plus
    # the `to:` track — the general "send the 3D icon to a 2D element"
    # primitive (§12.6).
    exit:
      - &copy-out
        id: copy-out
        target: [line1, line2]
        at: 0
        timing: { dur: 0.28, ease: *ease-leave }
        channels: { fade: [1, 0], blur: [0, 10] }
      - id: collect
        target: icon                      # a `to:` track is always `target: icon`
        to: slot1                         # ANY declared 2D element, ring or not
        at: 0.1
        timing: { dur: 0.6, ease: *ease-swell }
        land:
          mode:  object                   # object | glyph
          face:  front                    # object mode: stop rotating, rest facing front
          fit:   0.72                     # fraction of the target's inner diameter
          after: glyph                    # optional: then become the flat mark…
          delay: 0.45                     # …this long after touchdown (default 0.4)
          fade:  0.12                     # …cross-faded over this long (default 0.12)
    on:
      cta.tap: { do: advance }            # verbs: advance, restart, replay, nothing
    end: hold                             # hold is the only end

  - id: two
    icon: gem
    overlap: 0.35                         # this entrance starts 0.35 s BEFORE the
    copy:                                 # previous exit ends (§12.7)
      line1: "A SECOND ICON"
      line2: "THE SAME CHOREOGRAPHY"
    timeline: *entrance
    exit:
      - *copy-out
      - { id: collect, target: icon, to: slot2, at: 0.1,
          timing: { dur: 0.6, ease: *ease-swell },
          land: { mode: object, face: front, fit: 0.72 } }
    on: { cta.tap: { do: advance } }
    end: hold

  # A flow step with NO `icon:` is a state, not an icon: nothing on the canvas,
  # no copy, and the call-to-action still exactly where it has been. Its
  # zero-length track matters only on a RESUME straight into this state.
  - id: done
    timeline:
      - { id: cta-hold, target: cta, timing: { dur: 0 },
          channels: { fade: 1, rise: 0, bloom: 1 } }
    on: { cta.tap: { do: restart } }
    end: hold
```

Top-level keys: `version`, `ease`, `requires`, `resume`, `hit`, `rest`,
`stage`, `initial`, `steps`. Anything else is ignored with a validator warning. Everything below
the top level that is wrong — an undeclared target, a channel the layer does
not have, a `to:` that names nothing, an unknown landing mode or verb, a step
naming an icon the pack does not have, an unknown label or ease, a non-numeric
time — is a **load-time error, by name**, shown in the status line as
`sequence.yml: sequence: steps.one.timeline[3] (cta-in): target "ctaa" is not
declared in stage:`.

**Which step plays.** In a **flow** the steps play in file order, starting at
step 0 — or at a resumed step (§12.8), or at the step naming an icon a
developer picked from the viewer's dropdown. Without a flow the behaviour is
unchanged: the first step whose `icon:` names the loaded icon, else the first
step with no `icon:`; if neither exists the icon has no sequence, and
`stage.icon.ref` gates the whole file the same way (`current`, or one icon's
name).

### 12.3 Channels, per layer

Channels are abstract names, never raw CSS or three.js properties. Values are
`[from, to]` or a bare `to` (which animates from the value the state has when
the timeline is *built* — i.e. its default or `initial:` value).

**`icon` (3D — the wrapper Group + fade)**

| Channel | Unit | Maps to |
|---|---|---|
| `fade` | 0–1 | `api.setFade(v)` if the icon provides it; else the standard-material fallback below; else dropped (`degrade: scale-only`) |
| `scale` | multiplier | `wrapper.scale` (uniform) |
| `rise` | world units | `wrapper.position.y` |

Position and scale during a `to:` move are owned by that track, not by these
channels — see §12.6.

**`overlay` and `hud` (2D DOM)**

| Channel | Unit | Maps to |
|---|---|---|
| `fade` | 0–1 | `opacity` |
| `rise` | px | `transform: translateY()` — positive starts *below* rest |
| `blur` | px | `filter: blur()` |
| `wipe` | 0–1 | left-to-right reveal, `clip-path: inset(0 (1-w)·100% 0 0)` — **a GUESS at the reveal mechanism** (see below) |
| `bloom` | 0–1 | an *intent*; the page renders it as a two-layer `drop-shadow` glow in the element's colour |

All 2D channels of one element compose into one `transform`, one `filter`,
one `clip-path` from a single state object, so two tracks on the same element
can never clobber each other.

**The `blur` + `wipe` reveal is a stated guess.** The reference this was
measured from reads as "blur-in with a left-to-right reveal"; a clip-path wipe
plus a blur matches that in aggregate, but a per-character stagger or a
travelling blur gradient would read the same from a distance. A dedicated
research track is deciding the final mechanism. The code says so at the point
of implementation (`renderDom()` in `sequence.js`); do not present the current
look as final.

### 12.4 Timing, labels, stagger, easing

- All times are **seconds** (floats). `at:` is absolute by default because
  review notes arrive in absolute seconds ("pull the arrow to 2.6").
- `at: after` (or no `at`) starts when the previous track in the list ends.
- `- label: name` declares a time = the end of the previous track (or add
  `at:` to place it); `at: name + 0.3` / `at: name - 0.2` reference it.
  Labels must be declared **above** the track that uses them, and are scoped
  to the list they appear in (a `timeline:` and an `exit:` do not share them).
- `stagger: s` with a list `target:` starts each successive target `s` later.
- `timing: { dur, ease }` applies to the whole track — one gesture, N
  channels, so a fade and a scale cannot be desynced by accident.
- `ease` is any Anime.js v4 name (`linear`, `in/out/inOut` × `Quad Cubic
  Quart Quint Sine Circ Expo Bounce Back Elastic`, …) or
  `cubic-bezier(a,b,c,d)`, a parametrised name such as `outBack(0.8)` or
  `outElastic(1, 0.4)`, or a real spring: `spring(stiffness, damping)` — or
  `spring(mass, stiffness, damping, velocity)` for the long form. Unknown names,
  wrong argument counts and non-numeric arguments are all load-time errors.
  A spring is used as the CURVE only: Anime.js reports a fixed duration for it
  here, so the track's own `dur` still owns the timing.
- `duration` is the current **phase's** length, and `end: hold` clamps there.
  A phase is either a step's entrance or a transition (an exit plus the next
  entrance, overlapped) — so `viewer.sequence.duration` changes as a flow
  moves on, and the HUD transport's range follows it.

### 12.5 Slots — a row of rings with three states

```yaml
stage:
  hud:
    slot: { type: slots, count: 3, top: 0.14, size: 0.075, gap: 0.45,
            color: "#e9e3f4", dim: "#e9e3f433", ring: 0.07 }
```

| Key | Meaning |
|---|---|
| `count` | how many rings (default 3) |
| `size` | ring diameter *and* the row's font size, as a vmin fraction (1 em = one ring) |
| `gap` | space between rings, in em (default 0.5) |
| `color` | the BRIGHT colour: `next` and `filled` rings |
| `dim` | the `pending` colour |
| `ring` | border thickness in em (default 0.07) |

The three states are a function of the **flow**, never of a counter:

| State | Look | When |
|---|---|---|
| `pending` | dim ring, empty | not collected yet, and not the one being collected |
| `next` | bright ring, empty | the first ring that is not filled — where the CURRENT icon will land |
| `filled` | bright ring holding that icon's glyph | an icon has landed here |

Because `next` is simply "the first unfilled ring", **the highlight moves at
TOUCHDOWN, not when the fly begins** — there is no separate cue to keep in
sync. `initial: { slot: { filled: 2 } }` starts with the first two rings
filled from the flow's own step order; `filled: [twist, gem]` names them.

Each ring is separately addressable as a `to:` destination under the
element's name plus a 1-based index — a `slot` element with `count: 3` gives
the targets `slot1`, `slot2`, `slot3`. A ring is *only* a destination: it has
no channels and no `initial:` state of its own.

> **Deprecated: `pips`.** The Phase 1 progress row (`{ type: pips }` with
> `initial: { pips: { filled, total } }`) still works, unchanged, and the
> validator warns. It has two states and cannot receive an icon; `slots`
> replaces it.

### 12.6 Sending the icon to a 2D element — `to:` and `land:`

This is the general primitive, not a collect-flow special case: it moves the
3D icon to **any declared 2D element**, in a straight line, shrinking as it
goes so it lands inside.

```yaml
- id: collect
  target: icon                # always `icon`; a `to:` track carries no `channels:`
  to: slot2                   # any declared 2D element (a ring, a text line, the CTA)
  at: 0.1
  timing: { dur: 0.6, ease: outCubic }
  land:
    mode:  object             # object | glyph          (default object)
    face:  front              # object mode's rest orientation (only `front`)
    fit:   0.72               # fraction of the target's inner diameter (default 0.72)
    after: glyph              # optional; only after an object landing
    delay: 0.45               # seconds after touchdown for `after:` (default 0.4)
    fade:  0.12               # cross-fade object -> glyph, seconds (default 0.12)
```

**How the destination is computed — every frame, not once.** The target
element's centre is read with `getBoundingClientRect()`, converted to NDC, and
unprojected at a fixed **depth in front of the camera** (captured when the
flight is planned), so both ends of the flight sit on one plane and a linear
tween of x, y and z is a straight line on screen. Measured over the example
pack's 0.6 s collect: maximum deviation from the straight line **4.8 × 10⁻¹⁷
world units** — floating-point noise.

That solve is **repeated on every frame, for the whole life of the landed
object**, and the fit is re-derived with it. The rings are DOM elements fixed
to the *viewport*; the objects are in the 3D *world*. A one-time world position
decouples the two permanently the first time anything changes the projection.
Measured on the old one-time landing, from an object sitting exactly at its
ring centre: **one** wheel click moved it to `[0, -17.13]` px and pushed the fit
from 0.7200 to 0.7628; a few more took it clean out of the ring. With the
per-frame solve, offset stays `[0, 0]` px and the fit stays `0.7200` through
wheel zoom (camera z 3.88 → 10.40), a resize (864×814 → 1280×800), a portrait
phone (375×812) and an orientation change (812×375).

Cost: one `getBoundingClientRect()` per ring per frame, cached for the frame,
with the (expensive) computed border read only when a ring's size actually
changes. The reads happen **before** the frame's DOM writes, so nothing forces
a reflow.

Do not "fix" ring drift by locking the camera during a flow. Pinch and wheel
zoom are deliberately live in pack mode, and locking would not help a resize
or a phone being turned anyway.

**How the fit is computed.** The icon's visible radius is taken from each
mesh's **geometry bounding sphere**, expressed about the wrapper's own origin
(`|offset| + radius`, in wrapper-local units) — not from an axis-aligned box,
whose size swings by ~20 % with orientation while the icon's controller is
still spinning it. Halos and outer shells are meshes, so they count. That
radius is projected to pixels at the destination depth and scaled so the
visible diameter is `fit ×` the target's inner diameter (its border box minus
its border). Measured on both landing icons of the example pack, desktop and
phone: **0.7200** of a 52 px inner circle at 1280×800, and of a 25.13 px inner
circle at 375×812.

**Landing modes.**

| `mode` | What is in the ring afterwards |
|---|---|
| `object` | the real 3D object, live but **frozen**: it left the per-frame update path when the flight began, and the flight *tweened* it to its resting orientation |
| `glyph` | a flat 2D mark; the 3D object is cross-faded out and released at touchdown |
| `object` + `after: glyph` | an object landing, cross-faded to the glyph `delay` seconds later — the 3D motion without paying for a permanently live shader |

**The turn to rest is spread across the flight, and nothing is assigned at
touchdown.** The icon's own controller drives rotation right up to the frame
the flight starts; on that frame the icon leaves the update path and the
timeline takes the same property over, tweening it to front on the **shortest
angular path** (the delta is normalised to ±π, so a turn never goes the long
way round). Measured on the example pack's `gem`, sampled in real time through
a collect: largest single-frame step **0.159463 rad (9.14°)** — the first frame
of an `outCubic`, whose ease starts fastest — against an idle rate of 0.76° per
frame, and a total sweep of **107.90°**. The old code froze mid-flight and then
assigned `rotation.y = 0` at touchdown: a measured **275° snap in one frame**.

Because nothing is assigned, a landed icon rests facing front at `rotation.y`
**≡ 0 (mod 2π)** — it is the continuous value the turn arrived at, not a
literal zero. Assert `Math.cos(y) > 0.9999`, not `y === 0`.

**The object → glyph swap is a cross-fade, not a flip.** `land.fade` seconds
(default 0.12) during which the 3D object's fade ramps down and the mark's
opacity ramps up. A transition's `duration` is extended to cover it, so the
last step of a flow — whose incoming entrance is usually zero-length — cannot
end mid-fade.

Landed icons are reparented into a `sequence-landed` Group under the pivot, so
several icons can be on screen at once (the viewer otherwise holds exactly
one). Only the ACTIVE icon's `update(dt)` runs.

**Glyphs — two sources, in this order.**

1. **Provided.** A `glyphs:` map in `icons.yml`, exactly like `backgrounds:`:

   ```yaml
   glyphs:
     twist: glyphs/twist.png
   ```

   Paths are relative to `component.js` and must exist in the pack; the loader
   resolves each to an absolute URL and forwards it as `api.glyph`.

2. **Derived.** With no entry, the viewer renders the icon once to an offscreen
   256 × 256 render target at its **front** orientation and keeps the result as
   a PNG data URL. **This happens at PRELOAD, not at land time**, so every mark
   is framed the same way and none of them depends on where the icon happened
   to be rotated when it was collected. The icon is forced to `fade: 1` for the
   capture and put straight back — capture it at a t=0 pose and the mark comes
   back literally empty (measured: alpha coverage 0.0000).

   The capture uses **the page's own camera**, cropped with `setViewOffset()` to
   the glyph box inside the ring this icon is going to land in, with the object
   placed at exactly the world position and scale the landed object will have.
   The PNG is therefore the same projection, the same framing and the same
   lighting as the live object it replaces, which is what makes the cross-fade
   invisible. Measured against the live landed object rendered through that same
   crop: mean absolute pixel difference **0.00024** (max per channel 1/255) and a
   silhouette IoU of **1.00000**. The old capture — its own 40° camera, a
   bounding-sphere fit and 8% air — scored **0.14864** and **0.51181** on the
   same comparison, with the mark 35% too small (alpha coverage 0.20972 against
   the object's 0.32531). An icon that no step lands still falls back to the
   bounding-sphere frame.

   A pack needs no new assets for this to work. An icon whose look depends
   heavily on a backdrop (deep transmission, say) may derive a faint mark —
   ship a `glyphs:` image for it.

### 12.7 Flows — steps, `advance`, `restart`, overlap, preloading

**A sequence becomes a flow as soon as a step's `on:` uses `advance` or
`restart`.** There is no separate switch. Without one of those verbs nothing
changes: one step plays, exactly as it did in Phase 1.

In a flow:

- **Steps play in file order** and each one names the `icon:` it shows — the
  sequence drives which icon the viewer displays, inverting the Phase 1
  relationship. Every named icon must be in the pack. `stage.icon.ref` must be
  `current`.
- **Put the first step's icon first in `icons.yml`.** The viewer loads the
  pack's first icon; if step 0 names a different one the flow acquires and
  swaps it, which is correct but shows an empty stage for a few milliseconds.
- **The stage is persistent.** Slots accumulate; nothing is torn down and
  rebuilt between steps. Copy text is swapped on the same DOM nodes.
- **`persist: true`** on an element means: once a track has brought it in, every
  later step skips its tracks and leaves it where it is. This is how a
  call-to-action stays put — verified, its bounding rect is byte-identical
  before the first tap and at the end of the flow.
- **The last step should have no `icon:`.** A step with no icon is a state:
  nothing on the canvas, no copy (give it no `copy:`), the call-to-action
  still there, and `on: { cta.tap: { do: restart } }`.

**The verbs.**

| Verb | What it does |
|---|---|
| `advance` | commit the current step's landing, then play a **transition**: this step's `exit:`, and the next step's `timeline:` overlapped into it. Persists. Ignored while a transition is still running — the icon in flight owns the stage until it lands |
| `restart` | slots empty **instantly** (state, not animation), every icon back to rest and hidden, step 0's entrance from t = 0. Persists. A `persist:` element that has already arrived stays arrived, so the CTA does not blink |
| `replay` | `seek(0)` + play on the current phase. Unchanged from Phase 1 |
| `nothing` | declared and inert |

**Overlap.** One number, on the **incoming** step:

```yaml
- id: two
  icon: gem
  overlap: 0.35     # this entrance starts 0.35 s BEFORE the previous exit ends
```

`0` (the default) is strictly sequential; a value ≥ the exit's length starts
both at t = 0. It exists as a single number precisely so a review note ("let
the next one come in sooner") is a one-line change. Measured on the example
pack: the exit ends at 0.70 s, so the incoming entrance begins at 0.35 s and
the whole transition is 3.35 s.

**Preloading.** Every icon in the pack is built once, up front, behind the
first step's entrance — and its glyph captured at the same moment — so a tap
never stalls on a geometry build. `viewer.sequence.ready` is the promise.
Icons are singletons for the life of the pack: `restart` returns them to rest
rather than rebuilding them.

### 12.8 Resume — opt-in persistence

The viewer stores **nothing** by default, and a sequence changes that only if
the pack asks:

```yaml
resume:
  minutes: 60          # absent, or 0 = never persist
  id: example-pack     # localStorage key; defaults to the pack's name
```

- The key is `glb-viewer:seq:<id>`. The value is
  `{"v":1,"step":"two","slots":["twist",null,null],"t":1788574555367}` —
  schema version, the current step's id, one icon name (or `null`) per ring,
  and a millisecond timestamp.
- **Written on every state change, and only by `advance` and `restart`.** The
  dev transport — scrubbing, ▶/⏸, and picking an icon from the dropdown —
  never writes. Developer inspection must not overwrite a visitor's state.
- The **TTL runs from the last state change**, not from the first: it is an
  idle window, so someone actively tapping is never cut off.
- On load a saved state is **discarded, never repaired**, if it is older than
  `minutes`, if its schema version is not 1, if its `step` id no longer exists,
  if the ring count changed, or if it names an icon the pack no longer has.
  Editing `sequence.yml` must not strand a visitor on a step that is gone.
- **On resume the current step's entrance replays** with the rings already
  filled — no re-collection animation. Filled rings show **glyphs**; a landed
  3D object is not restored across a reload.
- Every read and write is wrapped in `try`/`catch`. A private window and
  blocked site data both throw on access, and the only correct response is to
  carry on with no persistence.

This is the one place the viewer touches browser storage; it is documented in
`README.md` as user-visible behaviour for that reason.

### 12.9 The fade contract

1. **Preferred:** the icon's `createIconObject()` return value has
   `setFade(v)`; the stock loader forwards it as `api.setFade`, and the
   sequence calls it. This is the only route for a raw `ShaderMaterial`
   (whose alpha is whatever its fragment shader writes) — the icon must
   multiply the value into its output alpha, with `transparent: true`.
2. **Fallback (generic, documented):** with no `setFade`, the page walks
   `api.object`, collects `MeshStandardMaterial` / `MeshPhysicalMaterial` /
   `MeshBasicMaterial` instances, and while the fade is in flight sets
   `transparent = true` and `opacity = original × v`; at `v ≥ 0.999` it
   restores the material's own `transparent`/`opacity`, so the resting look is
   pixel-identical to a pack without a sequence. Verified on all three example
   icons.
3. **Degrade:** neither is possible → `requires.icon.fade.degrade:
   scale-only` drops the `fade` for that icon, keeps everything else, and
   warns once **per icon** in the console. Any other `degrade` value is an
   error. In a flow the capability is per icon, not per pack.

### 12.10 Runtime and `window.viewer.sequence`

The page imports `sequence.js` (and the vendored Anime.js 4.5.0) **only when a
loaded icon carries `api.sequence`** — check the network panel on a pack
without the key: neither file is requested. The runtime compiles the current
**phase** into an Anime.js timeline created with `autoplay: false` and drives
it with `tl.seek(t × 1000)` from the render loop's accumulated `dt` — never
anime's own ticker, whose engine therefore never starts (`engine.reqId` stays
0). One timeline per phase, never one per track, so `seek(t)` stays exact in
both directions. The pack's `update(dt)` runs first each frame (its controller
assigns rotation), then the sequence writes the wrapper and overlay; they share
no property.

```js
const s = window.viewer.sequence;   // null when the icon has no sequence
s.duration;         // seconds — the CURRENT phase, e.g. 3 or 3.35
s.time;             // current time, clamped to [0, duration]
s.playing;          // false once `end: hold` is reached, or after pause()
s.seek(t);          // exact: renders every target for time t, in either direction
s.play();           // from the end, restarts at 0
s.pause();
s.flow;             // true when a step's `on:` uses advance/restart
s.step;             // id of the current step, e.g. 'two'
s.stepIndex;        // its index
s.phase;            // 'entrance' | 'transition'
s.slots;            // [{icon:'twist', as:'glyph', mix:1}, null, null] at the current time
                    // `mix` is the object -> glyph cross-fade: 0 = object, 1 = mark
s.hit;              // { padding: 0.25 } — the grab zone in force (§12.12)
s.rest;             // { spring, dur, ease } — the spring-back in force RIGHT NOW
s.grabbed;          // the icon being dragged, or null
s.turns;            // { twist: { yaw, pitch, springing }, … } — the runtime's own
                    // drag offsets, which live on each icon's WRAPPER
s.icons;            // every icon in the pack, in manifest order
s.advance();        // the verbs, for scripted checks — these DO persist
s.restart();
s.ready;            // promise: preload + glyph capture done
s.storageKey;       // 'glb-viewer:seq:example-pack', or null when resume is off
s.saved;            // the parsed stored state, or null
s.targets;          // ['slot','slot1','slot2','slot3','line1','line2','cta','icon']
s.states;           // { name: { channel: value } } snapshot, for assertions
s.warnings;
```

A small transport (▶/⏸ + slider + time, plus the step id in a flow) appears in
the HUD while a sequence is loaded; dragging the slider pauses and seeks. It
scrubs the current phase, exists for design review, and never writes state.

### 12.11 Verifying a sequence deterministically

A hidden pane never advances the render loop (§10.1, §10.13), so drive time
yourself. **Serve with cache-busting headers or hard-reload after every edit** —
a stale `sequence.js` from the browser cache will have you debugging code that
is not running (this cost a session an hour).

Against the example pack:

```js
const v = window.viewer, s = v.sequence, c = v.component;
await s.ready; s.pause();

// --- step 1
s.seek(0);
s.duration;                                     // 3
c.root.scale.x;                                 // 0.52  (the wrapper; the icon's own scale is untouched)
[...document.querySelectorAll('#fg .fg-slot')].map(e => e.dataset.state);
// ['is-next', 'is-pending', 'is-pending']
s.seek(3);
const before = document.querySelector('#fg [data-seq="cta"]').getBoundingClientRect();

// --- tap to advance
document.querySelector('#fg [data-seq="cta"]').click();
s.duration;                                     // 3.35  (exit 0.70 + entrance, overlapped by 0.35)
s.seek(0.30);  s.slots;                         // [null, null, null] — still in the air
s.seek(0.35);  c.root.scale.x;                  // 0.52 — icon 2's entrance has begun
s.seek(0.70);  s.slots;                         // [{icon:'twist', as:'object'}, null, null]
[...document.querySelectorAll('#fg .fg-slot')].map(e => e.dataset.state);
// ['is-filled', 'is-next', 'is-pending']
s.seek(1.15);  s.slots[0].as;                   // 'glyph' — the after: swap, 0.45 s later
document.querySelector('#fg [data-seq="cta"]').getBoundingClientRect().top === before.top;  // true

// --- a landed object is out of the update path, and facing front
const w = v.scene.getObjectByName('sequence-landed').children[0], o = w.children[0];
const r0 = o.rotation.y;
for (let i = 0; i < 60; i++) if (!v.component.frozen) v.component.api.update(1/60);
o.rotation.y === r0 && Math.cos(r0) > 0.9999;   // true — frozen, resting at front.
// NOT `r0 === 0`: the turn to rest is a continuous tween across the flight, so
// it lands on 0 MODULO 2*pi. Nothing is assigned at touchdown (§12.6).

// --- a landed object is anchored to its RING, not to a world position
const probe = () => {                             // screen offset from ring centre
  const r = document.querySelectorAll('#fg .fg-slot')[0].getBoundingClientRect();
  const p = w.getWorldPosition(new v.THREE.Vector3()).project(v.camera);
  return [(p.x * .5 + .5) * innerWidth - (r.left + r.width / 2),
          (-p.y * .5 + .5) * innerHeight - (r.top + r.height / 2)].map(n => +n.toFixed(2));
};
probe();                                          // [0, 0]
v.renderer.domElement.dispatchEvent(new WheelEvent('wheel',
  { deltaY: -120, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true }));
v.controls.update(); s.seek(s.time);
probe();                                          // [0, 0] — still. Same after a
                                                  // resize and an orientation change.

// --- the end, and restart
s.seek(s.duration); document.querySelector('#fg [data-seq="cta"]').click();  // → three
s.seek(s.duration); document.querySelector('#fg [data-seq="cta"]').click();  // → done
s.step;                                         // 'done'
document.querySelector('#fg [data-seq="line1"]').textContent;   // '' — no copy
document.querySelector('#fg [data-seq="cta"]').style.opacity;   // '1' — the CTA stays
document.querySelector('#fg [data-seq="cta"]').click();         // restart
s.step; s.time; s.slots;                        // 'one', 0, [null, null, null]

// --- persistence
s.storageKey;                                   // 'glb-viewer:seq:example-pack'
s.saved;                                        // { v:1, step:'one', slots:[null,null,null], t: … }
const before2 = localStorage.getItem(s.storageKey);
s.seek(1.4); s.play(); s.pause();
localStorage.getItem(s.storageKey) === before2; // true — the transport never writes
```

Then the invariants that must survive any change:

```js
// spin is the controller's, not the sequence's:
const r = c.api.object.rotation.y; s.seek(2); s.seek(0); c.api.object.rotation.y === r;  // true
c.api.update(1.0);                                  // only update(dt) moves it
// framing is solved at rest pose, once:
const cam = v.camera.position.clone(); s.seek(0); cam.equals(v.camera.position);         // true
// a drag that hits nothing rotates nothing (§12.12):
const before = JSON.stringify(s.turns);
// …a pointerdown/move/up on empty canvas…
JSON.stringify(s.turns) === before;                                                      // true
// a pack with no sequence loads neither module:
performance.getEntriesByType('resource').map(e => e.name).filter(n => /sequence\.js|anime/i.test(n));  // []
```

Unloading (`⏏ Unload …`, or loading any model) disposes the sequence, empties
`#fg`, releases every icon the flow acquired, removes the `sequence-landed`
Group, restores the wrapper to scale 1 and the materials to their own flags,
and `viewer.sequence` is `null` again. Verified: `#fg` empty, no landed group,
transport hidden, nothing left in `localStorage`.

### 12.12 Pointer — who gets the drag, and where it goes afterwards

While a sequence is live, **one router owns the canvas** and every press is
hit-tested. It replaces the old arrangement, in which every drag anywhere on
the canvas was forwarded to the *active* icon's own handlers and a landed
object could not be touched at all.

**How a press is resolved.** Each candidate — the active icon, plus every icon
already sitting in a ring — is projected to screen along with its own visible
radius (the same geometry-bounding-sphere radius the landing fit uses, §12.6).
That radius plus `hit.padding` of it is the grab zone; the **nearest** hit
wins, and a press that hits nothing rotates nothing.

```yaml
hit:
  padding: 0.25        # fraction of the projected radius (default 0.25)
```

Measured on the example pack's landed `gem` at 1280×800: projected radius
**18.72 px**, grab zone **23.40 px**. A press 16.7 px and one 21.4 px from the
centre both grab it; one at 26.4 px does not.

**What the drag does.** An icon that ships its own pointer handlers (an
`IconController` with `pointerDown`) keeps owning its rotation — the router
only routes the gesture to it. Every other icon, *including one with no
controller at all*, is turned by the runtime, which writes yaw and pitch to
the icon's **wrapper**. That is deliberately a different property from the one
a controller assigns, so the two compose rather than fight: measured on `gem`,
a 200 px drag put 1.5708 rad on the wrapper while the controller kept its idle
spin at exactly 0.800 rad/s throughout. A drag of the viewport's **shorter
side** is one full turn, so the gesture is the same on a phone and a desktop;
pitch is clamped to ±1.2 rad.

Camera **rotation** is off while a sequence is live — the icons own dragging —
but **zoom is not**: wheel and pinch work exactly as before, which is why the
rings are anchored per frame (§12.6) rather than the camera being locked.

**Spring-back.** When a runtime-owned drag ends, the icon returns to its rest
orientation:

```yaml
rest:
  spring: true         # default true; false leaves it where it was left
  dur: 0.5             # seconds (default 0.5)
  ease: outBack(0.9)   # any sequence ease (default outBack(0.9))

  # HOW SPRINGY the return feels is this line, and it spans a wide range.
  # Measured on the example pack, same 160 px drag, peak overshoot past rest:
  #
  #   outBack(0.2)      -0.00099 rad   barely a settle
  #   outBack(0.9)      -0.03668 rad   the default: a nudge past centre
  #   outBack           -0.12251 rad   Anime.js's bare 1.70158 — springy
  #   spring(60, 14)                   a real spring, no visible bounce
  #   spring(100, 10)                  a soft bounce
  #   spring(200, 8)    -0.46504 rad   loose and rubbery
  #
  # Stiffness raises the overshoot, damping kills it. `dur` is still the clock:
  # shorten it to make any of these snappier without changing their character.
```

- **Scope:** the block above is the sequence-wide default; **a step may carry
  its own `rest:`**, which overrides it for whatever is dragged while that step
  is showing. `viewer.sequence.rest` reports the one in force right now.
- The **runtime** owns this, not the pack. The minimal example icon `twist`
  exports no `IconController` whatsoever and still springs back — verified: a
  160 × 60 px drag put yaw 1.25664 / pitch 0.47124 on it, `outBack` overshot to
  −0.12506 rad, and it was back to exactly 0 at t = 0.500 s, with the icon's own
  `rotation.y` never touched.
- It **composes** with an idle spin rather than replacing it (the `gem`
  measurement above), and with `spring: false` the icon simply stays: 1.5708 rad
  still 1.5708 rad a full second later.
- A landing outranks a spring-back: if a collect starts mid-spring the flight
  takes the wrapper's yaw and pitch to zero along with the icon's own rotation,
  so it arrives square.
- Spring-back runs in **real time**, from the render loop's `dt`, not from
  sequence time. It has to survive a phase that has already reached `end: hold`,
  and it is a reply to a finger rather than something on a timeline — so it is
  deliberately *not* part of `seek()`.

Taps are unchanged: `on: { <element>.tap: … }` still only binds 2D elements
(§12.7). The canvas answers drags, not taps.

### 12.13 Deliberately not supported

Keyframes beyond `[from, to]`; `shift`/`scale` on 2D elements; a `background`
target; a stateful spring that survives being re-disturbed mid-return (`rest:`
  restarts its tween; the curve may be a real spring, but the solver is not
  carried across gestures) (`rest:` is a tween with an `outBack`-style
ease, §12.12); responsive variants; *taps* on the icon (the canvas answers
drags, and routes them by hit test — §12.12); a `goto <step>` verb (steps advance in order, or
restart); restoring a landed 3D object across a reload (a resumed ring shows
its glyph); any URL parameter — a sequence arrives only inside a pack. If a
request needs one of these, say so rather than approximating it.

---

## 13. Repo layout and where to read the source

```
index.html                     THE APP — markup, CSS, and one module <script>
sequence.js                    the sequence runtime (§12); imported by index.html only when a pack has one
sw.js                          "zipfs" service worker: serves unzipped pack files
vendor/
  three.module.min.js          three.js r170 (MIT), minified
  loaders/GLTFLoader.js
  controls/OrbitControls.js
  environments/RoomEnvironment.js
  utils/BufferGeometryUtils.js
  fflate.module.js             in-browser unzip
  js-yaml.esm.min.mjs          YAML parser for pack manifests + sequences, MIT
  animejs.esm.min.js           Anime.js 4.5.0 (MIT) — the sequence timeline; loaded on demand
models/*.glb                   7 Khronos sample models
backgrounds/starfield-default.jpg   default backdrop (synthetic, 4096x2732)
sidecars/example-emerald-glass.json example sidecar
components/
  example-shader-orb.js        minimal single-file component example
  pack.component.js            the stock pack loader — copied into every pack
  example-pack/                source of the example pack (unzipped), incl. sequence.yml
                               3 procedural icons: twist, gem, prism
  example-pack.zip             the same pack, zipped, for the drag-drop demo
README.md                      user-facing docs (designers + component authors)
CONTRIBUTING.md                background notes for a human contributor (not rules)
.claude/                       agent tooling (this file's neighbours)
  launch.json                  dev-server config
  tools/validate-pack.py       static pack validator (stdlib Python 3)
  skills/…                     repeatable authoring workflows
```

`index.html` is ~1,100 lines and, with `sequence.js`, is where all application
logic lives. Its sections are marked with `// --- name ---` banner comments;
navigate by those. In rough order: renderer/scene/camera → background layer →
model + pivot → sidecar → sidecar linter → sidecar editor UI → components →
sequences → icon packs / zip mode → zip loading → model loading → UI → render
loop.

Where to look when the docs above are not enough:

| Question | Read |
|---|---|
| What exactly does the viewer do with my component's return value? | `applyComponentApi()` / `activateComponent()` in `index.html` |
| How is my icon actually built? | `buildIcon()` in `components/pack.component.js` |
| Which sidecar properties does the linter recognise? | `PROP_TYPES`, near the top of the sidecar-linter section |
| How is my zip unpacked and served? | `loadZipFile()` in `index.html`, plus `sw.js` |
| How is my sequence compiled and played? | `createSequence()` in `sequence.js`; `startSequence()` / the render loop in `index.html` |
| How does an icon get sent into a slot, and how is a glyph made? | `makeSequenceHost()` in `index.html` — `planMove()`, `iconRadius()`, `setFrozen()`, `glyphFor()` |
| What does the viewer support at all? | `README.md`, and §11 above for what it does not |

---

## 14. Two things that genuinely constrain what you author

**Your copy of the pack loader must stay unedited.** A pack contains a copy of
`components/pack.component.js` as its `component.js`. It is the same file in
every pack; all pack-specific behaviour belongs in `icons.yml` and the
per-icon modules. `validate-pack.py` compares your copy against the repo's and
reports a drifted copy as an error, so an edited copy will not validate. If you
find yourself wanting to change it, the change belongs in your icon module.

**This repo is public.** Anything contributed back — an example pack, a sample
asset, a component in `components/`, a filename, a colour name, a code
comment — should be generic and product-neutral, with no client, brand, or
engagement references.
