"""Build-only HTTP contract. Run with python3 infra/build/test-build-server.py."""
import base64
import hashlib
import json
import io
import os
import pathlib
import runpy
import threading
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer

os.environ.setdefault('V5X_TEMPLATE', 'pros')
server = runpy.run_path(str(pathlib.Path(__file__).with_name('v5x-server')))
# runpy returns a copy of the globals; handlers and build state read the live module dict.
LIVE = server['Handler'].do_POST.__globals__


class BuildOnlyServer(unittest.TestCase):
    def setUp(self):
        server['UPLOADS'].clear()
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), server['Handler'])
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def request(self, path, data=None):
        body = json.dumps(data).encode() if data is not None else None
        return urllib.request.urlopen(urllib.request.Request(self.base + path, data=body))

    def test_build_health_and_source_upload_still_work(self):
        with self.request('/health') as response:
            self.assertIn('building', json.load(response))
        with self.request('/upload', {'id': 'browser-build', 'offset': 0, 'data': base64.b64encode(b'source archive').decode()}) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(bytes(server['UPLOADS']['browser-build']['data']), b'source archive')


class IncrementalSnapshots(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.target = pathlib.Path(self.tmp.name) / 'source'
        self.extract = server['extract']
        self.extract.__globals__['SOURCE_MANIFEST'] = None
        self.files = {'src/main.cpp': b'int main() {}', 'include/main.h': b'#pragma once', 'Makefile': b'all:'}

    def tearDown(self):
        self.tmp.cleanup()

    def extract_files(self, files):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for name, data in files.items(): archive.writestr(name, data)
        self.extract(stream.getvalue(), self.target)

    def output(self):
        path = self.target / 'bin' / 'main.o'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'object')
        return path

    def test_translation_unit_edit_preserves_output(self):
        self.extract_files(self.files)
        output = self.output()
        self.extract_files({**self.files, 'src/main.cpp': b'int main() { return 1; }'})
        self.assertTrue(output.exists())

    def test_headers_rules_and_file_set_changes_invalidate_output(self):
        for changed in ({**self.files, 'include/main.h': b'changed'},
                        {**self.files, 'Makefile': b'changed'},
                        {**self.files, 'src/new.cpp': b'new'},
                        {k: v for k, v in self.files.items() if k != 'src/main.cpp'}):
            with self.subTest(changed=changed):
                self.extract_files(self.files)
                output = self.output()
                self.extract_files(changed)
                self.assertFalse(output.exists())

    def test_source_owned_output_path_never_reuses_outputs(self):
        files = {**self.files, 'build/config': b'source'}
        self.extract_files(files)
        output = self.output()
        self.extract_files(files)
        self.assertFalse(output.exists())


class SourceIdentity(unittest.TestCase):
    # The browser computes the same value (see build-source-hash.ts); keep this vector in sync.
    VECTOR = {'src/main.cpp': b'int main() {}', 'Makefile': b'all:', 'include/main.h': b'#pragma once'}
    EXPECTED = 'a6c1c674b9a1fae9dcf6350a9c6f456d673f01c793c106946f0f8e623ee369b5'

    def manifest(self, files):
        import hashlib
        return {name: hashlib.sha256(data).digest() for name, data in files.items()}

    def test_hash_matches_the_browser_vector_in_any_order(self):
        self.assertEqual(server['source_hash'](self.manifest(self.VECTOR)), self.EXPECTED)
        self.assertEqual(server['source_hash'](self.manifest(dict(reversed(list(self.VECTOR.items()))))), self.EXPECTED)

    def test_hash_changes_with_contents_or_paths(self):
        changed = dict(self.VECTOR, **{'src/main.cpp': b'int main() { return 1; }'})
        renamed = {('src/other.cpp' if name == 'src/main.cpp' else name): data for name, data in self.VECTOR.items()}
        self.assertNotEqual(server['source_hash'](self.manifest(changed)), self.EXPECTED)
        self.assertNotEqual(server['source_hash'](self.manifest(renamed)), self.EXPECTED)


