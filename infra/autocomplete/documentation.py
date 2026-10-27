"""Render Clang's documentation AST as safe, structured Markdown."""
import re


def documentation(node):
    def inline(part):
        kind = part.get('kind')
        if kind == 'TextComment':
            return part.get('text', '')
        if kind == 'InlineCommandComment':
            value = ' '.join(arg if isinstance(arg, str) else arg.get('text', '') for arg in part.get('args', []))
            if part.get('name') in ('c', 'p', 'ref'):
                return f'`{value}`' if value else ''
            return value
        return ''.join(inline(child) for child in part.get('inner', []))

    def paragraph(part):
        # Clang splits wrapped prose into TextComment nodes. Reflow prose while
        # retaining list boundaries, including the SDK's bare errno entries.
        lines = []
        current = ''
        for child in part.get('inner', []):
            value = inline(child)
            line = child.get('loc', {}).get('line')
            if line is not None and current:
                lines.append(current)
                current = ''
            current += value
        if current:
            lines.append(current)
        result = ''
        for line in lines:
            line = re.sub(r'\s+', ' ', line).strip()
            if not line:
                continue
            error = re.match(r'^(E[A-Z0-9_]+)\s*[-:]\s*(.+)', line)
            if error:
                line = f'- `{error[1]}`: {error[2]}'
            if re.match(r'^[-*]\s+', line):
                result += ('\n' if result else '') + line
            else:
                result += (' ' if result else '') + line
        result = re.sub(
            r'^This function uses the following values of errno(?: when an error state is reached)?:',
            '### Errors\n', result)
        if result in ('Example', 'Examples'):
            result = '### ' + result
        return result

    blocks, parameters, template_parameters = [], [], []
    for child in node.get('inner', []):
        kind = child.get('kind')
        if kind == 'ParagraphComment':
            value = paragraph(child)
        elif kind in ('ParamCommandComment', 'TParamCommandComment'):
            name = child.get('param', '')
            description = ' '.join(paragraph(p) for p in child.get('inner', [])).strip()
            entry = f'- `{name}`: {description}' if name else f'- {description}'
            (parameters if kind == 'ParamCommandComment' else template_parameters).append(entry)
            continue
        elif kind == 'BlockCommandComment':
            value = '\n\n'.join(filter(None, (paragraph(p) for p in child.get('inner', []))))
            command = child.get('name', '')
            titles = {'return': 'Returns', 'returns': 'Returns', 'retval': 'Returns',
                      'note': 'Note', 'warning': 'Warning', 'deprecated': 'Deprecated',
                      'throws': 'Throws', 'exception': 'Throws', 'see': 'See also'}
            if command in titles and value:
                value = f'### {titles[command]}\n\n{value}'
        elif kind == 'VerbatimBlockComment':
            value = '```cpp\n' + '\n'.join(p.get('text', '') for p in child.get('inner', [])) + '\n```'
        else:
            value = inline(child).strip()
        if value:
            blocks.append(value)
    # Put call arguments before return details regardless of source comment order.
    insertion = next((i for i, block in enumerate(blocks) if block.startswith('### ')), len(blocks))
    for title, entries in reversed([('Template parameters', template_parameters), ('Parameters', parameters)]):
        if entries:
            blocks.insert(insertion, f'### {title}\n\n' + '\n'.join(entries))
    return '\n\n'.join(blocks).strip()
