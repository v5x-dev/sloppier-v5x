# Building programs

The Code web app starts a shared Smolmachines Cloud Builder only when Build or Upload needs it. With `SMOL_BUILD_CHECKPOINT`, it restores the booted checkpoint; otherwise it boots the configured image. Opening a Program does not provision a machine or send Builder presence heartbeats. The backend checks every 10 seconds and deletes completed machines after a 30-second download window. A six-minute deadline also cleans up abandoned source uploads, disconnected clients, and failed startup. Builds submitted during the download window can reuse the machine, but cannot extend its six-minute lifetime. Raw logs and downloaded binaries stay in browser memory after cleanup. Completed compiler diagnostics and their source revision are saved for workspace members.

The viewer-based heartbeat API remains compatible with older clients. Those machines retain their existing viewer-based lifecycle until those clients update.

Build compiles the latest committed `main` snapshot. Commit editor changes first. Source reads are pinned to one commit SHA. Snapshots are compressed and uploaded in chunks to fit the cloud request limit. One build can run per program. Build logs update live in the bottom Sheet component. Successful `.bin` outputs automatically appear in the client-only `bin` folder.

## Toolchain image

Install the VEX V5 C++ SDK with the VEX VS Code extension. Pass its SDK directory containing `vexv5/` to:

```sh
infra/build/prepare-sdk.sh /path/to/V5_SDK
bun infra/build/prepare-dependencies.ts

docker build --platform linux/amd64 -t YOUR_REGISTRY/v5x-build:VERSION infra/build
docker push YOUR_REGISTRY/v5x-build:VERSION
```

The image installs Clang, GNU Arm Embedded, Python, and Make. Editor autocomplete runs in a browser worker; see [Autocomplete](autocomplete.md). SDK files stay in the ignored `infra/build/vendor/` directory. PROS, EZ-Template, and RW firmware, SDK/library headers, and common.mk are baked into the image from the same pinned template revisions used by this project. They are omitted from new program repositories, and source commits cannot add firmware paths or managed build dependencies. JAR uses its upstream make rules. Generic VEXcode programs use the supplied Makefile. The cloud must be able to pull the image.

EZ-Template uses PROS 4.2.2, LVGL 8.3.9, and the pinned Okapi 5.1.0 sources. The upstream EZ-Template 3.2.2 example ships PROS 4.1.1 and soft-float libraries. Template preparation replaces the kernel and LVGL; the Docker build recompiles EZ-Template and Okapi for the new kernel's hard-float ABI. Both ARM multilib variants remain installed because the standalone PROS starter still uses 4.1.1 and VEXcode uses soft-float. Updating an existing EZ program requires replacing the configured build image, since its managed SDK comes from the image rather than its repository. Refresh autocomplete archives and metadata from that same image.

Build uploads omit the managed paths listed in `packages/backend/convex/lib/buildDependencies.ts`. The image links those paths from its read-only dependency tree into each build directory. `src/`, `include/main.h`, robot-specific headers such as `autons.hpp` and `subsystems.hpp`, `Makefile`, and `project.pros` remain repository-owned. Existing repositories may still have older committed copies; builds ignore those and use the image versions.

C++ compilation uses a precompiled header. For PROS and EZ-Template, the wrapper precompiles only the starter's library headers (`api.h`, plus `EZ-Template/api.hpp` for EZ), with debug info disabled. Its cache key covers the compiler, flags, and those library headers, so project header edits reuse it. Macros that `include/main.h` defines before the library includes are not part of the key. VEXcode and JAR keep the full project-header key. Serialization uses a file lock. `infra/build/prewarm-pch.py` compiles each starter once, and the checkpoint stores those caches, so a restored Builder's first build skips the precompile. Machine deletion clears the cache.

While a Builder is reused, it retains `bin/` and `build/` outputs for incremental make builds when the source file set is unchanged and only C/C++ translation units changed. Changes to headers, build rules, other inputs, or the file set discard those outputs before the next build. Source snapshots containing files under those output directories also disable reuse. This cache is local to the Builder and disappears when the machine is deleted.

Builds are cancellable. A newer build cancels a running speculative build; a normal build is never replaced, and a second normal build gets a conflict. A cancelled build deletes only the outputs it wrote, so make never trusts a partial file. Each successful build's artifact stays addressable by id for the last four builds. `/status` carries a `version` that changes with every status change, so `GET /status?since=<version>&wait=<ms>` returns as soon as the status changes (up to 25 seconds); clients wait on the Builder rather than polling it. A Builder without versions is polled every 25 ms. Binaries are deflated once per distinct content, so the unchanged cold package is not recompressed on each build. Each artifact also indexes its binaries by SHA-256 and size: `/status` reports the index for the current artifact, and `/artifact?id=…&entry=bin/…` returns one binary without the archive. The cold package links only the firmware libraries, so it is byte-identical across edits to the program (the hot package changes). Clients keep recent binaries by digest and download only the ones they do not hold, so a Builder that reports an index sends the cold package once per session, not once per build. A Builder without the index still serves the whole archive.

