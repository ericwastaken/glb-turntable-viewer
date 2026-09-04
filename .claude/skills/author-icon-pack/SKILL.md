---
name: author-icon-pack
description: Build, validate, and test an icon-pack ZIP for this viewer — the icons.json manifest, the standard per-icon exports (createIconObject / loadIconGeometry / loadIconTextures / IconController / LAYOUT), packaging, and the zipfs service-worker path. Use when asked to create, fix, extend, or validate a pack or the zip drag-drop workflow.
---

# Authoring an icon pack

A pack bundles several icons — each with its own code and assets — into one
`.zip` a non-technical user drags onto the page. The viewer unzips it in the
browser and serves the contents from a service worker, so ordinary relative
imports and asset paths work untouched.

Spec reference: `AGENT.md` §7. Working example: `components/example-pack/`
(and its zipped twin `components/example-pack.zip`). Loader source:
`components/pack.component.js`.

## Step 1 — lay out the folder

```
my-pack/
├── component.js        ← EXACT copy of components/pack.component.js. Never edit.
├── icons.json
├── backgrounds/        ← optional
└── icons/
    ├── nameA/
    │   ├── src/index.js
    │   └── assets/     ← optional; models + textures for this icon
    └── nameB/…
```

```bash
cp components/pack.component.js my-pack/component.js
```

The loader is the same file in every pack — all pack-specific behaviour lives
in `icons.json` and the per-icon modules. If you find yourself wanting to edit
it, the change belongs in your icon module: `validate-pack.py` compares your
copy against the repo's and reports a drifted copy as an error, so an edited
copy will not validate (`AGENT.md` §14).

## Step 2 — write `icons.json`

```json
{
  "icons": ["nameA", "nameB"],
  "background": "backgrounds/dusk.jpg",
  "backgrounds": { "nameB": "#05061a" }
}
```

- `icons` — **required**, non-empty, and it is what drives the dropdown. A
  folder under `icons/` that is not listed here is silently ignored.
- `background` — optional, pack-wide. A path inside the zip **or** a CSS
  colour. The loader treats a value as a colour when it matches
  `/^(#|rgb|hsl)/i` or is a single all-alpha word (`"black"`); everything else
  is resolved as a path relative to `component.js`.
- `backgrounds` — optional per-icon overrides, same value rules, falling back
  to `background`.

Keep background images web-sized — roughly a 2732-px-tall JPEG at quality ~80.

## Step 3 — write each `icons/<name>/src/index.js`

| Export | Required | Shape |
|---|---|---|
| `createIconObject` | **yes** | `({ geometry, textures, srgbOutput }) => Object3D \| { group, update?, dispose?, frameCount? }` |
| `loadIconGeometry` | **yes** | `({ path }) => Promise<BufferGeometry>` |
| `loadIconTextures` | no | `({ path, renderer }) => Promise<any>`; the result is handed straight to `createIconObject` |
| `IconController` | no | class with `update(dt)`; `setSheetFrames(frameCount)` called if present; add `pointerDown/pointerMove/pointerUp` to receive drags |
| `LAYOUT` | no | `{ iconHeightFraction, verticalCenter }` |

This one is verified working (it is `components/example-pack/icons/twist/src/index.js`):

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

Adding motion — verified as `icons/gem/src/index.js`; the loader calls
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

Rules that are easy to get wrong:

- **Icon modules DO `import * as THREE from 'three'`.** The bare specifier
  resolves through the *page's* import map, so every icon shares the viewer's
  single three.js instance. Do not vendor three.js into a pack, and do not
  rewrite these imports to relative paths.
- **`path` is always `icons/<name>/assets/` as an absolute URL with a trailing
  slash**, and is passed even when that folder does not exist. Load geometry
  and textures from it; never hard-code a path.
- **`createIconObject` is called with `srgbOutput: false`.** The viewer renders
  straight to the canvas with no post-processing pass, and three.js applies no
  sRGB encode to raw `ShaderMaterial` output. Emit display-ready colour. If you
  use a raw shader, also beware that `new THREE.Color(hex)` is linearized under
  ColorManagement — pin with
  `new THREE.Color().setHex(0x808080, THREE.LinearSRGBColorSpace)`.
