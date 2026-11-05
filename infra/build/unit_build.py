#!/usr/bin/env python3
"""Per-function compilation for one translation unit.

A source file becomes a set of units: a globals unit and one unit per split function (see unit_split). Each
unit is cached by content, so an edit inside a function body recompiles only that function's unit. The units
are combined with `ld -r` into the single object make expects for the file, so the rest of the build is unchanged.

Analysis has two paths:
  fast  an edit confined to one function body (the common case) is applied to the previous analysis. The
        prelude and the other units are unchanged by construction, so libclang is not run.
  slow  libclang re-analyses the file from scratch. A unit keeps its object from the previous build when nothing
        it can see has changed: its own definition, and every top-level declaration it uses, directly or through
        the file's inline, static and variable definitions (see reusable_units). Anything broader, such as a macro,
        a type, a template or an operator, compiles every unit again.
Both raise unit_split.Unsplittable when the file cannot be split; the caller then compiles it whole.
"""
import collections
import hashlib
import json
import os
import pathlib
import re
import subprocess
import threading

import unit_split
from unit_split import Function, Global, Unsplittable

DIRECTIVE = re.compile(r"^\s*#", re.M)
IDENTIFIER = re.compile(r"[A-Za-z_]\w*")
PLAIN_NAME = re.compile(r"[A-Za-z_]\w*\Z")
# Declarations whose changes are reasoned about by name. Anything else changes every unit.
PLAIN_CATEGORIES = ("function-sig", "function-decl", "function-body", "variable")
# Compiler processes at once. Each loads the precompiled header, so more than the CPUs only adds memory pressure.
COMPILE_JOBS = int(os.environ.get("V5X_COMPILE_JOBS", "2"))


def sha(data):
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def brace_balanced(text):
    """True if braces in text (a function body) open at the first character and close exactly at the last."""
    depth = 0
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end < 0:
                return False
            i = end + 2
            continue
        if c in "\"'":
            if i > 0 and c == '"' and text[i - 1] == "R":
                return False  # raw string literals are not scanned here
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 1
                if j < n and text[j] == "\n":
                    return False
                j += 1
            if j >= n:
                return False
            i = j + 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                return False
            if depth == 0 and i != n - 1:
                return False
        i += 1
    return depth == 0 and n > 0


class Analysis:
    """What the last build of a file was made from: its split, and the object of each unit."""

    def __init__(self, source_sha, functions, globals_, prelude_sha, mode, risky=None, decls=None, directives="",
                 objects=None, flags=""):
        self.source_sha = source_sha
        self.functions = functions
        self.globals_ = globals_
        self.prelude_sha = prelude_sha
        self.mode = mode  # "fast" or "slow"
        self.risky = risky or []  # file-local stateful functions; edits naming them re-analyse
        # The declarations the objects were built against: [category, name, text, line] (see unit_split.split).
        self.decls = decls or []
        self.directives = directives  # the prelude's preprocessor lines
        # Object of each unit from the last build, keyed by its definition (or "globals"); reused while still valid.
        self.objects = objects or {}
        self.flags = flags  # the compiler flags and precompiled header the objects were built with

    def copy(self, **changes):
        values = dict(vars(self))
        values.update(changes)
        return Analysis(**values)

    def to_json(self):
        return json.dumps({
            "source_sha": self.source_sha,
            "functions": [vars(f) for f in self.functions],
            "globals": [vars(g) for g in self.globals_],
            "prelude_sha": self.prelude_sha,
            "risky": self.risky,
            "decls": self.decls,
            "directives": self.directives,
            "objects": self.objects,
            "flags": self.flags,
        })

    @staticmethod
    def from_json(text):
        data = json.loads(text)
        return Analysis(
            source_sha=data["source_sha"],
            functions=[Function(**f) for f in data["functions"]],
            globals_=[Global(**g) for g in data["globals"]],
            prelude_sha=data["prelude_sha"],
            mode="cached",
            risky=data.get("risky", []),
            decls=data.get("decls", []),
            directives=data.get("directives", ""),
            objects=data.get("objects", {}),
            flags=data.get("flags", ""),
        )


class Plan:
    def __init__(self, labels, texts, analysis, keys=None, uses=None):
        self.labels = labels    # "globals" then the function names, in source order
        self.texts = texts      # the text of each unit
        self.analysis = analysis
        self.keys = keys or []  # "globals", or the definition key of each function
        self.uses = uses or []  # identifiers each function's definition uses; None for globals


def definition_key(definition, line):
    return sha(f"{line}\n{definition}")


