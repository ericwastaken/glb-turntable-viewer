// sequence.js — plays a pack's sequence.yml: the timed ENTRANCE of one icon
// step (the 3D icon swelling in, lines of 2D copy resolving, a call-to-action
// arriving) on top of whatever motion the icon's own controller provides.
//
// index.html imports this file only when a loaded icon carries `api.sequence`,
// so a pack without a sequence never fetches this module or Anime.js.
//
// Ground rules, all deliberate (AGENT.md §12):
//   - The sequence NEVER writes rotation. A pack controller assigns
//     `rotation.y` every frame, so a spin channel would be overwritten before
//     render. `scale` / `rise` go on a WRAPPER Group the host puts around the
//     icon; the icon's own object is never touched.
//   - Framing is solved by the host at rest pose BEFORE the t=0 pose is
//     applied, and never re-solved. An entrance starting at scale 0.52 would
//     otherwise be framed against a shrunken bounding box.
//   - Anime.js is created paused and driven by tl.seek(t) from the host's
//     accumulated dt — never by anime's own ticker. Deterministic, scrubbable,
//     and immune to the hidden-pane requestAnimationFrame pause. With
//     `autoplay: false` the anime engine never starts its loop (verified:
//     engine.reqId stays 0), so no engine.pause() is needed.
//   - Channels animate a plain state object per target, and ONE render pass
//     composes it into opacity / transform / filter / clip-path. Two tweens
//     writing `filter` on the same node would clobber each other; the state
//     object makes composition this file's job.
//
// Anime.js behaviour this file is written around (measured against the
// vendored v4.5.0 build): a child tween's `from` value is NOT rendered until
// the timeline first reaches it, so the t=0 pose is applied here explicitly;
// a tween skipped by a direct jump IS rendered at its end value; a finished
// tween is NOT re-written on later seeks, so the state objects belong to anime
// and are never reset per frame.

import { createTimeline, cubicBezier } from 'animejs';

// --- vocabulary ----------------------------------------------------------------
// Short on purpose: exactly what an entrance needs. Anything else is a
// load-time error, by name, so a typo cannot become "the copy just didn't
// animate" three days later.
export const LAYER_CHANNELS = {
  icon: ['fade', 'scale', 'rise'],                 // 3D: the wrapper Group (+ setFade)
  dom:  ['fade', 'rise', 'blur', 'wipe', 'bloom'], // 2D: hud + overlay elements
};
const DEFAULTS = {
  icon: { fade: 1, scale: 1, rise: 0 },
  dom:  { fade: 1, rise: 0, blur: 0, wipe: 1, bloom: 0 },
};
export const ELEMENT_TYPES = { hud: ['pips'], overlay: ['text', 'button'] };
export const ACTIONS = ['replay', 'nothing'];      // Phase 1 verbs for `on:`
// Anime.js v4 easing names (the parametrised forms and springs are left out).
export const EASE_NAME = /^(linear|none|in|out|inOut|outIn|(in|out|inOut|outIn)(Quad|Cubic|Quart|Quint|Sine|Circ|Expo|Bounce|Back|Elastic))$/;
const CUBIC_BEZIER = /^cubic-bezier\(\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*,\s*([-+\d.]+)\s*\)$/;

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
function buildElement(name, decl, layer, copy) {
  const where = `stage.${layer}.${name}`;
  if (!isObj(decl)) fail(where, 'must be a mapping such as { type: text, top: 0.7 }');
  const type = decl.type;
  if (!ELEMENT_TYPES[layer].includes(type)) fail(where, `type must be one of ${ELEMENT_TYPES[layer].join(', ')} (got ${JSON.stringify(type)})`);
  const el = document.createElement(type === 'button' ? 'button' : 'div');
  el.className = `fg-el fg-${type}`;
  el.dataset.seq = name;
  el.style.left = `${frac(decl.left ?? 0.5, where + '.left') * 100}%`;
  el.style.top = `${frac(decl.top ?? 0.5, where + '.top') * 100}%`;
  el.style.fontSize = `${num(decl.size ?? 0.045, where + '.size') * 100}vmin`;
  if (decl.color !== undefined) { el.style.color = String(decl.color); el.style.setProperty('--glow', String(decl.color)); }
  if (decl.weight !== undefined) el.style.fontWeight = String(decl.weight);
  if (decl.tracking !== undefined) el.style.letterSpacing = `${num(decl.tracking, where + '.tracking')}em`;
  if (type === 'button') el.type = 'button';
  if (type !== 'pips') el.textContent = String(copy[name] ?? decl.text ?? '');
  return el;
}

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
// The step played for an icon is the first whose `icon:` names it, else the
// first step with no `icon:` at all. `stage.icon.ref` gates the whole
// sequence: `current` applies to every icon, a name applies to that icon only.
export function pickStep(doc, iconName) {
  const steps = doc.steps;
  if (!Array.isArray(steps) || !steps.length) fail('steps', 'must be a non-empty list');
  return steps.find(s => isObj(s) && s.icon === iconName) ?? steps.find(s => isObj(s) && s.icon === undefined) ?? null;
}

