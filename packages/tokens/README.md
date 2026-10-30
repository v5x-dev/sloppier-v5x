# Product tokens

Tokens are organized by product; do not assume Design or Film uses Code's
palette. Each product's web CSS defines its semantic colors. Consumers import
the product export they need; shared UI does not select a product's palette.

Film's web colors come from shadcn preset `b3QxLIEcq` (olive and lime), and
Design's come from `b43fOIaBs` (mauve and pink). Import
`@v5x/tokens/film/web.css` or `@v5x/tokens/design/web.css` for the relevant
product. These files contain the presets' light and dark color tokens only;
they do not select fonts or component styles.
