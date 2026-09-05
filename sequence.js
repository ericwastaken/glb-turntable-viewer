// sequence.js — plays a pack's sequence.yml: the timed ENTRANCE of an icon
// step (the 3D icon swelling in, lines of 2D copy resolving, a call-to-action
// arriving), and — when a step's `on:` uses `advance` — a multi-step FLOW in
// which each icon is sent into a slot and the next one enters behind it.
//
// index.html imports this file only when a loaded icon carries `api.sequence`,
// so a pack without a sequence never fetches this module or Anime.js.
//
// Ground rules, all deliberate (AGENT.md §12):
//   - The sequence NEVER writes rotation while something is updating the icon.
//     A pack controller assigns `rotation.y` every frame, so a spin channel
//     would be overwritten before render. `scale` / `rise` go on a WRAPPER
//     Group the host puts around the icon; the icon's own object is untouched.
//     There are exactly two exceptions, and both take the icon OUT of the
//     update path first: a LANDING, which owns the icon's rotation for the
//     whole flight and tweens it to rest so it ARRIVES facing front; and a
//     DRAG, whose yaw/pitch live on the wrapper — a different property from
//     the one a controller writes — so the two compose instead of fighting.
//   - A landed object is anchored to its ring EVERY FRAME. The rings are DOM
//     elements fixed to the viewport and the objects are in the 3D world, so a
//     one-time world position decouples the two on the first zoom, resize or
//     orientation change. The host re-solves it from the ring's current rect.
//   - Framing is solved by the host at rest pose BEFORE the t=0 pose is
//     applied, and never re-solved — not even when the flow swaps icons.
//   - Anime.js is created paused and driven by tl.seek(t) from the host's
//     accumulated dt — never by anime's own ticker. Deterministic, scrubbable,
//     and immune to the hidden-pane requestAnimationFrame pause. With
//     `autoplay: false` the anime engine never starts its loop (verified:
//     engine.reqId stays 0), so no engine.pause() is needed.
//   - Channels animate a plain state object per target, and ONE render pass
//     composes it into opacity / transform / filter / clip-path. Two tweens
//     writing `filter` on the same node would clobber each other; the state
//     object makes composition this file's job.
//   - ONE timeline per PHASE, never one per track. A transition (icon N
//     leaving, icon N+1 arriving) is a single timeline holding both lists, so
//     seek(t) stays exact in both directions exactly as it is for an entrance.
//   - Everything a phase shows is DERIVED from t — which ring is filled, which
//     icon is active, whose copy is on screen. No fire-once side effects, so
//     scrubbing backwards undoes itself for free.
//   - The stage (the DOM) is built ONCE and lives for the whole flow. Slots
//     accumulate, and the call-to-action the visitor is about to tap is never
//     rebuilt or re-animated under their finger.
//   - `input:` (§12.13), `orientation:` (§12.14) and `portrait:` (§12.15) are
//     DECLARATIONS, not animation. This file resolves them for the step that is
//     showing and pushes the result to the host, which owns the controls, the
//     curtain and the render loop. A swipe and a tap run the same verb through
//     the same guard; the orientation lock is advisory, and the viewer holds
//     this timeline rather than pausing it, so it resumes where it stopped.
//   - Sizes and gestures are measured against the HOST'S STAGE (host.stage),
//     never the window. ?dev=mobile substitutes that one accessor, so an
//     emulated phone exercises these code paths and not a copy of them.
//
// Anime.js behaviour this file is written around (measured against the
// vendored v4.5.0 build): a child tween's `from` value is NOT rendered until
// the timeline first reaches it, so the t=0 pose is applied here explicitly;
// a tween skipped by a direct jump IS rendered at its end value; a finished
// tween is NOT re-written on later seeks, so the state objects belong to anime
// and are never reset per frame.

import { createTimeline, cubicBezier, eases, spring } from 'animejs';

// --- vocabulary ----------------------------------------------------------------
// Short on purpose: exactly what an entrance and a collect flow need. Anything
// else is a load-time error, by name, so a typo cannot become "the copy just
// didn't animate" three days later.
export const LAYER_CHANNELS = {
  icon: ['fade', 'scale', 'rise'],                 // 3D: the wrapper Group (+ setFade)
  dom:  ['fade', 'rise', 'blur', 'wipe', 'bloom'], // 2D: hud + overlay elements
};
const DEFAULTS = {
  icon: { fade: 1, scale: 1, rise: 0 },
  dom:  { fade: 1, rise: 0, blur: 0, wipe: 1, bloom: 0 },
};
// `pips` is the Phase 1 progress row and is DEPRECATED — `slots` replaces it,
// adds the third state (`next`) and gives a collected icon somewhere to land.
export const ELEMENT_TYPES = { hud: ['slots', 'pips'], overlay: ['text', 'button'] };
export const ACTIONS = ['replay', 'nothing', 'advance', 'restart'];
// How an icon is posed when a step it appears in begins.
//   reset    — back to the authored rest pose, every time (the default)
//   continue — leave it wherever it was
// This matters because an icon's controller accumulates yaw for the life of the
// pack and assigns rotation every frame, so without a reset an icon shown a
// second time (a restart, or a flow that reuses an icon) snaps back on its
// first frame to whatever it had spun to before.
export const START_MODES = ['reset', 'continue'];
export const LAND_MODES = ['object', 'glyph'];
const DEFAULT_FIT = 0.72;        // fraction of the target's inner diameter
const DEFAULT_XFADE = 0.12;      // seconds of object -> glyph cross-fade
const DEFAULT_PADDING = 0.25;    // grab zone, as a fraction of the projected radius
// `outBack` unparametrised overshoots by 1.70158, which reads as aggressive on
// a hand-sized icon. The default is deliberately slow and nearly overshoot-free
// — a settle rather than a bounce. Authors dial both ends: `dur` for speed,
// the ease's argument for how far past centre it goes.
const REST_DEFAULT = { spring: true, dur: 0.8, ease: 'outBack(0.25)' };
const REST_KEYS = ['spring', 'dur', 'ease'];
// A drag of the stage's SHORTER side is one full turn, so the gesture feels
// the same on a phone and on a desktop.
const DRAG_TURN = 2 * Math.PI;
const DRAG_PITCH_LIMIT = 1.2;    // radians; past this an icon reads as tumbling

// ---- input: one declaration for zoom, drag and swipe (AGENT.md §12.13) --------
// These three used to be scattered and partly accidental: `enableZoom` was
// referenced nowhere in the app (so a scroll dollied the camera even in pack
// mode, which nobody had chosen), and camera rotation was switched off
// unconditionally whenever a sequence attached its pointer router.
export const DRAG_MODES = ['icon', 'camera', 'none'];
export const SWIPE_DIRS = ['up', 'none'];
const INPUT_KEYS = ['zoom', 'drag', 'swipe'];
const SWIPE_KEYS = ['dir', 'ratio', 'distance', 'time'];
const INPUT_DEFAULT = {
  // FALSE for a pack, deliberately: a pack composes a fixed frame and a camera
  // dolly is not part of it. A viewer showing a plain model still zooms — this
  // default belongs to the sequence, not to the app.
  zoom: false,
  drag: 'icon',
  swipe: {
    dir: 'up',        // swipe UP advances, matching "scroll down a page"
    ratio: 1.5,       // |dy| must beat |dx| by this much, or it is a drag
    distance: 0.08,   // fraction of the stage's HEIGHT the finger must cover
    time: 0.5,        // seconds; anything slower is a considered drag, not a flick
  },
};

// The orientation a sequence was composed for. ADVISORY — the viewer prompts,
// it cannot turn a device (§12.14).
export const ORIENTATIONS = ['portrait', 'landscape', 'any'];
// Anime.js v4 easing names (the parametrised forms and springs are left out).
export const EASE_NAME = /^(linear|none|in|out|inOut|outIn|(in|out|inOut|outIn)(Quad|Cubic|Quart|Quint|Sine|Circ|Expo|Bounce|Back|Elastic))$/;
const CUBIC_BEZIER = /^cubic-bezier\(\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*\)$/;
// `name(a, b)` — the Back and Elastic families take parameters, and that is the
// dial for how much a return overshoots. Bare `outBack` is Anime.js's default
// 1.70158, which reads as very springy; outBack(0.8) is a nudge.
const EASE_CALL = /^([A-Za-z][\w]*)\(\s*([-+\d.,\s]*)\)$/;
// A real spring, for tuning feel rather than a curve shape:
//   spring(stiffness, damping) | spring(mass, stiffness, damping, velocity)
// Anime's spring reports a fixed .duration here, so it is used as an EASE and
// the sequence's own `dur` still owns the timing. Stiffness raises the
// overshoot, damping kills it: spring(100, 10) peaks at 1.16, spring(60, 14)
// at 1.00 (measured against the vendored build).
const SPRING_ARGS = ['mass', 'stiffness', 'damping', 'velocity'];

// localStorage keys, namespaced so a pack's state cannot collide with anything
// else on the origin. NOTHING is stored unless the pack declares `resume:`.
const STORE_PREFIX = 'glb-viewer:seq:';
const STORE_VERSION = 1;

const fail = (where, msg) => { throw new Error(`sequence: ${where}: ${msg}`); };
const mix = (a, b, k) => a + (b - a) * k;
// The SHORTEST way round to an angle. Without this a landing from 4.80 rad
// took the 275-degree route to 0 instead of the 85-degree one.
const shortest = d => Math.atan2(Math.sin(d), Math.cos(d));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, where) => (typeof v === 'number' && Number.isFinite(v)) ? v : fail(where, `expected a number, got ${JSON.stringify(v)}`);
const frac = (v, where) => { const n = num(v, where); return Math.min(1, Math.max(0, n)); };

