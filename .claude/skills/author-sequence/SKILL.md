---
name: author-sequence
description: Write, tune, validate, and verify a sequence.yml for an icon pack — the YAML file that choreographs how an icon ENTERS (3D fade/scale/rise on a wrapper, 2D copy lines with blur + wipe, a call-to-action with a glow, a pips HUD), timed in seconds with labels, stagger, and named easings, played by the viewer through a seek-driven Anime.js timeline. Use when asked to add, change, retime, or debug an entrance, copy reveal, or call-to-action in a pack. Never for spin, camera, or transitions — those are out of scope by design.
---

# Authoring a sequence

A sequence is a pack-level `sequence.yml` that stages an icon's **entrance**.
It is optional, sits at the pack root, and is named from `icons.yml`. The
viewer plays it; the pack loader only reads it. Full reference: `AGENT.md`
§12. Worked, fully-commented example: `components/example-pack/sequence.yml`.

## Step 0 — check the request fits the format

Say no (and say why) rather than approximating, if the request is any of:

- **Spin, yaw, rotation, "spins in and settles".** The icon's controller
  assigns `rotation` every frame; a sequence cannot own it and has no channel
  for it. Such motion belongs in the icon module.
- **Camera / framing.** Framing is solved at rest pose once, from `LAYOUT`.
- **Keyframes** (more than `[from, to]`), **springs**, **transitions between
  icons**, **`advance`/`goto` actions**, **background fades**. Phase 1 has
  none of these (`AGENT.md` §12.8).

Everything else — an entrance, copy, a call-to-action, a pips row, retiming —
is exactly what it is for.

## Step 1 — wire it into the manifest

```yaml
# icons.yml
sequence: sequence.yml
```

A pack without the key behaves exactly as before, so adding one is safe.

## Step 2 — write `sequence.yml`

Start from the example pack's file and change copy, positions, and times.
The skeleton:

```yaml
version: 1
ease:
  swell:   &ease-swell   outCubic       # names for what curves DO
  resolve: &ease-resolve outQuart
requires:
  icon.fade: { degrade: scale-only }    # the only capability + degrade today
stage:                                  # every target a track may name
  hud:
    pips:  { type: pips, top: 0.13, size: 0.018 }
  icon:
    ref: current                        # or one icon's name
  overlay:
    line1: { type: text, top: 0.735, size: 0.05, weight: 700, tracking: 0.12 }
    line2: { type: text, top: 0.805, size: 0.05, weight: 700, tracking: 0.12 }
    cta:   { type: button, top: 0.905, size: 0.055, text: "→", color: "#9cc3ff" }
initial:                                # state at frame 0 — not motion
  pips: { filled: 1, total: 3 }
steps:
  - id: intro                           # no `icon:` = the default for every icon
    copy: { line1: "FIRST LINE OF COPY", line2: "SECOND LINE OF COPY" }
    timeline: &entrance
      - { id: icon-entrance, target: icon, at: 0.2, timing: { dur: 0.7, ease: *ease-swell },
          channels: { fade: [0, 1], scale: [0.52, 1] } }
      - { id: copy-resolve, target: [line1, line2], at: 0.4, stagger: 0.6,
          timing: { dur: 1.0, ease: *ease-resolve }, channels: { blur: [12, 0], wipe: [0, 1], fade: [0, 1] } }
      - label: copy-settled             # = 2.0 s, the end of the previous track
      - { id: cta-in, target: cta, at: copy-settled + 0.8, timing: { dur: 0.2, ease: *ease-swell },
          channels: { fade: [0, 1], rise: [14, 0], bloom: [0, 1] } }
    on: { cta.tap: { do: replay } }     # verbs: replay, nothing
    end: hold
```

Rules that produce load-time errors if broken (the status line names the
track):

