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

## Code web end-to-end tests

The Playwright suite runs separately from the Vitest unit tests. Configure the
Code web app's local environment with `VITE_CONVEX_URL`,
`VITE_WORKOS_CLIENT_ID`, and the appropriate WorkOS redirect URI, as for normal
development. The sign-in test reaches the configured WorkOS sign-in page; it
does not sign in or modify account data.

From `apps/code/web`, install the Chromium browser once and run the suite:

```sh
bunx playwright install chromium
bun run test:e2e
```

By default Playwright starts a dedicated development server on port 4173. Set
`PLAYWRIGHT_BASE_URL` to test an already running app instead; that server must
be configured for the same authentication flow. Failure traces are saved in
`test-results/`. Run `bunx playwright show-trace <trace.zip>` to inspect one.

The signed-in dashboard and editor tests require a dedicated test account and
workspace. Start the app on port 4173 with the same environment used by the
suite, then run the interactive sign-in helper in another terminal:

```sh
bun run dev -- --host 127.0.0.1 --port 4173 --strictPort
# In another terminal, sign in in the opened browser:
bun run test:e2e:sign-in
PLAYWRIGHT_PROGRAM_ID=<test-program-id> bun run test:e2e
```

The helper waits for the authenticated Programs dashboard before saving the
session in `.auth/state.json`, including IndexedDB. The dashboard tests use it
automatically; the editor tests also require a ready test Program containing
`#include` (or set `PLAYWRIGHT_EDITOR_SEARCH` to text present in its source).
Set `PLAYWRIGHT_AUTH_STATE` to use a different state file. Signed-in tests are
skipped when the state or Program ID is missing. Session state contains
credentials: keep it private and use a disposable test account. Sessions may
expire; run the helper again if authentication fails. The editor tests search, open, and edit a file, then undo the edit. Use a
disposable Program: an interrupted test can leave a live edit behind.

For development-only testing without a WorkOS account, the existing demo
session can create a signed test identity and Program on the configured dev
Convex deployment. See [live editing](docs/live-editing.md) for its effects on
the deployment and cleanup. Run `node apps/code/web/scripts/completion-demo.mjs`
from the repository root, then use the Program ID and `demoUser` in the printed
URL from `apps/code/web`:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 \
PLAYWRIGHT_PROGRAM_ID=<program-id> PLAYWRIGHT_DEMO_USER=<demo-user> \
  bunx playwright test e2e/editor.spec.ts
```

Stop the demo process afterward. This verifies signed Convex authentication and
membership, but does not test the WorkOS sign-in callback.

### Automated WorkOS sign-in

`bun run test:e2e:workos` follows the WorkOS emulator workflow: it starts a
loopback-only emulator with a seeded user, signs in through AuthKit, checks that
Convex grants access to the workspace, and checks the session after reload. The
emulator and its test signing key are never used by production builds.

This command needs a **dedicated development Convex deployment** selected in
`packages/backend/.env.local`, CLI access to it, deployed backend functions, and
the Chromium browser installed. It temporarily sets `CODE_DEMO_ISSUER` and
`CODE_DEMO_JWKS` to trust the emulator's public key and clears them on exit; it
refuses to overwrite an existing demo provider. It creates a personal workspace
for the seeded identity. Run it only on an isolated test deployment; concurrent
runs against the same deployment conflict. If the process is forcibly killed,
clear both variables before using that deployment again. Ports 4100 and 4173
must be available. AuthKit uses the local emulator, but Convex and its configured
services are still required. Backend profile refresh may call WorkOS when the
token lacks a verified email claim. This does not verify a real hosted
WorkOS deployment or the production cookie proxy.

The production workflow runs this test in a separate, serialized job against a
dedicated development deployment before deploying. Configure the
`CONVEX_E2E_DEPLOY_KEY` repository secret with a development deployment key and
the `CONVEX_E2E_URL` repository variable with that deployment’s URL. The job
checks both the key’s target and that the URL differs from production before
pushing backend functions. Fork pull requests skip this job because GitHub
does not supply repository secrets to them.
