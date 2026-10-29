#!/usr/bin/env python3
"""Subset the web fonts used by @v5x/ui. Run by hand; the build never runs this.

Usage, from the repository root:
    python3 packages/ui/scripts/subset-fonts.py                 # default output
    python3 packages/ui/scripts/subset-fonts.py --split-latin   # opt-in core/extended split
    python3 packages/ui/scripts/subset-fonts.py --report        # sizes only, nothing written

Needs fonttools and brotli:  pip install fonttools brotli

Reads the @fontsource-variable packages installed for @v5x/ui and writes:
    packages/ui/src/fonts/<family>-<subset>.woff2   subset files (committed)
    packages/ui/src/fonts/licenses/<family>.txt     each family's OFL text
    packages/ui/src/styles/fonts.css                @font-face rules (generated)

Default (identical rendering): every fontsource subset keeps its glyphs, its
declared unicode-range, and its place in the CSS order, so browsers shape and
fall back as before. Files are pruned to the features, weight range, and tables
listed below.

--split-latin (changes rendering, opt-in): the latin subset becomes two files.
    core      printable ASCII and common punctuation. Preloaded.
    extended  the rest of the latin subset (Latin-1, symbols).
Kerning does not cross the split, so pairs such as "VÁ" lose their adjustment
(about 1.6 px at 16 px in Merriweather). See packages/ui/src/fonts/README.md.

Rerun this script when the fontsource version changes (bun.lock) or when a
feature list, weight range, or CORE_CODEPOINTS changes.
"""

import argparse
import io
import re
import sys
from collections import OrderedDict
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[3]
UI = ROOT / "packages/ui"
FONTSOURCE = UI / "node_modules/@fontsource-variable"
OUT_FONTS = UI / "src/fonts"
OUT_CSS = UI / "src/styles/fonts.css"

# weight_range is the wght axis each file keeps. It must cover every weight the
# site requests: 400 body, 500 medium, 600 semibold, and 700 or 900 from the UA
# bolder rule on <strong> and bold code. Outside the range a request clamps to the
# nearest end. A range narrows only where advance widths stay exact: narrowing
# re-encodes deltas (outlines move by at most 0.35 font units, under 0.01 px at
# 16 px), and moving the default or the top of the axis changes advances. So
# Merriweather keeps 300, its default, and DM Sans keeps 1000.
FAMILIES = {
    "merriweather": {
        "css_name": "Merriweather Variable",
        "weight_range": (300, 900),
        # Merriweather has a Reserved Font Name under the OFL, so modified files
        # must not use it. The copyright record (name ID 0) stays verbatim.
        "rename_to": "v5x Serif Subset",
        # tnum: the site sets tabular-nums on serif text (scores, counts).
        "features": ["calt", "ccmp", "liga", "locl", "tnum", "kern", "mark", "mkmk"],
    },
    "dm-sans": {
        "css_name": "DM Sans Variable",
        "weight_range": (400, 1000),
        "rename_to": None,
        "features": ["calt", "ccmp", "liga", "locl", "kern", "mark", "mkmk"],
    },
    "jetbrains-mono": {
        "css_name": "JetBrains Mono Variable",
        "weight_range": (400, 800),
        "rename_to": None,
        # calt carries the programming ligatures (!=, ->, =>) in code.
        "features": ["calt", "ccmp", "locl", "mark"],
    },
}

# Core glyphs for --split-latin: printable ASCII plus the punctuation most pages use.
CORE_CODEPOINTS = set(range(0x20, 0x7F)) | {
    0x00B7,  # middle dot
    0x2013,  # en dash
    0x2014,  # em dash
    0x2018,  # left single quotation mark
    0x2019,  # right single quotation mark
    0x201C,  # left double quotation mark
    0x201D,  # right double quotation mark
    0x2026,  # horizontal ellipsis
}

# Characters the site's source uses that the families contain. ⌘ and ⇧ are absent
# from all three families and keep falling back to the system font.
USED_CHARACTERS = {
    0x00B0,  # degree sign
    0x00C1,  # Á
    0x00DC,  # Ü
    0x2212,  # minus sign
}

