// component.js — UNIVERSAL icon-pack loader for the GLB Turntable Viewer.
// This file is always the same, for every pack. Do not edit it.
//
// It reads icons.yml (the manifest: folder names under icons/, plus optional
// backgrounds and an optional sequence file) and drives each icon through the
// standard exports every icon's src/index.js provides:
//
//   createIconObject({ geometry, textures, srgbOutput })   required
//   loadIconGeometry({ path })                             required
//   loadIconTextures({ path, renderer })                   optional
//   IconController                                         optional
//   LAYOUT ({ iconHeightFraction, verticalCenter })        optional
//
// The object createIconObject returns may also carry setFade(v) — a 0–1
// opacity setter a sequence uses to fade the icon in. Without it the viewer
// falls back to fading the icon's standard materials.
//
// Pack layout:
//   component.js          this file (never changes)
//   icons.yml             icons: [nameA, nameB, ...]                    required
//                         background: backgrounds/sky.jpg               optional, pack-wide
//                         backgrounds: { nameB: backgrounds/alt.jpg }   optional, per icon
//                         glyphs: { nameA: glyphs/a.png }               optional, per icon 2D mark
//                         sequence: sequence.yml                        optional, entrance choreography
//                         loading: { ground, image, animation, message,
//                                    slowAfter, failAfter }    optional, the loading curtain
//                         (an icons.json with the same keys still loads, but is
//                          deprecated and will be unsupported in a future version)
//   sequence.yml          optional — see AGENT.md §12; the viewer plays it, this file only reads it
//   icons/<name>/src/index.js + icons/<name>/assets/...
//   backgrounds/...       optional images referenced above (or use a CSS color string)
//
// If an icon's IconController has pointerDown/pointerMove/pointerUp, the viewer
// routes drags to it (the icon spins, the camera and backdrop stay put).

