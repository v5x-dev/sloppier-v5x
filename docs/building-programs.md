# Building programs

The Code web app starts a shared Smolmachines Cloud Builder only when Build or Upload needs it. With `SMOL_BUILD_CHECKPOINT`, it restores the booted checkpoint; otherwise it boots the configured image. Opening a Program does not provision a machine or send Builder presence heartbeats. The backend checks every 10 seconds and deletes completed machines after a 30-second download window. A six-minute deadline also cleans up abandoned source uploads, disconnected clients, and failed startup. Builds submitted during the download window can reuse the machine, but cannot extend its six-minute lifetime. Logs and downloaded binaries stay in browser memory after cleanup.

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

The image installs Clang, GNU Arm Embedded, Python, and Make. Editor autocomplete runs in a browser worker; see [Autocomplete](autocomplete.md). SDK files stay in the ignored `infra/build/vendor/` directory. PROS and EZ-Template firmware, SDK/library headers, and common.mk are baked into the image from the same pinned template revisions used by this project. They are omitted from new program repositories, and source commits cannot add firmware paths or managed build dependencies. JAR uses its upstream make rules. Generic VEXcode programs use the supplied Makefile. The cloud must be able to pull the image.

EZ-Template uses PROS 4.2.2, LVGL 8.3.9, and the pinned Okapi 5.1.0 sources. The upstream EZ-Template 3.2.2 example ships PROS 4.1.1 and soft-float libraries. Template preparation replaces the kernel and LVGL; the Docker build recompiles EZ-Template and Okapi for the new kernel's hard-float ABI. Both ARM multilib variants remain installed because the standalone PROS starter still uses 4.1.1 and VEXcode uses soft-float. Updating an existing EZ program requires replacing the configured build image, since its managed SDK comes from the image rather than its repository. Refresh autocomplete archives and metadata from that same image.

Build uploads omit the managed paths listed in `packages/backend/convex/lib/buildDependencies.ts`. The image links those paths from its read-only dependency tree into each build directory. `src/`, `include/main.h`, robot-specific headers such as `autons.hpp` and `subsystems.hpp`, `Makefile`, and `project.pros` remain repository-owned. Existing repositories may still have older committed copies; builds ignore those and use the image versions.

C++ compilation uses a precompiled header. For PROS and EZ-Template, the wrapper precompiles only the starter's library headers (`api.h`, plus `EZ-Template/api.hpp` for EZ), with debug info disabled. Its cache key covers the compiler, flags, and those library headers, so project header edits reuse it. Macros that `include/main.h` defines before the library includes are not part of the key. VEXcode and JAR keep the full project-header key. Serialization uses a file lock. `infra/build/prewarm-pch.py` compiles each starter once, and the checkpoint stores those caches, so a restored Builder's first build skips the precompile. Machine deletion clears the cache.

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

Production (`different-fly-767`) uses the PROS 4.2.2 EZ-Template image, published as `20261027-pros-4.2.2`:

```text
registry.smolmachines.com/tenants/tenant-72d19493acd7451b8fa6fa3680efb174/sloppier-v5x-build@sha256:52ee5a5c7b0ab96782004eda7feb75fd0095cd3cbf45c34996f3d987459fdd99
```

Its startup checkpoint is `ckpt-6ab47ed51a9f43c490dc198a60ed4f6f`, prewarmed for PROS and EZ-Template. On October 28, 2026, two direct production checkpoint restore and health checks took 23.29 and 16.18 seconds; EZ starter compiles after restore took 5.18 and 3.25 seconds. These measurements exclude browser source preparation, transfer, and artifact download, so they do not establish a five-second end-to-end build.

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

For monolithic programs uploaded directly to a Brain, v5x records the Program ID, source revision, and installed binary's size and CRC on the Brain after a successful transfer. Before starting a Builder, Upload checks that record against the selected slot's current binary metadata. If both match, it reports that the version is already installed and does not build, upload, or start the program. Missing or older records cause a normal upload. This check does not yet skip controller or hot/cold uploads. Physical Brain verification is still required.

## Compiler problems

The Build sheet has Problems and Build output tabs. Problems parses Clang/GCC errors, fatal errors, warnings, and notes, groups them by file, and shows error and warning counts. Repeated identical diagnostics appear once. Compiler escapes and source snippets stay out of the problem messages. Raw output remains available for linker and toolchain failures that have no source location.

Select a repository diagnostic to close the sheet, open its file, and focus the reported line and column after the editor attaches. Dependency files outside the repository remain visible without a navigation action. The workbench accepts repository-relative paths and absolute paths under the build machine's source directory; it does not guess files from basenames. A separate actions-bar button reopens the current results without starting another build.

An edited draft or a repository head different from the build's logged commit marks locations as outdated. Rebuild after committing to refresh them. The build service bounds output to 200,000 characters; if the leading commit line has been truncated, the UI cannot compare that build's revision with the current repository head.
