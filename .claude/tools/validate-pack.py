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
    names = []
    manifest = None
    if "icons.json" not in files:
        errors.append('no icons.json at the top level (expected e.g. {"icons": ["myicon"]})')
    else:
        try:
            manifest = json.loads(files["icons.json"].decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            errors.append(f"icons.json is not valid JSON: {err}")
        if isinstance(manifest, dict):
            names = manifest.get("icons")
            if not isinstance(names, list) or not names:
                errors.append('icons.json needs a non-empty "icons" array of folder names')
                names = []
            for extra in manifest:
                if extra not in ("icons", "background", "backgrounds"):
                    warnings.append(f'icons.json: unknown key "{extra}" (ignored by the loader)')
        elif manifest is not None:
            errors.append("icons.json must be a JSON object at the root")

    # --- icons --------------------------------------------------------------
    for name in names:
        if not isinstance(name, str):
            errors.append(f"icons.json lists a non-string icon name: {name!r}")
            continue
        idx = f"icons/{name}/src/index.js"
        if idx not in files:
            errors.append(f'icon "{name}" listed in icons.json has no {idx}')
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
            f'icons/{orphan}/ exists but is not listed in icons.json - it will not load'
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
        check_bg(manifest.get("background"), 'icons.json "background"')
        per_icon = manifest.get("backgrounds") or {}
        if isinstance(per_icon, dict):
            for icon, value in per_icon.items():
                if icon not in listed:
                    warnings.append(
                        f'icons.json "backgrounds" has an entry for "{icon}", '
                        "which is not a listed icon"
                    )
                check_bg(value, f'icons.json "backgrounds"."{icon}"')

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
