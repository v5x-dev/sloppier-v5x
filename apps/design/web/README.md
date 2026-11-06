# Design web

TanStack Start app for Design, the suite's CAD product for V5 robots. Terms are defined
in the root `GLOSSARY.md`, and the decisions behind this app are in `docs/adr/`.

- Copy `.env.example` to `.env.local`, then `bun run dev` starts the dev server on port 3002.
  The WorkOS client needs `http://localhost:3002/callback` as an allowed redirect.
- Colors come from `@v5x/tokens/design/web.css`. Shared UI comes from `@v5x/ui`.
- Sign-in comes from `@v5x/auth`. It stores its refresh cookie separately from Code's.
- Each Design is a Yjs document. `src/lib/design-sync.ts` keeps edits on the device and
  sends them to `packages/backend/convex/designSync.ts`, so a dropped connection loses nothing.

## Deploying with alchemy

`alchemy.run.ts` defines the Cloudflare Worker for this app using
[alchemy](https://alchemy.run). It is not wired into CI yet.

- `bun run alchemy:plan --stage <name>` previews changes.
- `bun run alchemy:deploy --stage <name>` deploys. Pass a stage so each
  environment keeps its own state, for example `--stage pr-12`.
- `bun run alchemy:destroy --stage <name>` removes a stage's resources.

Every pull request gets its own preview at `https://pr-<number>.design-preview.v5x.dev`,
with its own Convex backend and models bucket, from `.github/workflows/design-pr-preview.yml`.
It runs for any base branch, so each layer of a stack has one, and closing the PR removes it.

To deploy a stage by hand, set `VITE_CONVEX_URL`, `VITE_WORKOS_CLIENT_ID`, and
`DESIGN_DOMAIN`. Without them the site returns a 500. Sign-in only works on a callback
URL that WorkOS allows, and the preview client allows
`https://pr-*.design-preview.v5x.dev/callback`.

Cloudflare credentials come from `alchemy profile edit --add Cloudflare`, which
stores them in `~/.alchemy/profiles.json`. Alchemy's run logs go to `.alchemy/`,
which is gitignored.
