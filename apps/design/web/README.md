# Design web

TanStack Start app for Design, the suite's design product. Work in progress.

- `bun run dev` starts the dev server on port 3002.
- Colors come from `@v5x/tokens/design/web.css`. Shared UI comes from `@v5x/ui`.

## Deploying with alchemy

`alchemy.run.ts` defines the Cloudflare Worker for this app using
[alchemy](https://alchemy.run). It is not wired into CI yet.

- `bun run alchemy:plan --stage <name>` previews changes.
- `bun run alchemy:deploy --stage <name>` deploys. Pass a stage so each
  environment keeps its own state, for example `--stage pr-12`.
- `bun run alchemy:destroy --stage <name>` removes a stage's resources.

Cloudflare credentials come from `alchemy profile edit --add Cloudflare`, which
stores them in `~/.alchemy/profiles.json`. Alchemy's run logs go to `.alchemy/`,
which is gitignored.
