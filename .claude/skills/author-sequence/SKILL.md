---
name: author-sequence
description: Write, tune, validate, and verify a sequence.yml for an icon pack — the YAML file that choreographs how an icon ENTERS (3D fade/scale/rise on a wrapper, 2D copy lines with blur + wipe, a call-to-action with a glow, a row of slots), and optionally a multi-step tap-advanced FLOW that sends each icon into a slot and brings the next one in behind it, with opt-in resume. Timed in seconds with labels, stagger, and named easings, played by the viewer through a seek-driven Anime.js timeline. Use when asked to add, change, retime, or debug an entrance, copy reveal, call-to-action, collect flow, or slot row in a pack. Never for spin or camera — those are out of scope by design.
---

# Authoring a sequence

A sequence is a pack-level `sequence.yml` that stages an icon's **entrance**
and, optionally, a **flow**: tap, the icon flies into a slot and stays there,
the next icon enters behind it. It is optional, sits at the pack root, and is
named from `icons.yml`. The viewer plays it; the pack loader only reads it.
Full reference: `AGENT.md` §12. Worked, fully-commented example:
`components/example-pack/sequence.yml`.

## Step 0 — check the request fits the format

Say no (and say why) rather than approximating, if the request is any of:

- **Spin, yaw, rotation, "spins in and settles".** The icon's controller
  assigns `rotation` every frame; a sequence cannot own it and has no channel
  for it. Such motion belongs in the icon module. Two things do write rotation,
  and neither is a channel you can author: a **landing** takes the icon out of
  the update path as the flight begins and turns it to face front across the
  flight (§12.6), and a **drag** puts yaw/pitch on the icon's wrapper, tuned by
  `hit:` and `rest:` (§12.12).
- **Camera / framing.** Framing is solved at rest pose once, from the FIRST
  icon's `LAYOUT`, and never re-solved — a flow's icons all share it.
- **Keyframes** (more than `[from, to]`), a **physical spring solver**
  (`rest:` is a tween with an ease — §12.12), **background fades**, a
  **`goto <step>`** verb, **going backwards** through a flow, or restoring a
  landed 3D object across a reload. `AGENT.md` §12.13.

Everything else — an entrance, copy, a call-to-action, slots, a collect flow,
retiming — is exactly what it is for.

## Step 1 — wire it into the manifest

```yaml
# icons.yml
sequence: sequence.yml
```

A pack without the key behaves exactly as before, so adding one is safe. If
you are writing a **flow**, put the first step's icon FIRST under `icons:` —
the viewer loads that one, and anything else means a swap at load.

## Step 2 — write the entrance

Start from the example pack's file. The skeleton:

```yaml
version: 1
ease:
  swell:   &ease-swell   outCubic       # names for what curves DO
  resolve: &ease-resolve outQuart
  leave:   &ease-leave   inQuad
requires:
  icon.fade: { degrade: scale-only }    # the only capability + degrade today
stage:                                  # every target a track may name
  hud:
    slot:  { type: slots, count: 3, top: 0.14, size: 0.075, gap: 0.45 }
  icon:
    ref: current                        # a flow requires `current`
  overlay:
    line1: { type: text, top: 0.735, size: 0.05, weight: 700, tracking: 0.12 }
    line2: { type: text, top: 0.805, size: 0.05, weight: 700, tracking: 0.12 }
    cta:   { type: button, top: 0.905, size: 0.055, text: "→", color: "#9cc3ff", persist: true }
steps:
  - id: one
    icon: twist
    copy: { line1: "FIRST LINE OF COPY", line2: "SECOND LINE OF COPY" }
    timeline: &entrance
      - { id: icon-entrance, target: icon, at: 0.2, timing: { dur: 0.7, ease: *ease-swell },
          channels: { fade: [0, 1], scale: [0.52, 1] } }
      - { id: copy-resolve, target: [line1, line2], at: 0.4, stagger: 0.6,
          timing: { dur: 1.0, ease: *ease-resolve }, channels: { blur: [12, 0], wipe: [0, 1], fade: [0, 1] } }
      - label: copy-settled             # = 2.0 s, the end of the previous track
      - { id: cta-in, target: cta, at: copy-settled + 0.8, timing: { dur: 0.2, ease: *ease-swell },
          channels: { fade: [0, 1], rise: [14, 0], bloom: [0, 1] } }
    on: { cta.tap: { do: replay } }     # `replay` only = no flow, Phase 1 behaviour
    end: hold
```

Rules that produce load-time errors if broken (the status line names the
track):