// --- build -----------------------------------------------------------------------
// host = { root: HTMLElement (#fg), wrapper: THREE.Group around the icon,
//          api: the built icon's component API, iconName, file }
// Returns null when this sequence does not apply to the icon; otherwise the
// runtime described in AGENT.md §12 (duration, time, seek, play, pause, …).
export function createSequence(doc, host) {
  const file = host.file ?? 'sequence.yml';
  if (!isObj(doc)) fail(file, 'must be a YAML mapping at the root');
  if (doc.version !== 1) fail(file, `unsupported version ${JSON.stringify(doc.version)} (this viewer plays version: 1)`);
  const stage = doc.stage ?? {};
  if (!isObj(stage)) fail('stage', 'must be a mapping of layers (hud, icon, overlay)');
  for (const layer of Object.keys(stage)) {
    if (!['hud', 'icon', 'overlay'].includes(layer)) fail(`stage.${layer}`, 'unknown layer — this viewer knows hud, icon, overlay');
  }
  const ref = stage.icon?.ref ?? 'current';
  if (stage.icon && ref !== 'current' && ref !== host.iconName) return null;
  const step = pickStep(doc, host.iconName);
  if (!step) return null;
  const stepId = step.id ?? 'step';
  const copy = step.copy ?? {};
  if (!isObj(copy)) fail(`steps.${stepId}.copy`, 'must be a mapping of element name → text');

  // ---- bind names to targets ---------------------------------------------------
  const bind = {};   // name -> { kind: 'dom'|'icon', el?, state }
  const frag = document.createDocumentFragment();
  for (const layer of ['hud', 'overlay']) {
    const decls = stage[layer] ?? {};
    if (!isObj(decls)) fail(`stage.${layer}`, 'must be a mapping of element name → declaration');
    for (const [name, decl] of Object.entries(decls)) {
      if (name === 'icon' || bind[name]) fail(`stage.${layer}.${name}`, 'name already used by another target');
      const el = buildElement(name, decl, layer, copy);
      bind[name] = { kind: 'dom', el, type: decl.type, state: { ...DEFAULTS.dom } };
      frag.appendChild(el);
    }
  }
  for (const name of Object.keys(copy)) {
    if (!bind[name] || bind[name].kind !== 'dom') fail(`steps.${stepId}.copy.${name}`, 'is not a declared overlay/hud element');
  }
  if (stage.icon) bind.icon = { kind: 'icon', state: { ...DEFAULTS.icon } };

  // ---- capability: can this icon fade? --------------------------------------------
  const warnings = [];
  let fade = null;
  if (bind.icon) {
    fade = typeof host.api.setFade === 'function' ? v => host.api.setFade(v) : materialFade(host.api.object);
    if (!fade) {
      const degrade = doc.requires?.['icon.fade']?.degrade ?? 'scale-only';
      if (degrade !== 'scale-only') fail('requires.icon.fade', `this icon cannot fade and degrade is "${degrade}" — the only supported degrade is scale-only`);
      warnings.push(`icon.fade unavailable — the icon exports no setFade(v) and has no standard materials to fade. Degrading to scale-only (AGENT.md §12).`);
    }
  }

  // ---- initial state (state, not motion) -------------------------------------------
  const initial = doc.initial ?? {};
  if (!isObj(initial)) fail('initial', 'must be a mapping of target name → state');
  for (const [name, st] of Object.entries(initial)) {
    const b = bind[name];
    if (!b) fail(`initial.${name}`, 'is not a declared target');
    if (!isObj(st)) fail(`initial.${name}`, 'must be a mapping');
    if (b.kind === 'dom' && b.type === 'pips') {
      const total = Math.max(0, Math.round(num(st.total ?? 3, `initial.${name}.total`)));
      const filled = Math.max(0, Math.round(num(st.filled ?? 0, `initial.${name}.filled`)));
      b.pips = { filled: Math.min(filled, total), total };
    }
    for (const [ch, v] of Object.entries(st)) {
      if (b.type === 'pips' && (ch === 'filled' || ch === 'total')) continue;
      if (!LAYER_CHANNELS[b.kind].includes(ch)) fail(`initial.${name}.${ch}`, `not a ${b.kind} channel (${LAYER_CHANNELS[b.kind].join(', ')})`);
      b.state[ch] = num(v, `initial.${name}.${ch}`);
    }
  }
  for (const b of Object.values(bind)) if (b.type === 'pips') setPips(b.el, b.pips?.filled ?? 0, b.pips?.total ?? 3);

  // ---- timeline -------------------------------------------------------------------
  // Created paused. Positions are absolute milliseconds; `composition: 'none'`
  // keeps two tracks on the same channel from cancelling each other when the
  // timeline is scrubbed backwards.
  const tl = createTimeline({ autoplay: false, defaults: { composition: 'none' } });
  const labels = {};
  const zeroPose = {};   // `${name}.${ch}` -> [startTime, fromValue] of the earliest track
  let cursorEnd = 0, duration = 0;
  const timeline = step.timeline;
  if (!Array.isArray(timeline)) fail(`steps.${stepId}.timeline`, 'must be a list of tracks and labels');

  timeline.forEach((entry, i) => {
    const where = `steps.${stepId}.timeline[${i}]`;
    if (!isObj(entry)) fail(where, 'must be a mapping');
    if (entry.label !== undefined) {
      const at = resolveAt(entry.at, labels, cursorEnd, `${where} (label ${entry.label})`);
      labels[String(entry.label)] = at;
      return;
    }
    const id = entry.id ?? `#${i}`;
    const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
    if (!targets.length || targets.some(t => typeof t !== 'string')) fail(`${where} (${id})`, 'target must be a name or a list of names');
    const at = resolveAt(entry.at, labels, cursorEnd, `${where} (${id}).at`);
    const stagger = entry.stagger === undefined ? 0 : num(entry.stagger, `${where} (${id}).stagger`);
    const timing = entry.timing ?? {};
    if (!isObj(timing)) fail(`${where} (${id}).timing`, 'must be { dur, ease }');
    const dur = timing.dur === undefined ? 0 : num(timing.dur, `${where} (${id}).timing.dur`);
    const ease = resolveEase(timing.ease, `${where} (${id}).timing.ease`);
    if (!isObj(entry.channels) || !Object.keys(entry.channels).length) fail(`${where} (${id})`, 'needs a non-empty channels mapping');

    targets.forEach((name, k) => {
      const b = bind[name];
      if (!b) fail(`${where} (${id})`, `target "${name}" is not declared in stage:`);
      const start = at + k * stagger;
      const props = {};
      for (const [ch, v] of Object.entries(entry.channels)) {
        if (!LAYER_CHANNELS[b.kind].includes(ch)) fail(`${where} (${id}).channels.${ch}`, `not a ${b.kind} channel (${LAYER_CHANNELS[b.kind].join(', ')})`);
        if (b.kind === 'icon' && ch === 'fade' && !fade) continue;   // degraded: drop the channel, keep the track
        if (Array.isArray(v)) {
          if (v.length !== 2) fail(`${where} (${id}).channels.${ch}`, 'a range is exactly [from, to]');
          props[ch] = [num(v[0], `${where}.${ch}[0]`), num(v[1], `${where}.${ch}[1]`)];
          const key = `${name}.${ch}`;
          if (!zeroPose[key] || start < zeroPose[key][0]) zeroPose[key] = [start, v[0]];
        } else {
          props[ch] = num(v, `${where} (${id}).channels.${ch}`);   // from the value at build time
        }
      }
      if (Object.keys(props).length) tl.add(b.state, { ...props, duration: dur * 1000, ease }, start * 1000);
      duration = Math.max(duration, start + dur);
    });
    cursorEnd = at + dur + Math.max(0, targets.length - 1) * stagger;
  });
  duration = Math.max(duration, cursorEnd);

  const end = step.end ?? 'hold';
  if (end !== 'hold') warnings.push(`steps.${stepId}.end: "${end}" is not implemented — holding the final frame (Phase 1 supports end: hold only).`);

  // The t=0 pose: anime does not render a tween's `from` before the timeline
  // first reaches it, so every channel starts at its earliest track's `from`.
  for (const [key, [, from]] of Object.entries(zeroPose)) {
    const [name, ch] = key.split('.');
    bind[name].state[ch] = from;
  }

  // ---- actions --------------------------------------------------------------------
  // Only elements named in `on:` receive pointer events; everything else in
  // the overlay stays click-through so the icon can still be dragged.
  const listeners = [];
  const on = step.on ?? {};
  if (!isObj(on)) fail(`steps.${stepId}.on`, 'must be a mapping such as { cta.tap: { do: replay } }');
  for (const [key, action] of Object.entries(on)) {
    const m = /^([A-Za-z_][\w-]*)\.tap$/.exec(key);
    if (!m) fail(`steps.${stepId}.on.${key}`, 'only <target>.tap is supported');
    const verb = action?.do;
    if (!ACTIONS.includes(verb)) fail(`steps.${stepId}.on.${key}.do`, `must be one of ${ACTIONS.join(', ')}`);
    const b = bind[m[1]];
    if (!b) fail(`steps.${stepId}.on.${key}`, `target "${m[1]}" is not declared in stage:`);
    if (b.kind !== 'dom') { warnings.push(`on.${key}: taps on the icon are not routed in Phase 1 (the canvas belongs to the icon's own controller); ignored.`); continue; }
    b.el.classList.add('fg-action');
    const handler = () => { if (verb === 'replay') { runtime.seek(0); runtime.play(); } };
    b.el.addEventListener('click', handler);
    listeners.push([b.el, handler]);
  }

  // ---- render + playback ----------------------------------------------------------
  const wrapper = host.wrapper;
  function render() {
    for (const b of Object.values(bind)) {
      if (b.kind === 'dom') { renderDom(b); continue; }
      wrapper.scale.setScalar(b.state.scale);
      wrapper.position.y = b.state.rise;
      fade?.(b.state.fade);
    }
  }

  let t = 0, playing = true, disposed = false;
  const runtime = {
    file, step: stepId, duration, warnings,
    targets: Object.keys(bind),
    get time() { return t; },
    get playing() { return playing; },
    // A snapshot of every target's channel state — for deterministic checks.
    get states() { return Object.fromEntries(Object.entries(bind).map(([n, b]) => [n, { ...b.state }])); },
    seek(seconds) {
      if (disposed) return;
      t = Math.min(duration, Math.max(0, Number(seconds) || 0));
      tl.seek(t * 1000);
      render();
    },
    play() { if (t >= duration) runtime.seek(0); playing = true; },
    pause() { playing = false; },
    // Called by the host's render loop AFTER the pack's own update(dt).
    // `end: hold` is the whole termination story: clamp and stop.
    update(dt) {
      if (!playing || disposed) return;
      runtime.seek(t + dt);
      if (t >= duration) playing = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true; playing = false;
      for (const [el, h] of listeners) el.removeEventListener('click', h);
      for (const b of Object.values(bind)) if (b.kind === 'dom') b.el.remove();
      wrapper.scale.setScalar(1); wrapper.position.y = 0; fade?.(1);
    },
  };

  for (const w of warnings) console.warn(`[sequence] ${file}: ${w}`);
  host.root.appendChild(frag);
  runtime.seek(0);   // the t=0 pose — the host has already framed the rest pose
  return runtime;
}
