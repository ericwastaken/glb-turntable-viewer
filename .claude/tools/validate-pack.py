#!/usr/bin/env python3
"""Static validator for icon packs (a .zip, or the folder you would compress).

Checks the same things the viewer's loader checks at runtime, but without a
browser, so a broken pack is caught before anyone drags it onto the page.
Python 3 standard library only - no install step. (PyYAML, if installed, is
used for full YAML; it is required to validate a sequence.yml, whose nested
shape the built-in subset parser does not read.)

    python3 .claude/tools/validate-pack.py components/example-pack.zip
    python3 .claude/tools/validate-pack.py components/example-pack/

Exit code 0 = no errors (warnings may still be printed), 1 = errors found,
2 = the pack could not be opened at all.
"""

import json
import os
import re
import sys
import zipfile

# Kept in sync with index.html's loadZipFile(): these entries are dropped
# before the pack is inspected, so the validator must ignore them too.
def _is_junk(path):
    name = path.split("/")[-1]
    return (
        path.endswith("/")
        or path.startswith("__MACOSX/")
        or name.startswith("._")
        or name == ".DS_Store"
    )


def read_zip(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist() if not _is_junk(n)}


def read_dir(root):
    files = {}
    for base, _dirs, names in os.walk(root):
        for n in names:
            full = os.path.join(base, n)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if _is_junk(rel):
                continue
            with open(full, "rb") as fh:
                files[rel] = fh.read()
    return files


def unwrap_single_root(files):
    """Finder's Compress wraps everything in one folder; the viewer strips it."""
    roots = {p.split("/")[0] for p in files}
    if len(roots) == 1 and all("/" in p for p in files):
        prefix = next(iter(roots)) + "/"
        return {p[len(prefix):]: d for p, d in files.items() if p != prefix}
    return files


EXPORT_PATTERNS = [
    # export function NAME / export async function NAME / export class NAME
    r"export\s+(?:async\s+)?(?:function|class)\s+@\b",
    # export const NAME = / export let NAME =
    r"export\s+(?:const|let|var)\s+@\b",
    # export { x as NAME } / export { NAME }
    r"export\s*\{[^}]*\b@\b[^}]*\}",
]


def _yaml_subset(text):
    """Stdlib fallback for the manifest's own shape only: top-level `key: value`,
    `key:` followed by an indented `- item` list or `k: v` mapping, `[a, b]` flow
    lists, quoted or bare scalars, `#` comments. Anything richer raises with a
    pointer to PyYAML."""
    def scalar(v):
        v = v.strip()
        if v[:1] in "\"'" and v[-1:] == v[:1]:
            return v[1:-1]
        if v.startswith("["):
            if not v.endswith("]"):
                raise ValueError(f"unterminated flow list: {v}")
            inner = v[1:-1].strip()
            return [scalar(x) for x in inner.split(",")] if inner else []
        if v[:1] in "&*{|>!%@`":
            raise ValueError(f"unsupported YAML syntax near {v!r}")
        return v
    def strip(line):
        out, q = [], None
        for i, ch in enumerate(line):
            if q:
                out.append(ch)
                if ch == q: q = None
            elif ch in "\"'": q = ch; out.append(ch)
            elif ch == "#" and (i == 0 or line[i-1].isspace()): break
            else: out.append(ch)
        return "".join(out).rstrip()
    lines = [(len(l) - len(l.lstrip(" ")), strip(l).strip()) for l in text.splitlines()]
    lines = [(ind, t) for ind, t in lines if t]
    root, i = {}, 0
    while i < len(lines):
        ind, t = lines[i]
        if ind != 0 or ":" not in t:
            raise ValueError(f"unsupported YAML structure near {t!r}")
        key, _, rest = t.partition(":")
        key = scalar(key)
        if rest.strip():
            root[key] = scalar(rest); i += 1; continue
        i += 1
        block = []
        while i < len(lines) and lines[i][0] > 0:
            block.append(lines[i]); i += 1
        if not block:
            root[key] = None
        elif all(t.startswith("- ") or t == "-" for _, t in block):
            root[key] = [scalar(t[1:]) for _, t in block]
        elif all(":" in t and not t.startswith("-") for _, t in block):
            m = {}
            for _, t in block:
                k, _, v = t.partition(":"); m[scalar(k)] = scalar(v)
            root[key] = m
        else:
            raise ValueError(f"unsupported YAML block under {key!r}")
    return root