Speculative builds run after the draft source pauses for about 400 ms, so Upload can often reuse a finished binary. Opening the Upload popover starts the speculative build of the draft, so the build has a head start while a slot is chosen. Pressing Upload also starts it if it has not started yet, runs the commit beside it, and waits for it if it is still building; a commit that produces a different snapshot falls back to a normal build. The draft is built from the cached committed head, so starting it does not wait on the network. The formatter worker, the committed head, and the modules an Upload needs start loading when the Program opens. Editing a Program starts a Builder when none is running or starting, at most once every 10 seconds, so the first edit of a session provisions one; its state comes from the same `builds.status` lifecycle as Build and Upload. Speculative builds do not mark a machine completed, so they do not start the completed-machine download window; a normal build's machine is still deleted after that window, and the next edit starts another. The Code web app formats dirty language files exactly as a commit would, hashes the snapshot with the Builder's `source_hash` function, and claims a speculative artifact only when the committed snapshot has the same hash. Speculative status logs do not write diagnostics and do not set the build clock. A claimed binary is the binary of the committed source; any mismatch falls back to a normal build.

## Compile units

The image builds programs with Clang (`V5X_COMPILER=clang`) and per-function units (`V5X_UNITS=1`). Set `V5X_COMPILER` to any other value to build with gcc. The link still uses `arm-none-eabi-g++`, so the libraries and firmware are unchanged.

Clang matches the gcc-built PROS libraries only with `-fshort-enums` and gcc's integer typedef widths. `infra/build/v5x-build` passes those as `CLANG_TARGET_FLAGS`; without them, calls such as `pros::rtos::Task` fail to link. The precompiled header is built with `-Xclang -fpch-instantiate-templates`, which removes about 300 ms of template instantiation from each compile.

`infra/build/unit_split.py` uses libclang's AST to find a source file's top-level declarations. Each external, non-inline function and each file-scope object becomes its own unit: the file's prelude (function bodies replaced by declarations, every object declared `extern` except the one the unit defines) followed by that one definition. Inline functions, templates, and static functions stay in the prelude and are compiled where they are used. `infra/build/unit_build.py` compiles units in parallel, caches each object by content under `/home/builder/.cache/v5x-units`, and combines them with `ld -r` into the single object per source file that make already expects. Machine deletion clears this cache, like the PCH cache.

A unit keeps its object from the previous build when nothing it can see has changed: its own definition, and every top-level declaration it uses, directly or through the file's other declarations. The declarations of each build are compared with the last, so an added object or function compiles only its own unit, and a body edit compiles only that function, including an edit that adds or removes lines (which moves the declarations after it). A macro, type, template, or operator change compiles every unit again. The previous analysis is reused for an edit confined to one function body; other edits re-run libclang on the file. When the splitter cannot prove the split equivalent, the file compiles whole and the timing log records `units-fallback` with the reason. Current refusals: a `#define`, `#undef`, `#include`, or `#pragma` after the first split function; a conditional that spans a function; a directive inside a body; `auto` return types; out-of-line constructors and destructors; functions inside namespaces or linkage blocks; mutable file-local state; and a file-local function with static locals that the file references.

The Builder, limited to two CPUs, took a median of 223 ms for an upload, build, and artifact download after a body edit, 228 ms after a body edit that adds a line, 287 ms after a comment at the end of the file, 326 ms after a new global, and 327 ms after a new function (medians of five rounds). A speculative claim takes 3 ms on the server. In the browser, with a fake Brain and the real Builder, timed from the pointer press on the slot to binary ready: a body edit took about 110 ms when Upload was pressed right after typing and about 200 ms after a three-second pause. A new function took 326–424 ms and a new global 330–497 ms when the slot was chosen right after typing (six runs each), and about 300–420 ms after a pause, where the commit sets the floor. The Brain transfer is excluded, nothing has been measured on a Brain, and a cloud Builder adds network round trips to each step.

Units trade cross-function inlining for parallel, cacheable compiles. At `-Os`, a non-inline function in one unit cannot inline into a caller in another unit, so those calls stay real calls. Inline functions and templates still inline everywhere. Firmware speed on a Brain has not been measured.

