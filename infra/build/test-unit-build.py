"""Tests for per-function units. Run with python3 infra/build/test-unit-build.py.

Parsing uses libclang (set V5X_LIBCLANG to its path if it is not in the default location). Tests that compile
need clang and the ARM sysroot; they are skipped with a message when those are missing.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import unit_build  # noqa: E402
import unit_split  # noqa: E402
from unit_split import Unsplittable  # noqa: E402

try:
    unit_split._load()
    LIBCLANG_OK = True
except (OSError, AttributeError):
    LIBCLANG_OK = False

ARGS = ["-x", "c++", "-std=gnu++23"]
ARM = ["--target=arm-none-eabi", "-mcpu=cortex-a9", "-mfpu=neon-fp16", "-mfloat-abi=hard", "-mthumb", "-fshort-enums",
       "-nostdinc++", "-isystem", "/usr/lib/arm-none-eabi/include/c++/13.2.1",
       "-isystem", "/usr/lib/arm-none-eabi/include/c++/13.2.1/arm-none-eabi/thumb/v7-a+simd/hard",
       "-isystem", "/usr/lib/arm-none-eabi/include/c++/13.2.1/arm-none-eabi", "-isystem", "/usr/lib/arm-none-eabi/include"]
ARM_CLANG = shutil.which("clang++") is not None and os.path.isdir("/usr/lib/arm-none-eabi/include/c++/13.2.1")


def write(directory, name, text, newline="\n"):
    path = pathlib.Path(directory) / name
    with open(path, "w", encoding="utf-8", newline=newline) as handle:
        handle.write(text)
    return str(path)


@unittest.skipUnless(LIBCLANG_OK, "libclang is not available")
class Splitting(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="unit-tests-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def split(self, text, name="main.cpp", newline="\n"):
        path = write(self.tmp, name, text, newline)
        return unit_split.split(path, ARGS)

    def test_external_functions_split_and_globals_are_declared_extern(self):
        result = self.split("int counter = 0;\nvoid a() { counter++; }\nint b() { return counter; }\n")
        self.assertEqual([f.name for f in result.functions], ["a", "b"])
        self.assertEqual([g.name for g in result.globals], ["counter"])
        self.assertIn("extern int counter;", result.prelude)
        self.assertIn("int counter = 0;", result.globals_unit)
        self.assertNotIn("counter++", result.prelude)

    def test_crlf_files_split_at_the_right_offsets(self):
        text = "int x = 1;\r\nvoid a() {\r\n  x++;\r\n}\r\nint b() { return x; }\r\n"
        result = self.split(text, newline="\r\n")
        self.assertEqual([f.name for f in result.functions], ["a", "b"])
        unit = result.unit_text(result.functions[0], "main.cpp")
        self.assertIn("void a() {", unit)
        self.assertIn("x++;", unit)

    def test_line_numbers_match_the_whole_file(self):
        text = "#define MARK 1\nint pad;\nvoid a() {\n  int line = __LINE__;\n  (void)line;\n}\n"
        result = self.split(text)
        _, prelude = unit_split.render(text, result.functions, result.globals)
        analysis = unit_build.Analysis(unit_build.sha(text), result.functions, result.globals, unit_build.sha(prelude), "slow")
        plan = unit_build._plan_from(text, analysis, "src/main.cpp")
        self.assertIn('#line 3 "src/main.cpp"', plan.texts[1])

    def test_inline_and_template_code_stays_in_the_prelude(self):
        text = ("template <class T> T twice(T v) { return v + v; }\n"
                "inline int helper() { return 2; }\n"
                "int use() { return helper() + twice(1); }\n")
        result = self.split(text)
        self.assertEqual([f.name for f in result.functions], ["use"])
        self.assertIn("twice(T v) { return v + v; }", result.prelude)
        self.assertIn("inline int helper() { return 2; }", result.prelude)

    def test_static_functions_without_state_stay_in_the_prelude(self):
        result = self.split("static int square(int v) { return v * v; }\nint use() { return square(3); }\n")
        self.assertEqual([f.name for f in result.functions], ["use"])
        self.assertIn("static int square(int v) { return v * v; }", result.prelude)

    def test_static_function_with_a_static_local_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("static int next() { static int n = 0; return ++n; }\nint use() { return next(); }\n")

    def test_mutable_file_local_global_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("static int hidden = 0;\nint use() { return hidden; }\n")

    def test_constant_file_local_global_is_kept_in_every_unit(self):
        result = self.split("static const int limit = 4;\nint use() { return limit; }\n")
        self.assertEqual([f.name for f in result.functions], ["use"])
        self.assertIn("static const int limit = 4;", result.prelude)

    def test_macro_defined_after_a_split_function_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("int a() { return 1; }\n#define LATE 2\nint b() { return LATE; }\n")

    def test_conditional_spanning_a_split_function_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("#ifdef FLAG\nint a() { return 1; }\n#endif\n")

    def test_directive_inside_a_body_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("int a() {\n#define INSIDE 1\n  return INSIDE;\n}\n")

    def test_auto_return_type_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("auto make() { return 1; }\n")

    def test_out_of_line_constructor_is_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("struct A { A(); };\nA::A() {}\n")

    def test_functions_inside_a_namespace_are_refused(self):
        with self.assertRaises(Unsplittable):
            self.split("namespace n { int a() { return 1; } }\n")

    def test_out_of_line_member_function_is_split(self):
        result = self.split("struct A { int get(); };\nint A::get() { return 7; }\n")
        self.assertEqual([f.name for f in result.functions], ["get"])


@unittest.skipUnless(LIBCLANG_OK, "libclang is not available")
class Analysis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="unit-analysis-")
        self.base = "int x = 1;\nvoid a() {\n  x = 2;\n}\nint b() { return x; }\n"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def analysis(self, text):
        path = write(self.tmp, "main.cpp", text)
        return unit_split.split(path, ARGS)

    def test_body_edit_takes_the_fast_path_and_keeps_the_prelude(self):
        before = self.analysis(self.base)
        analysis = unit_build.Analysis(unit_build.sha(self.base), before.functions, before.globals, unit_build.sha(before.prelude), "slow")
        edited = self.base.replace("x = 2;", "x = 3; x += 1;")
        fast = unit_build.fast_analysis(analysis, edited, self.base)
        self.assertIsNotNone(fast)
        self.assertEqual(fast.mode, "fast")
        _, prelude = unit_split.render(edited, fast.functions, fast.globals_)
        self.assertEqual(unit_build.sha(prelude), analysis.prelude_sha)
        plan = unit_build._plan_from(edited, fast, "src/main.cpp")
        self.assertIn("x += 1;", plan.texts[1])
        self.assertNotIn("x += 1;", plan.texts[2])

    def test_edit_that_unbalances_braces_falls_back_to_a_fresh_analysis(self):
        before = self.analysis(self.base)
        analysis = unit_build.Analysis(unit_build.sha(self.base), before.functions, before.globals, unit_build.sha(before.prelude), "slow")
        self.assertIsNone(unit_build.fast_analysis(analysis, self.base.replace("x = 2;", "x = 2; }"), self.base))

    def test_edit_naming_a_risky_function_is_not_fast_pathed(self):
        before = self.analysis(self.base)
        analysis = unit_build.Analysis(unit_build.sha(self.base), before.functions, before.globals, unit_build.sha(before.prelude), "slow", ["lv_hidden"])
        self.assertIsNone(unit_build.fast_analysis(analysis, self.base.replace("x = 2;", "x = lv_hidden();"), self.base))

    def test_edit_outside_bodies_is_not_fast_pathed(self):
        before = self.analysis(self.base)
        analysis = unit_build.Analysis(unit_build.sha(self.base), before.functions, before.globals, unit_build.sha(before.prelude), "slow")
        self.assertIsNone(unit_build.fast_analysis(analysis, self.base.replace("int b()", "int c() {} int b()"), self.base))


class DeclarationReuse(unittest.TestCase):
    """Which units keep their object after an edit: decided from declarations, without libclang."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="unit-reuse-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def object_file(self, name):
        path = pathlib.Path(self.tmp) / f"{name}.o"
        path.write_text("object")
        return str(path)

    def build(self, decls, directives="", uses=None, objects=None, flags="flags"):
        """(plan of a file with functions a and b, previous analysis) for the given declarations."""
        current = unit_build.Analysis("s", [], [], "p", "slow", [], decls=decls, directives=directives, flags=flags)
        plan = unit_build.Plan(["object counter", "a", "b"], ["g", "a", "b"], current,
                               ["object-counter", "key-a", "key-b"], [{"counter"}, uses or {"helper"}, {"other"}])
        return plan

    def previous(self, decls, directives=""):
        objects = {"object-counter": self.object_file("counter"), "key-a": self.object_file("a"), "key-b": self.object_file("b")}
        return unit_build.Analysis("s", [], [], "p", "slow", [], decls=decls, directives=directives,
                                   objects=objects, flags="flags")

    BASE = [
        ["variable", "counter", "int counter = 0;", 1],
        ["function-sig", "a", "void a()", 2],
        ["function-sig", "b", "int b()", 3],
        ["function-decl", "helper", "int helper();", 4],
    ]

    def test_a_comment_only_change_reuses_every_unit(self):
        previous = self.previous(self.BASE)
        plan = self.build(self.BASE)
        self.assertEqual(sorted(unit_build.reusable_units(plan, previous, "flags")), [0, 1, 2])

    def test_a_new_global_recompiles_only_the_units_that_use_it(self):
        previous = self.previous(self.BASE)
        current = self.BASE + [["variable", "extra", "int extra;", 5]]
        plan = self.build(current, uses={"helper"})
        plan.uses[2] = {"extra"}
        reused = unit_build.reusable_units(plan, previous, "flags")
        self.assertEqual(sorted(reused), [0, 1])  # counter and a are unaffected; b uses extra

    def test_a_changed_signature_recompiles_its_callers_and_itself(self):
        previous = self.previous(self.BASE)
        current = [["variable", "counter", "int counter = 0;", 1], ["function-sig", "a", "void a(int)", 2],
                   ["function-sig", "b", "int b()", 3], ["function-decl", "helper", "int helper();", 4]]
        plan = self.build(current)
        plan.keys[1] = "key-a-with-int"  # a's definition changed with its signature, so its key does too
        reused = unit_build.reusable_units(plan, previous, "flags")
        self.assertNotIn(1, reused)  # a's signature changed, so it is compiled again
        self.assertIn(2, reused)

    def test_a_changed_helper_reaches_units_that_use_it_through_a_variable_or_inline_function(self):
        decls = self.BASE + [["function-body", "helper", "int helper() { return counter; }", 6]]
        previous = self.previous(decls)
        current = [dict_item if dict_item[1] != "counter" else ["variable", "counter", "long counter = 0;", 1]
                   for dict_item in decls]
        plan = self.build(current, uses={"helper"})
        reused = unit_build.reusable_units(plan, previous, "flags")
        self.assertNotIn(1, reused)  # a calls helper, which reads counter, whose type changed
        self.assertIn(2, reused)     # b uses neither

    def test_a_changed_inline_body_recompiles_only_its_users(self):
        decls = self.BASE + [["function-body", "helper", "inline int helper() { return 1; }", 6]]
        previous = self.previous(decls)
        current = [item if item[1] != "helper" else ["function-body", "helper", "inline int helper() { return 2; }", 6]
                   for item in decls]
        plan = self.build(current, uses={"helper"})
        reused = unit_build.reusable_units(plan, previous, "flags")
        self.assertNotIn(1, reused)
        self.assertIn(2, reused)

    def test_a_macro_change_disables_reuse(self):
        previous = self.previous(self.BASE)
        plan = self.build(self.BASE, directives="#define LIMIT 4")
        self.assertEqual(unit_build.reusable_units(plan, previous, "flags"), {})

    def test_a_type_template_or_operator_change_disables_reuse(self):
        previous = self.previous(self.BASE)
        for added in (
            ["other", "struct", "struct Point { int x; };", 5],
            ["function-body", "helper", "template <class T> int helper() { return 1; }", 6],
            ["function-sig", "operator+", "int operator+(int, int)", 7],
        ):
            with self.subTest(added=added):
                plan = self.build(self.BASE + [added])
                self.assertEqual(unit_build.reusable_units(plan, previous, "flags"), {})

    def test_different_flags_or_a_missing_object_disables_reuse(self):
        previous = self.previous(self.BASE)
        plan = self.build(self.BASE)
        self.assertEqual(unit_build.reusable_units(plan, previous, "other flags"), {})
        os.remove(previous.objects["key-a"])
        self.assertNotIn(1, unit_build.reusable_units(plan, previous, "flags"))

    def test_the_analysis_round_trips_its_objects_and_declarations(self):
        analysis = self.previous(self.BASE, directives="#define X")
        analysis.flags = "flags"
        restored = unit_build.Analysis.from_json(analysis.to_json())
        self.assertEqual(restored.decls, self.BASE)
        self.assertEqual(restored.objects, analysis.objects)
        self.assertEqual(restored.flags, "flags")
        self.assertEqual(restored.directives, "#define X")


