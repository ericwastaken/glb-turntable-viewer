# Optimizing an icon pack for a phone

A pack that is delivered for desktop review is usually three to ten times too
heavy for a phone, and the reason is almost never the one people reach for
first. This page is what to measure, what to change, and — just as usefully —
what to leave alone.

## The one idea everything else follows from

**A texture costs its DECODED size, not its file size.**

Every image is expanded to raw RGBA before it reaches the GPU. A 2048×2048 JPEG
costs `2048 × 2048 × 4 = 16 MiB` of GPU memory whether it compressed to 900 KB
or 9 MB on disk. Add a mip chain and it is **21 MiB**.

So:

- **Dimensions are the lever. Compression is not.**
- Re-encoding to WebP or AVIF changes the download and does **nothing** for
  memory. A file named `-optimized` that is still 4096×2160 has not been
  optimized in the way that matters.
- Halving a dimension quarters the memory. That is the whole game.

```
decoded bytes = width × height × 4          (× 4/3 again if mipmapped)
```

Run that on every image in the pack, add the background, and you have the real
number. It is routinely 10× the zip size.

## Why phones die and desktops do not

A Mac has gigabytes of VRAM and will render a pack happily that mobile Safari
would kill the tab for. **A desktop browser cannot tell you whether a pack is
too heavy** — it can only tell you the pack works. Budget against a real device,
or against arithmetic, never against "it seemed fine in Chrome."

See [`DEBUGGING-ON-IPHONE.md`](DEBUGGING-ON-IPHONE.md) for getting real numbers
off a phone.

## Size the textures to what is actually sampled

Two things shrink a target below the delivered size:

**1. The viewer caps its own pixel ratio.** It renders at
`min(devicePixelRatio, 2)`, so a 3× phone screen still rasterises at 2×. Size
textures against the *rendered* resolution, not the screen's.

**2. Only part of a matcap is ever read.** If the icon code divides the matcap
UV by a scale factor (a UV scale constant), only the central fraction
of the image is ever sampled — the rest is dead weight at full cost. Work out
the sampled fraction and the on-screen size of the icon, and the honest target
usually lands far below what was delivered.

One caveat worth stating plainly: a starfield or any high-frequency sparkle
texture is the **worst case for downscaling** — mean error stays low while max
error is high. Look at a side-by-side before committing; this one is an eyeball
call, not a number.

## The biggest win is usually not a resize

**Icons in one pack often ship byte-identical textures — and still pay for them
three times.**

Each icon is a separate ES module that calls `loader.load()` with its own path,
so three `THREE.Texture` objects are created and three GPU uploads happen even
though the bytes are the same file. Deduplicating the *files* saves download and
**zero** memory.

three's own `Cache` does not fix it either: it reuses the decoded **image**,
while each Texture still gets its own upload.

To actually share, you need two things together:

1. **One copy of the file** at a path all icons resolve to identically, and
2. **A registry keyed on that resolved URL**, reachable across modules — a
   `globalThis` map is enough — so the second and third icons receive the same
   promise, and therefore the same texture object.

```js
const cache = (globalThis.__packTextureCache ||= new Map());
const base  = new URL('../../../shared/', import.meta.url).href;

const load = (file) => {
  const url = base + file;
  let p = cache.get(url);
  if (!p) {
    p = new Promise((res, rej) => loader.load(url, res, undefined, rej));
    cache.set(url, p);
  }
  return p;
};
```

**How to prove it worked**, rather than assuming: in the console, walk the scene
and collect `material.uniforms[*].value.uuid` for every texture. Before sharing
you will see the same image at the same dimensions under *different* uuids —
that is the waste, visible. After, one uuid, and
`renderer.info.memory.textures` drops.

Watch for textures that are **generated at runtime** rather than loaded from
disk (a procedural roughness or noise map). Those are per-icon too, they never
appear in the pack's asset folder, and no file-side tool can share them — they
need the same registry applied in the code that creates them.

## Backgrounds: crop before you scale

A background delivered at landscape-tablet proportions and shown on a portrait
phone is mostly wasted. CSS `cover` is **height-driven** in portrait, so it
scales the image until the height fits and throws most of the width off-screen —
often 70–80% of it — while you pay for every pixel.

Scaling proportionally barely helps, because the height is what binds. **Crop to
the portrait aspect first, then scale.** The crop is a design decision (what
part of the image matters), which is exactly why a tool should propose it rather
than perform it silently.

## Mipmaps: know which way each texture goes

- A **matcap** *should* be mipmapped and anisotropic. Its normals sweep hundreds
  of texels across a few pixels on a bevel, so without minification filtering it
  aliases and crawls as the icon turns. Budget the extra 33%.
- A **sprite-sheet atlas** must **not** be mipmapped. Mipmapping blends across
  cell boundaries and bleeds neighbouring frames together — faint ghosting that
  is very hard to trace back to its cause.

If you resize an atlas, keep its cell grid on integer pixel boundaries. A 4×4
sheet must stay divisible by its cell count in both axes.

## What not to bother with

- **GLB geometry.** Typically well under 1% of the total, and meshes are often
  often hand-corrected — high risk, no reward.
- **WebP / AVIF.** Download only. Zero effect on the number that matters.
- **KTX2 / Basis.** This *is* the real answer to texture memory, because it
  stays compressed on the GPU. This viewer cannot decode it (§11), so it is not
  available here.
- **Shader edits** to save memory. Change the assets first; you will usually
  find you did not need to.

## A working order

1. **Measure** decoded totals for every image, per icon instance. Write the
   number down before changing anything.
2. **Share** what is duplicated — the code change, not just the files. Verify by
   uuid, and re-check `renderer.info.memory.textures`.
3. **Resize** to the sampled requirement at the capped pixel ratio.
4. **Crop** the background to the delivery aspect, then scale.
5. **Re-measure**, and check it still *looks* right — especially any
   high-frequency texture you downscaled.
6. **Confirm on a real device.** Desktop proves it works; only the phone proves
   it helped.

## A gate worth building in

If you automate any of this: **rewrite every icon's loader before deleting any
per-icon asset**, and abort if even one icon fails to patch. Icons in a single
pack are not always identical — they may not import the same modules — so a
patch anchored on one icon's shape can silently miss another. Half-patched, the
pack 404s at runtime, and it will do it on the device rather than on your desk.
