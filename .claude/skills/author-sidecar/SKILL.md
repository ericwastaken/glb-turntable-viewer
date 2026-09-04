---
name: author-sidecar
description: Write, apply, and verify a sidecar JSON for this viewer — per-mesh MeshPhysicalMaterial overrides (glass, transmission, metal, iridescence) applied on top of a model's exported materials, without re-exporting the model. Use when asked to restyle, recolour, or fix the look of a GLB, or when a sidecar lints wrong or appears to do nothing.
---

# Authoring a sidecar

A sidecar is a small JSON file of material overrides applied on top of whatever
the GLB already ships. It is the cheapest way to change a look: no re-export,
no code, no build step. Reach for a component (`author-component`) only when a
standard three.js material genuinely cannot express what you want.

Reference: `AGENT.md` §5. Working example:
`sidecars/example-emerald-glass.json`. Consumer code: `buildMaterial()`,
`prepareSidecar()`, and `lintSidecar()` in `index.html`.

## Step 1 — get the mesh names, do not guess them

Sidecar keys are **mesh names**, and a name that matches nothing is a silent
no-op. Serve the page (`python3 -m http.server 8000`), load the model, and ask:

```js
const names = []; window.viewer.model.traverse(o => o.isMesh && names.push(o.name)); names;
```

Faster alternative with no console: load the model, click **Sidecar…** with no
sidecar loaded, and the editor opens on a **skeleton generated from the current
model** — `"*"` with starter properties, then every mesh listed by name as an
empty placeholder, ready to fill in. Start from that skeleton rather than
typing names by hand.

## Step 2 — write the file

```json
{
  "_comment": "Anything under a key starting with _ is a comment, at any level.",
  "materials": {
    "Dragon": {
      "color": "#7fe0b0", "metalness": 0, "roughness": 0.06,
      "transmission": 0.95, "thickness": 2.0, "ior": 1.5,
      "attenuationColor": "#118f5a", "attenuationDistance": 1.6,
      "clearcoat": 1.0, "clearcoatRoughness": 0.1
    },
    "*": { "color": "#ffb04d", "metalness": 0.9, "roughness": 0.25 }
  }
}
```

- `materials` is the **only** root key that does anything; anything else warns.
- Keys inside it are mesh names, plus `"*"` — the fallback for every mesh with
  no non-empty entry of its own.
- Values are `MeshPhysicalMaterial` properties.
  [three.js docs → MeshPhysicalMaterial](https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial)
  is the reference; the page's **three.js docs** button opens it.
- A named entry containing **only** comment keys is a deliberate no-op
  placeholder: it documents the mesh without overriding it, and `"*"` then
  applies to that mesh.
- `buildMaterial()` builds a **fresh `MeshPhysicalMaterial`** per mesh. It does
  not merge with the exported material — anything you leave out gets the
  three.js default, not the model's exported value. Texture maps from the GLB
  are **not** carried over.
- Five properties are wrapped in `new THREE.Color(v)`: `color`,
  `attenuationColor`, `emissive`, `sheenColor`, `specularColor`.

Rules that are easy to get wrong:

- **Colours must be hex strings** (`"#7fe0b0"` or `"#7fe"`) or numbers. A CSS
  colour name like `"red"` is a lint **error** and blocks Apply, even though
  three.js itself would accept it. Use the hex.
- **Glass needs more than `transmission`.** A convincing glass look wants
  `transmission` plus `thickness`, `ior`, and usually low `roughness`;
  `attenuationColor` + `attenuationDistance` are what tint the interior.
- **`metalness: 0.9` and `transmission: 0.95` fight each other.** Pick one
  story per mesh — metal or glass.
- Property names are case-sensitive three.js names: `clearcoatRoughness`, not
  `clearCoatRoughness`.

## Step 3 — load it

Four routes, all equivalent once loaded:

- `?sidecar=sidecars/your-file.json` on the viewer URL — combine it with
  `?model=` (see `AGENT.md` §4).
- Multi-select the model and the `.json` together in the **Load…** dialog.
- Drag-drop the `.json` onto the page, with the model or on its own.
- Paste it into the **Sidecar…** editor and press **Apply**.

Any filename works — the sidecar is never inferred from the model's name, and
one sidecar can serve several models. It is **sticky**: it stays loaded across
model switches and is re-matched against each new model's meshes.

## Step 4 — read the linter honestly

`lintSidecar()` runs live in the editor and gates **Apply** on there being no
`error`-level messages. Two kinds of message, and the difference matters:

- **Errors block Apply**: invalid JSON, a non-object root, a missing
  `materials` object, a target that is not an object, a colour that is not a
  hex string or number, a number property given a non-number, a boolean given a
  non-boolean.
- **Warnings never block, and two of them are routinely fine**:
  - *"is not a known MeshPhysicalMaterial property"* — `PROP_TYPES` is a
    hand-written allowlist of **28** properties and is smaller than
    `MeshPhysicalMaterial`. A real three.js property missing from that table
    warns and **still applies at runtime**, because `buildMaterial()` only
    checks `k in m`. Confirm it took effect (step 5) rather than assuming the
    warning means failure.
  - *"doesn't match any mesh in the current model"* — expected if the sidecar
    is written for a different model than the one currently on screen. The
    message lists the model's actual mesh names; use them.
  - *"is usually between 0 and 1"* — a range hint on a `unit` property, not a
    rejection.

Mesh-name checking only happens when a model is loaded; with no model, every
name passes.

## Step 5 — verify it actually applied

The status line tells you the outcome:

```js
document.getElementById('status').textContent;
// "… • sidecar <name> ON"                     — applied
// "… • sidecar <name> off (as exported)"      — loaded, checkbox unticked
// "… • sidecar <name> matches no meshes"      — your names are wrong
```

Then read the materials off the live model:

```js
const out = [];
window.viewer.model.traverse(o => o.isMesh && out.push(
  [o.name, o.material.type, '#' + o.material.color.getHexString(),
   o.material.transmission, o.material.metalness, o.material.roughness]));
out;
```

Every overridden mesh should read `MeshPhysicalMaterial` with your values. The
**Apply sidecar settings** checkbox toggles between as-exported and sidecar
materials, which is the quickest visual A/B.

Do not judge a sidecar from a screenshot alone in a hidden or headless pane —
see the `verify-in-browser` skill; the viewport there can be `0×0`.

## Step 6 — before you finish

- The in-page editor has **no save**. Nothing persists across a reload: copy
  the JSON out of the editor into a real `.json` file, or the work is lost.
- To hand it to someone, send the `.json` file, or a URL carrying both
  `?model=` and `?sidecar=` so they land on exactly what you saw.
- Keep it product-neutral if it ships with this repo — the repo is public.
