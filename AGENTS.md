# v5x

Style the suite's name as `v5x`, always lowercase.

v5x is a suite of tools for VEX V5 robotics teams to prepare for and compete in
competitions. The starting lineup is three products:

- **Code** (`code`): tools for developing robot programs. The existing app covers
  collaborative editing, builds, and uploading programs to a V5 Brain.
- **Design** (`design`): work in progress.
- **Film** (`film`): work in progress.

Design and Film are works in progress; their detailed workflows are not defined
here. Read their product documentation and the task brief as they are added,
rather than inventing requirements from their names.

Each product has an Expo mobile app and a TanStack Start web app. All products
share the Convex backend in `packages/backend`. Build features around the team's
competition workflow and use VEX V5 terminology. This is one suite with distinct
products, not three unrelated projects.

Use "Builder" in user-facing copy for the build service. Use "Program" for the
robot code item and "Brain" for the V5 device.

## Layout and ownership

- `apps/<product>/web`: the product's TanStack Start app.
- `apps/<product>/mobile`: the product's Expo app.
- `packages/backend`: shared backend, schema, authorization, and business rules.
- `packages/ui`: shared web UI built with shadcn/ui. It currently depends on the DOM.
- `packages/serial`: VEX device communication; consult its README before changing
  transport or protocol behavior.
- `design/<product>`: product design assets.

The layout describes where new apps belong; it does not imply every app already
exists. Follow the existing `apps/code/web` implementation when working on Code.
Give new app packages unique names so workspace filters identify one app.

Keep product-specific behavior in that product's app or an explicitly named
product module. Extract shared code when consumers need the same behavior and
contract. Apps may depend on packages; packages must not import from apps, and
apps must not import another app's source. Use workspace package exports for
cross-package imports.

Keep platform-neutral logic separate from UI and platform APIs. Share domain
types, validation, and pure logic where useful; implement web and native UI with
their respective platform tools. Treat `packages/ui` as web-only unless native
support is deliberately added.

## Shared backend

Implement business rules and authorization in `packages/backend` so web and
mobile use the same rules. TanStack Start server functions may adapt web requests
and sessions, but shared business behavior belongs in the backend.

For each backend change, identify affected products and callers. Enforce identity
and resource membership on the server; client-supplied product, workspace, and
resource IDs are inputs to validate, not proof of access. Keep product-specific
data and permissions scoped explicitly as new products are added.

Preserve compatibility with deployed clients, including older mobile releases.
Prefer additive API and schema changes. For breaking changes, describe the data
migration and client rollout sequence before removing the old contract. Backend
and app deployments are separate operations.

Use the generated API through `@workspace/backend/api`. Keep server credentials
and server-only modules out of client bundles. Environment variables exposed by
Vite or Expo are public; store secrets only in server environments.

For data copies or repairs, identify the destination account and workspace by
stable IDs and verify visibility through that user's access path. Names and
email addresses have matched multiple accounts in this project.

## Web and mobile

For web work, follow the app's existing TanStack Router routes, loaders, and
TanStack Start server/client boundaries. Keep browser-only APIs safe during SSR.
Import shared web components through `@workspace/ui` exports.

Use the requested component and its existing variants rather than recreating its
appearance. Use the tokens in `packages/ui/src/styles/globals.css`, Phosphor for
general UI icons, and the existing template logos and file/symbol icon mappings.
Preserve the established typography: Merriweather for serif UI, DM Sans for sans
UI and documentation prose, JetBrains Mono for code and shortcut hints. Use the
existing `@fontsource-variable` fonts. Apply opacity to the requested background
or color, not to the whole element and its text.

For mobile work, inspect the app's Expo SDK and configuration first. Install
Expo-managed dependencies with `bunx expo install` from that app's directory.
Keep native permissions, app identifiers, deep links, and build configuration
specific to the product. Check whether native directories are generated or
maintained before editing them.

## Code editor and builds

Preserve Pierre integrations: `@pierre/diffs` for the web editor,
`@pierre/trees` for the file tree, and `@pierre/highlights` with
`preferredHighlighter: "highlights"` and the existing Birds of Paradise theme.
Use `setCarets` for remote positions. Check any custom caret renderer actually
draws the caret line, label, and selections. Keep the theme consistent in
search results, hover cards, and other code previews.

Preserve open file tabs, active file, cursor positions, and scroll positions
across reloads. Keep live edits distinct from source commits. For collaboration
changes, check independent sessions, remote commits, refresh/reconnect cleanup,
selections, and local undo. A whole-commit restore must account for added and
deleted files and invalidate stale live documents.

