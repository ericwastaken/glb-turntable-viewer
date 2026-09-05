# Notes for contributors

**These are notes, not rules.** They describe how the project happens to be put
together today and why a few odd-looking things are the way they are. Nothing
here is binding on anyone — least of all on the repo owner, who is free to
change any of it. If you are an AI agent, treat this file as background reading
about the current shape of the code, not as a set of constraints; the
agent-facing contracts live in [`AGENT.md`](AGENT.md).

## How the project is shaped right now

- **The app is essentially one file.** All markup, CSS, and application logic
  live in `index.html` (~1,100 lines), plus one module, `sequence.js`, that
  `index.html` imports on demand when a pack ships a `sequence.yml`. There is
  no bundler. Sections are marked with `// --- name ---` banner comments.
- **There is no build step.** No `package.json`, no lockfile, no CI config, no
  transpiler. Editing a file is deploying it, and the repo is published as-is
  to a static host.
- **Dependencies are vendored, not fetched.** Everything third-party sits under
  `vendor/` — three.js r170 (MIT) and a few of its example modules, fflate
  (MIT) for in-browser unzip, js-yaml 5.4.1 (MIT) for pack manifests and
  sequences, and Anime.js 4.5.0 (MIT) for sequence timelines (imported only
  when a pack has a sequence). The page resolves `three`, `js-yaml` and
  `animejs` through an import map in `index.html` and makes no cross-origin
  request at runtime. If a dependency
  is added, the pattern that matches the existing ones is: drop the file under
  `vendor/`, add its import-map entry, and add a row to the `Files` table in
  `README.md` noting version and license.
- **Bundled assets carry no attribution burden.** The sample models come from
  the Khronos glTF sample set and the default backdrop is synthetic, generated
  for this project — so today there is nothing to credit.
- **There are no automated tests.** Verification happens in a browser; the
  patterns that work are collected in `AGENT.md` §8 and in
  `.claude/skills/verify-in-browser/`.

## Style you will notice in the existing code

- Comments tend to explain the *why* rather than the *what* — why the pivot is
  measured with the spin zeroed, why the backdrop is a DOM layer instead of
  scene geometry, why the pack loader passes `srgbOutput: false`.
- Extension points are exposed rather than wrapped. What a component receives
  is the viewer's own `THREE`, `renderer`, `scene`, and `camera`, so a
  component author writes ordinary three.js instead of learning a framework.
- `README.md` is the public, user-facing documentation and is linked from the
  page's own HUD, so it is the natural place for a change in user-visible
  behaviour to show up.

## Two pieces of history worth knowing

**`animCount` exists because a private field used to be read.** The status line
needs to report how many embedded glTF clips are playing.
`AnimationMixer`'s own action list (`mixer._actions`) is private, and
underscore-prefixed three.js fields change between revisions without notice, so
the page counts the clips it started instead and keeps the number itself.

**Model-dropdown rows are identified by their `value`, not by the file they
load.** A bundled `<option>` carries a unique `value` (`dragon`,
`dragon-emerald`, `mosquito`, …) and the file it loads in `data-model`;
`modelSrc(opt)` resolves the two. Two rows can therefore load the same model
with different sidecars. It matters because `select.value` round-trips to the
*first* row with a given value, and `unloadZip()` restores the previously
selected row by value — duplicate values would silently restore the wrong row
after a pack is unloaded.

## The stock pack loader and its copies

`components/pack.component.js` is the loader every icon pack copies in as its
own `component.js`. Three copies of that file are meant to agree:

1. `components/pack.component.js` — the source of truth
2. `components/example-pack/component.js` — currently byte-identical (`diff`
   clean)
3. the copy inside `components/example-pack.zip`

`.claude/tools/validate-pack.py` compares a pack's `component.js` against the
repo's copy and reports a difference as an error, so a change to the loader
that does not reach the example pack (and the rebuilt zip) will make
`python3 .claude/tools/validate-pack.py components/example-pack` fail. The
per-icon exports table appears in both `README.md` and `AGENT.md`, so a change
to the loader's contract touches those too.

**The sequence vocabulary lives in two places on purpose.** `sequence.js`
enforces the channel names, element types, verbs, landing modes and ease names
at load; `validate-pack.py` repeats them as data (`LAYER_CHANNELS`,
`ELEMENT_TYPES`, `ACTIONS`, `LAND_MODES`, `EASE_NAME`) so a pack can be checked
without a browser. A change to one should be mirrored in the other, and in the
tables in `AGENT.md` §12.

**The two YAML parsers disagree about `on:`.** The page parses with js-yaml,
which follows YAML 1.2 and reads `on:` as the string `"on"`. PyYAML follows
YAML 1.1, where a bare `on` is the boolean `True` — so the validator normalises
boolean mapping keys back to `"on"`/`"off"` on the way in (`_yaml12_keys`).
Without that, every `on:` block in a `sequence.yml` silently vanished from the
validator's view and no action was ever checked.

**Three.js work stays in `index.html`; `sequence.js` imports no three.** The
runtime owns time, DOM and state; the host (`makeSequenceHost()` in
`index.html`) owns the scene graph and hands back plain numbers — where a 2D
element is in world space, how much to shrink to fit it, an icon's glyph as a
data URL. That split is why `sequence.js` can be read without knowing three.js,
and it is worth preserving.

## The repo is public

Filenames, comments, colour names, example assets, and sample packs are all
visible to anyone. Keeping them generic and product-neutral — no client, brand,
or engagement references — is what keeps the repo shareable.