function resolveEase(v, where) {
  if (v === undefined) return 'outQuad';
  const s = String(v).trim();
  const cb = CUBIC_BEZIER.exec(s);
  if (cb) return cubicBezier(+cb[1], +cb[2], +cb[3], +cb[4]);
  if (EASE_NAME.test(s)) return s;

  const call = EASE_CALL.exec(s);
  if (call) {
    const name = call[1];
    const args = call[2].trim() === '' ? []
      : call[2].split(',').map((a, i) => {
          const n = Number(a.trim());
          if (!Number.isFinite(n)) fail(where, `ease "${s}": argument ${i + 1} is not a number`);
          return n;
        });
    if (name === 'spring') {
      if (args.length !== 2 && args.length !== 4) {
        fail(where, `spring(...) takes stiffness, damping — or mass, stiffness, damping, velocity — got ${args.length}`);
      }
      // The 2-arg shorthand is the common case; mass and velocity default.
      const vals = args.length === 2 ? [1, args[0], args[1], 0] : args;
      const cfg = {};
      SPRING_ARGS.forEach((k, i) => { cfg[k] = vals[i]; });
      if (cfg.mass <= 0 || cfg.stiffness <= 0 || cfg.damping < 0) {
        fail(where, `spring(...): mass and stiffness must be > 0 and damping >= 0`);
      }
      const sp = spring(cfg);
      const fn = typeof sp === 'function' ? sp : sp.ease;
      if (typeof fn !== 'function') fail(where, `spring(...) did not produce an easing function`);
      return fn;
    }
    const factory = eases[name];
    if (typeof factory !== 'function') fail(where, `unknown ease "${name}(…)"`);
    const fn = factory(...args);
    if (typeof fn !== 'function') {
      fail(where, `ease "${name}" does not take parameters — write it without brackets`);
    }
    return fn;
  }

  return fail(where, `unknown ease "${s}" — an Anime.js name (outCubic, inOutQuart, …), a parametrised one (outBack(0.8), outElastic(1, 0.4)), spring(stiffness, damping), or cubic-bezier(a,b,c,d)`);
}

// `0.2` | `after` | `label` | `label + 0.3` | `label - 0.2`   (seconds)
function resolveAt(expr, labels, cursorEnd, where) {
  if (expr === undefined || expr === 'after') return cursorEnd;
  if (typeof expr === 'number') return num(expr, where);
  const m = /^\s*([A-Za-z_][\w-]*)\s*(?:([+-])\s*([\d.]+))?\s*$/.exec(String(expr));
  if (!m) return fail(where, `cannot parse at: ${JSON.stringify(expr)}`);
  if (!(m[1] in labels)) return fail(where, `unknown label "${m[1]}" (labels must be declared above the track that uses them)`);
  return labels[m[1]] + (m[2] ? (m[2] === '-' ? -1 : 1) * parseFloat(m[3]) : 0);
}

// --- 2D elements ---------------------------------------------------------------
// Real DOM (selectable, accessible), positioned by STAGE fractions like the
// component `framing`: `top` is the element's vertical CENTER as a fraction
// from the top, `left` its horizontal center (default 0.5), `size` its font
// size as a fraction of the stage's SHORTER side (vmin).
//
// Two things about `size` that a landscape desktop hides. The overlay is sized
// in vmin while the 3D icon is framed against stage HEIGHT, so on 1280x800 the
// two agree exactly (vmin IS the height) and on 375x812 they diverge by 2.2x —
// which is why slots and a call-to-action read as too small on a phone unless
// the author says otherwise. That is what `portrait:` is for (§12.15); there is
// deliberately no auto-derived correction factor, because the right mobile
// proportions are a design decision and not arithmetic.
//
// And the unit is written through `--vmin` (which is `1vmin` in the page's own
// CSS) rather than as a literal `vmin`, so ?dev=mobile can point it at an
// emulated stage instead of the window without a second code path.

// Placement keys a `portrait:` block may override. Deliberately NOT the whole
// declaration: `type`, `text`, `persist`, `count` and the colours are the
// element's identity, and an override able to change those would be a second
// element wearing the same name.
export const PORTRAIT_KEYS = ['top', 'left', 'size', 'gap', 'ring', 'weight', 'tracking'];

function readPortrait(decl, where) {
  const p = decl.portrait;
  if (p === undefined || p === null) return null;
  if (!isObj(p)) fail(`${where}.portrait`, 'must be a mapping of placement overrides such as { size: 0.12, top: 0.11 }');
  for (const k of Object.keys(p)) {
    if (!PORTRAIT_KEYS.includes(k)) {
      fail(`${where}.portrait.${k}`, `cannot be overridden per orientation — only ${PORTRAIT_KEYS.join(', ')} can`);
    }
  }
  return p;
}

// Every key an orientation is allowed to change, in one pass — so re-placing an
// element when the stage turns runs exactly the code that placed it at build
// time, and the two cannot drift.
function styleElement(el, decl, where, portrait) {
  const d = portrait ? { ...decl, ...portrait } : decl;
  el.style.left = `${frac(d.left ?? 0.5, where + '.left') * 100}%`;
  el.style.top = `${frac(d.top ?? 0.5, where + '.top') * 100}%`;
  el.style.fontSize = `calc(var(--vmin) * ${num(d.size ?? 0.045, where + '.size') * 100})`;
  if (d.weight !== undefined) el.style.fontWeight = String(d.weight);
  if (d.tracking !== undefined) el.style.letterSpacing = `${num(d.tracking, where + '.tracking')}em`;
  if (d.gap !== undefined) el.style.gap = `${num(d.gap, where + '.gap')}em`;
  if (d.ring !== undefined) el.style.setProperty('--slot-ring', `${num(d.ring, where + '.ring')}em`);
}

function buildElement(name, decl, layer) {
  const where = `stage.${layer}.${name}`;
  if (!isObj(decl)) fail(where, 'must be a mapping such as { type: text, top: 0.7 }');
  const type = decl.type;
  if (!ELEMENT_TYPES[layer].includes(type)) fail(where, `type must be one of ${ELEMENT_TYPES[layer].join(', ')} (got ${JSON.stringify(type)})`);
  if (type === 'slots') return buildSlots(name, decl, where);
  const el = document.createElement(type === 'button' ? 'button' : 'div');
  el.className = `fg-el fg-${type}`;
  el.dataset.seq = name;
  const portrait = readPortrait(decl, where);
  // `place(isPortrait)` is called again whenever the stage's orientation flips.
  const place = p => styleElement(el, decl, where, p ? portrait : null);
  place(false);
  if (decl.color !== undefined) { el.style.color = String(decl.color); el.style.setProperty('--glow', String(decl.color)); }
  if (type === 'button') el.type = 'button';
  return { el, type, place };
}

// A `slots` row: `count` rings, each separately addressable as a `to:`
// destination under the name `<element name><1-based index>` — a `slot`
// element with `count: 3` gives the targets `slot1`, `slot2`, `slot3`.
// Colours and sizes come from the declaration as custom properties; the CSS in
// index.html holds only the defaults.
function buildSlots(name, decl, where) {
  const el = document.createElement('div');
  el.className = 'fg-el fg-slots';
  el.dataset.seq = name;
  const portrait = readPortrait(decl, where);
  const place = p => styleElement(el, decl, where, p ? portrait : null);
  place(false);
  const count = Math.max(1, Math.round(num(decl.count ?? 3, where + '.count')));
  el.style.setProperty('--slot-on', String(decl.color ?? '#e9e3f4'));
  el.style.setProperty('--slot-off', String(decl.dim ?? '#e9e3f444'));
  const cells = [];
  for (let i = 0; i < count; i++) {
    const cell = document.createElement('span');
    cell.className = 'fg-slot is-pending';
    cell.dataset.slot = String(i + 1);
    cell.dataset.state = 'is-pending';
    const img = document.createElement('img');
    img.className = 'fg-glyph'; img.alt = ''; img.hidden = true;
    cell.appendChild(img);
    el.appendChild(cell);
    cells.push({ el: cell, img });
  }
  return { el, type: 'slots', count, cells, place };
}

// The three slot states are a function of the FLOW, never of a counter:
//   pending — dim ring, empty
//   next    — bright ring, empty; the ring the current icon will land in
//   filled  — bright ring holding that icon's 2D glyph
// `next` is therefore the first ring that is not filled, which is why the
// highlight moves at TOUCHDOWN and not when the fly begins.
function renderSlots(b, at) {
  let next = -1;
  for (let i = 0; i < b.count; i++) if (at(i) === null) { next = i; break; }
  for (let i = 0; i < b.count; i++) {
    const cell = b.cells[i], f = at(i);
    const state = f ? 'is-filled' : (i === next ? 'is-next' : 'is-pending');
    if (cell.el.dataset.state !== state) {
      cell.el.className = `fg-slot ${state}`;
      cell.el.dataset.state = state;
    }
    // A ring holding a landed 3D OBJECT stays visually empty — the object
    // itself is sitting in it. Only a `glyph` landing shows the flat mark.
    const src = (f && f.as === 'glyph' && f.glyph) ? f.glyph : '';
    if ((cell.img.getAttribute('src') || '') !== src) {
      if (src) { cell.img.setAttribute('src', src); cell.img.hidden = false; }
      else { cell.img.removeAttribute('src'); cell.img.hidden = true; }
    }
    // `mix` is the CROSS-FADE with the 3D object the glyph is replacing: the
    // mark fades up while the object fades down, so the swap is not a visible
    // flip between two things that never look quite identical.
    if (src) {
      const op = f.mix === undefined ? 1 : Math.min(1, Math.max(0, f.mix));
      const str = op >= 1 ? '' : String(op.toFixed(4));
      if (cell.img.style.opacity !== str) cell.img.style.opacity = str;
    }
  }
}

// DEPRECATED alias, kept so a Phase 1 pack keeps working unchanged.
function setPips(el, filled, total) {
  el.replaceChildren();
  for (let i = 0; i < total; i++) {
    const pip = document.createElement('span');
    pip.className = 'fg-pip' + (i < filled ? ' on' : '');
    el.appendChild(pip);
  }
}

