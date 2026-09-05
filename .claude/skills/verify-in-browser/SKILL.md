---
name: verify-in-browser
description: Serve this static viewer and confirm something actually works in a real browser — including how to test animation and pack sequences deterministically, since a hidden or headless pane pauses requestAnimationFrame and makes working code look broken. Use before claiming that a component, sidecar, icon pack, sequence, or URL you put together is done.
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

There is **no URL that loads a zip** — see step 5 below. The full parameter
table, with constraints, is `AGENT.md` §4.

## 3. Inspect via `window.viewer`

Defined at the bottom of `index.html`:

```js
window.viewer = { THREE, scene, camera, renderer, pivot, controls,
                  get model(), get component(), get sequence() };
```

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
await s.ready;                                  // preload + glyph capture, in a flow
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
o.rotation.y === r0;                       // true
// the call-to-action must never move:
document.querySelector('#fg [data-seq="cta"]').getBoundingClientRect();  // identical before and after
// and the transport must never write persisted state:
const saved = localStorage.getItem(s.storageKey);
s.seek(1.4); s.play(); s.pause();
localStorage.getItem(s.storageKey) === saved;   // true
```

`s.storageKey` is `null` unless the pack declared `resume:` — a pack that did
not ask for persistence must leave `localStorage` completely empty.

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

## 6. Always read the status line and the console

Almost nothing in this app throws to the user. Bad component, invalid sidecar,
missing `icons.yml`, blocked service worker, failed model load — all of it
lands as text in `#status`, often with the real error only in `console.error`.

```js
document.getElementById('status').textContent;
```

A `try/catch` around `component.update(dt)` in the render loop means a throwing
`update` logs once per frame and keeps rendering, so "the animation is frozen"
usually means "check the console".

## 7. Check the small viewport too

The page has a `@media (max-width: 640px)` layout (compact HUD, bottom-sheet
editor). If your component or pack does its own framing, emulate a phone
viewport and confirm the subject is still in frame — framing that looks right
on a wide desktop window can crop badly at phone aspect.

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
sidecar, the custom background, and the loaded pack are all lost on reload.
Capture what you want to keep in a URL (`AGENT.md` §4) or a file.
