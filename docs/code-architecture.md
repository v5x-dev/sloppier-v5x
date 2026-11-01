# Code architecture and verification

Code web uses TanStack Start routes in `apps/code/web/src/routes`. The Program
route creates the workbench source and renders `components/program/program-workbench.tsx`.
The workbench coordinates the editor, file tree, history, build, and upload UI.
`use-workbench-commands.ts` owns formatting, commits, and keyboard commands;
`use-workbench-drag.ts` owns tab and tree drag lifecycle; `workbench-editors.tsx`
renders controlled editor groups, tabs, and file editors. All source and layout
state stays in `WorkbenchSource`;
editor layout is modeled in `lib/editor-groups.ts` and persisted by
`lib/editor-persistence.ts`.

## Source and collaboration

`lib/workbench-source.ts` coordinates the current Program files and live file
sessions. `lib/live-file-session.ts` and `lib/live-document.ts` manage local and
remote Yjs state; `components/editor/live-file-editor.tsx` connects it to Pierre.
The backend `crdt.ts`, `files.ts`, and the `codeStorage.ts` compatibility facade enforce workspace access
and persist their respective state. Live edits are distinct from source commits:
a commit captures a source revision, and restoring one must also account for
added and deleted files and stale live documents. See [live editing](live-editing.md).

## Build and Brain

`lib/build-program.ts` prepares committed source and the Builder handshake;
`components/program/program-build.tsx` presents build state. The backend build
functions authorize requests; source and output transfer directly between client
and Builder after the handshake. `program-upload.tsx`, `lib/upload-binaries.ts`,
and `@v5x/serial` handle upload to a Brain. Build output is not Program source.
See [building programs](building-programs.md) and the serial package README.

## Backend changes

For each public API change, identify all web and mobile callers and the affected
product; verify identity and workspace membership server-side. Treat supplied IDs
as untrusted. Keep deployed clients compatible, and document any migration and
client rollout before removing a contract. Backend and web deploy separately;
a successful backend deploy can outlive a failed web deploy. See the backend
README for environment and deployment setup.

## Verification map

| Capability                  | Automated coverage                                                                                                                                                    | External verification                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Workspace and authorization | backend workspace, Program management, and storage-contract tests                                                                                                     | Hosted identity configuration                 |
| Live edits and restore      | backend collaboration/restore tests; web session tests; `e2e/collaboration.spec.ts` for independent sessions, cursor labels, local undo, remote commit, and reconnect | Long-lived real user sessions                 |
| Editor and persistence      | unit layout/source/persistence tests; `e2e/editor.spec.ts` for controls, split groups, tabs, reload, typing, undo, and scrolling                                      | Target-device browser checks                  |
| Authentication              | `e2e/workos-emulator.spec.ts` checks sign-in, protected routes, backend access, commit, and reload                                                                    | Hosted WorkOS and production cookie callback  |
| Build and upload            | unit build/upload/serial tests; `e2e/build-upload.spec.ts` uses the real app and simulated external service/device boundaries                                         | Real toolchain compilation and physical Brain |

Run `bun run lint`, `bun run typecheck`, and `bun run test` at the root for
available workspace tasks. Browser tests have separate environment requirements;
see the root README and `apps/code/web/AGENTS.md`. Generated autocomplete JSON is
large and may dominate searches; use `rg --glob '!**/autocomplete/data/**'`
when searching implementation. Its provenance and regeneration are documented in
[autocomplete](autocomplete.md).

## Stable storage API

`convex/codeStorage.ts` preserves the deployed function names, arguments, and
results. `convex/lib/codeStorage` groups source reads/commits, history/restores,
live-document operations/backups, provisioning, and search. `repository.ts`
owns storage construction, action membership lookup, optimistic commit retries,
path listing, and public errors. Refactoring this boundary changes no schema or
public contract and requires no client migration. Code web currently calls it;
future Code mobile clients must use the same public API and server authorization.

## Development and CI

`bun run check:boundaries` parses static imports, exports, dynamic imports, and
CommonJS requires to enforce workspace ownership and client/server boundaries.
The server session adapter also carries TanStack's server-only marker so the
bundler rejects client reachability. Frozen Bun installs use pinned TanStack
versions; update that family together and verify the lockfile and browser paths.

CI runs workspace lint/boundaries, formatting, typechecks, unit tests, and the web
build. The secret-dependent browser job creates local Convex databases and uses
dedicated test storage secrets, with a read-only dev deployment fallback. No hosted backend push is
needed for tests. Production and backend deployments remain separately validated.
