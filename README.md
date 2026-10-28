# code (by v5x)

code (by v5x) uses TanStack Start and shadcn/ui.

## Worktree setup

Run `bash scripts/setup-worktree.sh` in a worktree, or configure it as a
T3 Code project script with **Run on worktree create** enabled. It links
`.env.local` files from the main checkout without replacing existing files and
installs dependencies using the committed Bun lockfile. The links share the
original files, so changes to their contents affect the main checkout too.

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/code/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```
