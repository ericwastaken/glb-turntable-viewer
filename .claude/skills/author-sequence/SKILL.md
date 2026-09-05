---
name: author-sequence
description: Write, tune, validate, and verify a sequence.yml for an icon pack — the YAML file that choreographs how an icon ENTERS (3D fade/scale/rise on a wrapper, 2D copy lines with blur + wipe, a call-to-action with a glow, a row of slots), and optionally a multi-step tap- or swipe-advanced FLOW that sends each icon into a slot and brings the next one in behind it, with opt-in resume. Also declares what a finger may do (input: zoom/drag/swipe), the orientation the piece was composed for (an advisory rotation prompt), and per-element portrait sizing. Timed in seconds with labels, stagger, and named easings, played by the viewer through a seek-driven Anime.js timeline. Use when asked to add, change, retime, or debug an entrance, copy reveal, call-to-action, collect flow, slot row, swipe, rotation lock, or phone layout in a pack. Never for spin or camera moves — those are out of scope by design.
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
  landed 3D object across a reload. `AGENT.md` §12.16.
- **"Force the phone into portrait."** No web page can turn a device;
  `screen.orientation.lock()` needs fullscreen and does not exist in mobile
  Safari. `orientation:` (§12.14) prompts — curtain, rotate glyph, sequence
  held — and that is the honest ceiling. Say so rather than implying more.
- **"Work out the phone sizes for me."** `portrait:` (§12.15) takes the numbers
  a designer chose. There is deliberately no derived correction factor.

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
input:                                  # what a finger may do (§12.13). These
  zoom: false                           # ARE the defaults — write them to be read
  drag: icon                            # icon | camera | none
  swipe: up                             # up | none — fires the step's own CTA
orientation: any                        # portrait | landscape | any (§12.14)
stage:                                  # every target a track may name
  hud:
    slot:  { type: slots, count: 3, top: 0.14, size: 0.075, gap: 0.45,
             portrait: { size: 0.12, top: 0.11 } }     # §12.15
  icon:
    ref: current                        # a flow requires `current`
  overlay:
    line1: { type: text, top: 0.735, size: 0.05, weight: 700, tracking: 0.12 }
    line2: { type: text, top: 0.805, size: 0.05, weight: 700, tracking: 0.12 }
    cta:   { type: button, top: 0.905, size: 0.055, text: "→", color: "#9cc3ff", persist: false,
             portrait: { size: 0.085, top: 0.88 } }
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

- **`persist:` picks one of two models for a recurring element.** It is
  declared ONCE in `stage:`, while its animation usually lives in the shared
  entrance every step reuses — so this one flag decides which way it behaves:
  - `persist: true` — arrives once, then every later step skips its tracks. It
    never hides, never re-animates, never moves. Assert its
    `getBoundingClientRect()` is identical before the first tap and at the end.
  - `persist: false` — its tracks play in EVERY step, so it can leave in the
    exit and return with the next entrance. Put a fade-out in the shared `exit:`
    and let the existing entrance track bring it back; the element still never
    MOVES, so the tap target is stable even though it fades. Assert opacity
    reaches 0 during the transition and 1 again after the next step settles,
    with the rect unchanged throughout.
- **Author with `?dev=1`.** It re-fetches the sequence runtime on every load and
  ignores the pack's saved `resume:` step, so a reload shows your latest edit
  from the start rather than yesterday's module resuming into step 3. Your
  `sequence.yml` and `icons.yml` are never cached either way. If you are editing
  the VIEWER rather than a pack, serve it with the `viewer-dev` launch config —
  only a no-store server reaches `index.html` and `vendor/`.
- **`start: reset` is the default, and you usually want it.** An icon's
  controller accumulates yaw for the life of the pack and assigns rotation every
  frame, so `start: continue` means an icon shown a second time snaps back on its
  first frame to wherever it had spun to. Test it by asserting rotation ONE FRAME
  after a restart, not just immediately — immediately is always 0, and the jump
  is on the next frame.
- **Quote label expressions.** `at:` takes a number, `after`, or a
  `"label ± seconds"` string. Write the string form quoted — YAML turns a bare
  label named `on`/`off`/`yes`/`no` into a boolean, and an editor will otherwise
  infer a number-only schema for `at:` and flag the string as a type error.
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

