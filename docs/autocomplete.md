# Autocomplete

C and C++ completion, signature help, hover, definitions, and formatting run in a
browser worker using clangd compiled to WebAssembly. Smolmachines only build V5
binaries. Opening a language session does not upload source to a build machine,
start clangd there, or send HTTP language requests.

## How it works

`LanguageSession` owns one `LanguageClient` and one worker per tab. Startup reads
one pinned source snapshot, with at most six repository reads in flight, and
transfers its buffers to the worker. The worker installs source at `/workspace`
and loads the template's SDK headers into its own memory filesystem. Collaborators
have separate workers and unsaved buffers.

The client batches JSON-RPC messages through `postMessage`. Local and remote Yjs
edits become incremental `didChange` notifications with UTF-16 positions. Edits
reach clangd before completion requests. Cancellation and stale-response handling
follow the same rules as other editor operations. Closed files use the pinned
snapshot; open files use their live Yjs contents.

clangd runs with one parsing job, memory-backed preambles, no background index,
no clang-tidy, no automatic include insertion, and at most 100 completion results.
The compiler targets ARM, using the same PROS/newlib and VEX headers as builds.
Template defaults live in `compile_flags.txt`. Custom Makefile execution stays on
the build machine; programs with custom analysis flags should supply `.clangd`,
`compile_flags.txt`, or `compile_commands.json` using `/workspace` paths.

- **Editor UI.** `useEditorCompletion` (`components/editor/editor-completion.tsx`) follows VS Code's defaults:
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

## Runtime and SDK assets

`bun run prepare-language` in `apps/code/web` prepares the runtime and SDKs before
both development and production builds. Upstream downloads are SHA-256 pinned,
verified on every preparation, and cached outside `public/`. Generation fails on
an unexpected upstream layout or integrity mismatch.

Generated assets have content hashes in their names and immutable caching. The
small runtime and SDK manifests revalidate. The Wasm file is stored as gzip and
served with `Content-Encoding: gzip` and `Content-Type: application/wasm`, so the
browser can decompress and compile it as a stream. The generator checks the
Cloudflare 25 MiB per-file limit. Source arrays transfer to the worker, and the
memory filesystem takes ownership of SDK/source buffers without another copy.

Modern Chromium uses the bundled JSPI runtime when native WebAssembly suspension
is available. Older browsers use the pinned Asyncify runtime. Both run in a worker
and use the same SDKs. The JSPI build omits clang-tidy checks and the unrelated
WASI sysroot; compiler builtin headers remain embedded.

To rebuild the native-suspension runtime locally:

```sh
V5X_LANGUAGE_BUILD_JOBS=6 infra/language/build-clangd.sh
node infra/language/package-runtime.mjs \
  "$HOME/.cache/v5x-clangd-build/llvm-project/build-jspi/bin"
bun run --cwd apps/code/web prepare-language
```

The build pins LLVM 21.1.0 and Emscripten 4.0.22. Packaged binaries and their
integrity/provenance manifest live in `infra/language/runtime`; normal application
builds verify and copy them without rebuilding LLVM. LLVM's license is in
`infra/language/LLVM-LICENSE.txt`, alongside the upstream wrapper's license.

SDK archives are checked in under `infra/language/sdk` so CI and browser sessions
need no running build machine. PROS and EZ share one newlib download. VEXcode and
JAR share one VEX SDK download. To regenerate from an installed toolchain image:

```sh
python3 infra/build/prepare-language-sdk.py <toolchain-image>
```

The build image and `Smolfile` no longer install clangd. `v5x-server` no longer
exposes `/language/*`, creates language workspaces, or starts a language janitor.
Deploy a rebuilt image to remove those services from existing hosted machines.

The app sends COOP `same-origin` and COEP `credentialless` headers because the
pthread runtime requires `SharedArrayBuffer`. Vite applies the same headers during
development. Cloudflare static-asset headers are in `public/_headers`.

## Benchmarking

Recorded results and methodology are in
[`benchmarks/browser-clangd/README.md`](benchmarks/browser-clangd/README.md).

The benchmark starts a local static asset server and real headless Chromium. It
needs no account, Convex credentials, build machine, or editor UI automation.

```sh
cd apps/code/web
bun run prepare-language
bun run benchmark-language
```

Install Playwright or point `PLAYWRIGHT_MODULE` at an existing installation.
`CHROMIUM_PATH` defaults to `/usr/bin/chromium`. Set `LANGUAGE_TEMPLATE` to `pros`,
`ez-template`, `vexcode`, or `jar`; `BENCHMARK_RUNS` defaults to two worker sessions.
`BENCHMARK_OUTPUT` saves JSON. `WORKER_BUNDLE` can point at the production worker
bundle to verify Vite output instead of the benchmark's Bun bundle.

The harness measures worker startup, first completion, median and 95th-percentile
completion after incremental edits, Wasm heap size, main-thread long tasks, and
main-thread heartbeat delays. `timeToFirstCompletionMs` includes worker startup
and initialization; `firstCompletionMs` measures the first completion request.
`BENCHMARK_CGROUP=1` records the dedicated cgroup's peak memory, including all
Chromium processes and the harness. It also checks ARM SDK completion, hover, definition
reads, formatting, Unicode framing, and missing-header diagnostics.

Chrome page CPU throttling does **not** throttle dedicated workers. Constrain the
whole browser process group instead. For example, on a systemd Linux host:

```sh
systemd-run --user --scope -p CPUQuota=100% -p MemoryMax=2G \
  env BENCHMARK_CGROUP=1 \
  BENCHMARK_ENVIRONMENT="one CPU quota, 2 GiB process-group limit" \
  bun scripts/benchmark-language.mjs
```

These limits are a reproducible proxy, not measurements from Chromebook hardware.
The target device is a typical school Chromebook with 4 GB RAM. The 2 GiB
process-group limit reserves room for ChromeOS and other tabs, but it does not
emulate a particular Chromebook CPU.

Heap measurements exclude JavaScript, compiler code, browser processes, and GPU
memory. Network timing uses localhost, so it does not represent a school network.

Run the regression checks with `bun run --cwd apps/code/web test` and
`python3 infra/build/test-build-server.py` from the repository root.

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

SDK definition reads stay inside the worker's filesystem. They accept only
program and SDK paths, valid UTF-8 text, and files no larger than 512 KiB.
