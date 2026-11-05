#!/usr/bin/env python3
"""Splits a translation unit into a shared prelude plus one compilation unit per function.

Each external, non-inline, non-template function definition in the main file becomes its own unit, so an
edit inside a function body rebuilds only that function's object. The rest of the file (types, inline and
template code, declarations) is repeated in every unit as a prelude. Global objects are defined once, in the
globals unit, and are declared `extern` in the prelude.

The split is computed from libclang's AST, not from text matching. Anything the splitter cannot prove
equivalent raises Unsplittable with the reason; the caller then compiles the whole file as before.

Run as a library: split(path, clang_args) -> Split. Run as a script for inspection:
    python3 unit_split.py FILE [clang args...]
"""
import ctypes
import os
import re
import sys

LIBCLANG = os.environ.get("V5X_LIBCLANG", "/usr/lib/llvm-18/lib/libclang-18.so.1")


class Unsplittable(Exception):
    """The file uses something the splitter does not model; compile it whole."""


def directive_lines(text):
    """(offset, directive) for each preprocessor line; directive is the word after '#'."""
    found, offset = [], 0
    for line in text.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("#"):
            word = stripped[1:].lstrip().split(None, 1)[0] if stripped[1:].strip() else ""
            found.append((offset, word))
        offset += len(line) + 1
    return found


def check_directives(text, functions):
    """Macro and conditional state must match what the whole file sees at each function.

    Units repeat the file's text with bodies removed, so a conditional that spans a split function, a directive
    inside its body, or a macro change after the first split function would make a unit differ from the file.
    """
    if not functions:
        return
    first = min(f.decl_start for f in functions)
    depth_at = {}
    depth = 0
    events = directive_lines(text)
    for offset, word in events:
        if word in ("if", "ifdef", "ifndef"):
            depth += 1
        elif word == "endif":
            depth -= 1
        if offset > first and word in ("define", "undef", "include", "pragma"):
            raise Unsplittable(f"#{word} after the first split function changes the macros of later units")
    for function in functions:
        depth_here = 0
        for offset, word in events:
            if offset >= function.decl_start:
                break
            if word in ("if", "ifdef", "ifndef"):
                depth_here += 1
            elif word == "endif":
                depth_here -= 1
        if depth_here != 0:
            raise Unsplittable(f"{function.name} sits inside a preprocessor conditional")
        for offset, word in events:
            if function.body_start <= offset < function.body_end:
                raise Unsplittable(f"#{word} inside the body of {function.name}")


# Cursor kinds from clang-c/Index.h.
K_STRUCT, K_UNION, K_CLASS, K_ENUM = 2, 3, 4, 5
K_FUNCTION, K_VAR, K_TYPEDEF = 8, 9, 20
K_CXX_METHOD, K_NAMESPACE, K_LINKAGE_SPEC, K_CONSTRUCTOR, K_DESTRUCTOR = 21, 22, 23, 24, 25
K_CONVERSION, K_FUNCTION_TEMPLATE, K_CLASS_TEMPLATE, K_TYPE_ALIAS = 26, 30, 31, 36
K_COMPOUND = 202
K_CALL_EXPR, K_DECL_REF_EXPR = 103, 101
CALL_EXPR, DECL_REF_EXPR = K_CALL_EXPR, K_DECL_REF_EXPR
FUNCTION_KINDS = (K_FUNCTION, K_CXX_METHOD, K_CONSTRUCTOR, K_DESTRUCTOR, K_CONVERSION)
CONTAINER_KINDS = (K_STRUCT, K_UNION, K_CLASS, K_NAMESPACE, K_LINKAGE_SPEC, K_CLASS_TEMPLATE)
LINKAGE_EXTERNAL = 4
LINKAGE_INTERNAL = 2
SC_STATIC = 3
SC_EXTERN = 2
CHILD_CONTINUE, CHILD_RECURSE, CHILD_BREAK = 1, 2, 0


class CXString(ctypes.Structure):
    _fields_ = [("data", ctypes.c_void_p), ("flags", ctypes.c_uint)]


class CXCursor(ctypes.Structure):
    _fields_ = [("kind", ctypes.c_int), ("xdata", ctypes.c_int), ("data", ctypes.c_void_p * 3)]


