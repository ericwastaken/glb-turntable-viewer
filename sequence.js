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
//     The one exception is a LANDED icon, which is removed from the update
//     path FIRST and only then given its resting orientation.
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
//
// Anime.js behaviour this file is written around (measured against the
// vendored v4.5.0 build): a child tween's `from` value is NOT rendered until
// the timeline first reaches it, so the t=0 pose is applied here explicitly;
// a tween skipped by a direct jump IS rendered at its end value; a finished
// tween is NOT re-written on later seeks, so the state objects belong to anime
// and are never reset per frame.

import { createTimeline, cubicBezier } from 'animejs';

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
export const LAND_MODES = ['object', 'glyph'];
// Anime.js v4 easing names (the parametrised forms and springs are left out).
export const EASE_NAME = /^(linear|none|in|out|inOut|outIn|(in|out|inOut|outIn)(Quad|Cubic|Quart|Quint|Sine|Circ|Expo|Bounce|Back|Elastic))$/;
const CUBIC_BEZIER = /^cubic-bezier\(\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*\)$/;

// localStorage keys, namespaced so a pack's state cannot collide with anything
// else on the origin. NOTHING is stored unless the pack declares `resume:`.
const STORE_PREFIX = 'glb-viewer:seq:';
const STORE_VERSION = 1;

const fail = (where, msg) => { throw new Error(`sequence: ${where}: ${msg}`); };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, where) => (typeof v === 'number' && Number.isFinite(v)) ? v : fail(where, `expected a number, got ${JSON.stringify(v)}`);
const frac = (v, where) => { const n = num(v, where); return Math.min(1, Math.max(0, n)); };

