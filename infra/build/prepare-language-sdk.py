#!/usr/bin/env python3
"""Export only headers for browser clangd from the build image, without starting a server.

Usage: python3 infra/build/prepare-language-sdk.py [toolchain-image]
"""
import io
import pathlib
import subprocess
import sys
import zipfile

image = sys.argv[1] if len(sys.argv) > 1 else 'sloppier-v5x-build:definitions-local'
out = pathlib.Path(__file__).resolve().parents[2] / 'infra/language/sdk'
out.mkdir(parents=True, exist_ok=True)
# Runs at asset preparation time. No browser session ever contacts a machine.
export = r'''
import io, pathlib, sys, zipfile
output = io.BytesIO()
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
    for root in ['/usr/include/newlib', '/opt/vex/sdk/vexv5', '/opt/v5x/deps']:
        for p in pathlib.Path(root).rglob('*'):
            if p.is_file() and (root == '/usr/include/newlib' or p.suffix in ['.h','.hpp','.hh','.hxx','.inc','']):
                if p.suffix in ['.a','.lib','.bin','.elf']: continue
                z.writestr(str(p)[1:], p.read_bytes())
sys.stdout.buffer.write(output.getvalue())
'''
archive = subprocess.run(['docker', 'run', '--rm', image, 'python3', '-c', export], check=True, stdout=subprocess.PIPE).stdout
def save(name, files):
    path = out / (name + '.zip')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 26, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(info, data, compresslevel=9)
    print(path.stem, len(files), 'files,', path.stat().st_size, 'bytes')

with zipfile.ZipFile(io.BytesIO(archive)) as source:
    save('newlib', {name: source.read(name) for name in source.namelist() if name.startswith('usr/include/newlib/')})
    for template in ['pros', 'ez-template', 'vexcode']:
        pros = template in ['pros', 'ez-template']
        target = ['--target=arm-none-eabi', '-mcpu=cortex-a9', '-mfpu=neon-fp16'] if pros else ['--target=thumbv7-none-eabi', '-march=armv7-a', '-mfpu=neon']
        flags = ['-xc++', '-resource-dir=/usr', *target, '-mfloat-abi=softfp', '-std=gnu++20' if pros else '-std=gnu++17', '-I/workspace/include']
        files = {}
        if pros:
            base = 'usr/include/newlib/c++/13.2.1'
            flags += ['-D_POSIX_THREADS', '-D_UNIX98_THREAD_MUTEX_ATTRIBUTES', '-D_POSIX_TIMERS', '-D_POSIX_MONOTONIC_CLOCK', '-isystem/' + base, '-isystem/' + base + '/arm-none-eabi/thumb/v7-a+simd/softfp', '-isystem/' + base + '/backward', '-isystem/usr/include/newlib']
            if template == 'ez-template':
                flags += ['-D_PROS_INCLUDE_LIBLVGL_LLEMU_H', '-D_PROS_INCLUDE_LIBLVGL_LLEMU_HPP']
            prefix = 'opt/v5x/deps/' + template + '/include/'
            for name in source.namelist():
                if name.startswith(prefix):
                    files['workspace/include/' + name[len(prefix):]] = source.read(name)
        else:
            flags += ['-fshort-enums', '-DVexV5', '-U__INT32_TYPE__', '-U__UINT32_TYPE__', '-D__INT32_TYPE__=long', '-D__UINT32_TYPE__=unsigned long', '-fno-threadsafe-statics', '-fno-exceptions', '-fno-rtti']
            sdk = '/opt/vex/sdk/vexv5'
            flags += ['-I' + sdk + path for path in ['/include', '/gcc/include/c++/4.9.3', '/gcc/include/c++/4.9.3/arm-none-eabi/armv7-ar/thumb', '/gcc/include']]
            for name in source.namelist():
                if name.startswith('opt/vex/sdk/vexv5/'):
                    files[name] = source.read(name)
        files['workspace/compile_flags.txt'] = ('\n'.join(flags) + '\n').encode()
        save(template, files)