class CXSourceLocation(ctypes.Structure):
    _fields_ = [("ptr_data", ctypes.c_void_p * 2), ("int_data", ctypes.c_uint)]


class CXSourceRange(ctypes.Structure):
    _fields_ = [("ptr_data", ctypes.c_void_p * 2), ("begin_int_data", ctypes.c_uint), ("end_int_data", ctypes.c_uint)]


class CXType(ctypes.Structure):
    _fields_ = [("kind", ctypes.c_int), ("data", ctypes.c_void_p * 2)]


class CXUnsavedFile(ctypes.Structure):
    _fields_ = [("filename", ctypes.c_char_p), ("contents", ctypes.c_char_p), ("length", ctypes.c_ulong)]


VISITOR = ctypes.CFUNCTYPE(ctypes.c_int, CXCursor, CXCursor, ctypes.c_void_p)

_lib = None


def _load():
    global _lib
    if _lib is not None:
        return _lib
    lib = ctypes.CDLL(LIBCLANG)
    P = ctypes.c_void_p
    sigs = {
        "clang_createIndex": (P, [ctypes.c_int, ctypes.c_int]),
        "clang_parseTranslationUnit": (P, [P, ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p), ctypes.c_int,
                                           ctypes.POINTER(CXUnsavedFile), ctypes.c_uint, ctypes.c_uint]),
        "clang_getTranslationUnitCursor": (CXCursor, [P]),
        "clang_getNumDiagnostics": (ctypes.c_uint, [P]),
        "clang_getDiagnostic": (P, [P, ctypes.c_uint]),
        "clang_getDiagnosticSeverity": (ctypes.c_int, [P]),
        "clang_disposeDiagnostic": (None, [P]),
        "clang_disposeTranslationUnit": (None, [P]),
        "clang_disposeIndex": (None, [P]),
        "clang_getCursorKind": (ctypes.c_int, [CXCursor]),
        "clang_getCursorExtent": (CXSourceRange, [CXCursor]),
        "clang_getRangeStart": (CXSourceLocation, [CXSourceRange]),
        "clang_getRangeEnd": (CXSourceLocation, [CXSourceRange]),
        "clang_getSpellingLocation": (None, [CXSourceLocation, ctypes.POINTER(P), ctypes.POINTER(ctypes.c_uint),
                                             ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]),
        "clang_Location_isFromMainFile": (ctypes.c_uint, [CXSourceLocation]),
        "clang_getCursorSpelling": (CXString, [CXCursor]),
        "clang_getCString": (ctypes.c_char_p, [CXString]),
        "clang_disposeString": (None, [CXString]),
        "clang_getCursorType": (CXType, [CXCursor]),
        "clang_getTypeSpelling": (CXString, [CXType]),
        "clang_isCursorDefinition": (ctypes.c_uint, [CXCursor]),
        "clang_getCursorLinkage": (ctypes.c_int, [CXCursor]),
        "clang_Cursor_getStorageClass": (ctypes.c_int, [CXCursor]),
        "clang_Cursor_isFunctionInlined": (ctypes.c_uint, [CXCursor]),
        "clang_getCursorSemanticParent": (CXCursor, [CXCursor]),
        "clang_visitChildren": (ctypes.c_uint, [CXCursor, VISITOR, ctypes.c_void_p]),
        "clang_Cursor_isNull": (ctypes.c_int, [CXCursor]),
        "clang_getCursorUSR": (CXString, [CXCursor]),
        "clang_getCursorReferenced": (CXCursor, [CXCursor]),
        "clang_getCursorResultType": (CXType, [CXCursor]),
        "clang_isConstQualifiedType": (ctypes.c_uint, [CXType]),
        "clang_Cursor_Evaluate": (P, [CXCursor]),
        "clang_EvalResult_getKind": (ctypes.c_int, [P]),
        "clang_EvalResult_dispose": (None, [P]),
    }
    for name, (restype, argtypes) in sigs.items():
        fn = getattr(lib, name)
        fn.restype = restype
        fn.argtypes = argtypes
    _lib = lib
    return lib


