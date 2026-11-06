# v5x

This repo is the v5x suite: a set of tools for VEX V5 robotics teams, plus the
marketing site and the shared code they are built from. It is one platform, not a
collection of unrelated projects.

## The products

- **Code** (code.v5x.dev) is an editor for writing V5 robot programs in the browser.
  Programs are compiled on a remote build farm.
- **Design** (design.v5x.dev) is CAD software for V5 robots.
- **Film** (film.v5x.dev) is a match and skills review platform, similar to Hudl.
- **Marketing** (v5x.dev) is the public website.

## What is shared

- **One backend.** `packages/backend` is a Convex backend. All of the products use it.
- **One sign-in.** Accounts use WorkOS AuthKit and work across the products.
  `packages/auth` holds the sign-in code the apps share.
- **One UI kit.** `packages/ui` holds the components the apps are built from.
- **Design tokens.** `packages/tokens` holds the colors, type, and spacing values
  shared by the apps and the marketing site.
- **Serial.** `packages/serial` is shared serial-port code. The Code app uses it.

## Where things live

- `apps/code/web`, `apps/design/web`, `apps/film/web`: the three product apps.
- `apps/marketing`: the marketing site.
- `packages/`: code shared between apps.
- `infra/`: the build server images and scripts for compiling V5 programs, and the
  generator for the editor's autocomplete data.
- `GLOSSARY.md` and `docs/adr/`: the shared vocabulary and the decisions behind it.
- `scripts/`: repo tooling, such as the boundary checker and the doctor script.
- `.github/workflows/`: CI and deploys.

Tests sit next to the code they test, in each workspace's `tests/` folder.

## How the pieces depend on each other

Apps can use packages. Packages cannot import from apps, and apps do not import from
each other. Code in one workspace reaches another only through its `@v5x/...` name
and the paths that package exports. `bun run check:boundaries` checks this.

## Pierre packages

Several of the most important parts of the Code editor come from the Pierre packages:
`@pierre/diffs`, `@pierre/trees`, `@pierre/highlights`, and `@pierre/storage`. They are
central to this project, so do not replace them with something else.

## Getting around

- Install dependencies with `bun install`.
- `bun run checks` runs the full set: boundaries, tooling tests, lint, typecheck, and
  tests across the workspaces.
- Each workspace has its own `lint`, `typecheck`, and `test` scripts. Run those when
  you only changed one workspace.
- `bun run test:affected` runs only the suites that depend on what changed.

## Testing

CI (`.github/workflows/ci.yml`) runs the boundary check, tooling tests, test hygiene,
formatting, lint, typecheck, and every workspace's unit suite on each pull request.
Browser end-to-end suites run in `deploy-production.yml` with deployment credentials.

- Test behavior that can break: data, state, protocol, auth, and the logic a bug fix
  changed. Skip tests for what types already guarantee and for copy or static markup.
- Extend the existing case or table before adding a new `it`. Test at the lowest layer
  that fails on `main`.
- A bug fix starts with a failing test, then the fix.
- Tests never wait on wall-clock time: no `setTimeout`/`sleep` waits, no polling loops,
  no per-test timeout or retry. Await the promise, event, or state that marks the
  milestone, or use fake timers that the test advances explicitly.
- No committed `.only`. An unconditional `.skip` needs `// quarantine: #<issue> <reason>`
  on the line above.
- Test files live in a `tests/`, `e2e/`, or `benchmarks/` folder, where the runner collects them.
- `bun run check:tests` enforces these rules. The rules are in `scripts/lib/test-hygiene.mjs`.

### Browser end-to-end tests

Run them with `bun run test:e2e` from the repo root. It takes no setup: it installs
Chromium when missing, fetches Node 22 with npx when the default Node is another
version, and prints which storage source it used. It runs the WorkOS sign-in suite and
the editor suites, each against a fresh local Convex backend and a local WorkOS emulator.

The only credential these suites need is the Pierre Code Storage test organization
(`PIERRE_ORG` and `PIERRE_PRIVATE_KEY`). The runner reads it from the first source that
has it: a `CODE_TEST_STORAGE_ENV` file, `PIERRE_*` environment variables, or the
development Convex deployment named in `packages/backend/.env.local`. Nothing else is
required. WorkOS, Smol, and Resend keys are not used, and production deploy keys are
rejected. Never print the credential values.
