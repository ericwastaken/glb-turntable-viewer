---
name: verify-in-browser
description: Serve this static viewer and confirm something actually works in a real browser — including how to test animation and pack sequences deterministically (a hidden or headless pane pauses requestAnimationFrame and makes working code look broken), how to measure against the app's stage rather than the window, and how to exercise a phone layout, a swipe and a rotation lock from a desktop with ?dev=mobile. Use before claiming that a component, sidecar, icon pack, sequence, or URL you put together is done.
---

# Verifying it in the browser

There are **no automated tests** in this repo. You verify by serving the page
and inspecting it. Do not report your component, sidecar, or pack as working on
the strength of a code read.

## 1. Serve it

The app is fully static, but **it will not run from `file://`** — ES modules,
the import map, and the service worker all require HTTP.

```bash
cd <repo root>
python3 -m http.server 8000     # http://localhost:8000
```

`.claude/launch.json` declares the same thing as the `viewer` configuration for
harnesses that read launch configs.

**If you are editing the app itself, serve with cache-busting headers.**
`http.server` sends `Last-Modified` and the browser will happily keep serving a
stale `sequence.js` or `index.html` across reloads — which looks exactly like a
bug in the change you just made, and has cost a session an hour:

```python
# python3 serve.py  — same folder, but nothing is cached
import http.server, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', 8000), H).serve_forever()
```

Confirm which build is actually running before you debug anything:

```js
performance.getEntriesByType('resource')
  .filter(e => /sequence\.js/.test(e.name)).map(e => [e.transferSize, e.encodedBodySize]);
// transferSize 0 = served from cache
```

## 2. Load the route that exercises what you made

| URL | Covers |
|---|---|
| `/` | Boot, default model, default starfield |
| `/?model=models/DamagedHelmet.glb` | Model loading by path |
| `/?model=models/DragonAttenuation.glb&sidecar=sidecars/example-emerald-glass.json` | Sidecar match + apply |
| `/?component=./components/example-shader-orb.js` | Single-file component |
| `/?component=./components/example-pack/component.js` | Pack loader + pack mode + the example sequence, without the zip layer |
| `/?pivot=0,0.5,0` | Manual spin axis |
| `/?bg=backgrounds/starfield-default.jpg` | Background by path |
| `/?component=./components/example-pack/component.js&dev=1,mobile` | The same pack on an emulated 375x812 phone stage: portrait sizing, swipe (wheel-driven), rotation lock |
| `…&orientation=any` | Overrides a pack's `orientation:` so a locked pack can be reviewed the other way up |

There is **no URL that loads a zip** — see step 5 below. The full parameter
table, with constraints, is `AGENT.md` §4.

## 3. Inspect via `window.viewer`

Defined at the bottom of `index.html`:

```js
window.viewer = { THREE, scene, camera, renderer, pivot, controls,
                  get model(), get component(), get sequence(),
                  stage,                  // { w, h, left, top, portrait, orientation, emulated }
                  get curtain(),          // { up, reason, state, message }
                  get orientation(),      // { stage, want, held }
                  get load(), retry(),    // the load monitor; press its Retry
                  devStage };             // ?dev=mobile only: .size, .flip(), .set(w, h)
```

**Measure against `viewer.stage`, never `innerWidth`/`innerHeight`.** The app
composes against a stage element — the whole window normally, a letterboxed
phone box under `?dev=mobile` — and every projection in the code is in stage
coordinates. A `getBoundingClientRect()` is in WINDOW coordinates, so a check
that mixes the two is wrong by the letterbox offset:
`clientX - viewer.stage.left`. (In a hidden pane `innerWidth`/`innerHeight` are
`0` as well.)

`viewer.component` is `{ name, api, kind, root, seq }` — `kind` is `'object'`
or `'material'`, `api` is literally what `createComponent()` returned, `root`
is what sits under the pivot (the object, or the wrapper Group a sequence
animates), and `seq` (also `viewer.sequence`) is the running sequence or `null`.

```js
const c = window.viewer.component;
c.kind;                    // 'object'
Object.keys(c.api);        // ['object','framing','update','dispose']
c.api.framing;             // { heightFraction: 0.4, verticalCenter: 0.45 }
```

