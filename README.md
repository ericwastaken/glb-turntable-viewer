# GLB Turntable Viewer (three.js)

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

- **Model picker**: two bundled Khronos sample models. The glass dragon
  (`DragonAttenuation.glb`) exercises glTF transmission/volume glass
  materials; the helmet is the classic PBR test.
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
| `models/` | `DragonAttenuation.glb` and `DamagedHelmet.glb` from [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets). |

## Known limits (deliberate; it's a proof of concept)

- No Draco/meshopt decoders: use uncompressed GLB files, or add `DRACOLoader`
  plus the wasm decoder to `vendor/`.
- No KTX2 texture support (same deal: add `KTX2Loader` if needed).