| Rule | Detail |
|---|---|
| Every `target` is declared in `stage` | `icon`, or an element name under `hud`/`overlay` |
| Channels match the layer | icon: `fade scale rise` · 2D: `fade rise blur wipe bloom` |
| Values are `[from, to]` or a bare `to` | Numbers only. A bare `to` starts from the default / `initial:` value |
| `at:` is a number, `after`, or `label [+|- s]` | Labels are declared **above** the track that uses them |
| `timing.dur` is seconds ≥ 0; `ease` is an Anime.js name or `cubic-bezier(a,b,c,d)` | `outCubic`, `inOutQuart`, `outBack`, … |
| Element `type` fits the layer | hud: `pips` · overlay: `text`, `button` |
| `on:` keys are `<element>.tap`; `do:` is `replay` or `nothing` | Only the bound element receives pointer events |
| `steps[].icon` / `stage.icon.ref` name a listed icon | or `ref: current` |

Positioning: `top`/`left` are viewport fractions of the element's **center**
(default `left: 0.5`); `size` is font size as a fraction of the viewport's
**shorter side** (`vmin`), so a line sized for a landscape desktop does not
wrap into its neighbour on a portrait phone.
Text is real DOM — keep copy generic and product-neutral in anything that
lands in this public repo (`FIRST LINE OF COPY`, not a client's tagline).

Two things to carry into every file:

- **One gesture = one track.** A simultaneous fade + scale shares one
  `timing:`. Two lines that are "identical but staggered" are one track with
  `stagger:`, not two tracks. This is what stops a review edit from
  desyncing them.
- **The blur + wipe reveal is a stated guess** at the mechanism. Keep the
  comment that says so; a research track is deciding the final look.

## Step 3 — the fade

- Icons built from `MeshStandardMaterial` / `MeshPhysicalMaterial` /
  `MeshBasicMaterial`: nothing to do — the viewer fades them itself and
  restores the material's own `transparent`/`opacity` at fade 1.
- Icons with a raw `ShaderMaterial`: add `setFade(v)` to the object returned
  by `createIconObject()` and multiply `v` into the shader's output alpha with
  `transparent: true`. The loader forwards it as `api.setFade`.
- Neither: `degrade: scale-only` drops only the fade; the console warns once.
  The entrance then reads as a pure swell — obviously wrong, not broken.

## Step 4 — validate

```bash
python3 .claude/tools/validate-pack.py my-pack/
```

The sequence checks need PyYAML. If the output says
`sequence.yml was NOT validated: PyYAML is required`, run it with an
interpreter that has it (e.g. `/usr/local/bin/python3` on many Macs, or
`pip install pyyaml`). Expect `note   sequence.yml: sequence structure OK`.
Exit 1 with a named track on an undeclared target, unknown label, bad ease,
or wrong channel.

## Step 5 — verify in the browser, deterministically

Serve (`python3 -m http.server 8000`) and load
`/?component=./my-pack/component.js`. **Do not wait and look** — a hidden pane
never advances the render loop, so the icon would stay at its t=0 pose. Scrub:

```js
const v = window.viewer, s = v.sequence, c = v.component;
s.duration;                 // your last track's end
s.pause(); s.seek(0);       // wrapper at the entrance's `from` scale, copy hidden, pips present
c.root.scale.x;             // e.g. 0.52 — the WRAPPER; c.api.object.scale is untouched
s.seek(1.0);  document.querySelector('#fg [data-seq="line1"]').style.clipPath;  // mid-wipe
s.seek(s.duration);         // the held frame — take the screenshot here
s.states;                   // every target's channel values, for assertions
```

Then prove the two invariants:

```js
const r = c.api.object.rotation.y; s.seek(2); s.seek(0); c.api.object.rotation.y === r;   // seek never touches spin
c.api.update(1.0);                                                                        // only the controller does
const cam = v.camera.position.clone(); s.seek(0); cam.equals(v.camera.position);          // framing solved at rest, once
```

Check the phone layout too (emulate ~375 px wide): `top`/`size` are viewport
fractions, so copy that fits a desktop may wrap or crowd the icon on a phone.
The HUD transport (▶/⏸ + slider) is there for design review; drag it to any
time and compare against the reference.

## Step 6 — package and hand over

Rebuild the zip (`author-icon-pack` Step 5), drop it in a **real** browser
window once, and confirm `viewer.sequence` is non-null there too. Unload
(`⏏ Unload zip`) must leave `#fg` empty and `viewer.sequence === null`.
