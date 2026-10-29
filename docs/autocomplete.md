# Autocomplete

C and C++ suggestions run locally from API metadata and a tolerant declaration
index. The editor remains `@pierre/diffs`, with edits and undo synchronized through
Yjs. Opening autocomplete does not start a compiler, contact a build machine, or
send source to a completion service.

## Implementation

`lib/autocomplete/engine.ts` owns completion, signatures, hover documentation, and
definition lookup. Its interface accepts a file path and UTF-16 cursor position.
It indexes each source file when that file changes and loads one API database for
the program template. VEXcode and JAR share VEX SDK metadata; PROS and EZ-Template
have their own databases. JAR declarations in program headers join the source index.

The SDK metadata records namespaces, public classes and inherited members,
overloads, parameter types, enums, aliases, documentation, and definition locations.
SDK header text loads separately, only when a definition opens.

The source index recognizes namespace imports, aliases, classes, fields,
functions, parameters, variables, and enums. Local variables are limited to their
source scope. The context builder follows member access through `.`, `->`, and
`::`, including nested fields, returned objects, pointers, and indexed containers.
It counts active arguments across lines and nested calls, then offers appropriate
enum values with the qualifiers required by C++.

This is token-based assistance, not a C++ compiler. It does not expand macros,
evaluate conditional compilation, instantiate arbitrary templates, resolve every
C++ expression, or diagnose semantic errors. Complex deduction can yield no
suggestions. Build diagnostics remain the source of compiler errors. SDK metadata
covers the robotics APIs; it is not a complete standard-library database.

## Pierre integration

`LanguageService` owns the index and observes open Yjs documents. Local and remote
edits update the same context immediately. Other source files come from a pinned
repository snapshot, read with at most six requests in flight. Open-buffer and SDK
suggestions are available while those reads finish. File-list changes
refresh that snapshot, and loaded files and drafts override saved content.
Source indexing excludes binaries and build artifacts.

The existing completion popup provides fuzzy filtering, kind icons, documentation,
keyboard navigation, and signature help. Identifier input opens suggestions after
50 ms. Member and argument punctuation triggers queries immediately. Ctrl+Space
opens completion; Ctrl+Shift+Space opens signatures. Enter or Tab accepts the
selected item, and Escape dismisses the popup. Accepting a method inserts its
parentheses, places the caret inside when the method has parameters, and opens
argument suggestions. Existing identifier suffixes and parentheses are preserved.
Completion edits go through Pierre in one Yjs undo transaction.

Hover shows declaration signatures and documentation. F12 and Ctrl/Cmd-click
navigate to program declarations or open SDK headers in a read-only Pierre view.
Ctrl/Cmd-click navigates only for a press released in place on an identifier, so
dragging to select text with Ctrl held does not report a missing definition.

Formatting uses `@wasm-fmt/clang-format` in a separate worker, loaded on the first
format request. It honors the nearest program `.clang-format`, falling back to
LLVM style with two-space indentation and a 120-column limit. Formatting and completion have independent
lifecycles. Neither requires shared memory or cross-origin isolation headers.

## Updating API metadata

Generated JSON is checked in under `lib/autocomplete/data`, so regular development
and production builds need no SDK download or metadata generation. The source
archives and VEX SDK license live under `infra/autocomplete/sdk`. Generated excerpts
retain their source notices in the separate header files.

To refresh source archives from the build image:

```sh
python3 infra/build/export-autocomplete-sdk.py <toolchain-image>
```

To regenerate metadata with a local `clang++`:

```sh
bun run --cwd apps/code/web generate-autocomplete
```

The generator uses the SDK's ARM compile flags and public declarations. It fails
if SDK parsing fails. The provenance file records the generator, compiler version,
and source archive SHA-256 hashes. No compiler is included in the browser.

Run behavioral checks with `bun run --cwd apps/code/web test` and TypeScript checks
with `bun run --cwd apps/code/web typecheck`.
