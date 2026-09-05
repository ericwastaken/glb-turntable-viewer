---
name: author-icon-pack
description: Build, validate, and test an icon-pack ZIP for this viewer — the icons.yml manifest (including the optional sequence and glyphs keys), the standard per-icon exports (createIconObject / loadIconGeometry / loadIconTextures / IconController / LAYOUT / setFade), packaging, and the zipfs service-worker path. Use when asked to create, fix, extend, or validate a pack or the zip drag-drop workflow. For the choreography file itself, use author-sequence.
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
├── icons.yml
├── sequence.yml        ← optional choreography (author-sequence skill, AGENT.md §12)
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
in `icons.yml` and the per-icon modules. If you find yourself wanting to edit
it, the change belongs in your icon module: `validate-pack.py` compares your
copy against the repo's and reports a drifted copy as an error, so an edited
copy will not validate (`AGENT.md` §14).

## Step 2 — write `icons.yml`

```yaml
# YAML: comments allowed, no trailing-comma trouble.
icons:
  - nameA
  - nameB
background: backgrounds/dusk.jpg
backgrounds:
  nameB: "#05061a"
glyphs:
  nameA: glyphs/a.png         # optional — a 2D mark a sequence drops into a slot
sequence: sequence.yml        # optional — see the author-sequence skill
loading:                      # optional — the viewer's loading curtain
  ground: "#0b0d16"           #   a CSS colour for the layer
  image: loading/mark.png     #   optional, centred, must be inside the pack
  animation: pulse            #   pulse (default) | none
  slowAfter: 15               #   seconds before it says the link is slow
  failAfter: 45               #   seconds before it gives up and names the resource
```

(`icons.json` with the same keys is **deprecated** — it still loads with a
console warning and will be unsupported in a future version. Rename it to
`icons.yml`; the JSON is already valid YAML.)

- `icons` — **required**, non-empty, and it is what drives the dropdown. A
  folder under `icons/` that is not listed here is silently ignored. **Order
  matters if the pack's sequence is a multi-step flow**: the viewer loads the
  first icon listed, so put the flow's opening icon first.
- `background` — optional, pack-wide. A path inside the zip **or** a CSS
  colour. The loader treats a value as a colour when it matches
  `/^(#|rgb|hsl)/i` or is a single all-alpha word (`"black"`); everything else
  is resolved as a path relative to `component.js`.
- `backgrounds` — optional per-icon overrides, same value rules, falling back
  to `background`.
- `loading` — the viewer's **loading curtain**: the opaque layer up from the
  first paint that comes down the moment your pack's first step can draw,
  **backdrop included**.
  - Appearance: `ground` is a CSS colour, `image` a path inside the pack
    (centred and contained), `animation` is `pulse` (the default) or `none`.
  - Patience, in seconds: `slowAfter` (default 15) and `failAfter` (default
    45). Every read in the load path is on them — your manifest, your sequence
    file, each icon module, each icon's own asset loaders, and your backdrop.
    Past `slowAfter` the curtain names what it is waiting on; past `failAfter`
    it names it as failed and offers Retry. `slowAfter` must be less than
    `failAfter`; `validate-pack.py` checks it.
  - Deliberately no spinner and no percentage. It reports a **count** —
    "Loading 3 of 6 — icons/gem/src/index.js" — because that is a number the
    viewer has. Only your first step's icon and your backdrop are in that
    count; the rest of the pack is fetched after the curtain lifts.
  - A pack that leaves the key out gets the viewer's own quiet default
    (`AGENT.md` §7).
  - **Order `icons:` so the flow's first step is first.** It is now the only
    icon fetched before the curtain can lift, so getting it wrong costs a
    round trip that used to be hidden by preloading everything at once.
- `glyphs` — optional per-icon 2D mark: always a path inside the pack (never a
  colour), resolved relative to `component.js` and forwarded to the icon as
  `api.glyph`. A sequence shows it in a slot once that icon has been collected
  (`AGENT.md` §12.6). An icon with no entry gets a mark **derived** by the
  viewer — rendered offscreen at preload — so this key is never required.
- `sequence` — optional path (relative to `component.js`) of a `sequence.yml`
  that choreographs each icon's entrance, and optionally a tap-advanced flow.
  The loader fetches and parses it and hands it to every icon as
  `api.sequence`; the viewer plays it. Leave the key out and nothing changes.
  Author the file with the `author-sequence` skill.

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
- **If the pack has a sequence and your icon uses a raw `ShaderMaterial`, add
  `setFade(v)`** (0–1) to the returned object and multiply `v` into your
  output alpha with `transparent: true`. The loader forwards it as
  `api.setFade`. Standard materials need nothing — the viewer fades them
  itself; with neither, the fade channel is dropped and the console warns once.
- **Never write `rotation` from a sequence, and do not expect one to.** Your
  controller owns spin; the sequence animates a wrapper Group around your
  object (`AGENT.md` §12).
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
background and glyph paths exist in the pack, and warns about unlisted icon
folders and oversized assets. With a `sequence:` key it also checks the file
exists and validates its structure — slots, `to:`/`land:` targets and modes,
the `advance`/`restart` verbs, every step's `icon:`, and `resume:`. That part
needs PyYAML (`pip install pyyaml`, or run it with an interpreter that has
it); without PyYAML it warns and skips only the sequence. Exit 0 = clean,
1 = errors, 2 = could not open.

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

If the pack has a sequence, the icon starts at its t=0 pose (faded out, 48 %
scale in the example) and a hidden pane never advances it — scrub instead:
`window.viewer.sequence.seek(3.0)` shows the held final frame (`AGENT.md`
§12.11 has the full checklist). If the sequence is a flow, `await
viewer.sequence.ready` first (it preloads every icon and captures its glyph —
and it does not *start* until the first draw is painted, so awaiting it is now
the only reliable way to know the whole pack is in), then drive it with
`viewer.sequence.advance()` / `.restart()`.

If a load ever seems to hang, do not guess at it: `viewer.load.log` names every
phase with its wall time, `viewer.load.failed` names the resource that did not
arrive, and `viewer.curtain.message` is the exact text a visitor is looking at.
`?dev=1` prints the same phase log to the console as it happens.

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