@unittest.skipUnless(LIBCLANG_OK and ARM_CLANG, "clang with the ARM sysroot is not available")
class Compilation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="unit-compile-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_every_unit_compiles_and_the_union_defines_each_function_once(self):
        text = ("#include <cstdint>\nint counter = 0;\nint next() { return ++counter; }\n"
                "int twice() { return next() + next(); }\n")
        path = write(self.tmp, "main.cpp", text)
        result = unit_split.split(path, ARGS + ARM)
        plan = unit_build._plan_from(text, unit_build.Analysis(unit_build.sha(text), result.functions, result.globals,
                                                             unit_build.sha(unit_split.render(text, result.functions, result.globals)[1]), "slow"), path)
        for label, unit in zip(plan.labels, plan.texts):
            unit_path = pathlib.Path(self.tmp) / label / "main.cpp"
            unit_path.parent.mkdir(parents=True, exist_ok=True)
            unit_path.write_text(unit)
            proc = subprocess.run(["clang++", *ARM, "-Os", "-ffunction-sections", "-c", str(unit_path), "-o", str(unit_path.with_suffix(".o"))],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, f"{label}: {proc.stderr[:400]}")
        symbols = []
        for label in plan.labels:
            out = subprocess.run(["arm-none-eabi-nm", "--defined-only", "-C", str(pathlib.Path(self.tmp) / label / "main.o")],
                                 capture_output=True, text=True).stdout
            symbols.extend(line.split(None, 2)[2].split("(")[0] for line in out.splitlines() if line.split()[-2:-1] == ["T"] or line.split()[1:2] == ["T"])
        for name in ("next", "twice"):
            self.assertEqual(symbols.count(name), 1, name)


@unittest.skipUnless(sys.platform != "win32", "the fake compiler is a POSIX shell script")
class CompileCommand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="unit-command-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_source_directory_is_searched_before_project_include_paths(self):
        # A header in both src/ and include/ must resolve to src/, as it does in the whole-file build.
        log = pathlib.Path(self.tmp) / "argv.txt"
        compiler = pathlib.Path(self.tmp) / "fake-cxx"
        compiler.write_text(f'#!/bin/sh\nprintf \'%s\\n\' "$@" > "{log}"\n'
                            'while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then : > "$2"; fi; shift; done\n')
        compiler.chmod(0o755)
        analysis = unit_build.Analysis("source", [], [], "prelude", "slow")
        plan = unit_build.Plan(["globals"], ['#line 1 "src/main.cpp"\nint x;\n'], analysis)
        unit_build.compile_units(plan, pathlib.Path(self.tmp) / "objects", str(compiler), ["-iquote", "include"],
                                 "prefix.h.pch", include_dir="src", basename="main.cpp")
        args = log.read_text().splitlines()
        quoted = [args[i + 1] for i, arg in enumerate(args[:-1]) if arg == "-iquote"]
        self.assertEqual(quoted, ["src", "include"])


if __name__ == "__main__":
    unittest.main()
