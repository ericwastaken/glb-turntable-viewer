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

async function buildIcon(ctx, name, background, sequence, glyph) {
  const base = new URL(`./icons/${name}/`, import.meta.url);
  const mod = await import(new URL('src/index.js', base).href);

  if (typeof mod.createIconObject !== 'function' || typeof mod.loadIconGeometry !== 'function') {
    throw new Error(`icons/${name}/src/index.js must export createIconObject and loadIconGeometry (see the pack spec).`);
  }

  const path = new URL('assets/', base).href;
  const [geometry, textures] = await Promise.all([
    mod.loadIconGeometry({ path }),
    mod.loadIconTextures ? mod.loadIconTextures({ path, renderer: ctx.renderer }) : Promise.resolve(undefined),
  ]);

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
    dispose() { icon.dispose?.(); },
  };
}

// The manifest is icons.yml. An icons.json still loads for now, with a console
// warning: it is deprecated and will stop being read in a future version. YAML
// is a superset of JSON, so renaming the file is normally the whole migration.
// 'js-yaml' resolves through the page's import map exactly like 'three' does,
// and is only imported when a YAML manifest is actually present.
const EXAMPLE = 'It should contain e.g.\n\nicons:\n  - myicon';

async function readManifest() {
  const ymlUrl = new URL('./icons.yml', import.meta.url);
  let res;
  try { res = await fetch(ymlUrl); }
  catch (err) { throw new Error(`Could not fetch icons.yml next to component.js (${err.message}).`); }
  if (res.ok) {
    const { load } = await import('js-yaml');
    const text = await res.text();
    let manifest;
    try { manifest = load(text); }
    catch (err) { throw new Error(`icons.yml is not valid YAML: ${err.message}`); }
    return { file: 'icons.yml', manifest };
  }

  const jsonUrl = new URL('./icons.json', import.meta.url);
  let legacy;
  try { legacy = await fetch(jsonUrl); } catch { legacy = null; }
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
  try { res = await fetch(url); }
  catch (err) { throw new Error(`Could not fetch ${rel} named by ${file} (${err.message}).`); }
  if (!res.ok) throw new Error(`Could not read ${rel} named by ${file} (HTTP ${res.status}).`);
  const { load } = await import('js-yaml');
  let doc;
  try { doc = load(await res.text()); }
  catch (err) { throw new Error(`${rel} is not valid YAML: ${err.message}`); }
  return { file: rel, doc };
}

export async function createComponent(ctx) {
  const { file, manifest } = await readManifest();
  const names = manifest?.icons;
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`${file} has no icons listed. ${EXAMPLE}`);
  }
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
  return { icons };
}
