#!/usr/bin/env python3
"""Build EZ/Okapi archives with the same hard-float ABI as the PROS kernel."""
import concurrent.futures
import pathlib
import subprocess
import tempfile

root = pathlib.Path('/opt/v5x/deps/ez-template')
flags = ['-mcpu=cortex-a9', '-mfpu=neon-fp16', '-mfloat-abi=hard', '-mthumb', '-Os', '-std=gnu++23', '-ffunction-sections', '-fdata-sections', '-D_POSIX_THREADS', '-D_UNIX98_THREAD_MUTEX_ATTRIBUTES', '-D_POSIX_TIMERS', '-D_POSIX_MONOTONIC_CLOCK', '-D_PROS_INCLUDE_LIBLVGL_LLEMU_H', '-D_PROS_INCLUDE_LIBLVGL_LLEMU_HPP', '-I' + str(root / 'include'), '-Wno-deprecated-enum-enum-conversion']
with tempfile.TemporaryDirectory() as temporary:
    for name, libraries in [('EZ-Template', ['ez']), ('okapilib', ['okapi'])]:
        sources = [p for library in libraries for p in pathlib.Path('/tmp/library-sources', library).rglob('*.cpp')]
        def compile_source(item):
            index, source = item
            output = pathlib.Path(temporary, f'{name}-{index}.o')
            subprocess.run(['arm-none-eabi-g++', *flags, '-I' + str(root / 'include/EZ-Template'), '-I' + str(root / 'include/okapi/squiggles'), '-c', str(source), '-o', str(output)], check=True)
            return str(output)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            objects = list(executor.map(compile_source, enumerate(sources)))
        target = root / 'firmware' / (name + '.a')
        target.unlink(missing_ok=True)
        subprocess.run(['arm-none-eabi-ar', 'rcs', str(target), *objects], check=True)
