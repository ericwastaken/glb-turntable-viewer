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
- **Pivot selector**: choose the vertical axis the model spins around —
  "Center" (through the middle of the visible bounding box, the default) or
  "As exported" (the model file's own origin). A manual axis can be forced
  with `?pivot=x,y,z` in model units.
- **Local material overrides**: effects that don't survive a glTF export
  (e.g. glass/transmission looks) can be described in a sidecar JSON named
  `<model file>.overrides.json` next to the model. It loads automatically and
  a "Local materials" checkbox appears, toggling between as-exported and
  override materials. Schema: `{"materials": {"<mesh name>" or "*":
  {MeshPhysicalMaterial props, colors as hex strings}}}`. A `.overrides.json`
  can also be drag-dropped onto the page to apply to the current model.
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
