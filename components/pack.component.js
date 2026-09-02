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
//   icons.json            {"icons": ["nameA", "nameB", ...]}
//   icons/<name>/src/index.js + icons/<name>/assets/...

async function buildIcon(ctx, name) {
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

  return {
    object,
    framing,
    update(dt) {
      if (controller) { controller.update(dt); icon.update?.(dt, controller); }
      else icon.update?.(dt);
    },
    dispose() { icon.dispose?.(); },
  };
}

export async function createComponent(ctx) {
  const manifestUrl = new URL('./icons.json', import.meta.url);
  let names;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    names = (await res.json()).icons;
  } catch (err) {
    throw new Error(`Could not read icons.json next to component.js (${err.message}). It should contain e.g. {"icons": ["myicon"]}.`);
  }
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('icons.json has no icons listed. Expected e.g. {"icons": ["myicon"]}.');
  }

  // Always return the icons map — the viewer lists them in its dropdown
  // (even a single icon shows by name, with an unload entry).
  const icons = {};
  for (const name of names) icons[name] = () => buildIcon(ctx, name);
  return { icons };
}