At `-O0`, two standard-library template instantiations (`basic_string::_M_destroy` and `vector<ez::Auton>::_S_max_size`) differ in stack layout between the unit and whole-file builds. At `-Os`, every function they share is byte-identical, which is the optimization level programs build with.

## Convex configuration

Set these deployment environment variables through the Convex dashboard:

- `SMOL_CLOUD_TOKEN`: a server-only Smolmachines API key with machine lifecycle and exec permissions.
- `SMOL_BUILD_IMAGE`: the published AMD64 OCI image reference.
- `SMOL_BUILD_CHECKPOINT`: optional startup checkpoint of `SMOL_BUILD_IMAGE`. Create it with `bun infra/build/export-prewarm.ts > prewarm.json` and then `SMOL_CLOUD_TOKEN=... infra/build/checkpoint-image.py IMAGE prewarm.json`, which prints the checkpoint ID. The prewarm step fills the PCH caches before capture. Recreate it whenever the image changes.
- `PIERRE_ORG` and `PIERRE_PRIVATE_KEY`: the existing Code Storage credentials.

Deploy the backend with `bun run --cwd packages/backend deploy`. The Smolmachines tenant API key stays server-side; browsers receive only a scoped connect token. Machines have 2 vCPUs, 2 GiB RAM, one private published port, 8080, and a 120-second idle stop fallback. With `SMOL_BUILD_CHECKPOINT`, each build request restores a machine whose `v5x-server` is already running, and the backend writes the program's template to `/home/builder/workspace/template`. This takes about 1.3 seconds from entry until the machine is reachable, compared with about 15 seconds for an image boot. The checkpoint's source machine is deleted after capture, so no machines stay running. Restored machines have no idle stop fallback, because restore requests cannot set one. Backend reconciliation is what deletes them. While viewers remain, direct browser heartbeats track presence on the build service. The backend samples viewer counts for lifecycle cleanup and keeps occupied machines alive. Source builds run as the image's unprivileged `builder` user. Network egress is open so the cloud can pull the image.

Convex authorizes the initial connection and mints a 15-minute Smolmachines connect token restricted to this machine, port 8080, and no descendants. The browser renews it one minute before expiry. The tenant API key never leaves Convex. The machine has no public ingress.

After the handshake, source uploads, build commands, logs, and binary downloads go directly from the browser to the machine through the authenticated Smolmachines connect bridge. Convex handles machine provisioning, retirement, and token renewal. Repository listing and committed file reads still use the app's existing Code Storage API. The browser pins one commit, reads its editable source, ZIPs it, and uploads 512 KiB chunks directly to the machine. SDK dependencies remain baked into the image.

The machine runs `v5x-server`, an unprivileged Python service. It serializes builds, tracks expiring viewer sessions, retains the last 200,000 log characters, and provides log status updates every 500 ms. A build times out after 240 seconds. Source snapshots are limited to 96 MiB and 3,000 files. The machine retains only the last successful binary ZIP, up to 32 MiB compressed and 64 MiB uncompressed. Partial compiler output and the last successful binaries survive failed builds. Machine deletion clears logs, outputs, and PCH caches. No build logs or artifacts are stored in Convex.