def _plan_from(source, analysis, path):
    _, prelude = unit_split.render(source, analysis.functions, analysis.globals_)
    if sha(prelude) != analysis.prelude_sha:
        raise Unsplittable("prelude changed without a re-analysis")
    labels, keys, uses, texts = [], [], [], []
    body_edits = [(f.body_start, f.body_end, ";") for f in analysis.functions]
    # One unit per file-scope object: the prelude with that object defined, and the others declared extern. A new
    # object then costs one small unit, and an object that did not change is not compiled again.
    for g in analysis.globals_:
        line = source.count("\n", 0, g.start) + 1
        definition = source[g.start:g.end]
        edits = list(body_edits)
        for other in analysis.globals_:
            if other is not g:
                edits.append((other.start, other.end, "" if other.strip_in_prelude else f"extern {other.type_text} {other.name};"))
        labels.append(f"object {g.name}")
        keys.append(definition_key(definition, line))
        uses.append(set(IDENTIFIER.findall(definition)))
        texts.append(f'#line 1 "{path}"\n' + unit_split._apply(source, edits))
    for f in analysis.functions:
        line = source.count("\n", 0, f.decl_start) + 1
        definition = source[f.decl_start:f.body_end]
        keys.append(definition_key(definition, line))
        uses.append(set(IDENTIFIER.findall(definition)))
        labels.append(f.name)
        texts.append(f'#line 1 "{path}"\n' + prelude + f'\n#line {line} "{path}"\n' + definition + "\n")
    return Plan(labels, texts, analysis, keys, uses)


def fast_analysis(previous, source, previous_source):
    """Applies an edit confined to one function body to the previous analysis, or returns None."""
    if previous_source == source:
        return previous.copy(mode="fast")
    old, new = previous_source, source
    lim = min(len(old), len(new))
    p = 0
    while p < lim and old[p] == new[p]:
        p += 1
    s = 0
    while s < lim - p and old[len(old) - 1 - s] == new[len(new) - 1 - s]:
        s += 1
    old_start, old_end = p, len(old) - s
    delta = len(new) - len(old)
    for f in previous.functions:
        if f.body_start < old_start and old_end < f.body_end - 1:
            body_end = f.body_end + delta
            body = new[f.body_start:body_end]
            if not body.startswith("{") or not body.endswith("}"):
                return None
            if DIRECTIVE.search(body) or not brace_balanced(body):
                return None
            if any(re.search(r"\b" + re.escape(name) + r"\b", body) for name in previous.risky):
                return None  # the new body may reach a file-local stateful function: analyse the file again
            functions = []
            for g in previous.functions:
                if g is f:
                    functions.append(Function(g.name, g.decl_start, g.body_start, body_end))
                elif g.decl_start > f.body_end - 1:
                    functions.append(Function(g.name, g.decl_start + delta, g.body_start + delta, g.body_end + delta))
                else:
                    functions.append(g)
            globals_ = []
            for g in previous.globals_:
                if g.start > f.body_end - 1:
                    globals_.append(g.replace(start=g.start + delta, end=g.end + delta))
                else:
                    globals_.append(g)
            # The prelude keeps a newline for each line of a body, so a body that gained or lost lines moves the
            # declarations after it. Their lines follow the source; the rest of the declarations are unchanged.
            delta_lines = body.count("\n") - previous_source[f.body_start:f.body_end].count("\n")
            decls = previous.decls
            if delta_lines:
                after = previous_source.count("\n", 0, f.body_end) + 1
                decls = [[c, n, t, line + delta_lines if line > after else line] for c, n, t, line in previous.decls]
            return previous.copy(source_sha=sha(source), functions=functions, globals_=globals_, decls=decls, mode="fast")
    return None


def analyse(source_path, source, clang_args, previous_text, previous_analysis, risky_functions=None):
    """Returns (Analysis, mode) or raises Unsplittable."""
    if previous_analysis is not None and previous_text is not None:
        fast = fast_analysis(previous_analysis, source, previous_text)
        if fast is not None:
            _, prelude = unit_split.render(source, fast.functions, fast.globals_)
            _, old_prelude = unit_split.render(previous_text, previous_analysis.functions, previous_analysis.globals_)
            # A body edit can only change the prelude's newlines, which follow the lines of the source.
            if prelude.replace("\n", "") == old_prelude.replace("\n", ""):
                fast.prelude_sha = sha(prelude)
                return fast, "fast"
    split = unit_split.split(source_path, clang_args, risky_functions)
    _, prelude = unit_split.render(source, split.functions, split.globals)
    analysis = Analysis(sha(source), split.functions, split.globals, sha(prelude), "slow", split.risky,
                        decls=split.decls, directives=split.directives)
    return analysis, "slow"


def plan(source_path, source, clang_args, previous_text=None, previous_analysis=None, risky_functions=None):
    analysis, mode = analyse(source_path, source, clang_args, previous_text, previous_analysis, risky_functions)
    result = _plan_from(source, analysis, source_path)
    result.analysis.mode = mode
    return result


def _entries(decls):
    """(category, name, key, text) for each declaration. Signatures and declarations compare without their line."""
    entries = []
    for category, name, text, line in decls:
        key = sha(text) if category in ("function-sig", "function-decl") else sha(f"{line}\n{text}")
        entries.append((category, name, key, text))
    return entries


