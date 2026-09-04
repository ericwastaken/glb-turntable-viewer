#!/usr/bin/env python3
"""Static validator for icon packs (a .zip, or the folder you would compress).

Checks the same things the viewer's loader checks at runtime, but without a
browser, so a broken pack is caught before anyone drags it onto the page.
Python 3 standard library only - no install step.

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
                if extra not in ("icons", "background", "backgrounds"):
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