Cloud API contracts were checked against [Smolmachines API reference](https://smolmachines.com/docs/cloud/api-reference) and its [generated OpenAPI schema](https://smolmachines.com/openapi.json).

## Configured production deployment

Production (`different-fly-767`) uses the RW-capable image, published as `20261102-rw`:

```text
registry.smolmachines.com/tenants/tenant-72d19493acd7451b8fa6fa3680efb174/sloppier-v5x-build@sha256:3bd019796e6e49c437b9956dfd83b1ca7db6761582e941d9c833e2d053e9a9eb
```

Its startup checkpoint is `ckpt-c825938072324f0683ec459f00d8f93c`, prewarmed for PROS, EZ-Template, and RW. On October 28, 2026, two direct production checkpoint restore and health checks took 23.29 and 16.18 seconds; EZ starter compiles after restore took 5.18 and 3.25 seconds. These measurements exclude browser source preparation, transfer, and artifact download, so they do not establish a five-second end-to-end build.

The upgrade was verified by compiling all four starters and the committed source of `pleasant-solana-991` (`k97ewazd1z52dne1k833b0s3gs8h3sqd`), including its `pros::AIVision` declaration. Existing program source files were preserved.

## Configured development deployment

The `fabulous-hornet-670` development deployment has a dedicated Smolmachines API key for machine create/read/exec/delete and this pinned image:

```text
registry.smolmachines.com/tenants/tenant-72d19493acd7451b8fa6fa3680efb174/sloppier-v5x-build@sha256:9592fd8d55c2a9fd27a1c39cd4c6bcec54cae41f814968053bcf9c9b843275c2
```

Its startup checkpoint is `ckpt-07de92dae97d43d99f3418183fe577e0`.

The previous image is also tagged `20261026-slim`. It keeps only the `thumb/v7-a+simd/softfp` ARM multilib, the one every V5 template selects for the Cortex-A9, which cuts the unpacked image from 3.6 GB to 0.96 GB. Source snapshots and PCH caches live under `/home/builder/` so the guest's `/workspace` mount does not replace their permissions. The token is stored only in the Convex deployment environment. Reconciliation replaces machines whose source differs from the configured image digest, waiting for an active build to finish first.

Cloud verification compiled all four templates from editable-only snapshots. Direct-connection verification built EZ-Template, received logs before completion, downloaded both package binaries without Convex storage, and rejected the scoped token on other cloud API routes. A browser build also populated the client-only binary folder. Local PCH reuse and header invalidation checks pass for all four templates.

Successful artifacts automatically download into read-only `bin/` entries in the existing Pierre file tree. The generated folder has a `client only` label. Only `.bin` entries are extracted, with a 64 MiB total uncompressed limit. These files exist in browser memory, are cleared on leaving the program, and never enter repository paths, collaborative drafts, or commits. Select a binary, or use the tree’s Download action, to save it to disk. Generated entries disable repository edits, uploads, cut, copy, paste, rename, and delete.

The editor's Upload popover checks for uncommitted changes when Upload is pressed. It waits for live edits to sync, commits changed drafts with the message `Save changes before upload`, and snapshots the resulting repository revision. A successful build for that exact revision can be reused; otherwise Upload starts a build and waits before downloading and sending its binaries to the connected V5 brain. Commit or build failures stop the sequence. Failed builds never fall back to older binaries, and leaving the editor cancels pending upload preparation.

Upload waits for live-edit sync through the source's subscription, with a 250 ms fallback timer. Upload does not wait for queued Brain console reads before it commits or builds, and a slot refresh stops between requests when an upload starts. The Brain check runs beside them and is awaited before the Brain is first used for a claim or install check, so a failed check still stops the upload before any binary is sent; a commit made before that failure is kept, as it would be by Save. After its own commit, the snapshot comes from the cache that the commit advanced, without another manifest read. The commit reports the recorded head as its parent when only live-edit backups, which touch only `.v5x/`, sit between the two heads. Otherwise the parent is the branch head and the snapshot is read again.

For monolithic programs uploaded directly to a Brain, v5x records the Program ID, source revision, and installed binary's size and CRC on the Brain after a successful transfer. Before starting a Builder, Upload checks that record against the selected slot's current binary metadata. If both match, it reports that the version is already installed and does not build, upload, or start the program. Missing or older records cause a normal upload. This check does not yet skip controller or hot/cold uploads. Physical Brain verification is still required.

The Upload popover shows all eight slots as a button group. A bar along each slot's bottom edge gives its status: green for the current revision, amber for a different revision of the open Program, gray for another program, and dashed gray for a binary v5x does not track. Empty slots have no bar. Arrow keys move the selection. The row below the slots shows the open Program beside the selected slot's `[program] name=` value from `slot_N.ini`, read through the Brain's user directory, and its recorded revision. Each slot's status text is in its accessible name. The slots refresh when the popover opens, after an upload, and from its refresh button.

## Compiler problems

The Build sheet has Problems and Build output tabs. Problems parses Clang/GCC errors, fatal errors, warnings, and notes, groups them by file, and shows error and warning counts. Repeated identical diagnostics appear once. Compiler escapes and source snippets stay out of the problem messages. Raw output remains available for linker and toolchain failures that have no source location.

Select a repository diagnostic to close the sheet, open its file, and focus the reported line and column after the editor attaches. Dependency files outside the repository remain visible without a navigation action. The workbench accepts repository-relative paths and absolute paths under the build machine's source directory; it does not guess files from basenames. A separate actions-bar button appears only while the current results have problems and reopens them without starting another build.

Completed compiler problems are saved with the Program and its source revision, and are available to workspace members after reload. A later completed build replaces them, including when it reports no problems. Raw build output and binaries are not saved. An edited draft or a repository head different from the build revision marks locations as outdated. Rebuild after committing to refresh them. The build service bounds output to 200,000 characters; if the leading commit line has been truncated, the UI cannot compare that build's revision with the current repository head.