LAYOUT_NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # copyright, names, and license


def parse_range(text):
    """Expand a CSS unicode-range value into a set of codepoints."""
    cps = set()
    for part in text.split(","):
        match = re.fullmatch(r"\s*U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?\s*", part)
        low = int(match.group(1), 16)
        high = int(match.group(2), 16) if match.group(2) else low
        cps.update(range(low, high + 1))
    return cps


def parse_fontsource(family):
    """Return OrderedDict subset -> (source path, declared codepoints), in CSS order.

    The declared range is fontsource's own unicode-range. Some subset files carry
    glyphs outside it (space and A in the Cyrillic files). Those glyphs are
    unreachable in the original, so the outputs keep only declared codepoints.
    """
    css = (FONTSOURCE / family / "index.css").read_text()
    faces = OrderedDict()
    for block in re.findall(r"@font-face\s*\{(.*?)\}", css, re.S):
        src = re.search(r"url\(\./files/([^)]+)\)", block).group(1)
        subset_name = re.match(rf"{re.escape(family)}-(.+)-wght-normal\.woff2", src).group(1)
        declared = parse_range(re.search(r"unicode-range:\s*([^;]+);", block).group(1))
        faces[subset_name] = (FONTSOURCE / family / "files" / src, declared)
    return faces


def ranges(codepoints):
    """Format codepoints as a CSS unicode-range value."""
    parts, cps = [], sorted(codepoints)
    start = prev = None
    for cp in cps + [None]:
        if start is None:
            start = prev = cp
        elif cp is not None and cp == prev + 1:
            prev = cp
        else:
            parts.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
            start = prev = cp
    return ",".join(parts)


def plan_identical(family):
    """One output per fontsource subset, in CSS order, with its declared range."""
    plan = []
    for subset_name, (path, declared) in parse_fontsource(family).items():
        reachable = set(TTFont(path).getBestCmap()) & declared
        plan.append((subset_name, path, reachable))
    return plan


def plan_split_latin(family):
    """As plan_identical, with the latin subset split into core and extended."""
    plan = []
    for subset_name, (path, declared) in parse_fontsource(family).items():
        reachable = set(TTFont(path).getBestCmap()) & declared
        if subset_name == "latin":
            core = reachable & CORE_CODEPOINTS
            plan.append(("core", path, core))
            plan.append(("extended", path, reachable - core))
        else:
            plan.append((subset_name, path, reachable))
    return plan


def rename_reserved(font, new_name):
    """Replace the Reserved Font Name in the family-facing name records."""
    name = font["name"]
    for name_id in (16, 17):
        name.removeNames(nameID=name_id)
    values = {
        1: new_name,
        2: "Regular",
        3: f"{new_name} Regular;subset",
        4: f"{new_name} Regular",
        6: new_name.replace(" ", "") + "-Regular",
    }
    for name_id, value in values.items():
        name.removeNames(nameID=name_id)
        name.setName(value, name_id, 3, 1, 0x409)


def build_font(source, family_info, cps, output):
    """Pin the weight range when it narrows, subset to cps, and write a woff2 file."""
    # recalcTimestamp=False keeps head.modified from the source, so reruns are byte-identical.
    font = TTFont(source, recalcTimestamp=False)
    low, high = family_info["weight_range"]
    axis = font["fvar"].axes[0]
    if (low, high) != (axis.minValue, axis.maxValue):
        font = instancer.instantiateVariableFont(font, {"wght": (low, high)})
        # fontTools' instancer leaves gvar lazy and incomplete (it drops glyphs
        # such as "space", then the subsetter fails). A save and reload fixes it.
        buffer = io.BytesIO()
        font.save(buffer)
        font = TTFont(io.BytesIO(buffer.getvalue()), recalcTimestamp=False)
    font["fvar"].instances = []  # named instances are unused by browsers
    if family_info["rename_to"]:
        rename_reserved(font, family_info["rename_to"])

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = family_info["features"]
    options.name_IDs = LAYOUT_NAME_IDS
    options.name_languages = [0x409]
    options.name_legacy = False
    options.glyph_names = False  # post format 3: no glyph names
    options.hinting = True  # keeps prep and gasp; see fonts/README.md
    options.drop_tables += ["STAT"]  # design-tool metadata only
    options.ignore_missing_unicodes = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(cps))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(output)