def _text(lib, cxstring):
    value = lib.clang_getCString(cxstring)
    result = value.decode("utf-8", "replace") if value else ""
    lib.clang_disposeString(cxstring)
    return result


def _offsets(lib, rng):
    """Byte offsets of a source range in the main file, or None if it lies elsewhere."""
    start = lib.clang_getRangeStart(rng)
    end = lib.clang_getRangeEnd(rng)
    if not lib.clang_Location_isFromMainFile(start):
        return None
    file_ptr = ctypes.c_void_p()
    line, col, s_off, e_off = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    lib.clang_getSpellingLocation(start, ctypes.byref(file_ptr), ctypes.byref(line), ctypes.byref(col), ctypes.byref(s_off))
    lib.clang_getSpellingLocation(end, ctypes.byref(file_ptr), ctypes.byref(line), ctypes.byref(col), ctypes.byref(e_off))
    return s_off.value, e_off.value


class Function:
    """One external function definition: where its declaration starts and where its body is."""

    def __init__(self, name, decl_start, body_start, body_end):
        self.name = name
        self.decl_start = decl_start  # start of the declaration in the original text
        self.body_start = body_start  # the opening brace
        self.body_end = body_end      # one past the closing brace

    def replace(self, **changes):
        return Function(**{**vars(self), **changes})

    def __eq__(self, other):
        return isinstance(other, Function) and vars(self) == vars(other)

    def __repr__(self):
        return f"Function({self.name!r}, {self.decl_start}, {self.body_start}, {self.body_end})"


class Global:
    """A file-scope object: defined once in the globals unit and declared extern everywhere else."""

    def __init__(self, name, type_text, start, end, strip_in_prelude):
        self.name = name
        self.type_text = type_text
        self.start = start
        self.end = end
        # Static data member definitions: the class already declares them, so units omit them.
        self.strip_in_prelude = strip_in_prelude

    def replace(self, **changes):
        return Global(**{**vars(self), **changes})

    def __eq__(self, other):
        return isinstance(other, Global) and vars(self) == vars(other)


class Split:
    """The result of splitting one file."""

    def __init__(self, source, functions, globals, globals_unit, prelude, risky=None, decls=None, directives=""):
        self.source = source
        self.functions = functions
        self.globals = globals
        self.globals_unit = globals_unit  # the source with split function bodies stripped
        self.prelude = prelude            # the source with bodies stripped, globals declared extern, member definitions removed
        self.risky = risky or []          # names of file-local functions with static locals
        # [category, name, text, line] for each top-level declaration of the main file, in source order. unit_build
        # compares these between builds to find the units an edit can affect.
        self.decls = decls or []
        self.directives = directives      # the prelude's preprocessor lines

    def unit_text(self, function, path):
        """A unit defines one function; its prelude already declares everything it uses.

        #line directives restore the file name and the line numbers the function has in the whole file.
        """
        line = self.source.count("\n", 0, function.decl_start) + 1
        definition = self.source[function.decl_start:function.body_end]
        return f'#line 1 "{path}"\n' + self.prelude + f'\n#line {line} "{path}"\n' + definition + "\n"


def _constant_value(lib, cursor):
    result = lib.clang_Cursor_Evaluate(cursor)
    if not result:
        return False
    kind = lib.clang_EvalResult_getKind(result)
    lib.clang_EvalResult_dispose(result)
    return kind != 0


def _has_static_local(lib, cursor):
    found = [False]

    def visit(child, parent, data):
        if lib.clang_getCursorKind(child) == K_VAR and lib.clang_Cursor_getStorageClass(child) == SC_STATIC:
            found[0] = True
            return CHILD_BREAK
        return CHILD_RECURSE

    lib.clang_visitChildren(cursor, VISITOR(visit), None)
    return found[0]


def _body_of(lib, cursor):
    body = []

    def visit(child, parent, data):
        if lib.clang_getCursorKind(child) == K_COMPOUND:
            body.append(child)
            return CHILD_BREAK
        return CHILD_CONTINUE

    lib.clang_visitChildren(cursor, VISITOR(visit), None)
    return body[0] if body else None