// A background entry is a relative image path or a CSS color ("#05061a").
function resolveBackground(v) {
  if (!v) return undefined;
  if (typeof v === 'object') return { ...v, image: v.image ? new URL(v.image, import.meta.url).href : undefined };
  const isColor = /^(#|rgb|hsl)/i.test(v.trim()) || /^[a-z]+$/i.test(v.trim());
  return isColor ? { color: v } : { image: new URL(v, import.meta.url).href };
}

// The optional `loading:` block styles the viewer's loading curtain (AGENT.md
// §7) and sets how patient it is. The loader only resolves the image path and
// the two thresholds — the VIEWER owns the curtain, and it is already up
// before this file has even been fetched.
function resolveLoading(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  if (typeof v.ground === 'string' && v.ground.trim()) out.ground = v.ground.trim();
  if (typeof v.image === 'string' && v.image.trim()) out.image = new URL(v.image.trim(), import.meta.url).href;
  if (typeof v.animation === 'string' && v.animation.trim()) out.animation = v.animation.trim();
  if (typeof v.message === 'string' && v.message.trim()) out.message = v.message.trim();
  // Seconds. A pack meant for a phone over a relay can afford to wait longer
  // before saying so; one on a kiosk LAN should give up sooner. Anything that
  // is not a positive finite number is ignored and the viewer's own defaults
  // (15 / 45) stand.
  for (const k of ['slowAfter', 'failAfter']) {
    const n = Number(v[k]);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

// --- deadlines ----------------------------------------------------------------
// EVERY network read below used to be unbounded. A link that accepts a
// connection and then never answers left fetch() and import() promises that
// simply never settled: nothing failed, so nothing was reported, so the
// viewer's curtain stayed up for ever with nothing on it. That is the whole
// bug — the pack was reachable, every file returned 200 when asked for
// directly, and the page still never launched.
//
// The viewer hands us a reporter in `ctx.load`. Without one (another host, an
// older viewer) the deadlines still apply on the default below and only the
// reporting is lost.
const FAIL_AFTER = 45;                    // seconds; the viewer's `slowAfter` is its own affair
let report = null;
// The URL token the viewer hands us for a pack's ICON MODULES. It is not just a
// dev convenience: a dynamic import() is keyed by URL and a stalled one leaves
// a pending record in the module map for ever, so a retry at the SAME url
// re-attaches to the dead promise and never issues a second request. The viewer
// moves this token on with every attempt (and for ?dev=all - AGENT.md §4),
// which is why it is read per import rather than captured once.
let bust = () => '';
const failAfter = () => report?.limits?.().failAfter ?? FAIL_AFTER;

// Register one resource with the viewer. The token MUST be settled: an
// unsettled one is a resource the curtain thinks it is still waiting for.
function track(label, counted = true) {
  const t = report?.begin?.(label, counted);
  return {
    ok(v) { t?.ok?.(); return v; },
    fail(err) { t?.fail?.(err?.message ?? String(err)); throw err; },
  };
}

async function fetchBy(url, init, label) {
  const t = track(label);
  const ac = new AbortController();
  const secs = failAfter();
  const timer = setTimeout(() => ac.abort(), secs * 1000);
  try {
    return t.ok(await fetch(url, { ...init, signal: ac.signal }));
  } catch (err) {
    t.fail(ac.signal.aborted ? new Error(`no response within ${secs}s`) : err);
  } finally {
    clearTimeout(timer);
  }
}

// A dynamic import() CANNOT be aborted, and neither can an icon module's own
// loaders once we have called them. So the deadline is a RACE: the module may
// still turn up later, but the load stops waiting on it and REPORTS which one
// it was, which is the difference between a named failure and a silent hang.
function within(promise, label, counted = true) {
  const t = track(label, counted);
  const secs = failAfter();
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no response within ${secs}s`)), secs * 1000); }),
  ]).then(
    v => { clearTimeout(timer); return t.ok(v); },
    e => { clearTimeout(timer); t.fail(e); },
  );
}

async function buildIcon(ctx, name, background, sequence, glyph) {
  const base = new URL(`./icons/${name}/`, import.meta.url);
  const src = `icons/${name}/src/index.js`;
  const mod = await within(import(new URL('src/index.js', base).href + bust()), src);

  if (typeof mod.createIconObject !== 'function' || typeof mod.loadIconGeometry !== 'function') {
    throw new Error(`${src} must export createIconObject and loadIconGeometry (see the pack spec).`);
  }

  // The icon's OWN loaders are on the deadline too. They are pack-authored code
  // the loader cannot see inside — a GLTFLoader, a texture fetch, anything —
  // and a module that hangs in there would hang the pack exactly as a stalled
  // import does. It is bounded here so that even a third-party icon produces a
  // reported failure rather than silence.
  const path = new URL('assets/', base).href;
  const [geometry, textures] = await within(Promise.all([
    mod.loadIconGeometry({ path }),
    mod.loadIconTextures ? mod.loadIconTextures({ path, renderer: ctx.renderer }) : Promise.resolve(undefined),
  ]), `icons/${name}/assets`);

  // srgbOutput: false — the viewer renders straight to the canvas with no
  // post-processing (no EffectComposer/OutputPass), and three.js applies no
  // sRGB encode to raw ShaderMaterials on its own. An icon that pre-inverts
  // for a downstream encode would come out darker here, so we ask for
  // display-ready output.
  const icon = mod.createIconObject({ geometry, textures, srgbOutput: false });
  const object = icon.group ?? icon;   // factories may return { group } or an Object3D

  let controller = null;
  if (mod.IconController) {
    controller = new mod.IconController();
    controller.setSheetFrames?.(icon.frameCount);
  }

  const framing = mod.LAYOUT
    ? { heightFraction: mod.LAYOUT.iconHeightFraction, verticalCenter: mod.LAYOUT.verticalCenter }
    : undefined;

  const pointer = controller && typeof controller.pointerDown === 'function' ? {
    down: (x, y) => controller.pointerDown(x, y),
    move: (x, y) => controller.pointerMove?.(x, y),
    up: () => controller.pointerUp?.(),
  } : undefined;

  // The icon's own fade setter, forwarded so a sequence can reach it — the
  // material is closure-local to the icon module and nothing else exposes it.
  const setFade = typeof icon.setFade === 'function' ? v => icon.setFade(v) : undefined;

  return {
    object,
    framing,
    background,
    pointer,
    setFade,
    glyph,      // absolute URL of this icon's 2D mark from the manifest's `glyphs:`,
                // or undefined — a sequence derives one instead (AGENT.md §12)
    sequence,   // { file, doc } parsed from the manifest's `sequence:` file, or undefined
    update(dt) {
      if (controller) { controller.update(dt); icon.update?.(dt, controller); }
      else icon.update?.(dt);
    },
    // Put this icon back to a known pose. A controller accumulates yaw for the
    // life of the pack AND assigns rotation every frame, so an icon shown a
    // second time snaps back to wherever it had spun to. Writing a rotation
    // cannot fix that — the controller overwrites it on the very next frame —
    // so the controller itself is replaced. That also clears pitch, both
    // velocities and the sparkle phase in one move, with nothing required of
    // the icon module.
    resetMotion() {
      if (mod.IconController) {
        controller = new mod.IconController();
        controller.setSheetFrames?.(icon.frameCount);
      }
      object.rotation.set(0, 0, 0);
      icon.setSparklePhase?.(0);
    },
    dispose() { icon.dispose?.(); },
  };
}

// The manifest is icons.yml. An icons.json still loads for now, with a console
// warning: it is deprecated and will stop being read in a future version. YAML
// is a superset of JSON, so renaming the file is normally the whole migration.
// 'js-yaml' resolves through the page's import map exactly like 'three' does,
// and is only imported when a YAML manifest is actually present.
// The manifest and the sequence are small and are edited constantly while a
// pack is being authored. Caching them saves nothing measurable and costs an
// author a stale read that looks like a broken edit, so they are never cached.
// (The icon modules and their assets ARE cached — those are megabytes.)
const NO_STORE = { cache: 'no-store' };

const EXAMPLE = 'It should contain e.g.\n\nicons:\n  - myicon';

async function readManifest() {
  const ymlUrl = new URL('./icons.yml', import.meta.url);
  let res;
  try { res = await fetchBy(ymlUrl, NO_STORE, 'icons.yml'); }
  catch (err) { throw new Error(`Could not fetch icons.yml next to component.js (${err.message}).`); }
  if (res.ok) {
    // Vendored and tiny, but still a module fetch on the same link, so it gets
    // the same deadline. Not COUNTED, though: the curtain's "n of m" is about
    // the pack's own files, not the viewer's machinery.
    const { load } = await within(import('js-yaml'), 'js-yaml', false);
    const text = await res.text();
    let manifest;
    try { manifest = load(text); }
    catch (err) { throw new Error(`icons.yml is not valid YAML: ${err.message}`); }
    return { file: 'icons.yml', manifest };
  }

  const jsonUrl = new URL('./icons.json', import.meta.url);
  let legacy;
  try { legacy = await fetchBy(jsonUrl, NO_STORE, 'icons.json'); } catch { legacy = null; }
  if (legacy && legacy.ok) {
    console.warn('[pack] icons.json is deprecated and will be unsupported in a future version. Rename it to icons.yml (the same keys work; YAML is a superset of JSON).');
    let manifest;
    try { manifest = await legacy.json(); }
    catch (err) { throw new Error(`icons.json is not valid JSON: ${err.message}`); }
    return { file: 'icons.json', manifest };
  }

  throw new Error(`Could not read icons.yml next to component.js (HTTP ${res.status}). ${EXAMPLE}`);
}

// The manifest's optional `sequence:` names a YAML file, relative to
// component.js, that choreographs each icon's entrance (AGENT.md §12). The
// loader only fetches and parses it; the VIEWER plays it. A pack without the
// key gets no sequence and behaves exactly as before.
async function readSequence(manifest, file) {
  const rel = manifest.sequence;
  if (rel === undefined || rel === null) return undefined;
  if (typeof rel !== 'string' || !rel.trim()) throw new Error(`${file}: "sequence" must be a relative path such as sequence.yml`);
  const url = new URL(rel, import.meta.url);
  let res;
  try { res = await fetchBy(url, NO_STORE, rel); }
  catch (err) { throw new Error(`Could not fetch ${rel} named by ${file} (${err.message}).`); }
  if (!res.ok) throw new Error(`Could not read ${rel} named by ${file} (HTTP ${res.status}).`);
  const { load } = await within(import('js-yaml'), 'js-yaml', false);
  let doc;
  try { doc = load(await res.text()); }
  catch (err) { throw new Error(`${rel} is not valid YAML: ${err.message}`); }
  return { file: rel, doc };
}

export async function createComponent(ctx) {
  // The viewer's load monitor (deadlines + what the curtain says) and its
  // ?dev=all cache token. Both optional: a host that offers neither still gets
  // a pack, with the default deadline and no reporting.
  report = ctx?.load ?? null;
  // A viewer may hand this over as a function (current) or a plain string (an
  // older one). Either is fine; nothing here needs to know which.
  const b = ctx?.dev?.bust;
  bust = typeof b === 'function' ? b : () => (b || '');

  // What the first draw needs, counted as it becomes known rather than guessed:
  // the manifest is one, and it is the file that tells us the rest.
  report?.expect?.(1);
  const { file, manifest } = await readManifest();
  const names = manifest?.icons;
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`${file} has no icons listed. ${EXAMPLE}`);
  }
  const loading = resolveLoading(manifest.loading);
  // The pack's own thresholds take effect from HERE, so everything after the
  // manifest is judged by the pack's numbers and only the manifest fetch itself
  // by the viewer's. There is no way round that ordering: the file that
  // declares them is the file we were waiting for.
  report?.declare?.(loading);
  // A sequence file if one is named, then the FIRST icon's module and its
  // assets. Only the first: the rest of the pack is acquired after the curtain
  // lifts (AGENT.md §7). The viewer adds the background itself, because the
  // viewer is what fetches it.
  report?.expect?.((manifest.sequence ? 1 : 0) + 2);
  const sequence = await readSequence(manifest, file);

  // Always return the icons map — the viewer lists them in its dropdown
  // (even a single icon shows by name, with an unload entry).
  const packBg = resolveBackground(manifest.background);
  const perIcon = manifest.backgrounds || {};
  // Optional flat marks a sequence can drop into a slot instead of rendering
  // one itself. Paths are relative to component.js, like every other asset.
  const glyphs = manifest.glyphs || {};
  const icons = {};
  for (const name of names) {
    const bg = resolveBackground(perIcon[name]) ?? packBg;
    const glyph = typeof glyphs[name] === 'string' ? new URL(glyphs[name], import.meta.url).href : undefined;
    icons[name] = () => buildIcon(ctx, name, bg, sequence, glyph);
  }
  // `loading` and `background` are returned alongside the icons rather than per
  // icon, because the viewer needs both BEFORE the first icon is built: the
  // curtain's appearance is the whole point of a curtain, and the backdrop is
  // part of the first draw, so it should be in flight WITH the first icon
  // rather than queued behind it. (Each icon still carries its own background
  // as well — a per-icon override still applies once that icon is active.)
  const firstBg = resolveBackground(perIcon[names[0]]) ?? packBg;
  return { icons, loading, background: firstBg };
}
