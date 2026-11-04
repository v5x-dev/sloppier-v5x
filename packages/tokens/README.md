# Product tokens

Tokens are organized by product; do not assume Design or Film uses Code's
palette. Each product's web CSS defines its semantic colors. Consumers import
the product export they need; shared UI does not select a product's palette.

Film's web colors come from shadcn preset `b3QxLIEcq` (olive and lime), and
Design's come from `b43fOIaBs` (mauve and pink). Import
`@v5x/tokens/film/web.css` or `@v5x/tokens/design/web.css` for the relevant
product. Each file holds the preset's light and dark color tokens, plus the
suite tokens that shared UI reads and the presets omit: `--radius`,
`--success`, `--field-border`, and the elevation tokens (`--highlight`,
`--shadow-color`, `--shadow-raised`, `--shadow-overlay`). They do not select
fonts or component styles.

Preset values that miss the rules in `docs/suite-visual-rules.md` stay as the
preset defines them until a product owner changes them. Light-theme pairs that
currently miss the rules: `--ring` on `--background` (Film 2.32:1, Design
2.58:1); `--sidebar-primary-foreground` on `--sidebar-primary` (Film 2.96:1,
Design 4.16:1); and Film's `--muted-foreground` on `--muted` (3.86:1).