def _contains_split_candidate(lib, cursor):
    """True if a container holds an external, non-inline function definition (we do not split those)."""
    hit = [False]

    def visit(child, parent, data):
        kind = lib.clang_getCursorKind(child)
        if kind in FUNCTION_KINDS and lib.clang_isCursorDefinition(child):
            if not lib.clang_Cursor_isFunctionInlined(child) and lib.clang_getCursorLinkage(child) == LINKAGE_EXTERNAL:
                hit[0] = True
                return CHILD_BREAK
        if kind in CONTAINER_KINDS:
            return CHILD_RECURSE
        return CHILD_CONTINUE

    lib.clang_visitChildren(cursor, VISITOR(visit), None)
    return hit[0]


def header_check(path, clang_args):
    """Returns {usr: name} for file-local functions with static locals in the headers. Raises for mutable header state."""
    """Internal-linkage state declared in the included headers, which every unit would copy.

    A const object (or one whose value never changes) is copied harmlessly, and the whole-file build already keeps
    one copy per translation unit. Mutable internal state would not be shared between functions in different units,
    so the file is not split if any header declares it. Raises Unsplittable.
    """
    lib = _load()
    index = lib.clang_createIndex(0, 0)
    argv = (ctypes.c_char_p * len(clang_args))(*[a.encode() for a in clang_args])
    tu = lib.clang_parseTranslationUnit(index, path.encode(), argv, len(clang_args), None, 0, 0)
    errors = []
    try:
        if not tu:
            raise Unsplittable("libclang could not parse the headers")

        risky = {}

        def visit(child, parent, data):
            try:
                kind = lib.clang_getCursorKind(child)
                if kind == K_VAR and lib.clang_getCursorLinkage(child) == LINKAGE_INTERNAL:
                    if not lib.clang_isConstQualifiedType(lib.clang_getCursorType(child)):
                        raise Unsplittable(f"header variable {_text(lib, lib.clang_getCursorSpelling(child))} is mutable and file-local")
                if kind in FUNCTION_KINDS and lib.clang_isCursorDefinition(child):
                    if lib.clang_getCursorLinkage(child) == LINKAGE_INTERNAL and _has_static_local(lib, child):
                        risky[_text(lib, lib.clang_getCursorUSR(child))] = _text(lib, lib.clang_getCursorSpelling(child))
                    return CHILD_CONTINUE
                if kind in (K_NAMESPACE, K_LINKAGE_SPEC, K_CLASS, K_STRUCT, K_CLASS_TEMPLATE, K_UNION):
                    return CHILD_RECURSE
                return CHILD_CONTINUE
            except Unsplittable as error:
                errors.append(error)
                return CHILD_BREAK

        lib.clang_visitChildren(lib.clang_getTranslationUnitCursor(tu), VISITOR(visit), None)
        if errors:
            raise errors[0]
        return risky
    finally:
        lib.clang_disposeTranslationUnit(tu)
        lib.clang_disposeIndex(index)


