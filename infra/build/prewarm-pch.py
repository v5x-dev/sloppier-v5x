#!/usr/bin/env python3
"""Compile each starter once inside a Builder so its library PCH is cached before checkpointing.

checkpoint-image.py runs this as `python3 -c <this file> <payload>`. The payload comes from
export-prewarm.ts: {"templates": {"<template>": {"<path>": "<base64>"}}}. Builds use the production
source path so the cache matches what restored Builders compute. The source tree is removed
afterwards, and the server never receives a build, so checkpointed logs and artifacts stay empty.
"""
import base64
import json
import pathlib
import shutil
import subprocess
import sys

payload = json.loads(sys.argv[1])
source = pathlib.Path('/home/builder/workspace/source')
for template, files in payload['templates'].items():
    shutil.rmtree(source, ignore_errors=True)
    source.mkdir(parents=True)
    for relative, data in files.items():
        target = source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(data))
    result = subprocess.run(['/usr/local/bin/v5x-build', template], cwd=source, capture_output=True, text=True)
    if result.returncode:
        sys.exit(f'prewarm {template} failed:\n' + (result.stdout + result.stderr)[-2000:])
    print(f'prewarmed {template}', flush=True)
shutil.rmtree(source, ignore_errors=True)
