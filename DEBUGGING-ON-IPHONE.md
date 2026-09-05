# Debugging this viewer on a real iPhone

A phone is not a narrow desktop window. Texture memory, GPU behaviour, Safari's
own chrome and WebKit's compositing are all different there, and a pack that is
perfect in a resized browser can still be wrong on the device you are shipping
to. This page is how to get a real answer out of a real iPhone.

There are **two routes**, and they are complements rather than alternatives:

| | Web Inspector bridge | `safaridriver` |
|---|---|---|
| Reads the DOM, runs JS | Yes | Yes |
| Works on **the tab you are already using** | **Yes** | No — its own session |
| Navigate, screenshot | No | **Yes** |
| Real taps and swipes | No | No — see [the gesture gap](#the-gesture-gap) |
| Console + network panels | Yes, by eye | No |
| Needs a USB cable | No | **Yes** |
| Needs your password, once | No | Yes (`safaridriver --enable`) |

Rule of thumb: **the bridge to look at what is happening now, the driver to set
something up reproducibly.**

---

## Before either route: turn the phone on for debugging

On the **iPhone** — Settings → Apps → Safari → Advanced:

- **Web Inspector** → ON (needed by both routes)
- **Remote Automation** → ON (needed by `safaridriver` only)

On the **Mac** — Safari → Settings → Advanced → check
**"Show features for web developers"**. A **Develop** menu appears.

Connect the phone, tap **Trust** if asked. Web Inspector then works over the
local network as well as over the cable; `safaridriver` needs the cable.

---

## Route 1 — the Web Inspector bridge

Attach the inspector first: **Safari → Develop → [your iPhone] → [the page]**.
You now have Elements, Console, Network and Sources against the live phone,
which is often all a person needs.

### Getting values back out as text

The console's `copy()` writes to the **Mac's** clipboard. That turns the
inspector into a scriptable bridge: type an expression, read the answer with
`pbpaste`. No screenshots, no OCR.

```bash
./.claude/tools/ios-eval.sh 'viewer.stage'
```

```json
{
  "w": 440, "h": 795, "left": 0, "top": 0,
  "portrait": true, "orientation": "portrait", "emulated": false
}
```

Anything you can write as an expression works — `viewer.sequence.stepIndex`, a
computed style, the `naturalWidth` of a landed slot mark, a pixel measurement
done on a canvas.

### Two rules that are not optional

**1. Always prime the clipboard with a sentinel first.** If the expression
throws, `copy()` never runs and the clipboard still holds the *previous* value —
a stale answer that is indistinguishable from a fresh one. `ios-eval.sh` writes
a known token before every call and treats an unchanged clipboard as failure.
Never take this out.

**2. Clear the console prompt before typing.** A command that threw leaves its
text sitting in the prompt. Clicking puts the caret *inside* that text, so the
next expression is interleaved into it and throws as well — one failure then
cascades into every call after it, each looking like an independent problem.
`ios-eval.sh` sends Cmd+A and Delete first.

### What it costs

It drives a GUI, so it needs the inspector window open and focused, and it is
slow. Fine for probing state; not for a loop. If the page reloads and the
inspector window closes, reattach from the Develop menu.

---

## Route 2 — `safaridriver`

Apple's WebDriver ships with macOS. **No Xcode, no Appium, no WebDriverAgent, no
developer account, nothing to install.**

### One-time setup

```bash
safaridriver --enable
```

Asks for your password. Then, each time:

1. **Connect the USB-C cable.** This is a hard requirement — inspection works
   over the network, automation does not.
2. **Quit iPhone Mirroring** if it is running. It holds the phone in a state a
   session cannot start in.
3. **Unlock the phone and leave it unlocked.**

### Driving it

```bash
./.claude/tools/ios-safari-drive.sh start
./.claude/tools/ios-safari-drive.sh devices          # find your phone's UDID
./.claude/tools/ios-safari-drive.sh session-device <UDID>
./.claude/tools/ios-safari-drive.sh go   "http://<your-mac-ip>:8000/index.html?component=..."
./.claude/tools/ios-safari-drive.sh eval 'return document.title;'
./.claude/tools/ios-safari-drive.sh shot /tmp/phone.png
./.claude/tools/ios-safari-drive.sh stop
```

Serve the folder from your Mac and reach it by LAN address (§ *Run it locally*
in the README) — `localhost` on the phone is the phone.

### Read the OS version from the session, never from the UA

Safari **freezes the OS token in its user-agent string**. A phone running
iOS 26 will tell you it is on 18. The session capabilities are the truth:

```
safari:platformVersion   26.6.1        ← real
navigator.userAgent      ...iPhone OS 18_7...   ← frozen, ignore
```

---

## The gesture gap

**Neither route can perform a real tap on this viewer**, and the failure is
silent, which is the dangerous part.

A WebDriver element click returns success — `{"value":null}`, no error — and the
sequence does not advance. This viewer routes taps through its own pointer
handling and hit test rather than DOM click handlers, and a synthetic click does
not reach it.

So:

- **Never conclude "I tapped it" from the click's return value.** Assert that
  the state actually changed — the step index moved, the slot filled.
- To exercise a flow programmatically, drive the sequence's own API instead:
  `viewer.sequence.advance()`, `.restart()`, `.seek(t)` (§12 of `AGENT.md`).
- To test the *real* input path — that a finger in that spot does the right
  thing — use a finger. That part is still a human job.

---

## What to actually measure on a device

Things a desktop browser cannot tell you:

- **`devicePixelRatio` vs. what the renderer uses.** The viewer caps at
  `min(devicePixelRatio, 2)`, so 3× screens still render at 2×. Texture budgets
  should be sized against the *rendered* resolution — but DOM images, including
  a sequence's derived slot marks, are displayed at the full device ratio.
- **Texture memory and whether Safari kills the tab.** Decoded size, not file
  size, is what counts; a JPEG's dimensions are the lever, not its compression.
- **WebKit compositing.** Clipping, blending and transform behaviour that only
  misbehaves on real Safari.
- **Whether it holds up warm.** Thermal throttling has no desktop equivalent.

---

## You cannot hide Safari's chrome

The URL bar and toolbar are not yours to remove, in either orientation. See
`AGENT.md` § *What this viewer does not do*. Compose for the space you are
given: `viewport-fit=cover`, `env(safe-area-inset-*)`, and **`dvh` rather than
`vh`** so a collapsing toolbar cannot occlude your bottom row.
