#!/bin/bash
# ios-safari-drive.sh - drive Safari on an iOS host (physical iPhone or
# Simulator) through Apple's own safaridriver, using nothing but curl.
#
# No Selenium, no node, no pip, no Xcode project. safaridriver ships with macOS.
#
#   bash ios-safari-drive.sh start                    # start safaridriver :4444
#   bash ios-safari-drive.sh devices                  # list iOS hosts
#   bash ios-safari-drive.sh session-device <UDID>    # session on a real iPhone
#   bash ios-safari-drive.sh session-sim <SIM-UDID>   # session on a Simulator
#   bash ios-safari-drive.sh go   <URL>               # navigate
#   bash ios-safari-drive.sh eval '<js returning val>'# executeScript
#   bash ios-safari-drive.sh text <cssSelector>       # element text
#   bash ios-safari-drive.sh tap  <cssSelector>       # element click/tap
#   bash ios-safari-drive.sh type <cssSelector> <str> # send keys
#   bash ios-safari-drive.sh source                   # full page source (DOM)
#   bash ios-safari-drive.sh shot  [out.png]          # viewport screenshot
#   bash ios-safari-drive.sh stop                     # end session + driver
#
# The session id is cached in $SIDFILE so subcommands chain across calls.
set -uo pipefail
PORT="${SAFARIDRIVER_PORT:-4444}"
BASE="http://127.0.0.1:$PORT"
SIDFILE="${SIDFILE:-/tmp/ios-safari-drive.sid}"
PY=/usr/bin/python3
j() { "$PY" -c 'import sys,json;print(json.dumps(sys.stdin.read()))' ; }

sid() { [ -s "$SIDFILE" ] || { echo "no session - run session-device/session-sim first" >&2; exit 1; }; cat "$SIDFILE"; }
S()   { local i; i=$(sid) || exit 1; echo "$BASE/session/$i"; }

newsession() { # $1 = JSON capabilities body
  R=$(curl -s --max-time 150 -X POST "$BASE/session" -H 'Content-Type: application/json' -d "$1")
  echo "$R"
  ID=$(echo "$R" | "$PY" -c 'import sys,json
try: print(json.load(sys.stdin)["value"].get("sessionId",""))
except Exception: print("")' )
  [ -n "$ID" ] && { echo "$ID" > "$SIDFILE"; echo "session cached: $ID"; } || exit 1
}

elemid() { # $1 = css selector -> element id
  curl -s --max-time 30 -X POST "$(S)/element" -H 'Content-Type: application/json' \
    -d "{\"using\":\"css selector\",\"value\":$(printf '%s' "$1" | j)}" \
  | "$PY" -c 'import sys,json
v=json.load(sys.stdin)["value"]
if isinstance(v,dict) and "error" not in v: print(list(v.values())[0])
else: raise SystemExit("element not found: %s"%v)'
}

case "${1:-}" in
  start)
    pkill -f "safaridriver -p $PORT" 2>/dev/null; sleep 1
    nohup /usr/bin/safaridriver -p "$PORT" --diagnose >/tmp/safaridriver-$PORT.log 2>&1 &
    sleep 2; curl -s --max-time 10 "$BASE/status"; echo ;;
  devices)
    echo "--- physical (xcrun devicectl) ---"; xcrun devicectl list devices 2>/dev/null
    echo "--- simulators (booted first) ---"; xcrun simctl list devices available 2>/dev/null | grep -E "iPhone|iPad" ;;
  session-device)
    newsession "{\"capabilities\":{\"alwaysMatch\":{\"browserName\":\"Safari\",\"platformName\":\"iOS\",\"safari:useSimulator\":false,\"safari:deviceUDID\":\"$2\"}}}" ;;
  session-sim)
    newsession "{\"capabilities\":{\"alwaysMatch\":{\"browserName\":\"Safari\",\"platformName\":\"iOS\",\"safari:useSimulator\":true,\"safari:deviceUDID\":\"$2\"}}}" ;;
  go)     curl -s --max-time 90 -X POST "$(S)/url" -H 'Content-Type: application/json' -d "{\"url\":$(printf '%s' "$2" | j)}"; echo ;;
  url)    curl -s --max-time 30 "$(S)/url"; echo ;;
  title)  curl -s --max-time 30 "$(S)/title"; echo ;;
  eval)   curl -s --max-time 90 -X POST "$(S)/execute/sync" -H 'Content-Type: application/json' \
            -d "{\"script\":$(printf '%s' "$2" | j),\"args\":[]}"; echo ;;
  text)   curl -s --max-time 30 "$(S)/element/$(elemid "$2")/text"; echo ;;
  tap)    curl -s --max-time 30 -X POST "$(S)/element/$(elemid "$2")/click" -H 'Content-Type: application/json' -d '{}'; echo ;;
  type)   curl -s --max-time 30 -X POST "$(S)/element/$(elemid "$2")/value" -H 'Content-Type: application/json' \
            -d "{\"text\":$(printf '%s' "$3" | j)}"; echo ;;
  source) curl -s --max-time 60 "$(S)/source"; echo ;;
  shot)   curl -s --max-time 60 "$(S)/screenshot" \
            | "$PY" -c 'import sys,json,base64;open(sys.argv[1],"wb").write(base64.b64decode(json.load(sys.stdin)["value"]))' "${2:-/tmp/ios-shot.png}"
          echo "${2:-/tmp/ios-shot.png}" ;;
  stop)   [ -f "$SIDFILE" ] && curl -s --max-time 20 -X DELETE "$(S)" >/dev/null; rm -f "$SIDFILE"
          pkill -f "safaridriver -p $PORT" 2>/dev/null; echo "stopped" ;;
  *) sed -n '2,30p' "$0" ;;
esac