def declaration_changes(previous, current):
    """(names, broad, code): what changed in the top-level declarations since `previous`.

    names are the declarations that changed; broad is True when the change could affect any unit (a macro, a type,
    a template or an operator, or no baseline to compare with); code is True when a variable or an inline or static
    function definition changed, which the globals unit compiles.
    """
    if not previous.decls:
        return set(), True, True
    old_entries, new_entries = _entries(previous.decls), _entries(current.decls)
    old = collections.Counter((c, n, k) for c, n, k, _ in old_entries)
    new = collections.Counter((c, n, k) for c, n, k, _ in new_entries)
    texts = {(c, n, k): t for c, n, k, t in old_entries + new_entries}
    names = set()
    broad = previous.directives != current.directives
    code = False
    for item in (old - new) + (new - old):
        category, name, _ = item
        if category not in PLAIN_CATEGORIES or not PLAIN_NAME.match(name) or re.search(r"\btemplate\b", texts[item]):
            broad = True
        if category in ("variable", "function-body"):
            code = True
        names.add(name)
    return names, broad, code


def _uses_by_name(decls):
    """name -> identifiers in every declaration of that name: what a use of the name can bring in."""
    uses = collections.defaultdict(set)
    for _category, name, text, _line in decls:
        if name:
            uses[name].update(IDENTIFIER.findall(text))
    return uses


def _reaching(names, uses):
    seen, frontier = set(names), list(names)
    while frontier:
        for used in uses.get(frontier.pop(), ()):
            if used not in seen:
                seen.add(used)
                frontier.append(used)
    return seen


def reusable_units(plan_, previous, flags):
    """{unit index: object} for units whose object from `previous` is still valid for the plan's declarations.

    `previous` is the analysis of the last build, so its declarations and objects belong together. `flags` must
    match the flags the objects were built with. A unit is valid while its definition is unchanged and no name it
    uses, directly or through the file's other declarations, has changed.
    """
    if previous is None or not previous.objects or previous.flags != flags or not previous.decls:
        return {}
    names, broad, _code = declaration_changes(previous, plan_.analysis)
    if broad:
        return {}
    uses = _uses_by_name(plan_.analysis.decls)
    reused = {}
    for index, key in enumerate(plan_.keys):
        obj = previous.objects.get(key)
        if obj is None or not os.path.exists(obj):
            continue
        if not (_reaching(plan_.uses[index] or set(), uses) & names):
            reused[index] = obj
    return reused


def flags_key(flags, include_dir, pch):
    """What an object depends on besides its text: the compiler flags, the include directory and the header."""
    return repr(["-iquote", str(include_dir), *flags]) + "|" + pch


def unit_key(text, flags_key):
    return sha(flags_key + "\n" + text)


def compile_units(plan_, objects_dir, compiler, flags, pch, include_dir, basename, reuse=None, workers=None):
    """Object paths in plan order. Units in `reuse` keep their object; the others compile unless already cached.

    Units are written beside the cache, so quoted includes are resolved through include_dir (the source's own
    directory) as well as the project's include paths.
    """
    objects_dir = pathlib.Path(objects_dir)
    objects_dir.mkdir(parents=True, exist_ok=True)
    # The whole-file build searches the source's own directory before the project's -iquote paths. Units live in
    # the cache, so put that directory first to keep quoted includes resolving the same way.
    key_of_flags = flags_key(flags, include_dir, pch)
    flags = ["-iquote", str(include_dir), *flags]
    reuse = reuse or {}
    jobs = []
    paths = []
    for index, (label, text) in enumerate(zip(plan_.labels, plan_.texts)):
        if index in reuse:
            paths.append(pathlib.Path(reuse[index]))
            continue
        key = unit_key(text, key_of_flags)
        obj = objects_dir / f"{key}.o"
        paths.append(obj)
        if not obj.exists():
            # Same basename as the source: the static-initializer symbol names use it.
            unit_dir = objects_dir / key
            unit_dir.mkdir(parents=True, exist_ok=True)
            source_file = unit_dir / basename
            source_file.write_text(text)
            jobs.append((label, source_file, obj))

    def run(job):
        label, source_file, obj = job
        tmp = obj.with_suffix(".o.partial")
        proc = subprocess.run([compiler, *flags, "-include-pch", pch, "-c", str(source_file), "-o", str(tmp)],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            raise Unsplittable(f"unit {label} did not compile: {proc.stderr[:400]}")
        os.replace(tmp, obj)

    if jobs:
        pending = list(jobs)
        failures = []
        lock = threading.Lock()

        def worker():
            while True:
                with lock:
                    if not pending or failures:
                        return
                    job = pending.pop()
                try:
                    run(job)
                except Exception as error:
                    with lock:
                        failures.append(error)
                    return

        count = max(1, min(len(jobs), workers or COMPILE_JOBS))
        threads = [threading.Thread(target=worker) for _ in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        if failures:
            raise failures[0]
    return paths


def combine(objects, output, linker="arm-none-eabi-ld"):
    """ld -r: one relocatable object standing in for the file, so make's link line is unchanged."""
    subprocess.run([linker, "-r", "-o", str(output), *map(str, objects)], check=True, capture_output=True)