Sidecar applied correctly? (See also the `author-sidecar` skill.)

```js
const out = [];
window.viewer.model.traverse(o => o.isMesh && out.push(
  [o.name, o.material.type, '#' + o.material.color.getHexString(), o.material.transmission]));
out;
```

## 4. Test motion DETERMINISTICALLY — the biggest trap

**A hidden or headless browser pane pauses `requestAnimationFrame` and
throttles timers.** `renderer.setAnimationLoop` never fires. So this pattern
lies:

```js
// ❌ reads 0 from perfectly working code when document.hidden === true
await new Promise(r => setTimeout(r, 2000));
window.viewer.pivot.rotation.y;
```

Confirmed in this repo: with `document.hidden === true`, two seconds of wall
clock left `pivot.rotation.y === 0`, while calling `update(1.0)` directly moved
the component's time uniform by exactly `1.0`.

Drive the frame callback yourself instead:

```js
// ✅ deterministic, works whether or not the pane is visible
const c = window.viewer.component;
c.api.update(0.5);
c.api.update(0.5);          // exactly one simulated second
c.api.object.rotation.y;    // e.g. 0.8 for a controller doing t * 0.8
```

The same applies to `mixer` playback and anything else the render loop drives.
If you must confirm the loop itself runs, do it in a visible window.

### Pack sequences: scrub, don't wait

A pack with a `sequence.yml` starts at its t=0 pose — typically the icon faded
out and small, no copy yet — and only the render loop advances it. In a hidden
pane that pose *stays*, which looks like "the icon never appeared". Drive it:

```js
const v = window.viewer, s = v.sequence, c = v.component;   // s is null without a sequence
await s.ready;                                  // preload + glyph capture, in a flow.
                                                // It only STARTS once the first draw is
                                                // painted, so this is the one honest
                                                // "the whole pack is in" signal.
s.duration;                                     // e.g. 3 — the CURRENT phase
s.pause(); s.seek(0);
c.root.scale.x;                                 // 0.52 — the wrapper Group, not the icon
c.api.object.material.opacity;                  // 0 (fallback fade on a standard material)
[...document.querySelectorAll('#fg .fg-slot')].map(e => e.dataset.state);
// ['is-next', 'is-pending', 'is-pending']
s.seek(1.0);
document.querySelector('#fg [data-seq="line1"]').style.clipPath; // mid-wipe, e.g. 'inset(0px 2.56% 0px 0px)'
s.seek(3.0);
document.querySelector('#fg [data-seq="cta"]').style.opacity;    // '1'
s.seek(10); s.time;                             // 3 — `end: hold`
```

**A flow** (a step whose `on:` uses `advance`) is driven, not clicked and
hoped at. `s.duration` is the current phase, so it changes as you go:

```js
s.flow;                                    // true
s.advance();  s.step; s.phase; s.duration; // 'two', 'transition', 3.35
s.seek(0.70); s.slots;                     // [{icon:'twist', as:'object'}, null, null] — touchdown
s.seek(1.15); s.slots[0].as;               // 'glyph' — the `after:` swap
s.restart();  s.step; s.time; s.slots;     // 'one', 0, [null, null, null]
// a landed icon must be OUT of the update path:
const w = v.scene.getObjectByName('sequence-landed').children[0], o = w.children[0];
const r0 = o.rotation.y;
for (let i = 0; i < 60; i++) if (!v.component.frozen) v.component.api.update(1/60);
o.rotation.y === r0 && Math.cos(r0) > 0.9999;   // true — frozen, facing front.
// Math.cos, NOT `=== 0`: the turn to rest is tweened across the flight, so it
// ends on 0 modulo 2*pi and nothing is assigned at touchdown (AGENT.md §12.6).
// the call-to-action must never move:
document.querySelector('#fg [data-seq="cta"]').getBoundingClientRect();  // identical before and after
// and the transport must never write persisted state:
const saved = localStorage.getItem(s.storageKey);
s.seek(1.4); s.play(); s.pause();
localStorage.getItem(s.storageKey) === saved;   // true
```

