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
  coordinates. The status line switches to "drag to spin the icon".
- **`{ icons: {…} }`** is the fourth return shape — see §7. It is checked
  before `object`/`material`.
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
├── icons.json          ← the manifest
├── backgrounds/        ← optional images referenced from icons.json
└── icons/
    ├── nameA/
    │   ├── src/index.js    ← the standard exports (below)
    │   └── assets/         ← that icon's model + textures (optional)
    └── nameB/…
```

```bash
cp components/pack.component.js my-pack/component.js
```

### `icons.json`

```json
{
  "icons": ["twist", "gem"],
  "background": "backgrounds/dusk.jpg",
  "backgrounds": { "gem": "backgrounds/alt.jpg" }
}
```

- `icons` — **required**, non-empty array of folder names under `icons/`. An
  icon folder not listed here is never loaded.
- `background` — optional, pack-wide. Either a path inside the zip, or a CSS
  color. `resolveBackground()` treats a value as a color if it matches
  `/^(#|rgb|hsl)/i` or is a single all-alpha word (`"black"`); anything else
  is resolved as a path relative to `component.js`.
- `backgrounds` — optional per-icon overrides, same value rules; falls back to
  `background`.

Keep background images web-sized — roughly a 2732-px-tall JPEG at quality ~80.

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
oversized assets. Exit 0 = clean, 1 = errors, 2 = could not open.

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
                  get model(), get component() };
```

`viewer.component` is `{ name, api, kind }` where `kind` is `'object'` or
`'material'` and `api` is exactly what `createComponent()` returned.

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
// .../zipfs/<id>/component.js, .../icons.json, .../icons/<name>/src/index.js, …
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
| **"One of my icons is missing."** The folder is in the zip | `icons.json` drives the list, not the folder contents | §10.9 |
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
   user — bad component, bad sidecar, missing `icons.json`, blocked service
   worker all end up as text in `#status`, sometimes with the real error only
   in `console.error`. Read both.

9. **`icons.json` drives the icon list, not the folder contents.** An icon
   folder present in the zip but missing from `icons.json` is silently
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

---

## 11. What this viewer does not do

Verified against the source. Do not attempt these — they are not there to find.

- **No animation transport or scrubbing UI.** Embedded glTF clips are detected
  and *all* of them are auto-played on an `AnimationMixer` at load
  (`gltf.animations.forEach(clip => mixer.clipAction(clip).play())`), and the
  status line reports the count. There is no play/pause/scrub/select control
  for them. The **Pause** button pauses only the turntable spin — the mixer
  keeps advancing.
- **No post-processing.** No `EffectComposer`, no `OutputPass`, no bloom, no
  pass chain of any kind beyond the renderer's own ACES tone mapping. Nothing
  from three's `postprocessing` examples is vendored. This is why `srgbOutput`
  is `false` (§10.6).
- **One icon pack resident at a time.** `unloadZip()` deletes every key in the
  `zipfs` cache, and loading a new zip clears it first. Two packs cannot
  coexist, and a pack cannot reference another pack's files.
- **No sequencing or timeline support.** See §12.
- **No persistence.** No `localStorage`, no `sessionStorage`, no cookies, no
  server. Spin speed, pivot mode, the loaded sidecar, the custom background,
  and the loaded pack are all lost on reload. The only way to restore state is
  to put it back in the URL (§4).
- **No Draco / meshopt / KTX2 decoding.** Use uncompressed GLB. (Also noted in
  README's "Known limits".)
- **No URL route for a zip.** A zip arrives only by drop or file picker.
- **No cross-origin loading** of components or backgrounds (§4).
- **No upload of anything, anywhere.** That is a feature, not a limit.

---

## 12. Sequencing — not specified yet

A **YAML-driven animation-sequence format** is being designed for this viewer:
a way to describe a timed sequence of states rather than one continuous spin.
**The contract is not settled.** No schema, no key names, no loader, and no URL
parameter for it exist in this repo today.

Do not invent one, do not write files that assume one, and do not tell a user
this viewer can play a sequence. If someone asks for sequencing, point them at
this section and at §11.

---

## 13. Repo layout and where to read the source

```
index.html                     THE WHOLE APP — markup, CSS, and one module <script>
sw.js                          "zipfs" service worker: serves unzipped pack files
vendor/
  three.module.min.js          three.js r170 (MIT), minified
  loaders/GLTFLoader.js
  controls/OrbitControls.js
  environments/RoomEnvironment.js
  utils/BufferGeometryUtils.js
  fflate.module.js             in-browser unzip
models/*.glb                   7 Khronos sample models
backgrounds/starfield-default.jpg   default backdrop (synthetic, 4096x2732)
sidecars/example-emerald-glass.json example sidecar
components/
  example-shader-orb.js        minimal single-file component example
  pack.component.js            the stock pack loader — copied into every pack
  example-pack/                source of the example pack (unzipped)
  example-pack.zip             the same pack, zipped, for the drag-drop demo
README.md                      user-facing docs (designers + component authors)
CONTRIBUTING.md                background notes for a human contributor (not rules)
.claude/                       agent tooling (this file's neighbours)
  launch.json                  dev-server config
  tools/validate-pack.py       static pack validator (stdlib Python 3)
  skills/…                     repeatable authoring workflows
```

`index.html` is ~980 lines and is the only place application logic lives. Its
sections are marked with `// --- name ---` banner comments; navigate by those.
In rough order: renderer/scene/camera → background layer → model + pivot →
sidecar → sidecar linter → sidecar editor UI → components → icon packs / zip
mode → zip loading → model loading → UI → render loop.

Where to look when the docs above are not enough:

| Question | Read |
|---|---|
| What exactly does the viewer do with my component's return value? | `applyComponentApi()` / `activateComponent()` in `index.html` |
| How is my icon actually built? | `buildIcon()` in `components/pack.component.js` |
| Which sidecar properties does the linter recognise? | `PROP_TYPES`, near the top of the sidecar-linter section |
| How is my zip unpacked and served? | `loadZipFile()` in `index.html`, plus `sw.js` |
| What does the viewer support at all? | `README.md`, and §11 above for what it does not |

---

## 14. Two things that genuinely constrain what you author

**Your copy of the pack loader must stay unedited.** A pack contains a copy of
`components/pack.component.js` as its `component.js`. It is the same file in
every pack; all pack-specific behaviour belongs in `icons.json` and the
per-icon modules. `validate-pack.py` compares your copy against the repo's and
reports a drifted copy as an error, so an edited copy will not validate. If you
find yourself wanting to change it, the change belongs in your icon module.

**This repo is public.** Anything contributed back — an example pack, a sample
asset, a component in `components/`, a filename, a colour name, a code
comment — should be generic and product-neutral, with no client, brand, or
engagement references.
