# Autocomplete

C and C++ editors get clangd completion and signature help. clangd runs on the program's build machine, beside builds, and the browser talks to it over the same direct, token-scoped Smolmachines connection used for builds. Convex only mints the connect token; no language traffic passes through it.

## How it works

- **Session.** `LanguageSession` (`apps/code/web/src/components/language-session.tsx`) owns one `LanguageClient` per tab. When the build machine is ready, it uploads the latest committed snapshot with the build upload chunks and calls `POST /language/open`. Each tab gets its own clangd, so collaborators' unsaved buffers never collide.
- **Workspace.** `v5x-server` extracts the snapshot to `/home/builder/language/<session>`, separate from the build directory. It then runs the template's real `v5x-build` with `V5X_RECORD` set. In that mode `v5x-cxx` records each compile command instead of compiling, which yields a `compile_commands.json` with exactly the build's flags, defines, SDK paths, and managed dependencies. clangd runs `nice`d with `-j=1`, no background index, and `--query-driver` for the ARM toolchain. Up to three sessions run per machine, and a session is stopped 60 seconds after its last poll.
- **Transport.** `POST /language/send` carries batched JSON-RPC messages to clangd, in order. `POST /language/poll` long-polls for clangd's messages, held for 20 seconds, which is under the browser's 30-second request timeout. Neither route holds the build lock. When the server answers `{"closed": true}` (machine replaced or session expired), the client re-uploads and reopens.
- **Live buffers.** `LiveFileEditor` registers each open C/C++ file's Yjs text. Local and remote Yjs deltas become incremental `didChange` notifications with UTF-16 positions, so completion sees uncommitted edits. Files not open in this tab come from the last commit.
- **Editor UI.** `useEditorCompletion` (`components/editor-completion.tsx`) follows VS Code's defaults:
  - Identifier characters open quick suggestions after 50 ms, except in comments and strings.
  - clangd's trigger characters (`.`, `->`, `::`, `#include` `"`/`<`/`/`) request immediately.
  - Ctrl+Space invokes completion anywhere, and Ctrl+Shift+Space opens signature help.
  - Each item shows VS Code's codicon for its kind (`@vscode/codicons`) in VS Code's default dark colors: purple for methods and functions, blue for fields, variables and interfaces, orange for classes, enums and events.
  - Typing refilters the list client-side with fuzzy matching. Incomplete lists re-query.
  - Up/Down/PageUp/PageDown move the selection, Enter or Tab accept, and Escape dismisses.
  - Accepting applies the main edit and any `additionalTextEdits` in one Pierre edit, which is one Yjs transaction and one undo step. Snippets expand with the first placeholder selected.
  - Signature help opens on clangd's signature trigger characters. Up/Down cycles overloads.
  - Stale responses are dropped when the text before the word changed.

Rules that don't depend on the editor (word boundaries, fuzzy match, snippet expansion) live in `lib/completion.ts`. The LSP client lives in `lib/language-client.ts`.

## Toolchain image

`infra/build/Dockerfile` installs clangd in its own layer. The development deployment's image adds that layer and the updated `v5x-*` scripts on top of the previous published image (`20261026-language`, `sha256:6761b05f…`). That way the registry only receives small new layers; a freshly rebuilt multi-GB toolchain layer fails to upload with 502s.

## Checking it in a browser (agents)

Signing in needs a real WorkOS account. Use demo accounts instead:

```sh
node apps/code/web/scripts/completion-demo.mjs pros   # or ez-template, vexcode, jar
```

This requires `packages/backend/.env.local` to select a `dev:` deployment and working Convex CLI credentials. It registers an ephemeral demo JWT key, creates a program owned by `code-demo-alice`, starts Vite on `127.0.0.1:3001`, and prints the program URL. Ctrl+C stops Vite and clears the demo JWT settings. The machine starts when the page opens; allow about a minute for it and for clangd's first parse.

Run it in the background, then drive it with agent-browser:

```sh
export AGENT_BROWSER_SESSION=completion-check
agent-browser set viewport 1440 900
agent-browser open "<printed Alice URL>"
agent-browser wait 15000
agent-browser snapshot -i -c                      # find the textbox "src/main.cpp" ref
agent-browser click @eN
agent-browser press Control+End
agent-browser keyboard inserttext "void probe() { pros:"
agent-browser wait 20000                          # machine + clangd warm-up
agent-browser press ":"                           # trigger character → menu
agent-browser press M; agent-browser press o; agent-browser press t
agent-browser screenshot completion.png
agent-browser press Tab                           # accept; Control+z undoes it in one step
```

Notes:

- Press keys one at a time. `keyboard type`/`inserttext` arrive as one multi-character edit, which deliberately doesn't trigger suggestions, just as pasting doesn't.
- The program's live draft persists across reloads. Reset the test line before rerunning.
- Hot module reloads remount the editor and drop focus. Reload the page after editing completion code.
- In the Network panel, `connect/8080/language/*` requests show the direct machine traffic.

To test the server without a browser, run the image locally (`docker run -p 18080:8080 -e V5X_TEMPLATE=pros <image>`). Then call `/upload`, `/language/open`, `/language/send`, and `/language/poll` with plain JSON; no token is needed locally.

## Definitions and hover documentation

Hover over a C/C++ symbol for half a second to read clangd's type information
and documentation. C++ signatures use the editor theme’s syntax highlighting,
with prose and source paths in separate sections. Temporary build-session path
prefixes are hidden. Markdown code fences and inline emphasis are rendered
without accepting server HTML. Existing plaintext language sessions still work.
Move into the popup to scroll longer documentation; Escape dismisses it.

Press F12 at a symbol, or Ctrl-click it on Windows/Linux and Cmd-click it on
macOS, to go to its definition. Repository files open at the returned line and
column. Toolchain headers open in a read-only dialog with the definition line
highlighted. When clangd returns several locations, the first location is used.
Pending requests are canceled on navigation or another request, and responses
for an older document version are ignored.

Toolchain definitions use the direct, session-scoped `POST /language/read`
endpoint. It accepts only local file URIs resolving inside that language
session or the installed SDK/compiler header directories. Reads reject binary,
non-UTF-8, and files larger than 512 KiB. Symlinks are resolved before checking
the allowed directories. Rebuild and publish the build-machine image with the
updated `v5x-server`, then update `SMOL_BUILD_IMAGE`, to enable this endpoint on
hosted machines. Repository navigation and hover use the existing LSP routes.

Check the reader with `python3 infra/build/test-language-read.py`.