| Rule | Detail |
|---|---|
| Every `target` is declared in `stage` | `icon`, or an element name under `hud`/`overlay` |
| Channels match the layer | icon: `fade scale rise` · 2D: `fade rise blur wipe bloom` |
| Values are `[from, to]` or a bare `to` | Numbers only. A bare `to` starts from the default / `initial:` value |
| `at:` is a number, `after`, or `label [+/- s]` | Labels are declared **above** the track that uses them, and scoped to their own list |
| `timing.dur` is seconds ≥ 0; `ease` is an Anime.js name, a parametrised one, a spring, or `cubic-bezier(a,b,c,d)` | `outCubic`, `outBack(0.8)`, `spring(60, 14)`, … |
| Element `type` fits the layer | hud: `slots` (`pips` is deprecated) · overlay: `text`, `button` |
| `on:` keys are `<element>.tap`; `do:` is `replay`, `nothing`, `advance`, `restart` | Only the bound element receives pointer events |
| `steps[].icon` / `stage.icon.ref` name a listed icon | or `ref: current` |
| A slot ring (`slot1`, `slot2`, …) is only a `to:` destination | It has no channels and no `initial:` state |

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

## Step 3 — turn it into a flow

**A sequence becomes a flow the moment a step's `on:` uses `advance` or
`restart`.** There is no other switch. Then:

```yaml
  - id: one
    icon: twist                        # every icon step names its icon
    timeline: *entrance
    exit:                              # what plays when this step is LEFT
      - &copy-out
        { id: copy-out, target: [line1, line2], at: 0,
          timing: { dur: 0.28, ease: *ease-leave }, channels: { fade: [1, 0], blur: [0, 10] } }
      - { id: collect, target: icon, to: slot1, at: 0.1,
          timing: { dur: 0.6, ease: *ease-swell },
          land: { mode: object, face: front, fit: 0.72, after: glyph, delay: 0.45 } }
    on: { cta.tap: { do: advance } }
    end: hold

  - id: two
    icon: gem
    overlap: 0.35                      # start THIS entrance 0.35 s before that exit ends
    copy: { line1: "A SECOND ICON", line2: "THE SAME CHOREOGRAPHY" }
    timeline: *entrance
    exit:
      - *copy-out
      - { id: collect, target: icon, to: slot2, at: 0.1,
          timing: { dur: 0.6, ease: *ease-swell }, land: { mode: glyph, fit: 0.72 } }
    on: { cta.tap: { do: advance } }
    end: hold

  - id: done                           # no `icon:` = a STATE: no icon, no copy
    timeline:
      - { id: cta-hold, target: cta, timing: { dur: 0 }, channels: { fade: 1, rise: 0, bloom: 1 } }
    on: { cta.tap: { do: restart } }
    end: hold
```

Checklist for a flow:

- **`persist: true` on the call-to-action.** Once it has arrived, every later
  step skips its tracks — it never hides, never re-animates, never moves.
  Assert its `getBoundingClientRect()` is identical before the first tap and
  at the end.
- **`overlap` is the one number to retune in review.** It lives on the
  *incoming* step and says how many seconds its entrance starts BEFORE the
  outgoing exit ends. `0` is strictly sequential.
- **`land.mode`** — `object` keeps the real 3D object in the ring (frozen,
  front-facing); `glyph` drops a flat mark and releases the object;
  `mode: object` + `after: glyph` gives the 3D motion then flattens `delay`
  seconds later, cross-faded over `land.fade` (default 0.12 s). Prefer
  `after: glyph` unless a live object in the ring is the point — a permanently
  live shader is not free.
- **`hit: { padding: 0.25 }`** widens every icon's grab zone by that fraction of
  its projected radius. Raise it when the collected objects are small enough to
  be fiddly with a thumb; a press that hits nothing rotates nothing either way.
- **`rest: { spring: true, dur: 0.5, ease: outBack(0.9) }`** is what happens when a
  dragged icon is let go. It is sequence-wide, and any step may carry its own
  `rest:` to override it. The RUNTIME owns it, so it works for an icon that
  exports no `IconController` at all; an icon that ships its own pointer
  handlers keeps owning its own rotation and its own return.
- **`fit`** is the fraction of the ring's INNER diameter the icon's visible
  extent should occupy. 0.72 reads well; measure it, don't guess.
- **The last step should have no `icon:`.** That is the end state: nothing on
  the canvas, no copy, the call-to-action still there, `do: restart`.
- **Glyphs are free.** Give an icon a `glyphs:` entry in `icons.yml` if you
  want a specific mark; otherwise the viewer renders one offscreen at preload.
  An icon whose look depends on a backdrop (deep transmission) may derive a
  faint mark — ship an image for that one.
- **Resume is opt-in and off by default.** `resume: { minutes: 60 }` stores one
  small `localStorage` record of the step and collected slots. Leave the block
  out and nothing is stored at all. Do not add it "just in case" — this is a
  public tool and a visitor's browser is not scratch space.

## Step 4 — the fade

- Icons built from `MeshStandardMaterial` / `MeshPhysicalMaterial` /
  `MeshBasicMaterial`: nothing to do — the viewer fades them itself and
  restores the material's own `transparent`/`opacity` at fade 1.