function renderDom(b) {
  const s = b.state, st = b.el.style;
  st.opacity = String(Math.min(1, Math.max(0, s.fade)));
  // The centering translate and the `rise` channel share one transform string.
  st.transform = `translate(-50%, -50%) translateY(${s.rise}px)`;
  const filters = [];
  if (s.blur > 0.001) filters.push(`blur(${s.blur}px)`);
  // `bloom` is a 0–1 INTENT. There is no bloom pass in this viewer, so for a
  // DOM element 1.0 means "a soft glow in the element's own colour".
  if (s.bloom > 0.001) filters.push(`drop-shadow(0 0 ${(6 * s.bloom).toFixed(2)}px var(--glow)) drop-shadow(0 0 ${(18 * s.bloom).toFixed(2)}px var(--glow))`);
  st.filter = filters.length ? filters.join(' ') : 'none';
  // GUESS — the reveal mechanism. The reference reads as "blur-in with a
  // left-to-right reveal"; a clip-path wipe plus a blur matches that in
  // aggregate, but a per-character stagger or a travelling blur gradient would
  // read the same way at a distance. A dedicated research track is deciding
  // the final mechanism; until it does, `wipe` is this inset clip.
  st.clipPath = s.wipe >= 0.999 ? 'none' : `inset(0 ${((1 - s.wipe) * 100).toFixed(3)}% 0 0)`;
}

// --- 3D fade -------------------------------------------------------------------
// Preferred route: the icon exports setFade(v) and the loader forwards it as
// api.setFade. Generic fallback: animate `opacity` on the icon's standard
// materials (MeshStandard / MeshPhysical / MeshBasic), flipping `transparent`
// on while the fade is in flight and restoring the material's own flags at 1
// so the resting look is pixel-identical to a pack without a sequence. Raw
// ShaderMaterials cannot be faded generically (their alpha is whatever the
// shader writes), so an icon built from them must supply setFade or accept
// the documented degrade to scale-only.
function materialFade(object) {
  const mats = [];
  object.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (m && (m.isMeshStandardMaterial || m.isMeshBasicMaterial))
        mats.push({ m, transparent: m.transparent, opacity: m.opacity });
    }
  });
  if (!mats.length) return null;
  return v => {
    for (const { m, transparent, opacity } of mats) {
      if (v >= 0.999) { m.transparent = transparent; m.opacity = opacity; }
      else { m.transparent = true; m.opacity = opacity * Math.max(0, v); }
    }
  };
}

// --- step selection --------------------------------------------------------------
// Phase 1 (no flow): the step played for an icon is the first whose `icon:`
// names it, else the first step with no `icon:` at all. `stage.icon.ref` gates
// the whole sequence: `current` applies to every icon, a name applies to that
// icon only. A FLOW inverts this — the sequence drives which icon is shown —
// and uses this only to honour a dev picking an icon from the dropdown.
export function pickStep(doc, iconName) {
  const steps = doc.steps;
  if (!Array.isArray(steps) || !steps.length) fail('steps', 'must be a non-empty list');
  return steps.find(s => isObj(s) && s.icon === iconName) ?? steps.find(s => isObj(s) && s.icon === undefined) ?? null;
}

// --- persistence ----------------------------------------------------------------
// OFF unless the pack declares `resume:`. This is a public tool: it must not
// put anything in a visitor's browser unless the pack asks it to. Every read
// and write is wrapped — a private window and blocked site data both throw on
// access, and the only correct response is to carry on with no persistence.
function readSaved(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSaved(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* no persistence, no problem */ }
}
function dropSaved(key) {
  try { localStorage.removeItem(key); } catch { /* ditto */ }
}