`s.storageKey` is `null` unless the pack declared `resume:` — a pack that did
not ask for persistence must leave `localStorage` completely empty.

### A landed object must stay in its ring — zoom, resize, orientation

**Always run this after touching anything in the sequence runtime or the
sequence host.** The rings are DOM elements fixed to the *viewport*; a landed
object is in the 3D *world*. Anything that changes the projection separates the
two unless the object's world position and its fit are re-solved from the ring's
current rect **every frame** (AGENT.md §12.6). It is silent when it breaks: the
object simply drifts out and the ring renders empty, and the very first wheel
click is enough (measured on the one-time landing this replaced: `[0, -17.13]` px
and the fit off by 6% after a single click).

```js
const v = window.viewer, s = v.sequence;
const w = v.scene.getObjectByName('sequence-landed').children[0];   // a landed icon
const ring = document.querySelectorAll('#fg .fg-slot')[0];
const probe = () => {                       // screen offset from the ring's centre
  const r = ring.getBoundingClientRect();
  const p = w.getWorldPosition(new v.THREE.Vector3()).project(v.camera);
  return [(p.x * .5 + .5) * innerWidth  - (r.left + r.width  / 2),
          (-p.y * .5 + .5) * innerHeight - (r.top  + r.height / 2)].map(n => +n.toFixed(2));
};
const zoom = dy => { for (let i = 0; i < 4; i++) v.renderer.domElement.dispatchEvent(
  new WheelEvent('wheel', { deltaY: dy, clientX: innerWidth/2, clientY: innerHeight/2, bubbles: true }));
  v.controls.update(); s.seek(s.time); };

probe();                                    // [0, 0]
zoom(-120);  probe();                        // [0, 0] — zoomed in
zoom(240);   probe();                        // [0, 0] — and out
// then resize the window, and emulate a portrait phone, and probe again: [0, 0]
```

Check the **fit ratio** with it — the object's projected diameter over the
ring's inner diameter must stay at whatever `land.fit` says (0.72 in the example
pack) at every viewport and every zoom, not just its position. A wrong scale
looks almost right and is the half of this that a screenshot will not catch.

### Pointer routing, and spring-back

Drags are hit-tested while a sequence is live (AGENT.md §12.12), and both
spring-back and the per-frame ring anchoring run off the render loop's `dt` —
which a hidden pane does not deliver. Drive the frame yourself, in the render
loop's own order:

```js
const v = window.viewer, s = v.sequence;
const frame = (dt = 1/60, n = 1) => { for (let i = 0; i < n; i++) {
  if (!v.component.frozen) v.component.api.update(dt);      // the pack, first
  v.component.seq.update(dt);                               // then the sequence
} };
const cv = v.renderer.domElement;
const drag = (x, y, dx, dy, st = 6) => {
  cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, clientX: x, clientY: y, bubbles: true }));
  for (let i = 1; i <= st; i++) cv.dispatchEvent(new PointerEvent('pointermove',
    { pointerId: 7, clientX: x + dx*i/st, clientY: y + dy*i/st, bubbles: true }));
  cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: x + dx, clientY: y + dy, bubbles: true }));
};

drag(innerWidth/2, innerHeight*0.45, 200, 0);   // the big icon
s.turns;                     // { gem: { yaw: 1.5708, … } } — and NOTHING else moved
frame(1/60, 40);  s.turns;   // back to yaw 0 after the authored `rest.dur`
// a ring's centre grabs the object landed in it; empty canvas grabs nothing
```

Two things a sequence must never change — assert them:

```js
const r = c.api.object.rotation.y; s.seek(2); s.seek(0); c.api.object.rotation.y === r;  // spin is the controller's
const cam = v.camera.position.clone(); s.seek(0); cam.equals(v.camera.position);          // framing solved at rest, once
```

A pack **without** `sequence:` must be untouched: `v.sequence === null`,
`document.getElementById('fg').children.length === 0`, `localStorage` empty,
and neither `sequence.js` nor `animejs.esm.min.js` appearing in
`performance.getEntriesByType('resource')`. After `⏏ Unload`, `#fg` is empty
again, `v.sequence` is `null`, and
`v.scene.getObjectByName('sequence-landed')` is `undefined`.

