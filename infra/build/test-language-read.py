"""Run with python3 infra/build/test-language-read.py."""
import os
import pathlib
import runpy
import tempfile
import types
import unittest

os.environ.setdefault('V5X_TEMPLATE', 'pros')
server = runpy.run_path(str(pathlib.Path(__file__).with_name('v5x-server')))


class DefinitionReads(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.directory.name) / 'session'
        self.root.mkdir()
        server['LANGUAGE']['test-session'] = types.SimpleNamespace(root=self.root, alive=lambda: True, seen=0)

    def tearDown(self):
        server['LANGUAGE'].clear()
        self.directory.cleanup()

    def read(self, path):
        return server['language_request']('/language/read', {'sessionId': 'test-session', 'uri': path.as_uri()})

    def test_reads_utf8_source(self):
        path = self.root / 'robot header.hpp'
        path.write_text('// robot\nvoid drive();\n')
        self.assertEqual(self.read(path)['contents'], path.read_text())

    def test_rejects_paths_and_symlinks_outside_session(self):
        outside = self.root.parent / 'private.hpp'
        outside.write_text('private')
        link = self.root / 'escape.hpp'
        link.symlink_to(outside)
        for path in [outside, link]:
            with self.assertRaises(ValueError):
                self.read(path)

    def test_rejects_binary_oversized_and_missing_files(self):
        path = self.root / 'invalid.hpp'
        for content in [b'\0binary', b'\xff', b'x' * (512 * 1024 + 1)]:
            path.write_bytes(content)
            with self.assertRaises(ValueError):
                self.read(path)
        path.unlink()
        with self.assertRaises(ValueError):
            self.read(path)

    def test_expired_sessions_do_not_read(self):
        server['LANGUAGE'].clear()
        self.assertEqual(self.read(self.root / 'missing.hpp'), {'closed': True})


if __name__ == '__main__':
    unittest.main()
