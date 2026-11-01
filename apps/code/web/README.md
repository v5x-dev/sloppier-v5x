# Code web

Read [the architecture and verification map](../../../docs/code-architecture.md)
and [the domain glossary](../../../GLOSSARY.md) before changing domain behavior.

## Normal development

Use Bun 1.4.4. Install from the root with `bun install --frozen-lockfile`.
Configure the shared backend using [its README](../../../packages/backend/README.md),
then configure `.env.local` here using `.env.example`. The web `VITE_CONVEX_URL`
must match the selected backend `CONVEX_URL`. Vite variables are public.
Run `bun run doctor` from the root to diagnose runtime and configuration mismatches.
Run backend `bun run dev` and this app's `bun run dev` in separate terminals.
Use the port Vite reports. Normal development uses real WorkOS settings.

## Isolated browser tests and visual sessions

These commands create a temporary local Convex deployment, database, identities,
and ports. They deploy a copy of the current backend source locally and do not
push functions or change authentication on a hosted deployment. Each capability
suite starts with clean Program source. The app UI, Convex authentication and
membership, Pierre editor, and Code Storage operations are real.

Prerequisites:

- Node 22 or 24 on PATH (the local Convex action runtime requires one). If your
  default Node differs, set `CODE_TEST_NODE` to a supported Node executable.
- `bunx playwright install chromium` for automated browser tests.
- Test Pierre credentials: provide `CODE_TEST_STORAGE_ENV` pointing to a private
  dotenv file containing `PIERRE_ORG` and `PIERRE_PRIVATE_KEY`, or supply those
  environment variables. Otherwise the runner reads them with the Convex CLI
  from the selected **development** deployment in `packages/backend/.env.local`.
  It rejects production deploy keys. Use a test storage organization.
- Network access for first-use Convex runtime downloads and Code Storage.

Run from this app:

```sh
bun run test:e2e:workos # AuthKit sign-in, backend access, edit, commit, reload
bun run test:e2e:editor # editor controls, two sessions, simulated Builder and Brain
bun run demo:visual   # real app, signed Luna identity; accepts a template argument
```

`test:e2e:editor` simulates Smol's external machine API and the direct Builder
HTTP service on loopback. Only the URLs in the temporary backend copy are
redirected. The app still performs its normal authorized backend handshake and
direct client-to-Builder source/artifact transfer. A bundled Web Serial fixture
stands in for a Brain at the browser device boundary. These checks do not compile
with a real Builder or verify physical hardware. They cover successful upload,
installed-revision reuse, a failed build, and keyboard upload entry.

For several signed identities, run `node scripts/collaboration-demo.mjs`;
`node scripts/completion-demo.mjs` starts the completion fixture. Use the printed
URLs and ports. Each run has unique identities and a local database, so separate
runs can coexist. Within one run, use separate named browser sessions for
collaborators and avoid simultaneous edits for read-only visual comparisons.
Set `CODE_DEMO_PORT` for a fixed visual-session port; an occupied port fails.

On normal completion or Ctrl+C, runners stop their processes, delete repositories
identified by that run's local database, and remove the database and temporary
credentials. If repository deletion fails, the runner fails and prints the
retained temporary directory for recovery. A forced kill cannot execute cleanup;
see [fixture recovery](#fixture-recovery). Never commit tokens, browser state,
screenshots, recordings, or traces. CI retains failure traces for seven days.

## Fixture recovery

A retained directory is named `v5x-code-test-*` under the OS temporary directory.
It contains private storage credentials and the isolated database. Restart its
backend with Node 22/24 using `bunx convex dev --typecheck disable` from that
directory, then use `bunx convex data programs --format json` to inspect exact
Program and repository IDs. Delete only repositories whose IDs match
`programs/<that local Program ID>` using the test storage account, stop the
backend, and remove the directory. Do not clear hosted demo auth variables: the
new runners never set them. A local deployment's auth settings disappear with
its temporary database.

## Existing authenticated environments

`bun run test:e2e` uses the Playwright configuration, normally starting Vite on
port 4173. `PLAYWRIGHT_BASE_URL` selects an existing server. Signed-in dashboard
and editor tests skip unless their required credentials and Program are supplied;
the isolated runner above always supplies fixtures for the critical paths.

Use `bun run test:e2e:sign-in` for interactive WorkOS sign-in on a disposable test
account. It writes `.auth/state.json`, including IndexedDB. Set
`PLAYWRIGHT_AUTH_STATE` to select another file and `PLAYWRIGHT_PROGRAM_ID` for a
ready PROS Program. Tests modify source and undo changes; use a disposable Program.
An interrupted test can leave live edits behind. The isolated WorkOS emulator
checks do not verify hosted WorkOS, production cookies, or production configuration.

## Benchmarks

`bun run benchmark:load` measures control readiness, reload, opening an editor,
search navigation, a one-line edit, and undo. Configure an authenticated session
and Program as above. Set `PLAYWRIGHT_BENCHMARK_RUNS` (1–100) and
`PLAYWRIGHT_CPU_THROTTLE` (1–20) for sampling and constrained CPU comparisons.
For representative timing, build and preview the app and select it with
`PLAYWRIGHT_BASE_URL`. Development compilation and dependency optimization inflate
cold visits. CPU throttling does not reproduce a particular Chromebook or network;
record target hardware and cold/repeat measurements when doing performance work.
