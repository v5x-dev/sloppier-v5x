"""Exercise the metadata formatter with Clang's actual comment AST."""
import json
import subprocess
import unittest

from documentation import documentation


class DocumentationTest(unittest.TestCase):
    def test_preserves_api_documentation_structure(self):
        source = '''/**
 * Sets the voltage for the motor from -127 to 127. This is designed to
 * map easily to the controller's analog stick.
 *
 * The actual behavior is analogous to motor_move().
 *
 * This function uses the following values of errno:
 * ENODEV - The port cannot be configured as a motor
 * EINVAL - Invalid voltage
 *
 * @param voltage The new motor voltage from -127 to 127
 * @param reversed Whether to reverse the motor
 * @return 1 if successful, otherwise PROS_ERR.
 */
int move(int voltage, bool reversed);
'''
        result = subprocess.run(
            ['clang++', '-x', 'c++', '-fsyntax-only', '-fparse-all-comments',
             '-Xclang', '-ast-dump=json', '-'],
            input=source, text=True, capture_output=True, check=True)

        def comments(node):
            if node.get('kind') == 'FullComment':
                yield node
            for child in node.get('inner', []):
                yield from comments(child)

        rendered = documentation(next(comments(json.loads(result.stdout))))
        self.assertIn("designed to map easily", rendered)
        self.assertIn("stick.\n\nThe actual behavior", rendered)
        self.assertIn('### Errors', rendered)
        self.assertIn('- `ENODEV`: The port cannot be configured as a motor', rendered)
        self.assertIn('\n- `EINVAL`: Invalid voltage', rendered)
        self.assertIn('### Parameters\n\n- `voltage`: The new motor voltage', rendered)
        self.assertIn('\n- `reversed`: Whether to reverse the motor', rendered)
        self.assertIn('### Returns\n\n1 if successful, otherwise PROS_ERR.', rendered)
        self.assertLess(rendered.index('### Parameters'), rendered.index('### Returns'))

    def test_keeps_inline_code_commands(self):
        comment = {'inner': [{'kind': 'ParagraphComment', 'inner': [
            {'kind': 'TextComment', 'text': 'Use '},
            {'kind': 'InlineCommandComment', 'name': 'c', 'args': ['PROS_ERR']},
            {'kind': 'TextComment', 'text': ' on failure.'},
        ]}]}
        self.assertEqual(documentation(comment), 'Use `PROS_ERR` on failure.')


if __name__ == '__main__':
    unittest.main()