## Step 3b — input, orientation, and the phone layout

Three declarations, all optional, all with sane defaults. Write them when they
matter and leave them out when they do not.

- **`input:`** (§12.13) — `zoom` (default **false**: a pack composes a fixed
  frame, and a camera dolly is not part of it), `drag` (`icon` / `camera` /
  `none`), `swipe` (`up` / `none`, or the long form
  `{ dir, ratio, distance, time }`). Any step may override any of it.
  A swipe fires the **same verb** the call-to-action's tap does, through the
  same guard, and only when one is actually live — so a swipe mid-transition or
  on a step with no `advance` does nothing. Do not invent a second gesture
  binding; there is exactly one.
- **`orientation:`** (§12.14) — `portrait`, `landscape`, or `any` (default).
  On a mismatch the viewer curtains the stage, shows a rotate glyph and HOLDS
  the sequence; it resumes at the same time and step. **Advisory only.** Decide
  by aspect ratio is the viewer's job, not yours; you only declare the intent.
  A pack meant to be shown in a desktop window should say `any` (or say
  nothing) — a `portrait` declaration will curtain a laptop.
- **`portrait:`** (§12.15) — per element, overriding `top`, `left`, `size`,
  `gap`, `ring`, `weight`, `tracking` when the stage is taller than wide.
  Needed because overlay type is sized in vmin while the icon is framed against
  stage height: identical at 1280x800, **2.2x apart** at 375x812. Leave text
  sizes alone by default and move their `top` instead — wrapping, not height,
  is what constrains a line of copy.

Review all three with **`?dev=mobile`** (§4), which gives a phone-sized
letterboxed stage in a desktop window, a button to flip its orientation, and
the wheel mapped onto the swipe gesture. It drives the same accessor a real
device does, so what you see is what a phone does.

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
not have, an unknown label, a bad ease, a wrong channel, an `input.drag` /
`input.swipe` / `orientation` value the viewer does not know, or a `portrait:`
key that is not a placement key.

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
await s.ready;              // preload + glyph capture (a flow). It does not even
                            // START until the first draw is painted (AGENT.md §12.7),
                            // so await it before asserting anything pack-wide.
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

`advance()` is asynchronous when the icon it needs is not in yet — the pack's
later icons are fetched only after the first draw (`AGENT.md` §7). If it seems
to do nothing, read `v.curtain`: a hold shows `{ up: true, state: 'loading',
message: 'Loading gem…' }` and the step advances the moment the icon arrives.
`await s.ready` before a scripted flow check and the question does not arise.

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

Input, orientation and the phone layout — load with `?dev=1,mobile`:

```js
const v = window.viewer, s = v.sequence;
s.input;                                     // the policy resolved for the step showing now
[v.controls.enableZoom, v.controls.enableRotate];
v.stage;                                     // what the app is composing against
v.devStage.size; v.devStage.flip();          // flip the simulated orientation
v.orientation;                               // { stage, want, held }
v.curtain;                                   // { up, reason, state, message }
v.load.failed; v.load.limits; v.load.log;    // the load monitor (AGENT.md §8)
// a rotation lock must FREEZE, not skip:
v.devStage.flip(); const t = s.time;
// …wait several seconds…
[s.playing, s.time === t];                   // [false, true]
v.devStage.flip(); s.time === t;             // true — it resumes where it stopped
// portrait sizing, A/B at the same --vmin:
document.querySelector('#fg .fg-slot').getBoundingClientRect().width;
```

Check the phone layout at ~375 px wide either way: `top`/`size` are stage
fractions, so copy that fits a desktop may wrap or crowd the icon on a phone,
and the ring row can end up under the viewer's own compact HUD. The `fit`
ratio should be identical at both sizes — measure it. Measure with
`viewer.stage`, never `innerWidth`/`innerHeight` (§10.14).

## Step 7 — package and hand over

Rebuild the zip (`author-icon-pack` Step 5), drop it in a **real** browser
window once, and confirm `viewer.sequence` is non-null there too. Unload
(`⏏ Unload zip`) must leave `#fg` empty, `viewer.sequence === null`, and no
`sequence-landed` Group in the scene.