def split(path, clang_args, risky_functions=None):
    lib = _load()
    with open(path, "rb") as handle:
        raw = handle.read()
    source = raw.decode("utf-8")
    # libclang reports byte offsets; the text is indexed by character.
    def to_char(byte_offset):
        return len(raw[:byte_offset].decode("utf-8", "replace"))
    index = lib.clang_createIndex(0, 0)
    argv = (ctypes.c_char_p * len(clang_args))(*[a.encode() for a in clang_args])
    tu = lib.clang_parseTranslationUnit(index, path.encode(), argv, len(clang_args), None, 0, 0)
    try:
        if not tu:
            raise Unsplittable("libclang could not parse the file")
        for i in range(lib.clang_getNumDiagnostics(tu)):
            diagnostic = lib.clang_getDiagnostic(tu, i)
            severity = lib.clang_getDiagnosticSeverity(diagnostic)
            lib.clang_disposeDiagnostic(diagnostic)
            if severity >= 3:  # error or fatal
                raise Unsplittable("the file has compiler errors")
        functions, globals_, edits_units, edits_prelude = [], [], [], []
        decl_log = []  # (category, name, start, end) for every top-level cursor of the main file

        def top(child, parent, data):
            kind = lib.clang_getCursorKind(child)
            rng = lib.clang_getCursorExtent(child)
            offsets = _offsets(lib, rng)
            if offsets is None:
                return CHILD_CONTINUE  # declared in a header; the prelude already has it
            start, end = to_char(offsets[0]), to_char(offsets[1])
            name = _text(lib, lib.clang_getCursorSpelling(child))
            if kind in FUNCTION_KINDS:
                category = "function-def" if lib.clang_isCursorDefinition(child) else "function-decl"
            elif kind == K_VAR:
                category = "variable"
            else:
                category = "other"
            decl_log.append((category, name, start, end))
            if kind in FUNCTION_KINDS and lib.clang_isCursorDefinition(child):
                inline = bool(lib.clang_Cursor_isFunctionInlined(child))
                linkage = lib.clang_getCursorLinkage(child)
                if linkage == LINKAGE_INTERNAL:
                    if _has_static_local(lib, child):
                        raise Unsplittable(f"static function {name} has a static local")
                    return CHILD_CONTINUE
                if inline:
                    return CHILD_CONTINUE
                if kind in (K_CONSTRUCTOR, K_DESTRUCTOR, K_CONVERSION):
                    raise Unsplittable(f"out-of-line {name} is not split")
                signature = source[start:start + 400].split("{", 1)[0]
                if re.search(r"\b(auto|decltype\s*\(\s*auto\s*\))\b", signature):
                    raise Unsplittable(f"{name} has a deduced return type")
                body = _body_of(lib, child)
                if body is None:
                    raise Unsplittable(f"{name} has no body")
                body_offsets = _offsets(lib, lib.clang_getCursorExtent(body))
                if body_offsets is None:
                    raise Unsplittable(f"{name} body is outside the file")
                body_offsets = (to_char(body_offsets[0]), to_char(body_offsets[1]))
                if source[start:body_offsets[0]].count("[[") or "__attribute__" in source[start:body_offsets[0]]:
                    raise Unsplittable(f"{name} has attributes the split would move")
                functions.append(Function(name, start, body_offsets[0], body_offsets[1]))
                return CHILD_CONTINUE
            if kind == K_VAR and lib.clang_isCursorDefinition(child):
                sc = lib.clang_Cursor_getStorageClass(child)
                if sc == SC_STATIC or lib.clang_getCursorLinkage(child) == LINKAGE_INTERNAL:
                    # A const object with a constant value is copied into each unit with no visible difference.
                    if lib.clang_isConstQualifiedType(lib.clang_getCursorType(child)) and _constant_value(lib, child):
                        return CHILD_CONTINUE
                    raise Unsplittable(f"static variable {name} would not be shared between units")
                parent_kind = lib.clang_getCursorKind(lib.clang_getCursorSemanticParent(child))
                if parent_kind in (K_STRUCT, K_CLASS, K_UNION):
                    # A static data member definition: the class already declares it; only the globals unit defines it.
                    globals_.append(Global(name, "", start, end, True))
                    return CHILD_CONTINUE
                if lib.clang_getCursorLinkage(child) != LINKAGE_EXTERNAL:
                    # A const object with a constant value is copied into each unit with no visible difference.
                    if lib.clang_isConstQualifiedType(lib.clang_getCursorType(child)) and _constant_value(lib, child):
                        return CHILD_CONTINUE
                    raise Unsplittable(f"global {name} has internal linkage")
                type_text = _text(lib, lib.clang_getTypeSpelling(lib.clang_getCursorType(child)))
                if "[" in type_text or "(" in type_text:
                    raise Unsplittable(f"global {name} has a type that cannot be redeclared as extern: {type_text}")
                globals_.append(Global(name, type_text, start, end, False))
                return CHILD_CONTINUE
            if kind in (K_NAMESPACE, K_LINKAGE_SPEC, K_CLASS_TEMPLATE) and _contains_split_candidate(lib, child):
                raise Unsplittable(f"external functions inside {name or 'a namespace or linkage block'} are not split")
            return CHILD_CONTINUE

        errors = []
        risky = dict(risky_functions or {})  # USR -> name: file-local functions with static locals (see header_check)

        def top_guarded(child, parent, data):
            try:
                return top(child, parent, data)
            except Unsplittable as error:
                errors.append(error)
                return CHILD_BREAK

        lib.clang_visitChildren(lib.clang_getTranslationUnitCursor(tu), VISITOR(top_guarded), None)
        if errors:
            raise errors[0]
        if risky:
            _refuse_references(lib, tu, risky, path)
        split_starts = {f.decl_start: f for f in functions}
        decls = []
        for category, name, start, end in decl_log:
            line = source.count("\n", 0, start) + 1
            if category == "function-def" and start in split_starts:
                # A split function's definition is compiled in its own unit; the file only needs its signature.
                decls.append(["function-sig", name, source[start:split_starts[start].body_start], line])
            else:
                decls.append([category, name, source[start:end], line])
    finally:
        lib.clang_disposeTranslationUnit(tu)
        lib.clang_disposeIndex(index)
    risky_names = sorted(set(risky.values()))

    if not functions:
        raise Unsplittable("no external function definitions to split")
    check_directives(source, functions)
    _refuse_risky_bodies(source, functions, risky_names)
    # Edits are byte ranges in the original source. Function bodies are removed from every variant; globals
    # are removed from the prelude (replaced by extern declarations) and kept in the globals unit.
    globals_unit, prelude = render(source, functions, globals_)
    split_ = Split(source, functions, globals_, globals_unit, prelude)
    split_.risky = risky_names
    split_.decls = decls
    split_.directives = "\n".join(line for line in prelude.split("\n") if line.lstrip().startswith("#"))
    return split_


