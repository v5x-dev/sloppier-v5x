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