def parse_manifest(text, name):
    """icons.yml via PyYAML when installed; otherwise stdlib: JSON (YAML is a
    superset of JSON) then the subset parser above. icons.json is plain JSON."""
    if name.endswith(".json"):
        return json.loads(text), "json"
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text), "pyyaml"
    except ImportError:
        pass
    try:
        return json.loads(text), "json-shaped"
    except Exception:  # noqa: BLE001
        pass
    return _yaml_subset(text), "subset"


def _yaml12_keys(node):
    """PyYAML follows YAML 1.1, where a bare `on:` key is the BOOLEAN True. The
    viewer parses with js-yaml, which follows YAML 1.2 and reads it as the
    string "on" - so `on:` (the action block) would otherwise vanish here and
    every action go unchecked. Rename those keys back on the way in."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k is True:
                k = "on"
            elif k is False:
                k = "off"
            out[k] = _yaml12_keys(v)
        return out
    if isinstance(node, list):
        return [_yaml12_keys(v) for v in node]
    return node


def parse_sequence(text):
    """sequence.yml is nested (stage → layer → element, steps → timeline → tracks),
    which the subset parser cannot read. PyYAML if installed, else JSON-shaped,
    else None (the caller says PyYAML is required)."""
    try:
        import yaml  # type: ignore
        return _yaml12_keys(yaml.safe_load(text)), "pyyaml"
    except ImportError:
        pass
    try:
        return json.loads(text), "json-shaped"
    except Exception:  # noqa: BLE001
        return None, None


# --- sequence.yml structure ------------------------------------------------------
# Mirrors sequence.js (the runtime), which reports the same things as load-time
# errors. Kept as data so the two are easy to diff against each other.
LAYER_CHANNELS = {
    "icon": ("fade", "scale", "rise"),
    "dom": ("fade", "rise", "blur", "wipe", "bloom"),
}
# `pips` is the Phase 1 progress row and is deprecated; `slots` replaces it.
ELEMENT_TYPES = {"hud": ("slots", "pips"), "overlay": ("text", "button")}
ELEMENT_KEYS = {"type", "top", "left", "size", "color", "weight", "tracking", "text",
                "persist", "count", "gap", "dim", "ring"}
ACTIONS = ("replay", "nothing", "advance", "restart")
FLOW_VERBS = ("advance", "restart")
LAND_MODES = ("object", "glyph")
LAND_KEYS = {"mode", "face", "fit", "after", "delay", "fade"}
STEP_KEYS = {"id", "icon", "overlap", "copy", "timeline", "exit", "on", "end", "rest"}
# `rest:` (spring-back after a drag) and `hit:` (the grab zone) are runtime
# behaviour, not choreography, so they are top-level and step-overridable.
REST_KEYS = {"spring", "dur", "ease"}
HIT_KEYS = {"padding"}
EASE_NAME = re.compile(
    r"^(linear|none|in|out|inOut|outIn|(in|out|inOut|outIn)"
    r"(Quad|Cubic|Quart|Quint|Sine|Circ|Expo|Bounce|Back|Elastic))$"
)
CUBIC_BEZIER = re.compile(r"^cubic-bezier\(\s*[-+\d.]+\s*(,\s*[-+\d.]+\s*){3}\)$")
# name(a, b) — the Back/Elastic families take parameters, and spring(...) is a
# real spring. The runtime resolves these against Anime.js; here we only check
# the shape and the argument count, so a typo fails the pack rather than the page.
EASE_CALL = re.compile(r"^([A-Za-z]\w*)\(\s*([-+\d.,\s]*)\)$")
PARAM_EASES = {"inBack", "outBack", "inOutBack", "outInBack",
               "inElastic", "outElastic", "inOutElastic", "outInElastic"}


def ease_ok(value):
    """True if `value` is an ease the runtime will accept."""
    e = str(value).strip()
    if EASE_NAME.match(e) or CUBIC_BEZIER.match(e):
        return True
    m = EASE_CALL.match(e)
    if not m:
        return False
    name, raw = m.group(1), m.group(2).strip()
    args = [a.strip() for a in raw.split(",")] if raw else []
    for a in args:
        try:
            float(a)
        except ValueError:
            return False
    if name == "spring":
        return len(args) in (2, 4)
    return name in PARAM_EASES and len(args) <= 2
AT_EXPR = re.compile(r"^\s*([A-Za-z_][\w-]*)\s*(?:([+-])\s*([\d.]+))?\s*$")
TOP_KEYS = ("version", "ease", "requires", "resume", "hit", "rest", "stage", "initial", "steps")


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_sequence(doc, seq_file, icon_names, errors, warnings):
    """Structural checks: every track target is declared, channels are legal for
    the target's layer, timings are numeric, labels exist, eases are known, and
    - for a multi-step flow - every step names an icon the pack actually has and
    every `to:` lands somewhere that exists."""
    err = lambda m: errors.append(f"{seq_file}: {m}")  # noqa: E731
    warn = lambda m: warnings.append(f"{seq_file}: {m}")  # noqa: E731

    if not isinstance(doc, dict):
        err("must be a YAML mapping at the root")
        return
    if doc.get("version") != 1:
        err(f'"version" must be 1 (got {doc.get("version")!r})')
    for k in doc:
        if k not in TOP_KEYS:
            warn(f'unknown top-level key "{k}" (ignored by the viewer)')

    # -- stage: declared targets, by layer kind
    targets = {}  # name -> ("dom"|"icon"|"cell", type)
    stage = doc.get("stage") or {}
    if not isinstance(stage, dict):
        err('"stage" must be a mapping of layers (hud, icon, overlay)')
        stage = {}
    for layer, decls in stage.items():
        if layer == "icon":
            if not isinstance(decls, dict):
                err('stage.icon must be a mapping such as { ref: current }')
                continue
            ref = decls.get("ref", "current")
            if ref != "current" and ref not in icon_names:
                err(f'stage.icon.ref "{ref}" is neither "current" nor a listed icon')
            targets["icon"] = ("icon", "icon")
            continue
        if layer not in ELEMENT_TYPES:
            err(f'stage.{layer}: unknown layer (this viewer knows hud, icon, overlay)')
            continue
        if not isinstance(decls, dict):
            err(f"stage.{layer} must be a mapping of element name -> declaration")
            continue
        for name, decl in decls.items():
            where = f"stage.{layer}.{name}"
            if name == "icon" or name in targets:
                err(f"{where}: name already used by another target")
                continue
            if not isinstance(decl, dict):
                err(f"{where} must be a mapping such as {{ type: text, top: 0.7 }}")
                continue
            t = decl.get("type")
            if t not in ELEMENT_TYPES[layer]:
                err(f'{where}.type must be one of {", ".join(ELEMENT_TYPES[layer])} (got {t!r})')
            if t == "pips":
                warn(f"{where}: `pips` is deprecated - use `slots`, which adds the `next` "
                     "state and can receive a collected icon")
            for k in ("top", "left"):
                if k in decl and not (_is_num(decl[k]) and 0 <= decl[k] <= 1):
                    err(f"{where}.{k} must be a viewport fraction 0-1")
            for k in ("size", "tracking", "gap", "ring"):
                if k in decl and not _is_num(decl[k]):
                    err(f"{where}.{k} must be a number")
            if "persist" in decl and not isinstance(decl["persist"], bool):
                err(f"{where}.persist must be true or false")
            for k in decl:
                if k not in ELEMENT_KEYS:
                    warn(f'{where}: unknown key "{k}" (ignored)')
            targets[name] = ("dom", t)
            if t == "slots":
                count = decl.get("count", 3)
                if not (_is_num(count) and count >= 1):
                    err(f"{where}.count must be a number of rings >= 1")
                    count = 0
                # Each ring is its own `to:` destination: the element's name + index.
                for i in range(int(count)):
                    cell = f"{name}{i + 1}"
                    if cell in targets:
                        err(f'{where}: slot target "{cell}" collides with another declared element')
                    targets[cell] = ("cell", "slot")

    # -- initial: state for declared targets only
    initial = doc.get("initial") or {}
    if not isinstance(initial, dict):
        err('"initial" must be a mapping of target name -> state')
        initial = {}
    for name, st in initial.items():
        if name not in targets:
            err(f'initial.{name}: "{name}" is not declared in stage')
            continue
        kind, etype = targets[name]
        if kind == "cell":
            err(f"initial.{name}: a slot ring is only a `to:` destination; it has no state")
            continue
        if not isinstance(st, dict):
            err(f"initial.{name} must be a mapping")
            continue
        for ch, v in st.items():
            if etype == "pips" and ch in ("filled", "total"):
                if not _is_num(v):
                    err(f"initial.{name}.{ch} must be a number")
                continue
            if etype == "slots" and ch == "filled":
                if not (_is_num(v) or (isinstance(v, list) and all(isinstance(x, str) for x in v))):
                    err(f"initial.{name}.filled must be a count or a list of icon names")
                elif isinstance(v, list):
                    for n in v:
                        if n not in icon_names:
                            err(f'initial.{name}.filled names "{n}", which is not a listed icon')
                continue
            if ch not in LAYER_CHANNELS[kind]:
                err(f'initial.{name}.{ch}: not a {kind} channel ({", ".join(LAYER_CHANNELS[kind])})')
            elif not _is_num(v):
                err(f"initial.{name}.{ch} must be a number")

    # -- requires
    req = doc.get("requires") or {}
    if isinstance(req, dict):
        deg = (req.get("icon.fade") or {}).get("degrade") if isinstance(req.get("icon.fade"), dict) else None
        if deg not in (None, "scale-only"):
            err(f'requires.icon.fade.degrade "{deg}" is not supported (only scale-only)')

    # -- resume (opt-in persistence)
    resume = doc.get("resume")
    if resume is not None:
        if not isinstance(resume, dict):
            err('"resume" must be a mapping such as { minutes: 60 }')
        else:
            mins = resume.get("minutes", 0)
            if not (_is_num(mins) and mins >= 0):
                err("resume.minutes must be a number of minutes >= 0 (0 or absent = never persist)")
            if "id" in resume and not isinstance(resume["id"], str):
                err("resume.id must be a string (the localStorage key; defaults to the pack name)")
            for k in resume:
                if k not in ("minutes", "id"):
                    warn(f'resume: unknown key "{k}" (ignored)')

    # -- hit: the pointer grab zone
    hit = doc.get("hit")
    if hit is not None:
        if not isinstance(hit, dict):
            err('"hit" must be a mapping such as { padding: 0.25 }')
        else:
            if "padding" in hit and not (_is_num(hit["padding"]) and hit["padding"] >= 0):
                err("hit.padding must be a number >= 0 (a fraction of the icon's projected radius)")
            for k in hit:
                if k not in HIT_KEYS:
                    warn(f'hit: unknown key "{k}" (ignored)')

    # -- rest: spring-back after a drag (top level; a step may override it)
    def check_rest(decl, where):
        if decl is None:
            return
        if not isinstance(decl, dict):
            err(f"{where} must be a mapping such as {{ spring: true, dur: 0.8, ease: outBack }}")
            return
        if "spring" in decl and not isinstance(decl["spring"], bool):
            err(f"{where}.spring must be true or false")
        if "dur" in decl and not (_is_num(decl["dur"]) and decl["dur"] >= 0):
            err(f"{where}.dur must be a number of seconds >= 0")
        if "ease" in decl:
            e = str(decl["ease"])
            if not ease_ok(e):
                err(f'{where}.ease: unknown ease "{e}" (name, name(a, b), '
                    f"spring(stiffness, damping) or cubic-bezier(a,b,c,d))")
        for k in decl:
            if k not in REST_KEYS:
                warn(f'{where}: unknown key "{k}" (ignored)')

    check_rest(doc.get("rest"), "rest")

    # -- steps
    steps = doc.get("steps")
    if not isinstance(steps, list) or not steps:
        err('"steps" must be a non-empty list')
        return
    dom_names = [n for n, (k, _) in targets.items() if k == "dom"]

    # A sequence becomes a FLOW as soon as a step's `on:` uses advance/restart.
    flow = False
    for step in steps:
        if not isinstance(step, dict):
            continue
        for action in (step.get("on") or {}).values():
            if isinstance(action, dict) and action.get("do") in FLOW_VERBS:
                flow = True
    if flow:
        if isinstance(steps[0], dict) and "icon" not in steps[0]:
            err('steps[0]: the first step of a flow must name an `icon:`')
        ref = (stage.get("icon") or {}).get("ref", "current") if isinstance(stage.get("icon"), dict) else "current"
        if ref != "current":
            err('stage.icon.ref must be "current" in a flow - the flow drives which icon shows')

    def check_tracks(tracks, where_s, kind, allow_move):
        """One list of tracks and labels: `timeline:` (the entrance) or `exit:`."""
        if not isinstance(tracks, list):
            err(f"{where_s}.{kind} must be a list of tracks and labels")
            return
        labels = set()
        for ti, entry in enumerate(tracks):
            where = f"{where_s}.{kind}[{ti}]"
            if not isinstance(entry, dict):
                err(f"{where} must be a mapping")
                continue

            def check_at(expr, where=where):
                if expr is None or expr == "after" or _is_num(expr):
                    return
                m = AT_EXPR.match(str(expr))
                if not m:
                    err(f"{where}.at: cannot parse {expr!r}")
                elif m.group(1) not in labels:
                    err(f'{where}.at: unknown label "{m.group(1)}" (declare it above the track)')

            if "label" in entry:
                check_at(entry.get("at"))
                labels.add(str(entry["label"]))
                continue
            tid = entry.get("id", f"#{ti}")
            where = f"{where} ({tid})"
            tgts = entry.get("target")
            tgts = tgts if isinstance(tgts, list) else [tgts]
            kinds = set()
            for name in tgts:
                if not isinstance(name, str) or name not in targets:
                    err(f'{where}: target "{name}" is not declared in stage')
                elif targets[name][0] == "cell":
                    err(f'{where}: target "{name}" is a slot ring - it can only be a `to:` destination')
                else:
                    kinds.add(targets[name][0])
            check_at(entry.get("at"), where)
            if "stagger" in entry and not _is_num(entry["stagger"]):
                err(f"{where}.stagger must be a number of seconds")
            timing = entry.get("timing") or {}
            if not isinstance(timing, dict):
                err(f"{where}.timing must be {{ dur, ease }}")
                timing = {}
            if "dur" in timing and not (_is_num(timing["dur"]) and timing["dur"] >= 0):
                err(f"{where}.timing.dur must be a number of seconds >= 0")
            ease = timing.get("ease")
            if ease is not None and not ease_ok(ease):
                err(f'{where}.timing.ease "{ease}" is not an Anime.js ease name, '
                    f"a parametrised one such as outBack(0.8), spring(stiffness, damping), "
                    f"or cubic-bezier(a,b,c,d)")

            # -- a MOVE track: send the 3D icon to a 2D element
            if "to" in entry:
                if not allow_move:
                    err(f"{where}: `to:` sends the icon to a 2D element and only belongs in a step's `exit:` list")
                if tgts != ["icon"]:
                    err(f"{where}: a `to:` track must be `target: icon`")
                if "channels" in entry:
                    err(f"{where}: a `to:` track owns the icon's position and scale - put fade on a track of its own")
                dest = entry.get("to")
                if not isinstance(dest, str) or dest not in targets:
                    err(f'{where}.to: "{dest}" is not a declared 2D element')
                elif targets[dest][0] == "icon":
                    err(f"{where}.to: the destination must be a 2D element, not the icon")
                land = entry.get("land") or {}
                if not isinstance(land, dict):
                    err(f"{where}.land must be a mapping such as {{ mode: object, fit: 0.72 }}")
                    land = {}
                mode = land.get("mode", "object")
                if mode not in LAND_MODES:
                    err(f'{where}.land.mode must be one of {", ".join(LAND_MODES)} (got {mode!r})')
                if land.get("face", "front") != "front":
                    err(f'{where}.land.face: the only resting orientation is "front"')
                if "fit" in land and not (_is_num(land["fit"]) and 0 < land["fit"] <= 1):
                    err(f"{where}.land.fit must be a fraction of the target's inner diameter, 0-1")
                if "after" in land:
                    if land["after"] != "glyph":
                        err(f'{where}.land.after: the only follow-up landing is "glyph"')
                    elif mode != "object":
                        err(f"{where}.land.after: only an object landing can be swapped to a glyph afterwards")
                if "delay" in land and not (_is_num(land["delay"]) and land["delay"] >= 0):
                    err(f"{where}.land.delay must be a number of seconds >= 0")
                if "fade" in land and not (_is_num(land["fade"]) and land["fade"] >= 0):
                    err(f"{where}.land.fade must be a number of seconds >= 0 "
                        "(the object -> glyph cross-fade; 0 = a hard swap)")
                for k in land:
                    if k not in LAND_KEYS:
                        warn(f'{where}.land: unknown key "{k}" (ignored)')
                continue

            channels = entry.get("channels")
            if not isinstance(channels, dict) or not channels:
                err(f"{where} needs a non-empty channels mapping")
                continue
            for ch, v in channels.items():
                for k in kinds:
                    if ch not in LAYER_CHANNELS[k]:
                        err(f'{where}.channels.{ch}: not a {k} channel ({", ".join(LAYER_CHANNELS[k])})')
                ok = _is_num(v) or (isinstance(v, list) and len(v) == 2 and all(_is_num(x) for x in v))
                if not ok:
                    err(f"{where}.channels.{ch} must be a number or [from, to]")

    for si, step in enumerate(steps):
        sid = step.get("id", f"#{si}") if isinstance(step, dict) else f"#{si}"
        where_s = f"steps[{si}] ({sid})"
        if not isinstance(step, dict):
            err(f"{where_s} must be a mapping")
            continue
        for k in step:
            if k not in STEP_KEYS:
                warn(f'{where_s}: unknown key "{k}" (ignored)')
        if "icon" in step and step["icon"] not in icon_names:
            err(f'{where_s}.icon "{step["icon"]}" is not a listed icon')
        if "overlap" in step and not (_is_num(step["overlap"]) and step["overlap"] >= 0):
            err(f"{where_s}.overlap must be a number of seconds >= 0")
        check_rest(step.get("rest"), f"{where_s}.rest")
        if "exit" in step and not flow:
            warn(f"{where_s}.exit is only played when a step is LEFT, which needs a flow "
                 "(an `on:` using advance/restart)")
        for name in (step.get("copy") or {}):
            if name not in dom_names:
                err(f'{where_s}.copy.{name}: not a declared overlay/hud element')
        end = step.get("end", "hold")
        if end != "hold":
            warn(f'{where_s}.end "{end}" is not implemented - the viewer holds the final frame')
        on = step.get("on") or {}
        if not isinstance(on, dict):
            err(f"{where_s}.on must be a mapping such as {{ cta.tap: {{ do: replay }} }}")
        else:
            for key, action in on.items():
                m = re.match(r"^([A-Za-z_][\w-]*)\.tap$", str(key))
                if not m:
                    err(f"{where_s}.on.{key}: only <target>.tap is supported")
                    continue
                if m.group(1) not in targets:
                    err(f'{where_s}.on.{key}: target "{m.group(1)}" is not declared in stage')
                elif targets[m.group(1)][0] == "icon":
                    warn(f"{where_s}.on.{key}: taps on the icon are not routed (ignored)")
                verb = action.get("do") if isinstance(action, dict) else None
                if verb not in ACTIONS:
                    err(f'{where_s}.on.{key}.do must be one of {", ".join(ACTIONS)}')

        check_tracks(step.get("timeline"), where_s, "timeline", allow_move=False)
        if "exit" in step:
            check_tracks(step.get("exit"), where_s, "exit", allow_move=True)


def exports(src, name):
    esc = re.escape(name)
    return any(re.search(p.replace("@", esc), src) for p in EXPORT_PATTERNS)


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    target = argv[1]
    try:
        files = read_dir(target) if os.path.isdir(target) else read_zip(target)
    except Exception as err:  # noqa: BLE001 - report, don't trace
        print(f"ERROR  could not open {target}: {err}")
        return 2

    files = unwrap_single_root(files)
    errors, warnings = [], []

    # --- entry module -------------------------------------------------------
    entry = None
    if "component.js" in files:
        entry = "component.js"
    else:
        cands = [p for p in files if p.endswith(".component.js") and "/" not in p]
        if len(cands) == 1:
            entry = cands[0]
        elif cands:
            errors.append(
                "several *.component.js files at the top level - the loader only "
                f"accepts one: {sorted(cands)}"
            )
    if not entry:
        errors.append(
            "no component.js at the top level of the pack (copy "
            "components/pack.component.js in unchanged)"
        )

    # The stock loader is meant to be byte-identical in every pack.
    repo_loader = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..",
        "components", "pack.component.js",
    )
    if entry and os.path.exists(repo_loader):
        with open(repo_loader, "rb") as fh:
            if fh.read() != files[entry]:
                warnings.append(
                    f"{entry} differs from components/pack.component.js - the stock "
                    "pack loader is the same in every pack and should be copied in unedited"
                )

    # --- manifest -----------------------------------------------------------
    # icons.yml is the manifest. icons.json still loads (deprecated).
    names = []
    manifest = None
    has_yml, has_json = "icons.yml" in files, "icons.json" in files
    if has_yml and has_json:
        warnings.append(
            "both icons.yml and icons.json are present - the loader reads icons.yml "
            "and ignores icons.json; delete icons.json"
        )
    mf = "icons.yml" if has_yml else ("icons.json" if has_json else None)
    if mf is None:
        errors.append("no icons.yml at the top level (expected e.g.  icons: [myicon])")
    else:
        if mf == "icons.json":
            warnings.append(
                "icons.json is deprecated and will be unsupported in a future version - "
                "rename it to icons.yml (same keys; YAML is a superset of JSON)"
            )
        try:
            manifest, how = parse_manifest(files[mf].decode("utf-8"), mf)
            if how == "subset":
                print("  note   PyYAML is not installed; validated icons.yml with the built-in "
                      "subset parser (pip install pyyaml for full YAML)")
        except Exception as err:  # noqa: BLE001
            kind = "JSON" if mf.endswith(".json") else "YAML"
            errors.append(f"{mf} is not valid {kind}: {err}")
        if isinstance(manifest, dict):
            names = manifest.get("icons")
            if not isinstance(names, list) or not names:
                errors.append(f'{mf} needs a non-empty "icons" list of folder names')
                names = []
            for extra in manifest:
                if extra not in ("icons", "background", "backgrounds", "glyphs", "sequence"):
                    warnings.append(f'{mf}: unknown key "{extra}" (ignored by the loader)')
        elif manifest is not None:
            errors.append(f"{mf} must be a mapping at the root")

    # --- icons --------------------------------------------------------------
    for name in names:
        if not isinstance(name, str):
            errors.append(f"{mf} lists a non-string icon name: {name!r}")
            continue
        idx = f"icons/{name}/src/index.js"
        if idx not in files:
            errors.append(f'icon "{name}" listed in {mf} has no {idx}')
            continue
        src = files[idx].decode("utf-8", "replace")
        for required in ("createIconObject", "loadIconGeometry"):
            if not exports(src, required):
                errors.append(f"{idx} does not export {required} (required)")
        for optional in ("loadIconTextures", "IconController", "LAYOUT"):
            if exports(src, optional):
                print(f"  note   {name}: optional export {optional} present")

    listed = set(n for n in names if isinstance(n, str))
    on_disk = {p.split("/")[1] for p in files if p.startswith("icons/") and p.count("/") >= 2}
    for orphan in sorted(on_disk - listed):
        warnings.append(
            f'icons/{orphan}/ exists but is not listed in {mf} - it will not load'
        )

    # --- backgrounds --------------------------------------------------------
    def check_bg(value, where):
        if not isinstance(value, str) or not value.strip():
            return
        v = value.strip()
        if re.match(r"^(#|rgb|hsl)", v, re.I) or re.fullmatch(r"[a-z]+", v, re.I):
            return  # a CSS color, not a path
        if v not in files:
            errors.append(f"{where} points at \"{v}\", which is not in the pack")

    if isinstance(manifest, dict):
        check_bg(manifest.get("background"), f'{mf} "background"')
        per_icon = manifest.get("backgrounds") or {}
        if isinstance(per_icon, dict):
            for icon, value in per_icon.items():
                if icon not in listed:
                    warnings.append(
                        f'{mf} "backgrounds" has an entry for "{icon}", '
                        "which is not a listed icon"
                    )
                check_bg(value, f'{mf} "backgrounds"."{icon}"')

        # --- glyphs: a per-icon 2D mark a sequence drops into a slot ---------
        # Always a path inside the pack (never a colour), and the viewer derives
        # one for any icon that has no entry.
        glyphs = manifest.get("glyphs") or {}
        if not isinstance(glyphs, dict):
            errors.append(f'{mf} "glyphs" must be a mapping of icon name -> image path')
        else:
            for icon, value in glyphs.items():
                if icon not in listed:
                    warnings.append(
                        f'{mf} "glyphs" has an entry for "{icon}", which is not a listed icon'
                    )
                if not isinstance(value, str) or not value.strip():
                    errors.append(f'{mf} "glyphs"."{icon}" must be a path inside the pack')
                elif value.strip() not in files:
                    errors.append(
                        f'{mf} "glyphs"."{icon}" points at "{value}", which is not in the pack'
                    )

    # --- sequence -----------------------------------------------------------
    # Optional `sequence: sequence.yml` in the manifest (AGENT.md §12). The file
    # must exist in the pack; its structure is checked against the same rules
    # the runtime enforces at load.
    if isinstance(manifest, dict) and manifest.get("sequence") is not None:
        seq_file = manifest.get("sequence")
        if not isinstance(seq_file, str) or not seq_file.strip():
            errors.append(f'{mf} "sequence" must be a relative path such as sequence.yml')
        elif seq_file not in files:
            errors.append(f'{mf} "sequence" points at "{seq_file}", which is not in the pack')
        else:
            doc, how = parse_sequence(files[seq_file].decode("utf-8"))
            if how is None:
                warnings.append(
                    f"{seq_file} was NOT validated: PyYAML is required to read a sequence "
                    "file (pip install pyyaml)"
                )
            else:
                validate_sequence(doc, seq_file, listed, errors, warnings)
                if not errors or not any(e.startswith(seq_file) for e in errors):
                    print(f"  note   {seq_file}: sequence structure OK ({how})")

    # --- size sanity --------------------------------------------------------
    for path, data in sorted(files.items()):
        if len(data) > 2_000_000:
            warnings.append(f"{path} is {len(data)//1024} KB - keep pack assets web-sized")

    for w in warnings:
        print(f"  warn   {w}")
    for e in errors:
        print(f"  ERROR  {e}")

    total = len(files)
    if errors:
        print(f"\n{target}: {len(errors)} error(s), {len(warnings)} warning(s), {total} file(s).")
        return 1
    print(
        f"\n{target}: OK - {len(listed)} icon(s) [{', '.join(sorted(listed))}], "
        f"{total} file(s), {len(warnings)} warning(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
