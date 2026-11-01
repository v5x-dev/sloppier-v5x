# v5x

v5x is a suite for VEX V5 teams. Code provides collaborative Program editing,
builds through Builder, and upload to a Brain. Design and Film are works in
progress; their app layout is reserved but their workflows are not defined yet.

| Location           | Responsibility                                        |
| ------------------ | ----------------------------------------------------- |
| `apps/code/web`    | Code web, TanStack Start and React                    |
| `packages/backend` | Shared Convex data, authorization, and business rules |
| `packages/ui`      | Shared DOM components, typography, and web tokens     |
| `packages/serial`  | VEX device transport and protocol                     |
| `packages/tokens`  | Product styling tokens                                |
| `infra`            | Builder and autocomplete generation tooling           |

Start with [the glossary](GLOSSARY.md), [Code's architecture map](docs/code-architecture.md),
and [Code web setup and browser testing](apps/code/web/README.md).
Backend environment and release setup live in [its README](packages/backend/README.md).

## Setup and checks

Use Bun 1.4.4 and the committed lockfile. Node 22 or 24 is required for local
Convex Node actions. Run `bun install --frozen-lockfile`, then `bun run doctor`
to check the local runtime and environment selection without changing cloud state.

Run `bash scripts/setup-worktree.sh` in a worktree, or use it as T3 Code's
worktree-create script. It copies `.env.local` files from the main checkout,
replaces existing shared symlinks with independent copies, preserves existing
regular files, and installs dependencies. Environment copies still point to the
same deployment; isolated browser runners use their own local backend instead.

From the root:

```sh
bun run lint          # import boundaries plus available package lint tasks
bun run format:check  # non-writing check of maintained source and scripts
bun run typecheck    # available workspace typechecks
bun run test         # tooling regressions plus available package unit tests
```

Turborepo coordinates package tasks; a package without a task is skipped.
Browser integration tests run separately from Code web. See its README for
`test:e2e:workos`, `test:e2e:editor`, and visual checks.

## Shared web components

From the root, add components with `bunx shadcn@latest add button -c apps/code/web`.
Import through package exports, for example
`import { Button } from "@v5x/ui/components/button"`. Packages cannot import
apps, apps cannot import another app, and cross-package source imports must use
workspace exports. `bun run check:boundaries` enforces these rules and rejects
server modules imported by client components, hooks, and libraries.
