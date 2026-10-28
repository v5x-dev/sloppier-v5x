# Product tokens

Tokens are organized by product; do not assume Design or Film uses Code's
palette. Code's web CSS is the source of truth for its semantic colors. After
changing it, run `bun run generate` in this directory to update the Uniwind
mobile tokens, and commit both files. Consumers import the product and platform
export they need; shared UI does not select a product's palette.
