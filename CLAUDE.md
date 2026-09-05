# CLAUDE.md

The agent instructions for this repository live in **[`AGENT.md`](AGENT.md)**.
Read that file first. It covers how to *use* this viewer — the URL parameters,
the sidecar / component / icon-pack contracts, how to run it, how to verify
what you authored, and the gotchas that have cost previous sessions time.

Quick orientation while you fetch it:

- A single static page that spins a `.glb` on a turntable with self-hosted
  three.js (r170). Nothing to install, nothing to build, nothing uploaded.
  The app is `index.html` plus `sequence.js` (loaded only when a pack has a
  `sequence.yml`); `sw.js` only serves the contents of a dropped `.zip`.
- **It must be served over HTTP** — ES modules, the import map, and the service
  worker all fail from `file://`:

  ```bash
  python3 -m http.server 8000   # then open http://localhost:8000
  ```

- Five URL parameters: `?model=`, `?sidecar=`, `?component=`, `?bg=`,
  `?pivot=`. The full table with constraints is `AGENT.md` §4.
- There are no tests. Verify in a browser via `window.viewer`, and read
  `AGENT.md` §8 and §10 before writing any timing-based check — a hidden
  browser pane pauses `requestAnimationFrame`, so waiting and then reading a
  rotation gives a false negative.
- `AGENT.md` §11 lists what the viewer deliberately does not do; §12 is the
  sequence format (`sequence.yml`, an icon pack's choreography: an entrance,
  and optionally a tap-advanced flow that collects each icon into a slot) —
  it never owns spin, and it is verified with `viewer.sequence.seek(t)`, not
  by waiting.
- **The viewer stores nothing** unless a pack's sequence opts in with a
  `resume:` block (`AGENT.md` §12.8). Keep it that way: this is a public tool,
  and a visitor's browser is not scratch space.
- Serve with cache-busting headers while you work on `sequence.js` or
  `index.html`. A stale module from the browser cache looks exactly like a bug
  in your code (`AGENT.md` §12.11).

Repeatable authoring workflows are packaged as skills under `.claude/skills/`:
`author-sidecar`, `author-component`, `author-icon-pack`, `author-sequence`,
`verify-in-browser`.
