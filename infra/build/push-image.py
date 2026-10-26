#!/usr/bin/env python3
"""Push a local Docker image to the Smolmachines registry with chunked blob uploads.

`docker push` sends each layer as one request, and the registry answers 502 for
the multi-hundred-MB toolchain layer. This uploads the same compressed blobs
(from `docker save` with the containerd image store) in 32 MiB PATCH chunks,
skips blobs the registry already has, then pushes the manifests unchanged, so
digests match what `docker push` would produce.

Usage: infra/build/push-image.py IMAGE REPOSITORY TAG
  e.g. infra/build/push-image.py sloppier-v5x-build:local \\
         tenants/tenant-.../sloppier-v5x-build 20261026-language
Requires `smol auth login`. Prints REGISTRY/REPOSITORY@DIGEST for SMOL_BUILD_IMAGE.
"""
import base64
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import urllib.error
import urllib.parse
import urllib.request

REGISTRY = 'registry.smolmachines.com'
CHUNK = 32 * 1024 * 1024
image, repository, tag = sys.argv[1:4]
token = None

def authenticate():
    global token
    config = tomllib.loads((pathlib.Path.home() / '.config/smolvm/config.toml').read_text())
    identity = config['machines']['registries'][REGISTRY]['identity_token']
    basic = base64.b64encode(f'token:{identity}'.encode()).decode()
    query = urllib.parse.urlencode({'service': REGISTRY, 'scope': f'repository:{repository}:pull,push'})
    request = urllib.request.Request(f'https://api.smolmachines.com/v2/auth?{query}', headers={'Authorization': f'Basic {basic}'})
    body = json.load(urllib.request.urlopen(request, timeout=60))
    token = body.get('token') or body.get('access_token')

def call(method, url, data=None, headers=None, retry=True):
    url = url if url.startswith('https://') else f'https://{REGISTRY}{url}'
    request = urllib.request.Request(url, data=data, method=method, headers={'Authorization': f'Bearer {token}', **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            return response.status, response.headers
    except urllib.error.HTTPError as error:
        if error.code == 401 and retry:
            authenticate()  # Long uploads can outlive one bearer token.
            return call(method, url, data, headers, False)
        if method == 'HEAD' and error.code == 404:
            return 404, error.headers
        raise SystemExit(f'{method} {url}: {error.code} {error.read()[:300]!r}')

def push_blob(path, digest):
    if call('HEAD', f'/v2/{repository}/blobs/{digest}')[0] == 200:
        print(f'exists  {digest[:19]}')
        return
    size = path.stat().st_size
    location = call('POST', f'/v2/{repository}/blobs/uploads/', b'')[1]['Location']
    with path.open('rb') as blob:
        offset = 0
        while chunk := blob.read(CHUNK):
            location = call('PATCH', location, chunk, {
                'Content-Type': 'application/octet-stream',
                'Content-Range': f'{offset}-{offset + len(chunk) - 1}',
            })[1]['Location']
            offset += len(chunk)
            print(f'\rupload  {digest[:19]} {offset * 100 // max(size, 1)}%', end='', flush=True)
    separator = '&' if '?' in location else '?'
    call('PUT', f'{location}{separator}digest={digest}', b'')
    print(f'\rpushed  {digest[:19]} {size} bytes')

def push(descriptor, root, reference):
    """Push a manifest or index after everything it references."""
    digest = descriptor['digest']
    path = root / 'blobs' / 'sha256' / digest.split(':')[1]
    if not path.exists():
        print(f'skip    {digest[:19]} (not in local store)')
        return False
    document = json.loads(path.read_text())
    for child in document.get('manifests', []):
        push(child, root, child['digest'])
    for blob in [document.get('config'), *document.get('layers', [])]:
        if blob:
            push_blob(root / 'blobs' / 'sha256' / blob['digest'].split(':')[1], blob['digest'])
    call('PUT', f'/v2/{repository}/manifests/{reference}', path.read_bytes(), {'Content-Type': descriptor['mediaType']})
    return True

authenticate()
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    archive = root / 'image.tar'
    subprocess.run(['docker', 'save', image, '-o', str(archive)], check=True)
    with tarfile.open(archive) as saved:
        saved.extractall(root, filter='data')
    archive.unlink()
    top = json.loads((root / 'index.json').read_text())['manifests'][0]
    push(top, root, top['digest'])
    call('PUT', f'/v2/{repository}/manifests/{tag}', (root / 'blobs' / 'sha256' / top['digest'].split(':')[1]).read_bytes(), {'Content-Type': top['mediaType']})
    print(f'{REGISTRY}/{repository}@{top["digest"]}')
