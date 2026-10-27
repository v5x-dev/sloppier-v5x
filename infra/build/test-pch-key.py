"""PCH cache-key contract for v5x-cxx. Run with python3 infra/build/test-pch-key.py."""
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

WRAPPER = pathlib.Path(__file__).with_name('v5x-cxx')
FAKE_COMPILER = '''#!/usr/bin/env python3
import os, pathlib, sys
with open(os.environ['V5X_FAKE_LOG'], 'a') as log: log.write(' '.join(sys.argv[1:]) + '\\n')
output = sys.argv[sys.argv.index('-o') + 1]
pathlib.Path(output).write_text('fake')
'''
LIBRARY_PCH = '#define PROS_USE_SIMPLE_NAMES\n#include "api.h"\n'
FLAGS = ['-mcpu=cortex-a9', '-mfloat-abi=hard', '-Os', '-g', '--std=gnu++23']


class PchKey(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.project = root / 'source'
        for relative in ('src/main.cpp', 'include/main.h', 'include/autons.hpp', 'include/api.h'):
            (self.project / relative).parent.mkdir(parents=True, exist_ok=True)
            (self.project / relative).write_text(f'// {relative}\n')
        (self.project / 'bin').mkdir()
        self.compiler = root / 'fake-c++'
        self.compiler.write_text(FAKE_COMPILER)
        self.compiler.chmod(0o755)
        self.log = root / 'compiles.log'
        self.cache = root / 'cache'

    def tearDown(self):
        self.tmp.cleanup()

    def compile(self, library=True):
        env = dict(os.environ, V5X_REAL_CXX=str(self.compiler), V5X_PCH_CACHE=str(self.cache),
                   V5X_PCH_HEADER=str(self.project / 'include/main.h'), V5X_FAKE_LOG=str(self.log))
        if library:
            env['V5X_PCH_SOURCE'] = LIBRARY_PCH
        else:
            env.pop('V5X_PCH_SOURCE', None)
        result = subprocess.run([sys.executable, str(WRAPPER), *FLAGS, '-c', 'src/main.cpp', '-o', 'bin/main.cpp.o'],
                                cwd=self.project, env=env, capture_output=True, text=True, check=True)
        return result.stdout

    def precompiles(self, output):
        return output.count('Precompiling')

    def test_library_pch_survives_project_header_edits(self):
        self.assertEqual(self.precompiles(self.compile()), 1)
        (self.project / 'include/autons.hpp').write_text('// edited\n')
        (self.project / 'src/main.cpp').write_text('// edited\n')
        self.assertEqual(self.precompiles(self.compile()), 0)
        self.assertEqual(len(list(self.cache.iterdir())), 1)

    def test_library_pch_is_keyed_by_flags(self):
        self.compile()
        env_flags = FLAGS + ['-Wno-psabi']
        subprocess.run([sys.executable, str(WRAPPER), *env_flags, '-c', 'src/main.cpp', '-o', 'bin/main.cpp.o'],
                       cwd=self.project, env=dict(os.environ, V5X_REAL_CXX=str(self.compiler), V5X_PCH_CACHE=str(self.cache),
                                                  V5X_PCH_HEADER=str(self.project / 'include/main.h'), V5X_FAKE_LOG=str(self.log),
                                                  V5X_PCH_SOURCE=LIBRARY_PCH), capture_output=True, text=True, check=True)
        self.assertEqual(len(list(self.cache.iterdir())), 2)

    def test_library_mode_compiles_without_debug_info(self):
        self.compile()
        compiles = self.log.read_text().splitlines()
        translation_unit = [line for line in compiles if '-include' in line][-1].split()
        self.assertIn('-g0', translation_unit)
        self.assertNotIn('-g', translation_unit)

    def test_full_header_mode_still_keys_on_project_headers(self):
        self.assertEqual(self.precompiles(self.compile(library=False)), 1)
        (self.project / 'include/autons.hpp').write_text('// edited\n')
        self.assertEqual(self.precompiles(self.compile(library=False)), 1)
        translation_unit = self.log.read_text().splitlines()[-1].split()
        self.assertIn('-g', translation_unit)


if __name__ == '__main__':
    unittest.main()