- **Return either an `Object3D` or `{ group }`** — the loader does
  `icon.group ?? icon`.
- **Implement `dispose()`**; icons are unloaded whenever the user switches.
- **Filenames with spaces are fine** inside a pack (verified: a background
  named `dusk sky.jpg` and a folder named `big gem` both resolve). The cache
  key and the service-worker lookup normalize identically. Do not rename to
  work around a problem you have not actually observed.

## Step 4 — validate before zipping

```bash
python3 .claude/tools/validate-pack.py my-pack/          # a folder
python3 .claude/tools/validate-pack.py my-pack.zip       # or the zip
```

Stdlib Python 3, no install. It checks the entry module, that your
`component.js` still matches the repo's copy, the manifest shape, that every
listed icon has `src/index.js` exporting both required functions, that
background paths exist in the pack, and warns about unlisted icon folders and
oversized assets. Exit 0 = clean, 1 = errors, 2 = could not open.

## Step 5 — package

macOS: right-click the pack folder → **Compress**. Windows: **Send to →
Compressed folder**. Or:

```bash
cd my-pack && zip -qr ../my-pack.zip . -x '.DS_Store'
```

Both shapes load: the viewer strips a single wrapping top-level folder (what
Finder produces) and drops `__MACOSX/`, `._*`, and `.DS_Store` entries.

The entry point must be `component.js` at the top of the pack, or exactly one
`*.component.js`. Zero or several → the page reports an error and stops.

## Step 6 — test it

```bash
python3 -m http.server 8000
```

**Two paths. They put the page in the same pack mode; only one of them
exercises the zip layer:**

1. `http://localhost:8000/?component=./my-pack/component.js` — exercises the
   loader, the manifest, every icon, framing, and backgrounds. Fast, and it
   works in an automation pane. Pack mode is identical to the zip route
   (`zipmode` set, spin slider zeroed, dropdown swapped), so what it leaves
   untested is only fflate, the `zipfs` cache, and the service worker.

2. **Dropping the real zip** — the only way to test the fflate + service
   worker + `zipfs` layer. Service workers are often blocked in headless or
   hidden automation panes (registration fails with *"An unknown error occurred
   when fetching the script"*); use a normal browser window. From a console:

   ```js
   const blob = await (await fetch('/my-pack.zip')).blob();
   const dt = new DataTransfer();
   dt.items.add(new File([blob], 'my-pack.zip', { type: 'application/zip' }));
   window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
   ```

   Then assert: `document.body.classList.contains('zipmode') === true`,
   `document.getElementById('speed').value === '0'`, `#modelSelect` holds
   `zipicon:<name>…` plus `__unloadzip__`, and
   `(await (await caches.open('zipfs')).keys()).map(r => r.url)` lists your
   files under `/zipfs/<id>/`. Only that last one is unique to this path.

   Unload it too (`⏏ Unload zip`): the dropdown, the row that had been
   selected, the spin slider, and the page's own background all come back.

Check motion deterministically rather than by waiting:

```js
const c = window.viewer.component;
c.api.update(0.5); c.api.update(0.5);   // one second
c.api.object.rotation.y;
```

Only one pack is resident at a time — loading a new zip or unloading clears the
whole `zipfs` cache.

## Step 7 — before you finish

- **Ship the zip, not the folder.** The zip is the whole point: one file, no
  server, no tools at the other end.
- **Nothing persists.** A dropped pack is gone on reload, and only one pack is
  resident at a time — loading another (or unloading) clears the whole `zipfs`
  cache (`AGENT.md` §11).
- The repo's own example pack lives as both `components/example-pack/` and
  `components/example-pack.zip` (the same content, zipped) — that is the shape
  a pack contributed back would take.
- The repo is public: keep icon names, asset filenames, colours, and comments
  generic and product-neutral.