class ArtifactStore(unittest.TestCase):
    def setUp(self):
        self.store = server['store_artifact'].__globals__
        self.store['ARTIFACTS'].clear()
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), server['Handler'])
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.store['ARTIFACTS'].clear()

    def fetch(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            error.close()
            return error.code, b''

    def test_artifacts_are_addressable_by_id_and_evicted_oldest_first(self):
        ids = [server['store_artifact'](f'zip-{index}'.encode()) for index in range(server['ARTIFACT_LIMIT'] + 1)]
        self.assertEqual(self.fetch(f'/artifact?id={ids[-1]}'), (200, b'zip-4'))
        self.assertEqual(self.fetch(f'/artifact?id={ids[0]}')[0], 404)
        self.assertEqual(self.fetch('/artifact?id=missing')[0], 404)

    def test_entries_are_served_raw_by_name_and_digested_in_status(self):
        artifact = server['store_artifact'](b'zip', {'bin/cold.package.bin': b'cold', 'bin/hot.package.bin': b'hot'})
        self.assertEqual(self.fetch(f'/artifact?id={artifact}&entry=bin/hot.package.bin'), (200, b'hot'))
        self.assertEqual(self.fetch(f'/artifact?id={artifact}&entry=bin/missing.bin')[0], 404)
        self.assertEqual(self.fetch(f'/artifact?id={artifact}'), (200, b'zip'))
        state = self.store['STATE']
        saved = state['artifactId']
        try:
            state['artifactId'] = artifact
            status, body = self.fetch('/status')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['artifactEntries'], {
                'bin/cold.package.bin': {'sha256': hashlib.sha256(b'cold').hexdigest(), 'bytes': 4},
                'bin/hot.package.bin': {'sha256': hashlib.sha256(b'hot').hexdigest(), 'bytes': 3},
            })
        finally:
            state['artifactId'] = saved

    def test_status_long_poll_returns_on_change_or_after_its_wait(self):
        publish, lock = self.store['publish'], self.store['LOCK']
        version = json.loads(self.fetch('/status')[1])['version']

        def change():
            with lock:
                publish()
        timer = threading.Timer(0.2, change)
        timer.start()
        started = time.time()
        status, body = self.fetch(f'/status?since={version}&wait=5000')
        timer.join()
        self.assertEqual(status, 200)
        self.assertGreater(json.loads(body)['version'], version)
        self.assertLess(time.time() - started, 3)
        # Nothing changes: the poll ends at its wait, with the same version.
        version = json.loads(body)['version']
        started = time.time()
        status, body = self.fetch(f'/status?since={version}&wait=300')
        self.assertEqual(json.loads(body)['version'], version)
        self.assertGreaterEqual(time.time() - started, 0.25)
        # A malformed version is not a long poll.
        self.assertEqual(self.fetch('/status?since=abc&wait=5000')[0], 200)

    def test_written_archive_is_standard_and_deterministic(self):
        members = [('bin/cold.package.bin', b'c' * 50000), ('bin/hot.package.bin', b'hot program')]
        first = server['write_zip'](members)
        second = server['write_zip'](members)
        self.assertEqual(first, second)
        archive = zipfile.ZipFile(io.BytesIO(first))
        self.assertEqual(archive.testzip(), None)
        self.assertEqual(archive.read('bin/cold.package.bin'), b'c' * 50000)
        self.assertEqual(archive.read('bin/hot.package.bin'), b'hot program')
        artifact = server['store_artifact'](first)
        status, body = self.fetch(f'/artifact?id={artifact}')
        self.assertEqual(status, 200)
        self.assertEqual(body, first)


class CancelledBuildOutputs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.source = pathlib.Path(self.tmp.name) / 'source'
        self.globals = server['remove_outputs_since'].__globals__
        self.previous_source = self.globals['SOURCE']
        self.globals['SOURCE'] = self.source

    def tearDown(self):
        self.globals['SOURCE'] = self.previous_source
        self.tmp.cleanup()

    def test_only_outputs_written_by_the_cancelled_build_are_removed(self):
        (self.source / 'bin').mkdir(parents=True)
        old = self.source / 'bin' / 'cold.package.elf'
        old.write_bytes(b'cold')
        old_time = time.time() - 60
        os.utime(old, (old_time, old_time))
        started = time.time()
        partial = self.source / 'bin' / 'hot.package.elf'
        partial.write_bytes(b'partial')
        server['remove_outputs_since'](started)
        self.assertFalse(partial.exists())
        self.assertTrue(old.exists())


class SupersedingBuilds(unittest.TestCase):
    def setUp(self):
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), server['Handler'])
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'
        self.state = server['STATE']
        self.saved = dict(self.state)
        self.saved_current = LIVE['CURRENT']

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.state.update(self.saved)
        LIVE['CURRENT'] = self.saved_current

    def post(self, path, data):
        request = urllib.request.Request(self.base + path, data=json.dumps(data).encode())
        try:
            with urllib.request.urlopen(request) as response:
                return response.status
        except urllib.error.HTTPError as error:
            error.close()
            return error.code

    def test_a_running_normal_build_is_never_replaced_and_refusals_free_their_upload(self):
        threads = threading
        server['UPLOADS'].clear()
        self.state.update(building=True)
        LIVE['CURRENT'] = {'speculative': False, 'done': threads.Event()}
        for name in ('speculative-source', 'normal-source'):
            server['UPLOADS'][name] = {'data': bytearray(b'x'), 'expires': time.time() + 60}
        self.assertEqual(self.post('/build', {'id': 'speculative-source', 'commit': 'abc', 'speculative': True}), 409)
        self.assertNotIn('speculative-source', server['UPLOADS'])
        self.assertEqual(self.post('/build', {'id': 'normal-source', 'commit': 'abc'}), 409)
        self.assertNotIn('normal-source', server['UPLOADS'])
        server['UPLOADS'].clear()

    def test_abandoned_uploads_never_block_a_new_upload(self):
        # A superseded or interrupted upload is never followed by /build, so only the slot limit can free it.
        server['UPLOADS'].clear()
        chunk = base64.b64encode(b'source archive').decode()
        for index in range(4):
            self.assertEqual(self.post('/upload', {'id': f'abandoned-{index}', 'offset': 0, 'data': chunk}), 200)
        self.assertEqual(self.post('/upload', {'id': 'fresh-source', 'offset': 0, 'data': chunk}), 200)
        self.assertIn('fresh-source', server['UPLOADS'])
        self.assertLessEqual(len(server['UPLOADS']), 4)
        server['UPLOADS'].clear()


if __name__ == '__main__':
    unittest.main()