def measure(path):
    font = TTFont(path)
    info = {
        "bytes": Path(path).stat().st_size,
        "glyphs": font["maxp"].numGlyphs,
        "codepoints": len(font.getBestCmap()),
        "axes": [(a.axisTag, int(a.minValue), int(a.defaultValue), int(a.maxValue)) for a in font["fvar"].axes] if "fvar" in font else [],
        "features": {
            tag: sorted({r.FeatureTag for r in font[tag].table.FeatureList.FeatureRecord})
            for tag in ("GSUB", "GPOS")
            if tag in font
        },
        "hinting": [t for t in ("fpgm", "prep", "cvt ", "gasp") if t in font],
    }
    font.close()
    return info


def font_face_css(family_info, file_name, cps, weight_range):
    return "\n".join([
        "@font-face {",
        f"  font-family: '{family_info['css_name']}';",
        "  font-style: normal;",
        "  font-display: swap;",
        f"  font-weight: {weight_range[0]} {weight_range[1]};",
        f"  src: url(../fonts/{file_name}) format('woff2-variations');",
        f"  unicode-range: {ranges(cps)};",
        "}",
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--split-latin", action="store_true", help="split latin into core and extended (changes rendering)")
    parser.add_argument("--report", action="store_true", help="print sizes without writing outputs")
    args = parser.parse_args()
    planner = plan_split_latin if args.split_latin else plan_identical

    scratch = Path("/tmp")
    css_blocks, rows = [], []
    if not args.report:
        # Remove the other mode's files so the committed set matches the chosen mode.
        if OUT_FONTS.exists():
            for old in OUT_FONTS.glob("*.woff2"):
                old.unlink()
        OUT_FONTS.mkdir(parents=True, exist_ok=True)
        OUT_CSS.parent.mkdir(parents=True, exist_ok=True)
    for family, info in FAMILIES.items():
        family_plan = planner(family)
        planned = set()
        for tier, source, cps in family_plan:
            planned |= cps
            file_name = f"{family}-{tier}.woff2"
            output = scratch / f"v5x-report-{file_name}" if args.report else OUT_FONTS / file_name
            build_font(source, info, cps, output)
            data = measure(output)
            rows.append((file_name, Path(source).stat().st_size, data))
            axis = data["axes"][0]
            css_blocks.append(font_face_css(info, file_name, cps, (axis[1], axis[3])))
        # Every used character the family has must land in one of its files.
        in_family = {cp for _, source, _ in family_plan for cp in TTFont(source).getBestCmap()}
        missing = (USED_CHARACTERS & in_family) - planned
        assert not missing, f"{family}: used characters not planned: {sorted(hex(c) for c in missing)}"
        if not args.report:
            (OUT_FONTS / "licenses").mkdir(parents=True, exist_ok=True)
            (OUT_FONTS / "licenses" / f"{family}.txt").write_text(
                (FONTSOURCE / family / "LICENSE").read_text()
            )

    print(f"{'file':36} {'source':>8} {'output':>8}  glyphs  cps  axes  features")
    for name, source_bytes, data in rows:
        axes = ",".join(f"{t} {lo}-{hi}" for t, lo, _, hi in data["axes"]) or "-"
        feats = " ".join(f"{k}:{len(v)}" for k, v in data["features"].items())
        print(f"{name:36} {source_bytes:>8} {data['bytes']:>8}  {data['glyphs']:>6} {data['codepoints']:>4}  {axes}  {feats}  hinting={data['hinting']}")

    if not args.report:
        mode = "split-latin" if args.split_latin else "identical"
        OUT_CSS.write_text(
            f"/* Generated by packages/ui/scripts/subset-fonts.py ({mode}). Do not edit by hand. */\n\n"
            + "\n\n".join(css_blocks)
            + "\n"
        )
        print(f"wrote {OUT_FONTS.relative_to(ROOT)} and {OUT_CSS.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