function resolveEase(v, where) {
  if (v === undefined) return 'outQuad';
  const s = String(v).trim();
  const cb = CUBIC_BEZIER.exec(s);
  if (cb) return cubicBezier(+cb[1], +cb[2], +cb[3], +cb[4]);
  if (EASE_NAME.test(s)) return s;
  return fail(where, `unknown ease "${s}" — use an Anime.js name (outCubic, inOutQuart, …) or cubic-bezier(a,b,c,d)`);
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
// Real DOM (selectable, accessible), positioned by viewport fractions like the
// component `framing`: `top` is the element's vertical CENTER as a fraction
// from the top, `left` its horizontal center (default 0.5), `size` its font
// size as a fraction of the viewport's SHORTER side (vmin) — keyed to height
// alone, a line that fits a landscape desktop wraps into its neighbour on a
// portrait phone (measured: 0.05 × 812 px = 41 px type in a 375 px column).
function placeElement(el, name, decl, where) {
  el.dataset.seq = name;
  el.style.left = `${frac(decl.left ?? 0.5, where + '.left') * 100}%`;
  el.style.top = `${frac(decl.top ?? 0.5, where + '.top') * 100}%`;
  el.style.fontSize = `${num(decl.size ?? 0.045, where + '.size') * 100}vmin`;
}

function buildElement(name, decl, layer) {
  const where = `stage.${layer}.${name}`;
  if (!isObj(decl)) fail(where, 'must be a mapping such as { type: text, top: 0.7 }');
  const type = decl.type;
  if (!ELEMENT_TYPES[layer].includes(type)) fail(where, `type must be one of ${ELEMENT_TYPES[layer].join(', ')} (got ${JSON.stringify(type)})`);
  if (type === 'slots') return buildSlots(name, decl, where);
  const el = document.createElement(type === 'button' ? 'button' : 'div');
  el.className = `fg-el fg-${type}`;
  placeElement(el, name, decl, where);
  if (decl.color !== undefined) { el.style.color = String(decl.color); el.style.setProperty('--glow', String(decl.color)); }
  if (decl.weight !== undefined) el.style.fontWeight = String(decl.weight);
  if (decl.tracking !== undefined) el.style.letterSpacing = `${num(decl.tracking, where + '.tracking')}em`;
  if (type === 'button') el.type = 'button';
  return { el, type };
}

// A `slots` row: `count` rings, each separately addressable as a `to:`
// destination under the name `<element name><1-based index>` — a `slot`
// element with `count: 3` gives the targets `slot1`, `slot2`, `slot3`.
// Colours and sizes come from the declaration as custom properties; the CSS in
// index.html holds only the defaults.
function buildSlots(name, decl, where) {
  const el = document.createElement('div');
  el.className = 'fg-el fg-slots';
  placeElement(el, name, decl, where);
  const count = Math.max(1, Math.round(num(decl.count ?? 3, where + '.count')));
  if (decl.gap !== undefined) el.style.gap = `${num(decl.gap, where + '.gap')}em`;
  if (decl.ring !== undefined) el.style.setProperty('--slot-ring', `${num(decl.ring, where + '.ring')}em`);
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
  return { el, type: 'slots', count, cells };
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
        count: built.count, cells: built.cells,
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

  // ---- which ring does each step land in? ------------------------------------------
  // Read off the step's own `exit:` list, so nothing is declared twice.
  const stepSlot = steps.map((s, i) => {
    const track = (Array.isArray(s.exit) ? s.exit : []).find(e => isObj(e) && e.to !== undefined);
    if (!track) return -1;
    const b = bind[track.to];
    if (!b) fail(`steps.${stepId(s, i)}.exit`, `to: "${track.to}" is not a declared 2D element`);
    return b.kind === 'cell' ? b.index : -1;
  });

  // ---- persistence ------------------------------------------------------------------
  const slotCount = slotsBind ? slotsBind.count : 0;
  const flow = { index: startIndex, filled: new Array(slotCount).fill(null) };
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
    const saved = readSaved(storeKey);
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
    if (p.actor) { host.rest(p.actor); p.actor.wrapper.visible = true; }
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
        const fit = land.fit === undefined ? 0.72 : num(land.fit, `${w}.land.fit`);
        if (land.after !== undefined && land.after !== 'glyph') fail(`${w}.land.after`, 'the only follow-up landing is "glyph"');
        if (land.after === 'glyph' && mode !== 'object') fail(`${w}.land.after`, 'only an object landing can be swapped to a glyph afterwards');
        const delay = land.delay === undefined ? 0.4 : num(land.delay, `${w}.land.delay`);
        const h = p.actor;
        if (!h) fail(w, `step "${stepId(sOut, from)}" has no \`icon:\` to send`);

        // Measured NOW, from the live DOM: the stage is persistent and the
        // rings never move, so one measurement holds for the whole flight.
        const plan = host.planMove(h, dest.el, fit);
        const state = { ...plan.from };
        p.tl.add(state, {
          x: [plan.from.x, plan.to.x], y: [plan.from.y, plan.to.y], z: [plan.from.z, plan.to.z],
          s: [plan.from.s, plan.to.s], duration: dur * 1000, ease,
        }, at * 1000);
        const touchdown = at + dur;
        p.move = {
          handle: h, state, mode, touchdown,
          releaseAt: mode === 'glyph' ? touchdown : (land.after === 'glyph' ? touchdown + delay : null),
        };
        if (dest.kind === 'cell' && slotsBind) {
          p.pending = { index: dest.index, at: touchdown, glyphAt: p.move.releaseAt };
          flow.filled[dest.index] = fillEntry(h.name, p.move.releaseAt === null ? 'object' : 'glyph');
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
    p.on = stepOns[to ?? from];
    phase = p;
    if (p.incoming) { host.rest(p.incoming); p.incoming.wrapper.visible = false; }
    seekTo(0);
  }

  // ---- what a phase shows at time t --------------------------------------------------
  function slotAt(i) {
    const f = flow.filled[i];
    if (!f) return null;
    const p = phase?.pending;
    if (p && p.index === i) {
      if (t < p.at) return null;                                    // still in the air
      if (p.glyphAt !== null && t < p.glyphAt) return { ...f, as: 'object' };
    }
    return f;
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

  function applyIcon(h, s) {
    if (!h) return;
    h.wrapper.scale.setScalar(s.scale);
    h.wrapper.position.set(0, s.rise, 0);
    fadeFor(h)?.(s.fade);
  }

  function render() {
    applyCopy();
    for (const b of Object.values(bind)) if (b.kind === 'dom' && b.type !== 'slots' && b.type !== 'pips') renderDom(b);
    if (slotsBind) renderSlots(slotsBind, slotAt);
    const ib = bind.icon, p = phase;
    if (!ib || !p) return;
    // The INCOMING icon owns the entrance channels during a transition; the
    // outgoing one owns the exit channels and, if there is one, the move.
    if (p.incoming) {
      applyIcon(p.incoming, ib.state);
      p.incoming.wrapper.visible = t >= p.swapAt;
    } else if (p.kind === 'entrance') {
      applyIcon(p.actor, ib.state);
    }
    if (p.kind === 'transition' && p.actor) {
      if (p.move) {
        const m = p.move, w = m.handle.wrapper;
        w.position.set(m.state.x, m.state.y, m.state.z);
        w.scale.setScalar(m.state.s);
        fadeFor(m.handle)?.(ib.outState.fade);
        w.visible = !(m.releaseAt !== null && t >= m.releaseAt);
        // Frozen means REMOVED FROM THE UPDATE PATH first and given its
        // resting orientation second — the icon's own controller would
        // otherwise overwrite the rotation on the very next frame (measured).
        host.setFrozen(m.handle, t >= m.touchdown);
      } else {
        applyIcon(p.actor, ib.outState);
      }
    }
    setActive((p.incoming && t >= p.swapAt) ? p.incoming
      : (p.move && t >= p.move.touchdown ? null : p.actor));
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
    for (const h of handles.values()) { host.setFrozen(h, false); host.rest(h); h.wrapper.visible = false; }
    if (bind.icon) { Object.assign(bind.icon.state, DEFAULTS.icon); Object.assign(bind.icon.outState, DEFAULTS.icon); }
    lastCopy = undefined;
    enterStep(0);
    playing = true;
    save();
  }

  // The listeners are attached ONCE — the element must not be rebuilt under a
  // finger that is about to tap it — and dispatch through the current phase.
  const listeners = [];
  for (const on of stepOns) for (const name of Object.keys(on)) {
    const b = bind[name];
    if (b.el.classList.contains('fg-action')) continue;
    b.el.classList.add('fg-action');
    const handler = () => {
      const verb = phase?.on?.[name];
      if (!verb || verb === 'nothing') return;
      if (verb === 'replay') { seekTo(0); playing = true; return; }
      // A tap during a transition is ignored: the icon in flight owns the
      // stage until it lands.
      if (phase.kind === 'transition' && t < phase.duration) return;
      if (verb === 'advance') advance();
      else if (verb === 'restart') restart();
    };
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
        const g = await host.glyphFor(h);
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
    file, warnings, flow: flowMode,
    targets: Object.keys(bind),
    icons: packIcons.slice(),
    storageKey: storeKey,
    get duration() { return phase?.duration ?? 0; },
    get step() { return stepId(steps[flow.index], flow.index); },
    get stepIndex() { return flow.index; },
    get phase() { return phase?.kind ?? null; },
    get time() { return t; },
    get playing() { return playing; },
    // Ring presentation at the current time — for deterministic checks.
    get slots() { return Array.from({ length: slotCount }, (_, i) => { const f = slotAt(i); return f ? { icon: f.icon, as: f.as } : null; }); },
    // A snapshot of every target's channel state — for deterministic checks.
    get states() { return Object.fromEntries(Object.entries(bind).filter(([, b]) => b.state).map(([n, b]) => [n, { ...b.state }])); },
    get saved() { return storeKey ? readSaved(storeKey) : null; },
    seek(seconds) { seekTo(seconds); },            // the dev transport: never persists
    play() { if (t >= (phase?.duration ?? 0)) seekTo(0); playing = true; },
    pause() { playing = false; },
    advance, restart,
    // Called by the host's render loop AFTER the pack's own update(dt).
    // `end: hold` is the whole termination story: clamp and stop.
    update(dt) {
      if (!playing || disposed || !phase) return;
      seekTo(t + dt);
      if (t >= phase.duration) playing = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true; playing = false;
      for (const [el, h] of listeners) el.removeEventListener('click', h);
      for (const b of Object.values(bind)) if (b.kind === 'dom') b.el.remove();
      for (const h of handles.values()) { host.setFrozen(h, false); host.rest(h); fadeFor(h)?.(1); h.wrapper.visible = true; }
      host.dispose?.();
    },
  };

  for (const w of warnings) console.warn(`[sequence] ${file}: ${w}`);
  host.root.appendChild(frag);

  // The starting step's icon is usually the one the viewer already loaded (put
  // it first in icons.yml and it always is). When a resume lands elsewhere the
  // right icon is acquired first, so nothing flashes at the wrong step.
  const startsHere = !flowMode || steps[flow.index].icon === undefined || steps[flow.index].icon === host.iconName;
  if (startsHere) enterStep(flow.index);
  runtime.ready = (async () => {
    if (!startsHere) { await acquire(steps[flow.index].icon); if (!disposed) enterStep(flow.index); }
    if (flowMode && !disposed) await preload();
  })();
  return runtime;
}
