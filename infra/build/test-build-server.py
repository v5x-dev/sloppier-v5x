"""Build-only HTTP contract. Run with python3 infra/build/test-build-server.py."""
import base64
import json
import os
import pathlib
import runpy
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

os.environ.setdefault('V5X_TEMPLATE', 'pros')
server = runpy.run_path(str(pathlib.Path(__file__).with_name('v5x-server')))


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


if __name__ == '__main__':
    unittest.main()