Keep generated binaries and managed firmware/build dependencies out of program
source commits and imports. Keep build output in the client-only `bin/` view.
Preserve direct client-to-builder communication after the backend handshake;
inspect `docs/building-programs.md` before changing data transfer paths.

## Deployment and environments

Preserve Cloudflare bindings when changing deployment commands (`--keep-vars`).
Check frontend build variables, Worker runtime bindings, Convex deployment, and
WorkOS configuration together. Verify CI/deployment status for the exact commit
before saying it is live; distinguish a local fix, pushed code, and deployment.

## Working and checking changes

Use Bun and the committed Bun lockfile. Read root and affected package scripts
before running commands; Turborepo coordinates root tasks. Run app-specific
commands from that app's directory or use its unique workspace package name.

Resolve the affected product, platform, control, and environment before editing.
Browser tabs and editor file tabs are different concepts. Removing a shortcut
does not mean removing its button. Apply the requested scope and preserve
adjacent behavior.

Before proposing a feature, trace the existing UI through its implementation.
Extend an existing history, build, or workspace flow when it already owns the
behavior. A missing or broken operation is a fix, not automatically a new
product concept.

Before changing behavior, read the relevant implementation and tests. For Code
domain changes, read `GLOSSARY.md` and the matching document in `docs/`. For backend
setup, authentication, or deployment changes, read `packages/backend/README.md`.

Run the affected packages' available typechecks, lint, and relevant tests. Changes
to shared packages also need checks for affected consumers. Add regression tests
for changed business rules, authorization, and bug fixes. Report checks run and
anything that could not be verified. The root task list does not currently
include a test command; use the affected package's test script.

Regenerate derived files with their owning tools, including Convex `_generated`
files and TanStack's `routeTree.gen.ts`. Keep edits and formatting scoped to the
task.

For performance work, measure the user's complete path as well as individual
phases. Include cold startup, repeat use, and common one-line edits on the
target hardware budget. Read the provider's current docs before changing build
packaging; use its native tooling when requested rather than substituting a
familiar image workflow.

## Checking web behavior with agent-browser

Reproduce the reported failure on the reported environment. Local success does
not establish success on `code-dev.v5x.dev` or production `code.v5x.dev`. For auth,
check the full callback, authenticated backend access, and reload persistence;
reaching the provider's sign-in screen is only the first step. School
Chromebooks may block DevTools: inspect available logs and expose useful error
states instead of repeatedly asking the user for console output.

After a correction, reproduce the exact reported symptom again. Inspect the
actual scroll container, shadow root, portal, hit target, or font rendering as
applicable. A matching class name or passing unit test does not prove the
visible issue is fixed. Keep screenshots and recordings out of tracked source
unless the task explicitly calls for committed artifacts.

When the task asks for browser verification, use `agent-browser` to exercise the
actual app instead of the T3 preview browser. Passing typechecks or reading JSX
does not establish that a user flow works. Follow the session's tool restrictions
on when browser verification is available and authorized.

1. Read the affected app's scripts and start its development server if needed.
   Use the server's reported port; check startup output for failures before
   opening the app. Start the local backend too if the flow requires it, using
   the documented development environment.
2. Open the app with `agent-browser open` and inspect it with
   `agent-browser snapshot`. Use snapshot references to click, type, and submit
   through the same controls a user uses. Refresh the snapshot after navigation
   or substantial UI changes so references refer to the current page.
3. Exercise the changed flow from its entry point to its observable result.
   Check the saved result after reload when persistence matters. Include the
   relevant empty, error, loading, and permission states. For a bug fix, repeat
   the original reproduction and verify the expected behavior.
4. Inspect the rendered result visually as well as structurally. Set relevant
   desktop and narrow web viewports with `agent-browser set viewport`; check for
   clipped content, overflow, unreadable text, and unreachable controls.
   Browser resizing checks responsive web layout, not the native Expo app.
5. Use `agent-browser wait` for observable UI conditions instead of arbitrary
   delays. Use `agent-browser eval` for targeted diagnostics when needed; changing
   page state through JavaScript is not evidence that the user interaction works.
6. Fix failures and repeat the affected flow. Close browser sessions opened solely
   for the check unless the user asked to keep them open or is using them. Report
   which flow and viewport you checked, its result, and any
   blockers such as missing authentication, backend configuration, or hardware.

If browser verification cannot run, report the specific tool or environment
failure and the checks you completed. Claim browser verification only after
actually exercising the flow.

Keep this root file focused on rules shared across products. Add nested
`AGENTS.md` files when an app or package needs its own instructions, and keep
detailed setup and feature explanations in the relevant README or `docs/` file.