## 5. Testing the zip / service-worker path

Two constraints:

- There is no URL route for a zip; it arrives only by drop or file picker.
- **Service workers are frequently blocked in automation panes.** Registration
  fails with *"Failed to register a ServiceWorker … An unknown error occurred
  when fetching the script"*, which kills the whole zip path. That is the
  harness, not the code — the identical drop succeeds in a normal browser
  window. Use a real window for this layer; use
  `?component=./pack-folder/component.js` in the pane for everything else.

Simulate a drop from the console:

```js
const blob = await (await fetch('/components/example-pack.zip')).blob();
const dt = new DataTransfer();
dt.items.add(new File([blob], 'example-pack.zip', { type: 'application/zip' }));
window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
```

Then assert:

```js
document.body.classList.contains('zipmode');                  // true
document.getElementById('speed').value;                       // '0'
[...document.getElementById('modelSelect').options].map(o => o.value);
// ['zipicon:twist', 'zipicon:gem', '__unloadzip__']
(await (await caches.open('zipfs')).keys()).map(r => r.url);
// .../zipfs/<id>/component.js, .../icons.yml, .../icons/<name>/src/index.js, …
navigator.serviceWorker.controller;                            // non-null
```

`zipmode` and the zeroed spin slider are *not* unique to this path —
`?component=<a pack>` enters the same pack mode. The cache entries and
`navigator.serviceWorker.controller` are what only a real zip produces.

Unloading restores state, and is worth asserting after you have had a pack
loaded:

```js
document.getElementById('modelSelect').value = '__unloadzip__';
document.getElementById('modelSelect').onchange();
// the row selected before the zip is selected again (rows have unique values),
// #speed is back to its old value, and body.zipmode is gone
```

## 5b. Assert the runtime is FRESH before you trust any measurement

The browser caches `sequence.js` hard, and a stale module produces measurements
that look like a real result. This has produced a false "the fix works" AND a
false "the fix does nothing" in the same session. One line, before anything else:

```js
viewer.sequence.start;                    // a string = fresh · undefined = STALE
typeof viewer.component.api.resetMotion;  // "function" = fresh · "undefined" = STALE
```

If either is stale, the measurement that follows is worthless. Fix it by loading
with `?dev=1` (re-fetches the runtime every time and ignores the saved step), or
serve the whole app no-store with the `viewer-dev` launch config — that is the
only thing that also reaches `index.html` and `vendor/`.

Two related traps in the same family:

- **A pack carries its OWN COPY of the stock loader.** Changing
  `components/pack.component.js` does nothing for a pack until you copy it in
  again; `api.resetMotion` coming back `undefined` is the usual symptom.
- **`resume:` will restore a step you did not ask for.** A page that loads
  straight into step 3 while you are editing step 1 is not a bug. `?dev=1`
  ignores saved state; `localStorage.clear()` removes it. Clear it BEFORE the
  page loads, not after — the read happens at boot.

## 5c. Two things that will surprise you before you measure anything

- **The viewer's controls are OFF whenever `?component=` is present.** No picker,
  no transport, no status line — loading a pack means showing it, not operating
  the tool. Add **`?ui=1`** when a check needs them; `?ui=0` forces them off
  everywhere. It also means the status line is not always there as a fallback,
  which is why the curtain carries its own message.
- **An icon returns to its authored pose at every step entrance** (`start: reset`,
  the default). Assert rotation ONE FRAME after a restart, not immediately —
  immediately is always 0, and a carry-over only appears on the next frame, when
  the controller writes its accumulated yaw. `start: continue` is the opt-out and
  reproduces the old behaviour, which is how you prove the option does anything.

## 6. Always read the status line, the curtain, and the console

Almost nothing in this app throws to the user. Bad component, invalid sidecar,
missing `icons.yml`, blocked service worker, failed model load — all of it
lands as text in `#status`, often with the real error only in `console.error`.

```js
document.getElementById('status').textContent;
```

