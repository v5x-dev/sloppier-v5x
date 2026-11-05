# Marketing

Astro site for v5x. It is a placeholder page for now.

- `bun run dev` starts the Astro dev server.
- `bun run build` writes the static site to `dist/`.

The site is always dark. `src/layouts/Base.astro` sets `class="dark"` on `<html>`
and imports the marketing tokens, `@v5x/tokens/marketing/web.css`, which come from
shadcn preset `b5xuVmA0e`. Text uses Merriweather from `@fontsource-variable`.

Tailwind v4 runs through `@tailwindcss/vite`. `src/styles/global.css` imports Tailwind and maps the
marketing tokens to color utilities such as `bg-background` and `text-muted-foreground`.
