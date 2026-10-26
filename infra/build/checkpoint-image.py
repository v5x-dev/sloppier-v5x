#!/usr/bin/env python3
"""Capture a booted build machine as the startup checkpoint for SMOL_BUILD_CHECKPOINT.

Booting the image takes ~15 s; restoring this checkpoint with v5x-server already
listening takes ~1 s. The source machine is deleted once the checkpoint is stored,
so no machine stays running.

Usage: SMOL_CLOUD_TOKEN=... infra/build/checkpoint-image.py SMOL_BUILD_IMAGE
Prints the checkpoint ID.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.smolmachines.com/v1'
image = sys.argv[1]

def cloud(path, body=None, method=None):
    request = urllib.request.Request(
        API + path, method=method or ('POST' if body is not None else 'GET'),
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {os.environ["SMOL_CLOUD_TOKEN"]}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=330) as response:
            data = response.read()
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        raise SystemExit(f'{request.method} {path}: {error.code} {error.read()[:300]!r}')

machine = cloud('/machines', {
    'name': f'v5x-checkpoint-{int(time.time())}',
    'source': {'type': 'image', 'reference': image, 'arch': 'amd64'},
    'resources': {'cpus': 2, 'memoryMb': 2048},
    'network': {'mode': 'open'},
    'autoStopSeconds': 600,
    'ports': [{'port': 8080}],
    'public': False,
})['id']
try:
    # Exec starts the machine; retry until v5x-server answers.
    while True:
        health = cloud(f'/machines/{machine}/exec?output=text', {
            'command': ['python3', '-c', "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5)"],
            'timeoutSeconds': 10,
        })
        if health['exitCode'] == 0: break
        time.sleep(1)
    checkpoint = cloud(f'/machines/{machine}/checkpoints', {})['id']
    while (status := cloud(f'/checkpoints/{checkpoint}')['status']) != 'available':
        if status not in ('creating', 'uploading'): raise SystemExit(f'Checkpoint {checkpoint} is {status}.')
        time.sleep(2)
finally:
    cloud(f'/machines/{machine}', method='DELETE')
print(checkpoint)
