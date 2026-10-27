#!/usr/bin/env python3
"""Generate checked-in API metadata. Requires clang++, never runs in the app.

Usage: python3 infra/autocomplete/generate.py
Headers come from sdk/*.zip; refresh them with infra/build/export-autocomplete-sdk.py.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import zipfile

from documentation import documentation

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'apps/code/web/src/lib/autocomplete/data'
OUT.mkdir(parents=True, exist_ok=True)


def objects(text):
    decoder = json.JSONDecoder()
    at = 0
    while at < len(text):
        while at < len(text) and text[at].isspace():
            at += 1
        if at == len(text):
            break
        value, at = decoder.raw_decode(text, at)
        yield value


def generate(root, sdk, includes, namespaces):
    base = root / sdk
    flags = (base / 'workspace/compile_flags.txt').read_text().splitlines()
    flags = [s.replace('/workspace', str(base / 'workspace'))
             .replace('/opt/vex', str(base / 'opt/vex'))
             .replace('/usr/include/newlib', str(root / 'newlib/usr/include/newlib'))
             for s in flags if not s.startswith('-resource-dir')]
    entry = base / 'entry.cpp'
    entry.write_text(''.join('#include <' + name + '>\n' for name in includes))
    symbols, sources, inline, seen = [], {}, {}, set()
    current_file = ''

    def visit(node, scope='', access='public', record=False):
        nonlocal current_file
        location = node.get('loc', {})
        location = location.get('spellingLoc', location)
        current_file = location.get('file', current_file)
        filename = current_file
        kind, name = node.get('kind'), node.get('name', '')
        if kind == 'CXXConstructorDecl':
            name = name.split('<', 1)[0]
        children = node.get('inner', [])
        is_record = kind in ('CXXRecordDecl', 'RecordDecl')
        if kind == 'NamespaceDecl':
            if node.get('isInline'):
                inline[(scope + '::' + name).strip(':')] = scope
            child_scope = (scope + '::' + name).strip(':') if name else scope
        elif is_record or kind == 'EnumDecl':
            child_scope = (scope + '::' + name).strip(':') if name else scope
        else:
            child_scope = scope
        accepted = filename.startswith(str(base / 'workspace/include') + '/') or filename.startswith(str(base / 'opt/vex/sdk/vexv5/include') + '/')
        kinds = {'NamespaceDecl': 9, 'CXXRecordDecl': 7, 'RecordDecl': 22,
                 'EnumDecl': 13, 'EnumConstantDecl': 20, 'FunctionDecl': 3,
                 'CXXMethodDecl': 2, 'CXXConstructorDecl': 4, 'FieldDecl': 5,
                 'VarDecl': 6, 'TypedefDecl': 7, 'TypeAliasDecl': 7}
        if accepted and name and kind in kinds and not node.get('isImplicit') and access == 'public' and not name.startswith('_') and not name.startswith('operator'):
            path = 'sdk/' + filename.split('/include/', 1)[1]
            if path not in sources:
                sources[path] = pathlib.Path(filename).read_text()
            source = sources[path]
            # AST offsets count bytes, so decode only after slicing.
            raw = pathlib.Path(filename).read_bytes()
            offset = location.get('offset', 0)
            before = raw[:offset].decode('utf-8', errors='replace')
            position = {'line': before.count('\n'), 'character': len(before.rsplit('\n', 1)[-1])}
            params = []
            for child in children:
                if child.get('kind') != 'ParmVarDecl':
                    continue
                bounds = child.get('range', {})
                begin, end = bounds.get('begin', {}), bounds.get('end', {})
                label = ''
                if 'offset' in begin and 'offset' in end:
                    label = raw[begin['offset']:end['offset'] + end.get('tokLen', 0)].decode('utf-8', errors='replace')
                params.append({'name': child.get('name', ''), 'type': child.get('type', {}).get('qualType', ''),
                               'label': re.sub(r'\s+', ' ', label).strip() or child.get('type', {}).get('qualType', ''),
                               **({'optional': True} if 'init' in child else {})})
            typ = node.get('type', {}).get('qualType', '')
            symbol = {'name': name, 'scope': scope, 'kind': kinds[kind], 'type': typ,
                      'path': path, 'position': position}
            if kind in ('FunctionDecl', 'CXXMethodDecl', 'CXXConstructorDecl'):
                symbol['parameters'] = params
                symbol['type'] = typ.split(' (', 1)[0] if kind != 'CXXConstructorDecl' else child_scope
            if kind == 'EnumDecl':
                symbol['scoped'] = bool(node.get('scopedEnumTag'))
            if is_record:
                symbol['bases'] = [b.get('type', {}).get('qualType', '') for b in node.get('bases', []) if b.get('access') == 'public']
            if kind in ('TypedefDecl', 'TypeAliasDecl'):
                symbol['alias'] = node.get('type', {}).get('desugaredQualType', typ)
            if node.get('storageClass') == 'static':
                symbol['static'] = True
            comment = next((c for c in children if c.get('kind') == 'FullComment'), None)
            rendered = documentation(comment) if comment else ''
            if rendered:
                symbol['documentation'] = rendered
            key = (scope, name, typ, path)
            if key not in seen:
                seen.add(key)
                symbols.append(symbol)
        child_access = 'private' if is_record and node.get('tagUsed') == 'class' else 'public'
        for child in children:
            if child.get('kind') == 'AccessSpecDecl':
                child_access = child.get('access', 'private')
            # Function bodies are irrelevant. Still traverse templates and linkage declarations.
            if child.get('kind') in ('CompoundStmt', 'FullComment', 'ParmVarDecl'):
                continue
            visit(child, child_scope, child_access if is_record else access, is_record)

    for namespace in namespaces:
        current_file = ''
        command = ['clang++', *flags, '-w', '-fsyntax-only', '-fparse-all-comments', '-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=' + namespace, str(entry)]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        for node in objects(result.stdout.decode()):
            visit(node)
    # Inline namespaces remain addressable by either spelling.
    aliases = {key: value for key, value in inline.items()}
    metadata = {'symbols': sorted(symbols, key=lambda s: (s['scope'], s['name'], s['type'])), 'inlineNamespaces': aliases,
                'headers': sorted(p.removeprefix('sdk/') for p in sources)}
    for suffix, data in [('', metadata), ('-sources', sources)]:
        encoded = json.dumps(data, separators=(',', ':'), ensure_ascii=False)
        encoded = encoded.replace(str(base / 'workspace/include') + '/', 'sdk/').replace(str(base / 'opt/vex/sdk/vexv5/include') + '/', 'sdk/').replace(str(root), '/sdk-archives')
        (OUT / (sdk + suffix + '.json')).write_text(encoded + '\n')
    print(sdk, len(symbols), 'symbols,', len(sources), 'headers')


with tempfile.TemporaryDirectory(prefix='v5x-api-') as temporary:
    root = pathlib.Path(temporary)
    for name in ['newlib', 'pros', 'ez-template', 'vexcode']:
        with zipfile.ZipFile(HERE / 'sdk' / (name + '.zip')) as archive:
            archive.extractall(root / name)
    generate(root, 'pros', ['api.h'], ['pros'])
    generate(root, 'ez-template', ['EZ-Template/api.hpp'], ['pros', 'ez', 'okapi'])
    generate(root, 'vexcode', ['v5_vcs.h'], ['vex'])
(OUT / 'provenance.json').write_text(json.dumps({
    'generator': 'infra/autocomplete/generate.py',
    'compiler': subprocess.check_output(['clang++', '--version'], text=True).splitlines()[0],
    'archives': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((HERE / 'sdk').glob('*.zip'))}
}, indent=2) + '\n')
