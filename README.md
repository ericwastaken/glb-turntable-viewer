# GLB Turntable Viewer (three.js)

**▶ View this live: https://ericwastaken.github.io/glb-turntable-viewer/**

A single static page that spins a GLB model over a starfield, rendered with
self-hosted three.js. No CDN, no build step, no licenses. Everything needed is
in this folder.

## Run it locally

Any static server works (ES modules won't load from file://):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. For static hosting, upload this folder as-is.

## What's in the page

- **Model picker**: seven bundled Khronos sample models, mostly glass
  (glTF transmission/volume) tests like the dragon and the mosquito in amber,
  plus the classic DamagedHelmet PBR test.
- **Load .glb button + drag-and-drop**: drop any GLB straight onto the page to
  preview it. Also `?model=models/yourfile.glb` works.
- **Spin slider + pause**: rotation is done in code (requestAnimationFrame),
  so no baked animation is needed for turntable moves. If a GLB does contain
  embedded animations, the page detects and plays them, and says so in the
  status line.
- **Lighting**: procedurally generated RoomEnvironment IBL + ACES tone
  mapping, which is what makes PBR/glass materials read correctly.
- Backdrop/stage meshes bundled inside sample models (names matching
  backdrop/stage/floor/ground) are hidden automatically so only the hero
  object shows.

## Files

| Path | What |
|---|---|
| `index.html` | The whole page (markup, styles, and module script). |
| `vendor/` | three.js 0.170.0 (MIT) + GLTFLoader, OrbitControls, RoomEnvironment, self-hosted. |
| `models/` | Sample models from [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets): glass/transmission tests (DragonAttenuation, MosquitoInAmber, GlassVaseFlowers, GlassHurricaneCandleHolder, IridescentDishWithOlives, DispersionTest) plus DamagedHelmet (PBR). |

## Known limits (deliberate; it's a proof of concept)

- No Draco/meshopt decoders: use uncompressed GLB files, or add `DRACOLoader`
  plus the wasm decoder to `vendor/`.
- No KTX2 texture support (same deal: add `KTX2Loader` if needed).