**Read it a second after the load, not at the moment of the write.** A failure
used to be written to `#status` and then quietly overwritten by the next
`refreshStatus()` a few lines later, so the write always looked right in a
review of the code and the message was gone in the browser. `holdStatus()` now
pins it, and this is how you prove it:

```js
await new Promise(r => setTimeout(r, 1500));
document.getElementById('status').textContent;   // still the failure
```

**In bare mode (`?ui=0`) there is no status line at all** — `#status` is
`display: none`. That is the mode a pack is actually looked at in, so check the
curtain, which is where the same text also goes:

```js
const v = window.viewer;
v.curtain;        // { up, reason, state: 'loading'|'slow'|'failed', message }
v.load.failed;    // { label, detail } — the resource that did not arrive
v.load.limits;    // { slowAfter, failAfter } in force for this pack
v.load.log;       // [{ label, ms, how }] — every phase of the load
v.retry();        // press Retry, and assert the curtain comes down
```

**A load that hangs is not a load that is slow.** To tell them apart
deliberately, serve the pack behind something that accepts a connection and
never answers (a few lines of `http.server` will do it) and watch the curtain
move `loading` → `slow` → `failed`. Verified against the defaults: slow at
16.5 s, failed at 46.5 s, both naming the resource. A pack may retune both with
`loading.slowAfter` / `loading.failAfter`, which is also how you make that test
take ten seconds instead of a minute.

**Retrying needs a fresh URL.** A stalled `import()` is remembered by URL, so a
retry at the same one re-attaches to the dead promise and never reaches the
network. The viewer adds `?retry=<n>` per attempt; if you are checking a retry,
assert the second request actually happened
(`performance.getEntriesByType('resource')`, or the server's own log) rather
than trusting that the button was pressed (`AGENT.md` §10.17).

A `try/catch` around `component.update(dt)` in the render loop means a throwing
`update` logs once per frame and keeps rendering, so "the animation is frozen"
usually means "check the console".

## 7. Check the small viewport too

The page has a `@media (max-width: 640px)` layout (compact HUD, bottom-sheet
editor). If your component or pack does its own framing, emulate a phone
viewport and confirm the subject is still in frame — framing that looks right
on a wide desktop window can crop badly at phone aspect.

For a **pack with a sequence**, use `?dev=mobile` instead of resizing the
window: it gives a phone-sized letterboxed stage, a button (and
`viewer.devStage.flip()`) to flip the simulated orientation, and the wheel
mapped onto the swipe gesture. It is the only way to review a rotation lock, a
`portrait:` override or a swipe without a device. It drives the same accessor a
real phone changes, so there is no second implementation to be right about.

```js
const v = window.viewer, s = v.sequence;
v.stage;                                   // 375 x 812 portrait, emulated: true
v.devStage.flip();                         // as if the device turned
[v.curtain, s.playing, s.held, s.time];    // a lock: curtain up, playing false, time PINNED
v.devStage.flip();                         // back — same time, same step
s.input;                                   // { zoom, drag, swipe } for the step showing now
[v.controls.enableZoom, v.controls.enableRotate];   // the policy, as applied
```

The stage is **clamped to the window, never scaled** — at 1280x800 a requested
375x812 is reported as 375x800. Make the window taller (1280x940 is enough) if
you need the exact numbers.

While you are there: the canvas must have **both** its `width`/`height`
attributes and its `style.width`/`style.height` set. `renderer.setSize(w, h)`
does this because `updateStyle` defaults to `true`. Passing `false` as the
third argument makes the canvas lay out at backing-store size — 2x too big on
any `devicePixelRatio >= 2` screen, pushing the subject off frame — and it is
invisible on a DPR-1 development machine, so watch for it in any standalone
harness you write.

```js
const cv = window.viewer.renderer.domElement;
[cv.width, cv.height, cv.style.width, cv.style.height];   // all four populated
```

## 8. Clean up

Stop the server, and delete any scratch file you dropped into the repo root to
test with. Finish with `git status` so nothing unintended is left behind.

Nothing you did in the page persists: spin speed, pivot mode, the loaded
sidecar, the custom background, the loaded pack and the `?dev=mobile` stage are
all lost on reload.
Capture what you want to keep in a URL (`AGENT.md` §4) or a file.