def render(source, functions, globals_):
    """(globals_unit, prelude) for a source and its split positions. Shared by the analysis and the fast path.

    Every replacement keeps the newlines of the text it replaces, so each line of the output has the same number
    as in the source. Together with #line directives (see unit_build) this keeps __LINE__ and __FILE__ identical
    to the whole-file build.
    """
    body_edits = [(f.body_start, f.body_end, ";") for f in functions]
    prelude_edits = list(body_edits)
    for g in globals_:
        if g.strip_in_prelude:
            prelude_edits.append((g.start, g.end, ""))
        else:
            prelude_edits.append((g.start, g.end, f"extern {g.type_text} {g.name};"))
    return _apply(source, body_edits), _apply(source, prelude_edits)


def _refuse_references(lib, tu, risky, path):
    """Raises if the main file calls a file-local function that has a static local."""
    hits = []

    def visit(child, parent, data):
        kind = lib.clang_getCursorKind(child)
        if kind in (CALL_EXPR, DECL_REF_EXPR):
            target = lib.clang_getCursorReferenced(child)
            if not lib.clang_Cursor_isNull(target) and _text(lib, lib.clang_getCursorUSR(target)) in risky:
                hits.append(_text(lib, lib.clang_getCursorSpelling(target)))
                return CHILD_BREAK
        return CHILD_RECURSE

    def top(child, parent, data):
        rng = lib.clang_getCursorExtent(child)
        if _offsets(lib, rng) is None:
            return CHILD_CONTINUE
        lib.clang_visitChildren(child, VISITOR(visit), None)
        return CHILD_CONTINUE

    lib.clang_visitChildren(lib.clang_getTranslationUnitCursor(tu), VISITOR(top), None)
    if hits:
        raise Unsplittable(f"the file calls {hits[0]}, a file-local function with a static local")


def _refuse_risky_bodies(source, functions, risky_names):
    """Text check for edits: a body that names a risky function must be analysed again."""
    import re as _re
    for f in functions:
        body = source[f.body_start:f.body_end]
        for name in risky_names:
            if _re.search(r"\b" + _re.escape(name) + r"\b", body):
                raise Unsplittable(f"{f.name} calls {name}, a file-local function with a static local")


def _apply(text, edits):
    out, last = [], 0
    for start, end, replacement in sorted(edits):
        if start < last:
            raise Unsplittable("overlapping edits")
        out.append(text[last:start])
        out.append(replacement)
        out.append("\n" * text.count("\n", start, end))  # keep the line count
        last = end
    out.append(text[last:])
    return "".join(out)


if __name__ == "__main__":
    result = split(sys.argv[1], sys.argv[2:])
    print(f"{len(result.functions)} functions, {len(result.globals)} globals")
    for function in result.functions:
        print(" unit", function.name, function.decl_start, function.body_end)