// --- build -----------------------------------------------------------------------
// host = { root: HTMLElement (#fg), initialHandle: { name, api, wrapper },
//          iconName, file, packId, picked, iconNames,
//          acquire(name) -> Promise<handle>, setActive(handle|null),
//          setFrozen(handle, bool), rest(handle),
//          planMove(handle, el, fit) -> { from, to }, glyphFor(handle),
//          dispose() }
// Returns null when this sequence does not apply to the icon; otherwise the
// runtime described in AGENT.md §12.
export function createSequence(doc, host) {
  const file = host.file ?? 'sequence.yml';
  if (!isObj(doc)) fail(file, 'must be a YAML mapping at the root');
  if (doc.version !== 1) fail(file, `unsupported version ${JSON.stringify(doc.version)} (this viewer plays version: 1)`);
  const stage = doc.stage ?? {};
  if (!isObj(stage)) fail('stage', 'must be a mapping of layers (hud, icon, overlay)');
  for (const layer of Object.keys(stage)) {
    if (!['hud', 'icon', 'overlay'].includes(layer)) fail(`stage.${layer}`, 'unknown layer — this viewer knows hud, icon, overlay');
  }
  const steps = doc.steps;
  if (!Array.isArray(steps) || !steps.length) fail('steps', 'must be a non-empty list');
  steps.forEach((s, i) => { if (!isObj(s)) fail(`steps[${i}]`, 'must be a mapping'); });
  const stepId = (s, i) => String(s.id ?? `#${i}`);

  // A sequence becomes a FLOW as soon as a step's `on:` uses advance or
  // restart. Without one of those verbs nothing below changes: one step
  // plays, exactly as it did in Phase 1.
  const verbsUsed = new Set();
  for (const s of steps) for (const a of Object.values(s.on ?? {})) if (isObj(a)) verbsUsed.add(a.do);
  const flowMode = verbsUsed.has('advance') || verbsUsed.has('restart');

  const ref = stage.icon?.ref ?? 'current';
  const startDefault = stage.icon?.start ?? 'reset';
  if (!START_MODES.includes(startDefault)) {
    fail('stage.icon.start', `must be one of ${START_MODES.join(', ')}`);
  }
  const packIcons = Array.isArray(host.iconNames) && host.iconNames.length ? host.iconNames : [host.iconName];
  const warnings = [];

  // ---- which step do we start on? ------------------------------------------------
  let startIndex = 0;
  if (!flowMode) {
    if (stage.icon && ref !== 'current' && ref !== host.iconName) return null;
    const step = pickStep(doc, host.iconName);
    if (!step) return null;
    startIndex = steps.indexOf(step);
  } else {
    if (stage.icon && ref !== 'current') fail('stage.icon.ref', 'a flow (a step whose `on:` uses advance/restart) drives which icon shows — ref must be "current"');
    if (steps[0].icon === undefined) fail(`steps[0] (${stepId(steps[0], 0)})`, 'the first step of a flow must name an `icon:`');
    steps.forEach((s, i) => {
      if (s.icon !== undefined && !packIcons.includes(s.icon))
        fail(`steps[${i}] (${stepId(s, i)}).icon`, `"${s.icon}" is not an icon in this pack (${packIcons.join(', ')})`);
    });
  }

  // ---- bind names to targets (built once; the stage is persistent) ----------------
  const bind = {};   // name -> { kind: 'dom' | 'icon' | 'cell', el?, state?, … }
  const frag = document.createDocumentFragment();
  for (const layer of ['hud', 'overlay']) {
    const decls = stage[layer] ?? {};
    if (!isObj(decls)) fail(`stage.${layer}`, 'must be a mapping of element name → declaration');
    for (const [name, decl] of Object.entries(decls)) {
      if (name === 'icon' || bind[name]) fail(`stage.${layer}.${name}`, 'name already used by another target');
      const built = buildElement(name, decl, layer);
      bind[name] = {
        kind: 'dom', el: built.el, type: built.type, state: { ...DEFAULTS.dom },
        text: decl.text, persist: decl.persist === true, arrived: false,
        count: built.count, cells: built.cells, place: built.place,
      };
      if (built.type === 'slots') {
        built.cells.forEach((cell, i) => {
          const cn = `${name}${i + 1}`;
          if (bind[cn]) fail(`stage.${layer}.${name}`, `slot target "${cn}" collides with another declared element`);
          bind[cn] = { kind: 'cell', el: cell.el, owner: name, index: i };
        });
      }
      frag.appendChild(built.el);
    }
  }
  const slotsName = Object.keys(bind).find(n => bind[n].type === 'slots');
  const slotsBind = slotsName ? bind[slotsName] : null;
  if (stage.icon) bind.icon = { kind: 'icon', state: { ...DEFAULTS.icon }, outState: { ...DEFAULTS.icon } };

  steps.forEach((s, i) => {
    if (s.copy !== undefined && !isObj(s.copy)) fail(`steps.${stepId(s, i)}.copy`, 'must be a mapping of element name → text');
    for (const name of Object.keys(s.copy ?? {})) {
      if (!bind[name] || bind[name].kind !== 'dom') fail(`steps.${stepId(s, i)}.copy.${name}`, 'is not a declared overlay/hud element');
    }
    const end = s.end ?? 'hold';
    if (end !== 'hold') warnings.push(`steps.${stepId(s, i)}.end: "${end}" is not implemented — holding the final frame (end: hold is the only end).`);
  });

  // ---- hit: the grab zone ------------------------------------------------------------
  // Pointer input is HIT-TESTED, not broadcast: a press picks the nearest icon
  // whose projected circle (plus this padding) contains it. Before this, every
  // drag anywhere on the canvas went to the active icon, and a landed object
  // could not be touched at all.
  const hitDecl = doc.hit ?? {};
  if (!isObj(hitDecl)) fail('hit', 'must be a mapping such as { padding: 0.25 }');
  for (const k of Object.keys(hitDecl)) if (k !== 'padding') warnings.push(`hit: unknown key "${k}" (ignored)`);
  const hitPadding = hitDecl.padding === undefined ? DEFAULT_PADDING : num(hitDecl.padding, 'hit.padding');

  // ---- rest: does a disturbed icon come back? -----------------------------------------
  // Sequence-wide default, overridable per step. The RUNTIME owns this, not the
  // pack: an icon with no controller at all (the minimal example ships one)
  // must still spring back, so it cannot be delegated to the icon's own code.
  function readRest(decl, where, base) {
    if (decl === undefined || decl === null) return base;
    if (!isObj(decl)) fail(where, 'must be a mapping such as { spring: true, dur: 0.8, ease: outBack }');
    for (const k of Object.keys(decl)) if (!REST_KEYS.includes(k)) warnings.push(`${where}: unknown key "${k}" (ignored)`);
    if (decl.spring !== undefined && typeof decl.spring !== 'boolean') fail(`${where}.spring`, 'must be true or false');
    return {
      spring: decl.spring === undefined ? base.spring : decl.spring,
      dur: decl.dur === undefined ? base.dur : Math.max(0, num(decl.dur, `${where}.dur`)),
      ease: decl.ease === undefined ? base.ease : resolveEase(decl.ease, `${where}.ease`),
    };
  }
  const restDefault = readRest(doc.rest, 'rest', REST_DEFAULT);
  const stepRest = steps.map((s, i) => readRest(s.rest, `steps.${stepId(s, i)}.rest`, restDefault));

  // ---- input: zoom, drag and swipe -----------------------------------------------------
  // Sequence-wide, overridable per step, exactly like `rest:`. `swipe:` takes
  // the shorthand `up` / `none` or the full mapping with its thresholds, so the
  // common case is one word and a retune is still declarative.
  function readSwipe(decl, where, base) {
    if (decl === undefined) return base;
    if (typeof decl === 'string') {
      if (!SWIPE_DIRS.includes(decl)) fail(where, `must be one of ${SWIPE_DIRS.join(', ')} — or a mapping { dir, ratio, distance, time }`);
      return { ...base, dir: decl };
    }
    if (!isObj(decl)) fail(where, `must be ${SWIPE_DIRS.join(' / ')} or a mapping { dir, ratio, distance, time }`);
    for (const k of Object.keys(decl)) if (!SWIPE_KEYS.includes(k)) warnings.push(`${where}: unknown key "${k}" (ignored)`);
    if (decl.dir !== undefined && !SWIPE_DIRS.includes(decl.dir)) fail(`${where}.dir`, `must be one of ${SWIPE_DIRS.join(', ')}`);
    const positive = (v, k, b) => (v === undefined ? b : Math.max(0, num(v, `${where}.${k}`)));
    return {
      dir: decl.dir ?? base.dir,
      ratio: positive(decl.ratio, 'ratio', base.ratio),
      distance: positive(decl.distance, 'distance', base.distance),
      time: positive(decl.time, 'time', base.time),
    };
  }
  function readInput(decl, where, base) {
    if (decl === undefined || decl === null) return base;
    if (!isObj(decl)) fail(where, 'must be a mapping such as { zoom: false, drag: icon, swipe: up }');
    for (const k of Object.keys(decl)) if (!INPUT_KEYS.includes(k)) warnings.push(`${where}: unknown key "${k}" (ignored)`);
    if (decl.zoom !== undefined && typeof decl.zoom !== 'boolean') fail(`${where}.zoom`, 'must be true or false');
    if (decl.drag !== undefined && !DRAG_MODES.includes(decl.drag)) fail(`${where}.drag`, `must be one of ${DRAG_MODES.join(', ')}`);
    return {
      zoom: decl.zoom === undefined ? base.zoom : decl.zoom,
      drag: decl.drag === undefined ? base.drag : decl.drag,
      swipe: readSwipe(decl.swipe, `${where}.swipe`, base.swipe),
    };
  }
  const inputDefault = readInput(doc.input, 'input', INPUT_DEFAULT);
  const stepInput = steps.map((s, i) => readInput(s.input, `steps.${stepId(s, i)}.input`, inputDefault));

  // ---- orientation: what this sequence was composed for ---------------------------------
  // The VIEWER owns the lock (it owns the curtain and the render loop); this is
  // only the declaration. It is advisory by necessity: screen.orientation.lock()
  // needs fullscreen and does not exist in mobile Safari at all.
  const orientation = doc.orientation ?? 'any';
  if (!ORIENTATIONS.includes(orientation)) fail('orientation', `must be one of ${ORIENTATIONS.join(', ')}`);

  // ---- fade capability -------------------------------------------------------------
  const degrade = doc.requires?.['icon.fade']?.degrade ?? 'scale-only';
  if (degrade !== 'scale-only') fail('requires.icon.fade', `degrade "${degrade}" is not supported — the only supported degrade is scale-only`);
  const fadeCache = new WeakMap();
  function fadeFor(h) {
    if (!h) return null;
    if (!fadeCache.has(h)) {
      const f = typeof h.api.setFade === 'function' ? v => h.api.setFade(v) : materialFade(h.api.object);
      if (!f) console.warn(`[sequence] ${file}: icon.fade unavailable for "${h.name}" — it exports no setFade(v) and has no standard materials to fade. Degrading to scale-only (AGENT.md §12).`);
      fadeCache.set(h, f);
    }
    return fadeCache.get(h);
  }

  // ---- glyphs + flow state ------------------------------------------------------------
  const glyphs = new Map();          // icon name -> image URL (provided or derived)
  const fillEntry = (icon, as) => ({ icon, as, glyph: glyphs.get(icon) ?? null });

  // ---- initial state (state, not motion) -------------------------------------------
  const initial = doc.initial ?? {};
  if (!isObj(initial)) fail('initial', 'must be a mapping of target name → state');
  let initialFilled = [];
  for (const [name, st] of Object.entries(initial)) {
    const b = bind[name];
    if (!b) fail(`initial.${name}`, 'is not a declared target');
    if (b.kind === 'cell') fail(`initial.${name}`, 'a slot ring is only a `to:` destination; it has no state of its own');
    if (!isObj(st)) fail(`initial.${name}`, 'must be a mapping');
    if (b.type === 'pips') {
      const total = Math.max(0, Math.round(num(st.total ?? 3, `initial.${name}.total`)));
      const filled = Math.max(0, Math.round(num(st.filled ?? 0, `initial.${name}.filled`)));
      b.pips = { filled: Math.min(filled, total), total };
    }
    if (b.type === 'slots' && st.filled !== undefined) {
      // A number fills the first N rings from the flow's own step order; a list
      // names the icons that are already in them.
      initialFilled = typeof st.filled === 'number'
        ? steps.filter(s => s.icon).slice(0, Math.max(0, Math.round(st.filled))).map(s => s.icon)
        : (Array.isArray(st.filled) ? st.filled.map(String) : fail(`initial.${name}.filled`, 'must be a count or a list of icon names'));
    }
    for (const [ch, v] of Object.entries(st)) {
      if (b.type === 'pips' && (ch === 'filled' || ch === 'total')) continue;
      if (b.type === 'slots' && ch === 'filled') continue;
      if (!LAYER_CHANNELS[b.kind].includes(ch)) fail(`initial.${name}.${ch}`, `not a ${b.kind} channel (${LAYER_CHANNELS[b.kind].join(', ')})`);
      b.state[ch] = num(v, `initial.${name}.${ch}`);
    }
  }
  for (const b of Object.values(bind)) if (b.type === 'pips') setPips(b.el, b.pips?.filled ?? 0, b.pips?.total ?? 3);

  // ---- where does each step land its icon? -------------------------------------------
  // Read off the step's own `exit:` list, so nothing is declared twice. The
  // destination and the fit are needed twice: by the flight, and — before the
  // flow has run at all — by the GLYPH CAPTURE, which frames the mark through
  // the very ring the object will occupy so the two are interchangeable.
  const stepLand = steps.map((s, i) => {
    const track = (Array.isArray(s.exit) ? s.exit : []).find(e => isObj(e) && e.to !== undefined);
    if (!track) return null;
    const b = bind[track.to];
    if (!b) fail(`steps.${stepId(s, i)}.exit`, `to: "${track.to}" is not a declared 2D element`);
    const fit = track.land?.fit === undefined ? DEFAULT_FIT : num(track.land.fit, `steps.${stepId(s, i)}.exit.land.fit`);
    return { to: track.to, el: b.el, fit, slot: b.kind === 'cell' ? b.index : -1 };
  });
  const stepSlot = stepLand.map(l => (l ? l.slot : -1));

  // ---- persistence ------------------------------------------------------------------
  const slotCount = slotsBind ? slotsBind.count : 0;
  // `landed` is the anchoring record: which icon is in each ring, and the
  // element + fit + depth its world position is re-solved from every frame.
  const flow = { index: startIndex, filled: new Array(slotCount).fill(null), landed: new Array(slotCount).fill(null) };
  const resume = doc.resume ?? null;
  if (resume !== null && !isObj(resume)) fail('resume', 'must be a mapping such as { minutes: 60 }');
  const resumeMinutes = resume ? num(resume.minutes ?? 0, 'resume.minutes') : 0;
  const storeKey = resumeMinutes > 0 ? STORE_PREFIX + String(resume.id ?? host.packId ?? file) : null;

  function setFilledFromNames(names) {
    for (let i = 0; i < slotCount; i++) flow.filled[i] = names[i] ? fillEntry(names[i], 'glyph') : null;
  }
  setFilledFromNames(initialFilled);

  // A saved state is thrown away — never repaired — when the pack has moved on:
  // editing sequence.yml must not strand a visitor on a step that is gone.
  if (storeKey) {
    // ?dev=1 ignores a saved step. Resuming into step 3 while you are editing
    // step 1 is the same class of problem as a cached module: the page is
    // showing you yesterday's answer.
    const saved = host.dev ? null : readSaved(storeKey);
    const ids = steps.map(stepId);
    const fresh = saved
      && saved.v === STORE_VERSION
      && typeof saved.t === 'number'
      && Date.now() - saved.t <= resumeMinutes * 60_000
      && ids.includes(saved.step)
      && Array.isArray(saved.slots) && saved.slots.length === slotCount
      && saved.slots.every(n => n === null || packIcons.includes(n));
    if (fresh) {
      flow.index = ids.indexOf(saved.step);
      setFilledFromNames(saved.slots);
    } else if (saved) {
      dropSaved(storeKey);
    }
  }
  // A dev picking an icon from the viewer's dropdown jumps to that icon's step
  // (and to the rings it would have collected by then) — but never writes state.
  if (flowMode && host.picked) {
    const k = steps.findIndex(s => s.icon === host.iconName);
    if (k >= 0) {
      flow.index = k;
      for (let i = 0; i < k; i++) if (stepSlot[i] >= 0 && steps[i].icon) flow.filled[stepSlot[i]] = fillEntry(steps[i].icon, 'glyph');
    }
  }
  // Only `advance` and `restart` write. Scrubbing, playing, pausing and picking
  // an icon in the dev transport must never overwrite a visitor's state.
  function save() {
    if (!storeKey) return;
    writeSaved(storeKey, {
      v: STORE_VERSION,
      step: stepId(steps[flow.index], flow.index),
      slots: flow.filled.map(f => f?.icon ?? null),
      t: Date.now(),          // the TTL runs from the LAST state change, so an
    });                       // actively tapping visitor is never timed out.
  }

  // ---- timeline building -------------------------------------------------------------
  // One list of tracks, added to `tl` at `offset` seconds. Returns the absolute
  // end time. `o` carries what differs between an entrance list and an exit
  // list — chiefly WHICH icon state an `icon:` track writes.
  function addTracks(tl, tracks, where0, offset, o) {
    if (!Array.isArray(tracks)) fail(where0, 'must be a list of tracks and labels');
    const labels = {};
    let cursorEnd = 0, end = 0;
    tracks.forEach((entry, i) => {
      const where = `${where0}[${i}]`;
      if (!isObj(entry)) fail(where, 'must be a mapping');
      if (entry.label !== undefined) {
        labels[String(entry.label)] = resolveAt(entry.at, labels, cursorEnd, `${where} (label ${entry.label})`);
        return;
      }
      const id = entry.id ?? `#${i}`;
      const w = `${where} (${id})`;
      const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
      if (!targets.length || targets.some(x => typeof x !== 'string')) fail(w, 'target must be a name or a list of names');
      const at = resolveAt(entry.at, labels, cursorEnd, `${w}.at`);
      const timing = entry.timing ?? {};
      if (!isObj(timing)) fail(`${w}.timing`, 'must be { dur, ease }');
      const dur = timing.dur === undefined ? 0 : num(timing.dur, `${w}.timing.dur`);
      const ease = resolveEase(timing.ease, `${w}.timing.ease`);

      // A MOVE track — send the 3D icon to a 2D element in a straight line,
      // shrinking as it goes so it lands inside the target.
      if (entry.to !== undefined) {
        if (!o.move) fail(w, '`to:` sends the icon to a 2D element and only belongs in a step\'s `exit:` list');
        if (targets.length !== 1 || targets[0] !== 'icon') fail(w, '`to:` tracks must be `target: icon`');
        if (entry.channels !== undefined) fail(w, 'a `to:` track owns the icon\'s position and scale — put fade on a track of its own');
        o.move(entry, offset + at, dur, ease, w);
        cursorEnd = at + dur; end = Math.max(end, at + dur);
        return;
      }

      const stagger = entry.stagger === undefined ? 0 : num(entry.stagger, `${w}.stagger`);
      if (!isObj(entry.channels) || !Object.keys(entry.channels).length) fail(w, 'needs a non-empty channels mapping');
      targets.forEach((name, k) => {
        const b = bind[name];
        if (!b) fail(w, `target "${name}" is not declared in stage:`);
        if (b.kind === 'cell') fail(w, `target "${name}" is a slot ring — it can only be a \`to:\` destination`);
        const start = at + k * stagger;
        end = Math.max(end, start + dur);
        // A `persist:` element that has already arrived is skipped, so the
        // call-to-action never hides, never re-animates, and never moves.
        if (b.persist && b.arrived) return;
        const st = b.kind === 'icon' ? o.iconState : b.state;
        const props = {};
        for (const [ch, v] of Object.entries(entry.channels)) {
          if (!LAYER_CHANNELS[b.kind].includes(ch)) fail(`${w}.channels.${ch}`, `not a ${b.kind} channel (${LAYER_CHANNELS[b.kind].join(', ')})`);
          if (Array.isArray(v)) {
            if (v.length !== 2) fail(`${w}.channels.${ch}`, 'a range is exactly [from, to]');
            props[ch] = [num(v[0], `${w}.channels.${ch}[0]`), num(v[1], `${w}.channels.${ch}[1]`)];
            o.zero(st, ch, offset + start, v[0]);
          } else {
            props[ch] = num(v, `${w}.channels.${ch}`);   // from the value at build time
          }
        }
        if (Object.keys(props).length) tl.add(st, { ...props, duration: dur * 1000, ease }, (offset + start) * 1000);
        if (b.persist) b.arrived = true;
      });
      cursorEnd = at + dur + Math.max(0, targets.length - 1) * stagger;
    });
    return offset + Math.max(end, cursorEnd);
  }

  // The t=0 pose: anime does not render a tween's `from` before the timeline
  // first reaches it, so every channel starts at its earliest track's `from`.
  function zeroPoseCollector() {
    const seen = new Map();
    return {
      zero(st, ch, start, from) {
        let m = seen.get(st); if (!m) seen.set(st, m = new Map());
        const cur = m.get(ch);
        if (!cur || start < cur[0]) m.set(ch, [start, from]);
      },
      apply() { for (const [st, m] of seen) for (const [ch, [, from]] of m) st[ch] = from; },
    };
  }

  // ---- actions per step ---------------------------------------------------------------
  // Only elements named in some step's `on:` receive pointer events; everything
  // else in the overlay stays click-through so the icon can still be dragged.
  function stepOn(i) {
    const s = steps[i];
    const out = {};
    for (const [key, action] of Object.entries(s?.on ?? {})) {
      const m = /^([A-Za-z_][\w-]*)\.tap$/.exec(key);
      if (!m) fail(`steps.${stepId(s, i)}.on.${key}`, 'only <target>.tap is supported');
      const verb = action?.do;
      if (!ACTIONS.includes(verb)) fail(`steps.${stepId(s, i)}.on.${key}.do`, `must be one of ${ACTIONS.join(', ')}`);
      const b = bind[m[1]];
      if (!b) fail(`steps.${stepId(s, i)}.on.${key}`, `target "${m[1]}" is not declared in stage:`);
      if (b.kind !== 'dom') { warnings.push(`on.${key}: taps on the icon are not routed (the canvas belongs to the icon's own controller); ignored.`); continue; }
      out[m[1]] = verb;
    }
    return out;
  }
  const stepOns = steps.map((s, i) => stepOn(i));

  // ---- phases ---------------------------------------------------------------------------
  // A phase is one timeline plus everything derived from t. `entrance` plays a
  // step's `timeline:`; `transition` plays the outgoing step's `exit:` and,
  // `overlap` seconds before that ends, the incoming step's `timeline:`.
  let phase = null, t = 0, playing = true, disposed = false, activeHandle;
  // A viewer-level HOLD (today: the rotation lock, §12.14). Nothing advances and
  // nothing is written while it is on, but `time`, `step` and the phase are
  // untouched, so play resumes exactly where it stopped. Deliberately NOT
  // pause(): pause()'s partner play() restarts a phase that has already reached
  // `end: hold`, which is the last thing a returning visitor should see.
  let held = false;
  let lastCopy;
  const handles = new Map();
  if (host.initialHandle) handles.set(host.initialHandle.name, host.initialHandle);

  function newPhase(kind) {
    return {
      kind, tl: createTimeline({ autoplay: false, defaults: { composition: 'none' } }),
      duration: 0, actor: null, incoming: null, swapAt: Infinity,
      move: null, pending: null, on: {}, outStep: null, inStep: null,
    };
  }

  // `start:` on the step wins over `stage.icon.start`; both default to reset.
  function startModeOf(s, i) {
    const m = s.start ?? startDefault;
    if (!START_MODES.includes(m)) {
      fail(`steps.${stepId(s, i)}.start`, `must be one of ${START_MODES.join(', ')}`);
    }
    return m;
  }

  function enterStep(i) {
    const s = steps[i];
    const p = newPhase('entrance');
    p.inStep = i; p.outStep = i;
    // A flow step with no `icon:` is a STATE, not an icon — the end of a flow
    // shows no icon at all. Outside a flow the step always drives the one icon
    // the viewer loaded, exactly as it did in Phase 1.
    p.actor = flowMode ? (s.icon ? handles.get(s.icon) ?? null : null) : (host.initialHandle ?? null);
    const z = zeroPoseCollector();
    p.duration = addTracks(p.tl, s.timeline ?? [], `steps.${stepId(s, i)}.timeline`, 0,
      { iconState: bind.icon?.state, zero: z.zero, move: null });
    z.apply();
    p.on = stepOns[i];
    phase = p;
    for (const h of handles.values()) if (h !== p.actor) h.wrapper.visible = false;
    if (p.actor) {
      toRest(p.actor);
      // Position, scale and any finger-left rotation are back to rest above.
      // This is the icon's OWN motion, which lives in its controller and
      // survives everything else.
      if (startModeOf(s, i) === 'reset') host.resetMotion?.(p.actor);
      p.actor.wrapper.visible = true;
    }
    seekTo(0);
  }

  function transition(from, to) {
    const sOut = steps[from], sIn = to === null ? null : steps[to];
    const p = newPhase('transition');
    p.outStep = from; p.inStep = to;
    p.actor = sOut.icon ? handles.get(sOut.icon) ?? null : null;   // a flow always names its icons
    p.incoming = sIn?.icon ? handles.get(sIn.icon) ?? null : null;
    const z = zeroPoseCollector();

    // The outgoing icon's own channels start from wherever its entrance left
    // them, so a fade-out reads as a fade-out and not as a jump back to 1.
    if (bind.icon) Object.assign(bind.icon.outState, bind.icon.state);

    const exitEnd = addTracks(p.tl, sOut.exit ?? [], `steps.${stepId(sOut, from)}.exit`, 0, {
      iconState: bind.icon?.outState, zero: z.zero,
      move: (entry, at, dur, ease, w) => {
        if (p.move) fail(w, 'a step may only send its icon to one target');
        const dest = bind[entry.to];
        if (!dest) fail(`${w}.to`, `"${entry.to}" is not a declared 2D element`);
        if (dest.kind === 'icon') fail(`${w}.to`, 'the destination must be a 2D element, not the icon');
        const land = entry.land ?? {};
        if (!isObj(land)) fail(`${w}.land`, 'must be a mapping such as { mode: object, fit: 0.72 }');
        const mode = land.mode ?? 'object';
        if (!LAND_MODES.includes(mode)) fail(`${w}.land.mode`, `must be one of ${LAND_MODES.join(', ')}`);
        const face = land.face ?? 'front';
        if (face !== 'front') fail(`${w}.land.face`, 'the only resting orientation this viewer can set is "front"');
        const fit = land.fit === undefined ? DEFAULT_FIT : num(land.fit, `${w}.land.fit`);
        if (land.after !== undefined && land.after !== 'glyph') fail(`${w}.land.after`, 'the only follow-up landing is "glyph"');
        if (land.after === 'glyph' && mode !== 'object') fail(`${w}.land.after`, 'only an object landing can be swapped to a glyph afterwards');
        const delay = land.delay === undefined ? 0.4 : num(land.delay, `${w}.land.delay`);
        const xfade = land.fade === undefined ? DEFAULT_XFADE : Math.max(0, num(land.fade, `${w}.land.fade`));
        for (const k of Object.keys(land)) {
          if (!['mode', 'face', 'fit', 'after', 'delay', 'fade'].includes(k)) warnings.push(`${w}.land: unknown key "${k}" (ignored)`);
        }
        const h = p.actor;
        if (!h) fail(w, `step "${stepId(sOut, from)}" has no \`icon:\` to send`);

        // ONE eased progress drives the whole flight — position, scale AND the
        // turn to rest. The destination itself is NOT baked in here: it is
        // re-solved from the ring's live rect every frame (render(), below),
        // because the ring is a viewport-fixed DOM element and any camera or
        // viewport change moves it. `plan` supplies only the two things that
        // genuinely are fixed: where the flight starts, and the depth in front
        // of the camera the icon holds from here on.
        const plan = host.planMove(h, dest.el, fit);
        const prog = { p: 0 };
        p.tl.add(prog, { p: [0, 1], duration: dur * 1000, ease }, at * 1000);
        const touchdown = at + dur;
        p.move = {
          handle: h, prog, mode, touchdown, flightStart: at, xfade,
          el: dest.el, fit, depth: plan.depth, from: plan.from,
          // Captured the first time the flight is actually reached: the icon's
          // own controller is still turning it right up to that instant, so no
          // earlier value is the truth. Once captured it never changes, which
          // is what keeps seeking back and forth through a landing exact.
          rot: null,
          releaseAt: mode === 'glyph' ? touchdown : (land.after === 'glyph' ? touchdown + delay : null),
        };
        if (dest.kind === 'cell' && slotsBind) {
          p.pending = { index: dest.index, at: touchdown, glyphAt: p.move.releaseAt };
          flow.filled[dest.index] = fillEntry(h.name, p.move.releaseAt === null ? 'object' : 'glyph');
          flow.landed[dest.index] = { icon: h.name, el: dest.el, fit, depth: plan.depth };
        }
      },
    });

    // OVERLAP — the one number an author retunes in review: how many seconds
    // the incoming entrance starts BEFORE the outgoing exit ends. 0 = strictly
    // sequential; >= the exit's length = both from t 0.
    const overlap = sIn ? num(sIn.overlap ?? 0, `steps.${stepId(sIn, to)}.overlap`) : 0;
    const offset = Math.max(0, exitEnd - Math.max(0, overlap));
    let inEnd = exitEnd;
    if (sIn) {
      // The incoming icon owns bind.icon.state for this phase; reset it so its
      // entrance's `from` values are what the audience actually sees.
      if (bind.icon) Object.assign(bind.icon.state, DEFAULTS.icon);
      inEnd = addTracks(p.tl, sIn.timeline ?? [], `steps.${stepId(sIn, to)}.timeline`, offset,
        { iconState: bind.icon?.state, zero: z.zero, move: null });
      p.swapAt = offset;
    }
    z.apply();
    p.duration = Math.max(exitEnd, inEnd);
    // A landing is not finished until its object -> glyph CROSS-FADE is. Without
    // this the last step of a flow (whose incoming entrance is zero-length) ends
    // exactly at touchdown and the fade freezes half-done — the object never
    // leaves and the mark never arrives.
    if (p.move && p.move.releaseAt !== null) p.duration = Math.max(p.duration, p.move.releaseAt + p.move.xfade);
    p.on = stepOns[to ?? from];
    phase = p;
    if (p.incoming) {
      toRest(p.incoming);
      // The SAME reset the first step gets from enterStep(). An icon arriving
      // through a transition is starting its step just as much as one arriving
      // at a restart, and its controller has been accumulating yaw the whole
      // time it was off screen.
      if (sIn && startModeOf(sIn, to) === 'reset') host.resetMotion?.(p.incoming);
      p.incoming.wrapper.visible = false;
    }
    seekTo(0);
  }

  // ---- what a phase shows at time t --------------------------------------------------
  // How far through the object -> glyph cross-fade we are: 0 = the object
  // alone, 1 = the mark alone. `as` still flips at releaseAt, so a ring reports
  // 'glyph' from the instant the swap starts and the fade is the presentation.
  function glyphMix(m) {
    if (!m || m.releaseAt === null) return 0;
    if (m.xfade <= 0) return t >= m.releaseAt ? 1 : 0;
    return Math.min(1, Math.max(0, (t - m.releaseAt) / m.xfade));
  }

  function slotAt(i) {
    const f = flow.filled[i];
    if (!f) return null;
    const p = phase?.pending;
    if (p && p.index === i) {
      if (t < p.at) return null;                                    // still in the air
      if (p.glyphAt !== null && t < p.glyphAt) return { ...f, as: 'object', mix: 0 };
      if (p.glyphAt !== null) return { ...f, mix: glyphMix(phase.move) };
    }
    return { ...f, mix: 1 };
  }

  function applyCopy() {
    const p = phase;
    const i = (p && p.inStep !== null && p.inStep !== p.outStep && t >= p.swapAt) ? p.inStep : p?.outStep ?? null;
    if (i === lastCopy) return;
    lastCopy = i;
    const copy = i === null || i === undefined ? {} : (steps[i].copy ?? {});
    for (const b of Object.values(bind)) {
      if (b.kind !== 'dom' || b.type === 'slots' || b.type === 'pips') continue;
      b.el.textContent = String(copy[b.el.dataset.seq] ?? b.text ?? '');
    }
  }

  function setActive(h) {
    if (h === activeHandle) return;
    activeHandle = h;
    host.setActive(h ?? null);
  }

  // ---- drag: the runtime's own yaw/pitch, on the WRAPPER --------------------------------
  // Deliberately not on the icon's own object: a controller assigns that every
  // frame and would erase this before render. On the wrapper the two compose —
  // a dragged `gem` keeps its idle spin and turns with the finger at once —
  // and an icon with no controller at all becomes draggable for free.
  const drags = new Map();      // handle -> { yaw, pitch, tl, at, dur }
  function dragOf(h) {
    let d = drags.get(h);
    if (!d) drags.set(h, d = { yaw: 0, pitch: 0, tl: null, at: 0, dur: 0 });
    return d;
  }
  function applyDrag(h) {
    const d = drags.get(h);
    h.wrapper.rotation.set(d ? d.pitch : 0, d ? d.yaw : 0, 0);
  }
  // Back to rest means back to rest: position, scale AND whatever a finger
  // left on the wrapper.
  function toRest(h) {
    host.rest(h);
    const d = drags.get(h);
    if (d) { d.yaw = 0; d.pitch = 0; d.tl = null; }
  }

  function applyIcon(h, s) {
    if (!h) return;
    h.wrapper.scale.setScalar(s.scale);
    h.wrapper.position.set(0, s.rise, 0);
    applyDrag(h);
    fadeFor(h)?.(s.fade);
  }

  // Every landed object, re-solved against its ring's CURRENT rect. The rings
  // are DOM elements fixed to the viewport, so one measurement at touchdown is
  // wrong the moment anything changes the projection — a wheel zoom moved a
  // landed object 67 px out of its ring. Three rect reads a frame, cached.
  function anchorLanded() {
    const m = phase?.move;
    for (const L of flow.landed) {
      if (!L) continue;
      const h = handles.get(L.icon);
      if (!h) continue;
      if (m && m.handle === h && t < m.touchdown) continue;   // still in the air
      // An icon a later step puts back on the canvas as the hero is that
      // step's to place, not this pass's.
      if (h === phase?.incoming || (phase?.kind === 'entrance' && h === phase.actor)) continue;
      const a = host.anchor(h, L.el, L.fit, L.depth);
      h.wrapper.position.set(a.x, a.y, a.z);
      h.wrapper.scale.setScalar(a.s);
      applyDrag(h);
    }
  }

  // The landing turn. Captured once, at the frame the flight is first reached,
  // and normalised to the SHORTEST way round: a measured collect used to spin
  // to 4.8002 rad, freeze, and then snap to 0 in one frame — 275 degrees of
  // it. Now the turn is spread across the flight and the icon arrives facing
  // front with nothing left to assign.
  function captureRest(h) {
    const o = h.api.object.rotation, d = dragOf(h);
    // The angle is NOT wrapped into (-pi, pi] first, and that is deliberate:
    // wrapping is the same orientation but a 2*pi step in the number, which is
    // exactly the discontinuity this is here to remove. The turn is therefore
    // continuous and the icon rests facing front at `rotation.y` = 0 MODULO
    // 2*pi — nothing is assigned, so nothing can snap.
    return {
      x: o.x, y: o.y, z: o.z,
      dx: shortest(-o.x), dy: shortest(-o.y), dz: shortest(-o.z),
      yaw: d.yaw, pitch: d.pitch,
    };
  }

  function render() {
    host.beginFrame?.();
    // Both are no-ops unless something actually changed: the step's `input:`
    // policy, and the orientation the 2D elements are placed for.
    syncInput();
    syncLayout();
    // 3D first, 2D second: the anchoring READS the rings' rects, and reading
    // them before this frame's DOM writes keeps it off the layout critical
    // path instead of forcing a reflow per ring.
    const ib = bind.icon, p = phase;
    if (ib && p) {
      // The INCOMING icon owns the entrance channels during a transition; the
      // outgoing one owns the exit channels and, if there is one, the move.
      if (p.incoming) {
        applyIcon(p.incoming, ib.state);
        p.incoming.wrapper.visible = t >= p.swapAt;
      } else if (p.kind === 'entrance') {
        applyIcon(p.actor, ib.state);
      }
      if (p.kind === 'transition' && p.actor) {
        if (p.move) renderMove(p.move, ib);
        else applyIcon(p.actor, ib.outState);
      }
      anchorLanded();
      setActive((p.incoming && t >= p.swapAt) ? p.incoming
        : (p.move && t >= p.move.flightStart ? null : p.actor));
    }
    applyCopy();
    for (const b of Object.values(bind)) if (b.kind === 'dom' && b.type !== 'slots' && b.type !== 'pips') renderDom(b);
    if (slotsBind) renderSlots(slotsBind, slotAt);
  }

  function renderMove(m, ib) {
    const h = m.handle, w = h.wrapper, k = m.prog.p;
    // The controller drives rotation right up to the flight, and the timeline
    // from the flight on — the hand-over is the same instant the icon leaves
    // the update path, so there is no frame where both write and none where
    // neither does.
    const flying = t >= m.flightStart;
    host.setFrozen(h, flying);
    if (!flying) {
      m.rot = null;                                  // seeking back before the flight
    } else if (t <= m.touchdown) {
      if (!m.rot) m.rot = captureRest(h);
      const r = m.rot, o = h.api.object.rotation, d = dragOf(h);
      o.x = r.x + r.dx * k; o.y = r.y + r.dy * k; o.z = r.z + r.dz * k;
      d.tl = null;                                   // a landing outranks a spring-back
      d.yaw = r.yaw * (1 - k); d.pitch = r.pitch * (1 - k);
    }
    // Past touchdown nothing above is written at all: the icon is already at
    // rest, and leaving it alone is what lets a visitor spin it in its ring.

    // Position and scale interpolate toward the ring's LIVE anchor, so a camera
    // or viewport change mid-flight bends the path to where the ring IS rather
    // than to where it was. After touchdown anchorLanded() owns them outright.
    if (t < m.touchdown) {
      const a = host.anchor(h, m.el, m.fit, m.depth);
      w.position.set(mix(m.from.x, a.x, k), mix(m.from.y, a.y, k), mix(m.from.z, a.z, k));
      w.scale.setScalar(mix(m.from.s, a.s, k));
      applyDrag(h);
    }
    const x = glyphMix(m);
    fadeFor(h)?.(ib.outState.fade * (1 - x));
    w.visible = x < 1;
  }

  function seekTo(seconds) {
    if (disposed || !phase) return;
    t = Math.min(phase.duration, Math.max(0, Number(seconds) || 0));
    phase.tl.seek(t * 1000);
    render();
  }

  // ---- verbs ---------------------------------------------------------------------------
  async function acquire(name) {
    if (handles.has(name)) return handles.get(name);
    const h = await host.acquire(name);
    handles.set(name, h);
    return h;
  }

  function advance() {
    if (!flowMode || disposed) return;
    const from = flow.index;
    const to = from + 1 < steps.length ? from + 1 : null;
    if (to === null) return;                       // the last step is the end state
    const need = steps[to].icon;
    if (need && !handles.has(need)) {              // preload has not reached it yet
      acquire(need).then(() => { if (!disposed && flow.index === from) advance(); }).catch(err => console.error(err));
      return;
    }
    flow.index = to;
    transition(from, to);
    playing = true;
    save();
  }

  function restart() {
    if (!flowMode || disposed) return;
    flow.index = 0;
    setFilledFromNames(initialFilled);             // rings empty INSTANTLY — state, not animation
    flow.landed.fill(null);
    for (const h of handles.values()) { host.setFrozen(h, false); toRest(h); h.wrapper.visible = false; }
    if (bind.icon) { Object.assign(bind.icon.state, DEFAULTS.icon); Object.assign(bind.icon.outState, DEFAULTS.icon); }
    lastCopy = undefined;
    enterStep(0);
    playing = true;
    save();
  }

  // ---- pointer routing -------------------------------------------------------------------
  // Which icons can actually be grabbed right now: the active one, and every
  // landed one that is still on screen. An icon in flight is deliberately not
  // on the list — it belongs to the timeline until it touches down.
  function grabCandidates() {
    const out = [];
    const m = phase?.move;
    for (const L of flow.landed) {
      if (!L) continue;
      const h = handles.get(L.icon);
      if (!h || !h.wrapper.visible || out.includes(h)) continue;
      if (m && m.handle === h && t < m.touchdown) continue;
      out.push(h);
    }
    if (activeHandle && activeHandle.wrapper.visible && !out.includes(activeHandle)) out.push(activeHandle);
    return out;
  }

  // Which step's overrides are in force right now — the incoming one once a
  // transition has swapped, otherwise the outgoing one. Shared by `rest:` and
  // `input:` so the two can never disagree about which step is showing.
  function stepNow() {
    const p = phase;
    return (p && p.inStep !== null && p.inStep !== undefined && t >= (p.swapAt ?? Infinity)) ? p.inStep : (p?.outStep ?? flow.index);
  }
  function restNow() { return stepRest[stepNow()] ?? restDefault; }
  function inputNow() { return stepInput[stepNow()] ?? inputDefault; }

  // The viewer owns `controls.enableZoom` / `enableRotate`, so the resolved
  // policy is PUSHED to it — and only when it actually changes, which is once
  // per step at most. The per-frame render pass already runs, so this rides
  // along rather than needing plumbing of its own.
  let lastInput = null;
  function syncInput() {
    const p = inputNow();
    if (p === lastInput) return;
    lastInput = p;
    host.setInput?.({ zoom: p.zoom, drag: p.drag, swipe: p.swipe.dir });
  }

  // Re-place every 2D element when the stage's orientation flips (§12.15).
  // Same check, same pass: cheap, and it cannot miss a resize because the
  // render pass is what notices.
  let lastPortrait = null;
  function syncLayout() {
    const p = !!host.stage?.portrait;
    if (p === lastPortrait) return;
    lastPortrait = p;
    for (const b of Object.values(bind)) b.place?.(p);
  }

  // ---- actions: what a tap (or a swipe) fires ---------------------------------------------
  // Is a call-to-action live right now? The runtime already marks actionable
  // overlay elements `fg-action`; a step's `on:` says what the verb is. So a
  // swipe during a transition, or on a step with no `advance`, has nothing to
  // fire and does exactly nothing.
  function verbLive(name) {
    const verb = phase?.on?.[name];
    if (!verb || verb === 'nothing') return false;
    const b = bind[name];
    if (!b || !b.el || !b.el.classList.contains('fg-action')) return false;
    if (verb === 'replay') return true;
    // The icon in flight owns the stage until it lands.
    return !(phase.kind === 'transition' && t < phase.duration);
  }
  function actionable() {
    for (const name of Object.keys(phase?.on ?? {})) if (verbLive(name)) return name;
    return null;
  }
  // The one place a verb is carried out, so a tap and a swipe cannot diverge.
  function fireAction(name) {
    if (!verbLive(name)) return false;
    const verb = phase.on[name];
    if (verb === 'replay') { seekTo(0); playing = true; return true; }
    if (verb === 'advance') advance();
    else if (verb === 'restart') restart();
    return true;
  }

  // A SWIPE is classified by the SHAPE OF THE GESTURE, not by where it started:
  // a flick that begins on the icon still counts, because the icon fills the
  // middle of the stage and that is where a thumb lands. Predominantly
  // vertical, far enough, and fast enough — anything slower or rounder stays an
  // icon drag. A gesture reclassified as a swipe after it has already turned the
  // icon is not left crooked: the release below always arms the `rest:`
  // spring-back, which returns it while the step advances.
  function trySwipe(dx, dy, secs) {
    const cfg = inputNow().swipe;
    if (cfg.dir !== 'up') return false;
    if (secs > cfg.time) return false;                             // considered, not flicked
    if (Math.abs(dy) <= Math.abs(dx) * cfg.ratio) return false;    // too round
    if (-dy < cfg.distance * Math.max(1, host.stage?.h ?? 1)) return false;   // UP is a negative dy
    const name = actionable();
    if (!name) return false;                                       // nothing to fire: do nothing
    return fireAction(name);
  }

  let grab = null;      // { handle, x, y, forward }
  let gesture = null;   // { x0, y0, x, y, t0 } — the swipe classifier's raw material
  const WHEEL_GAP = 300;         // ms: a longer pause is a new flick, not the same one
  let wheelAcc = 0, wheelAt = 0;

  // What `down` returns tells the host how much of the gesture to take:
  //   'grab'  an icon was hit — capture the pointer and drive it
  //   'watch' nothing was hit, but the gesture is still being classified as a
  //           possible swipe. NOT captured, so `drag: camera` still orbits.
  //   false   nothing to do with this one at all.
  const router = {
    down(x, y) {
      const p = inputNow();
      gesture = p.swipe.dir === 'none' ? null : { x0: x, y0: y, x, y, t0: performance.now() };
      const claim = gesture ? 'watch' : false;
      if (p.drag !== 'icon') return claim;         // the camera's, or nobody's
      const h = host.hitTest?.(grabCandidates(), x, y, hitPadding) ?? null;
      if (!h) return claim;                        // a drag on nothing rotates nothing
      dragOf(h).tl = null;                         // a new grab cancels a spring-back
      // An icon that ships its own pointer handlers keeps owning its rotation;
      // the runtime only routes the gesture to it. Everything else — including
      // an icon with no controller at all — is turned by the runtime.
      grab = { handle: h, x, y, forward: h.api.pointer ?? null };
      grab.forward?.down?.(x, y);
      return 'grab';
    },
    move(x, y) {
      if (gesture) { gesture.x = x; gesture.y = y; }
      if (!grab) return;
      if (grab.forward) { grab.forward.move?.(x, y); return; }
      // The STAGE's shorter side, not the window's: on an emulated phone the
      // gesture has to feel like it does on a phone.
      const side = Math.max(1, Math.min(host.stage?.w ?? 1, host.stage?.h ?? 1));
      const d = dragOf(grab.handle);
      d.yaw += ((x - grab.x) / side) * DRAG_TURN;
      d.pitch = Math.max(-DRAG_PITCH_LIMIT, Math.min(DRAG_PITCH_LIMIT, d.pitch + ((y - grab.y) / side) * DRAG_TURN));
      grab.x = x; grab.y = y;
      if (!playing) render();                      // a held phase still has to redraw
    },
    up() {
      const g = gesture; gesture = null;
      releaseGrab();
      // AFTER the release, so a swipe that turned the icon on its way up is
      // already springing back as the step advances.
      if (g) trySwipe(g.x - g.x0, g.y - g.y0, (performance.now() - g.t0) / 1000);
    },
    // ?dev=mobile maps the wheel onto the SWIPE channel so the gesture can be
    // exercised with a trackpad or a mouse. It goes through the classifier
    // above — there is no second gesture implementation to drift out of step.
    // A wheel DOWN (positive deltaY) is the page-scrolling gesture a swipe UP
    // performs on a touch screen, hence the sign flip.
    wheel(dy) {
      const now = performance.now();
      if (now - wheelAt > WHEEL_GAP) wheelAcc = 0;
      wheelAt = now;
      wheelAcc += dy;
      if (trySwipe(0, -wheelAcc, 0)) wheelAcc = 0;
    },
  };

  function releaseGrab() {
    if (!grab) return;
    const g = grab; grab = null;
    if (g.forward) { g.forward.up?.(); return; }
    const cfg = restNow();
    const d = dragOf(g.handle);
    if (!cfg.spring || cfg.dur <= 0) return;       // `spring: false` leaves it where it was left
    if (!d.yaw && !d.pitch) return;
    // A real tween, not a per-frame decay, so the authored ease (outBack's
    // overshoot, say) is the one Anime.js implements.
    d.tl = createTimeline({ autoplay: false, defaults: { composition: 'none' } });
    d.tl.add(d, { yaw: 0, pitch: 0, duration: cfg.dur * 1000, ease: cfg.ease }, 0);
    d.at = 0; d.dur = cfg.dur;
  }

  // Spring-back runs in REAL time, not sequence time: it answers a finger, not
  // a timeline, and must survive a phase that has already reached `end: hold`.
  function stepSprings(dt) {
    let moved = false;
    for (const d of drags.values()) {
      if (!d.tl) continue;
      d.at += dt;
      d.tl.seek(Math.min(d.at, d.dur) * 1000);
      if (d.at >= d.dur) { d.tl = null; d.yaw = 0; d.pitch = 0; }
      moved = true;
    }
    return moved;
  }

  // The listeners are attached ONCE — the element must not be rebuilt under a
  // finger that is about to tap it — and dispatch through the current phase.
  const listeners = [];
  for (const on of stepOns) for (const name of Object.keys(on)) {
    const b = bind[name];
    if (b.el.classList.contains('fg-action')) continue;
    b.el.classList.add('fg-action');
    // A tap and a swipe run the SAME verb through the same guard (fireAction),
    // so "the button works but the swipe does not" cannot happen.
    const handler = () => { fireAction(name); };
    b.el.addEventListener('click', handler);
    listeners.push([b.el, handler]);
  }

  // ---- preload -------------------------------------------------------------------------
  // Every icon in the pack is built up front, behind the first step's
  // entrance, so a tap never stalls on a geometry build. Each icon's glyph is
  // captured at the same moment — offscreen, at its front orientation — so the
  // mark in a ring is framed identically no matter where the icon happened to
  // be rotated when it was collected.
  async function preload() {
    for (const name of packIcons) {
      try {
        const h = await acquire(name);
        // Force the icon fully opaque for the capture. The icon the flow is
        // currently entering is sitting at its t=0 pose, which is usually
        // `fade: 0` — capture it as it is and the mark comes back literally
        // empty (measured: alpha coverage 0.0000). render() below puts the
        // fade back to whatever the current time says it should be.
        fadeFor(h)?.(1);
        // Frame the mark through the very ring this icon lands in, so the PNG
        // and the live object are the same projection at the same size and the
        // cross-fade between them has nothing to give away.
        const k = steps.findIndex(st => st.icon === name);
        const g = await host.glyphFor(h, k >= 0 ? stepLand[k] : null);
        if (g) glyphs.set(name, g);
        if (!disposed) render();
      } catch (err) {
        warnings.push(`could not preload icon "${name}": ${err.message}`);
        console.warn(`[sequence] ${file}:`, err);
      }
    }
    // Rings filled before the glyphs existed (a resume, or `initial:`) get
    // their marks now.
    for (const f of flow.filled) if (f && !f.glyph) f.glyph = glyphs.get(f.icon) ?? null;
    if (slotsBind && !disposed) renderSlots(slotsBind, slotAt);
  }

  // ---- runtime -------------------------------------------------------------------------
  const runtime = {
    file, warnings, flow: flowMode, start: startDefault,
    targets: Object.keys(bind),
    icons: packIcons.slice(),
    storageKey: storeKey,
    get duration() { return phase?.duration ?? 0; },
    get step() { return stepId(steps[flow.index], flow.index); },
    get stepIndex() { return flow.index; },
    get phase() { return phase?.kind ?? null; },
    get time() { return t; },
    // A held sequence reports itself as not playing — it is not — while keeping
    // `playing` underneath, so the hold lifting resumes rather than restarts.
    get playing() { return playing && !held; },
    get held() { return held; },
    // What this sequence was composed for; the VIEWER owns the lock itself.
    orientation,
    get input() { const p = inputNow(); return { zoom: p.zoom, drag: p.drag, swipe: { ...p.swipe } }; },
    // The pointer router, so the ?dev=mobile stage can feed the wheel into the
    // very same swipe classifier a finger uses.
    router,
    // Ring presentation at the current time — for deterministic checks.
    // `mix` is the object -> glyph cross-fade (0 = object, 1 = mark).
    get slots() { return Array.from({ length: slotCount }, (_, i) => { const f = slotAt(i); return f ? { icon: f.icon, as: f.as, mix: f.mix ?? 1 } : null; }); },
    // The grab zone and the spring-back in force, and what is being dragged —
    // for deterministic checks of §12.12.
    get hit() { return { padding: hitPadding }; },
    get rest() { return { ...restNow() }; },
    get grabbed() { return grab?.handle.name ?? null; },
    get turns() { return Object.fromEntries([...drags].map(([h, d]) => [h.name, { yaw: d.yaw, pitch: d.pitch, springing: !!d.tl }])); },
    // A snapshot of every target's channel state — for deterministic checks.
    get states() { return Object.fromEntries(Object.entries(bind).filter(([, b]) => b.state).map(([n, b]) => [n, { ...b.state }])); },
    get saved() { return storeKey ? readSaved(storeKey) : null; },
    seek(seconds) { seekTo(seconds); },            // the dev transport: never persists
    play() { if (t >= (phase?.duration ?? 0)) seekTo(0); playing = true; },
    pause() { playing = false; },
    hold(on) { held = !!on; },
    advance, restart,
    // Called by the host's render loop AFTER the pack's own update(dt).
    // `end: hold` is the whole termination story: clamp and stop.
    update(dt) {
      if (disposed || !phase || held) return;
      // Called EVERY frame, playing or not: a held phase still has to settle a
      // spring-back and still has to keep its landed objects anchored to rings
      // that the camera or the viewport may have moved under them.
      stepSprings(dt);
      if (playing) {
        seekTo(t + dt);
        if (t >= phase.duration) playing = false;
      } else {
        render();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; playing = false;
      host.detachDrag?.();
      grab = null;
      for (const d of drags.values()) d.tl = null;
      for (const [el, h] of listeners) el.removeEventListener('click', h);
      for (const b of Object.values(bind)) if (b.kind === 'dom') b.el.remove();
      for (const h of handles.values()) { host.setFrozen(h, false); toRest(h); fadeFor(h)?.(1); h.wrapper.visible = true; }
      host.dispose?.();
    },
  };

  for (const w of warnings) console.warn(`[sequence] ${file}: ${w}`);
  host.root.appendChild(frag);
  // One router for the whole sequence, hit-testing every press. It replaces
  // the host's per-icon pointer attachment, which sent every drag anywhere on
  // the canvas to the active icon and gave landed objects nothing.
  host.attachDrag?.(router);
  // Push the `input:` policy immediately rather than waiting for the first
  // frame: a sequence that resumes into a later step does not draw until its
  // icon has been acquired, and a stray wheel-zoom in between is exactly the
  // accident this block exists to remove.
  syncInput();

  // The starting step's icon is usually the one the viewer already loaded (put
  // it first in icons.yml and it always is). When a resume lands elsewhere the
  // right icon is acquired first, so nothing flashes at the wrong step.
  const startsHere = !flowMode || steps[flow.index].icon === undefined || steps[flow.index].icon === host.iconName;
  // `posed` resolves the moment the STARTING STEP can draw — its t=0 pose
  // applied — which is what the viewer's loading curtain waits for. `ready` is
  // the whole pack: preload and every glyph capture, which deliberately carry
  // on BEHIND the lifted curtain (AGENT.md §7).
  let posed;
  runtime.posed = new Promise(resolve => { posed = resolve; });
  if (startsHere) { enterStep(flow.index); posed(); }
  runtime.ready = (async () => {
    try {
      if (!startsHere) { await acquire(steps[flow.index].icon); if (!disposed) enterStep(flow.index); }
    } finally {
      posed();   // resolved either way: a failed acquire must not hold the curtain up
    }
    if (flowMode && !disposed) await preload();
  })();
  return runtime;
}