- Icons with a raw `ShaderMaterial`: add `setFade(v)` to the object returned
  by `createIconObject()` and multiply `v` into the shader's output alpha with
  `transparent: true`. The loader forwards it as `api.setFade`.
- Neither: `degrade: scale-only` drops only the fade **for that icon**; the
  console warns once per icon. The entrance then reads as a pure swell —
  obviously wrong, not broken.

## Step 5 — validate

```bash
python3 .claude/tools/validate-pack.py my-pack/
```

The sequence checks need PyYAML. If the output says
`sequence.yml was NOT validated: PyYAML is required`, run it with an
interpreter that has it (e.g. `/usr/local/bin/python3` on many Macs, or
`pip install pyyaml`). Expect `note   sequence.yml: sequence structure OK`.
Exit 1 with a named step and track on an undeclared target, a `to:` that names
nothing, an unknown landing mode or verb, a step naming an icon the pack does
not have, an unknown label, a bad ease, or a wrong channel.

## Step 6 — verify in the browser, deterministically

Serve (`python3 -m http.server 8000`) and load
`/?component=./my-pack/component.js`. Two rules before anything else:

1. **Do not wait and look.** A hidden pane never advances the render loop, so
   the icon would stay at its t=0 pose. Scrub.
2. **Serve with cache-busting headers, or hard-reload after every edit.** A
   stale `sequence.js` looks exactly like a bug in your YAML. If a change you
   just made appears to do nothing, check this before anything else:

   ```js
   performance.getEntriesByType('resource')
     .filter(e => /sequence\.js/.test(e.name)).map(e => [e.transferSize, e.encodedBodySize]);
   // transferSize 0 = served from cache
   ```

```js
const v = window.viewer, s = v.sequence, c = v.component;
await s.ready;              // preload + glyph capture (a flow)
s.pause(); s.seek(0);       // wrapper at the entrance's `from` scale, copy hidden
c.root.scale.x;             // e.g. 0.52 — the WRAPPER; c.api.object.scale is untouched
s.seek(1.0);  document.querySelector('#fg [data-seq="line1"]').style.clipPath;  // mid-wipe
s.seek(s.duration);         // the held frame — take the screenshot here
s.states;                   // every target's channel values, for assertions
```

For a flow, drive the verbs rather than clicking and hoping:

```js
const ring = () => [...document.querySelectorAll('#fg .fg-slot')].map(e => e.dataset.state);
ring();                                      // ['is-next','is-pending','is-pending']
const before = document.querySelector('#fg [data-seq="cta"]').getBoundingClientRect();
s.seek(s.duration); s.advance(); s.duration; // exit + overlapped entrance
s.seek(0.70); s.slots; ring();               // touchdown: filled, and `next` has moved
s.seek(1.15); s.slots[0].as;                 // 'glyph' — the after: swap
document.querySelector('#fg [data-seq="cta"]').getBoundingClientRect().top === before.top;  // true
s.restart(); s.step; s.time; s.slots;        // 'one', 0, [null, null, null]
```

Prove a landed object really is out of the update path — this is the whole
point of `land.mode: object`:

```js
const w = v.scene.getObjectByName('sequence-landed').children[0], o = w.children[0];
const r0 = o.rotation.y;
for (let i = 0; i < 60; i++) if (!v.component.frozen) v.component.api.update(1/60);
o.rotation.y === r0 && Math.cos(r0) > 0.9999;   // true — frozen, resting at front
```

`Math.cos(r0)`, not `r0 === 0`: the turn to rest is a continuous tween across
the flight, so it ends on 0 **modulo 2π**. Nothing is assigned at touchdown —
that assignment was the 275° snap this replaced (§12.6).

And the invariants that must survive any change:

```js
const r = c.api.object.rotation.y; s.seek(2); s.seek(0); c.api.object.rotation.y === r;   // seek never touches spin
const cam = v.camera.position.clone(); s.seek(0); cam.equals(v.camera.position);          // framing solved at rest, once
```

Persistence, if you declared `resume:`:

```js
s.storageKey;                                // 'glb-viewer:seq:<id>', or null when resume is off
const saved = localStorage.getItem(s.storageKey);
s.seek(1.4); s.play(); s.pause();
localStorage.getItem(s.storageKey) === saved;   // true — the transport must never write
// then: advance, reload, and assert s.step / s.slots come back with the entrance replaying
// then: push the stored `t` back past `minutes`, reload, assert a clean step 0
```

Check the phone layout too (emulate ~375 px wide): `top`/`size` are viewport
fractions, so copy that fits a desktop may wrap or crowd the icon on a phone,
and the ring row can end up under the viewer's own compact HUD. The `fit`
ratio should be identical at both sizes — measure it.

## Step 7 — package and hand over

Rebuild the zip (`author-icon-pack` Step 5), drop it in a **real** browser
window once, and confirm `viewer.sequence` is non-null there too. Unload
(`⏏ Unload zip`) must leave `#fg` empty, `viewer.sequence === null`, and no
`sequence-landed` Group in the scene.
