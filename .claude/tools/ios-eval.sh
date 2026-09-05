#!/bin/bash
# ios-eval.sh — evaluate JavaScript on the iPhone's Safari page and get the value back.
#
# HOW IT WORKS. macOS Safari's Web Inspector is attached to the iPhone. Its
# console has a command-line API function `copy(v)` that writes to the MAC's
# system clipboard. So we type an expression into that console, press Return,
# and read the answer back with `pbpaste`. Text in, text out — no OCR, no
# screenshot parsing.
#
# THE SENTINEL MATTERS. If the JS throws, `copy()` never runs and the clipboard
# keeps whatever it held before — a stale value that looks exactly like success.
# So we prime the clipboard with a known token first; an unchanged clipboard
# means the eval did NOT run. Never remove this guard.
#
# REQUIRES: Accessibility + Screen Recording granted to the app running this;
# the Web Inspector window open and attached to the phone.
#
# USAGE: ios-eval.sh 'viewer.stage'          # auto-wrapped in JSON.stringify
#        ios-eval.sh --raw 'document.title'  # no wrapping
#
# KEEP EXPRESSIONS SHORT. The text is typed by synthetic keystrokes, so a very
# long one-liner is slow and can drop characters. To move a lot of data, copy a
# single value (e.g. an image's `.src`) and analyse it on the Mac.
set -euo pipefail

RAW=0
[ "${1:-}" = "--raw" ] && { RAW=1; shift; }
EXPR="${1:?usage: ios-eval.sh [--raw] '<js expression>'}"

if [ "$RAW" -eq 1 ]; then JS="copy(String($EXPR))"; else JS="copy(JSON.stringify($EXPR, null, 2))"; fi

SENTINEL="__IOS_EVAL_DID_NOT_RUN_$(date +%s%N)__"
printf '%s' "$SENTINEL" | pbcopy

osascript - "$JS" <<'APPLESCRIPT' >/dev/null
on run argv
  set js to item 1 of argv
  tell application "System Events"
    tell process "Safari"
      set frontmost to true
      set idx to 0
      repeat with i from 1 to (count of windows)
        if (name of window i) starts with "Web Inspector" then set idx to i
      end repeat
      if idx = 0 then error "No Web Inspector window found - open it from Safari's Develop menu."
      perform action "AXRaise" of window idx
      set w to window idx
      set {wx, wy} to position of w
      set {ww, wh} to size of w
      -- FIND THE CONSOLE PROMPT. Never assume where it is: the console drawer
      -- changes height as messages arrive and as panels open, so a fixed offset
      -- from the window's bottom lands in the status strip below the prompt and
      -- every eval then silently does nothing. The prompt is an AXTextArea.
      --
      -- Use its Y ONLY. Its reported X is partly virtual and can fall outside
      -- the window (observed: prompt x=318 for a window starting at x=736), so
      -- X comes from the window. Measured and fixed 2026-09-05.
      set py to (wy + wh - 14)
      set grp to entire contents of w
      repeat with e in grp
        try
          if role of e is "AXTextArea" then
            set p to position of e
            set sz to size of e
            set py to (item 2 of p) + ((item 2 of sz) / 2)
            exit repeat
          end if
        end try
      end repeat
      set clickX to wx + 40
    end tell
    delay 0.3
    click at {clickX, py}
    delay 0.3
    -- CLEAR THE PROMPT FIRST. A command that threw leaves its text sitting in
    -- the prompt; clicking then puts the caret INSIDE that text, the new
    -- expression is interleaved into it and throws too, so one failure cascades
    -- into every later call, each looking independent.
    keystroke "a" using command down
    delay 0.15
    key code 51
    delay 0.15
    keystroke js
    delay 0.25
    key code 36
  end tell
end run
APPLESCRIPT

# Poll for the clipboard to change rather than sleeping a fixed time.
for _ in $(seq 1 40); do
  OUT="$(pbpaste)"
  [ "$OUT" != "$SENTINEL" ] && { printf '%s\n' "$OUT"; exit 0; }
  sleep 0.15
done

echo "ios-eval: TIMED OUT - clipboard never changed. The expression did not run," >&2
echo "          or it threw. Check the console for a red error line." >&2
exit 1
