// component.js — UNIVERSAL icon-pack loader for the GLB Turntable Viewer.
// This file is always the same, for every pack. Do not edit it.
//
// It reads icons.json (a list of folder names under icons/) and drives each
// icon through the standard exports every icon's src/index.js provides:
//
//   createIconObject({ geometry, textures, srgbOutput })   required
//   loadIconGeometry({ path })                             required
//   loadIconTextures({ path, renderer })                   optional
//   IconController                                         optional
//   LAYOUT ({ iconHeightFraction, verticalCenter })        optional
//
// Pack layout:
//   component.js          this file (never changes)
//   icons.json            {"icons": ["nameA", "nameB", ...],
//                          "background": "backgrounds/sky.jpg",      optional, pack-wide
//                          "backgrounds": {"nameB": "backgrounds/alt.jpg"}}  optional, per icon
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

async function buildIcon(ctx, name, background) {
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

  return {
    object,
    framing,
    background,
    pointer,
    update(dt) {
      if (controller) { controller.update(dt); icon.update?.(dt, controller); }
      else icon.update?.(dt);
    },
    dispose() { icon.dispose?.(); },
  };
}

export async function createComponent(ctx) {
  const manifestUrl = new URL('./icons.json', import.meta.url);
  let names, manifest;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
    names = manifest.icons;
  } catch (err) {
    throw new Error(`Could not read icons.json next to component.js (${err.message}). It should contain e.g. {"icons": ["myicon"]}.`);
  }
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('icons.json has no icons listed. Expected e.g. {"icons": ["myicon"]}.');
  }

  // Always return the icons map — the viewer lists them in its dropdown
  // (even a single icon shows by name, with an unload entry).
  const packBg = resolveBackground(manifest.background);
  const perIcon = manifest.backgrounds || {};
  const icons = {};
  for (const name of names) {
    const bg = resolveBackground(perIcon[name]) ?? packBg;
    icons[name] = () => buildIcon(ctx, name, bg);
  }
  return { icons };
}
