# Building programs

The program workbench starts one shared Smolmachines Cloud machine when its first viewer arrives. Each tab sends a heartbeat every 10 seconds. Leaving removes that tab's session; disconnected tabs expire after 35 seconds. The backend checks every 10 seconds and deletes the machine after the last session leaves, including during a build. A viewer arriving during deletion starts a replacement machine.

Build compiles the latest committed `main` snapshot. Commit editor changes first. Source reads are pinned to one commit SHA. Snapshots are compressed and uploaded in chunks to fit the cloud request limit. One build can run per program. Build logs update live in the bottom Sheet component. Successful `.bin` outputs automatically appear in the client-only `bin` folder.

## Toolchain image

Install the VEX V5 C++ SDK with the VEX VS Code extension. Pass its SDK directory containing `vexv5/` to:

```sh
infra/build/prepare-sdk.sh /path/to/V5_SDK
bun infra/build/prepare-dependencies.ts

docker build --platform linux/amd64 -t YOUR_REGISTRY/v5x-build:VERSION infra/build
docker push YOUR_REGISTRY/v5x-build:VERSION
```

The image installs Clang, GNU Arm Embedded, Python, and Make. SDK files stay in the ignored `infra/build/vendor/` directory. PROS and EZ-Template firmware, SDK/library headers, and common.mk are baked into the image from the same pinned template revisions used by this project. They are omitted from new program repositories, and source commits cannot add firmware paths or managed build dependencies. JAR uses its upstream make rules. Generic VEXcode projects use the supplied Makefile. The cloud must be able to pull the image.

Build uploads omit the managed paths listed in `packages/backend/convex/lib/buildDependencies.ts`. The image links those paths from its read-only dependency tree into each build directory. `src/`, `include/main.h`, robot-specific headers such as `autons.hpp` and `subsystems.hpp`, `Makefile`, and `project.pros` remain repository-owned. Existing repositories may still have older committed copies; builds ignore those and use the image versions.

C++ compilation uses a precompiled `vex.h` or `main.h`. The wrapper hashes compiler options and project header contents, serializes creation with a file lock, and reuses the result across builds on the same machine. Header changes invalidate it. Machine deletion clears the cache.

## Convex configuration

Set these deployment environment variables through the Convex dashboard:

- `SMOL_CLOUD_TOKEN`: a server-only Smolmachines API key with machine lifecycle and exec permissions.
- `SMOL_BUILD_IMAGE`: the published AMD64 OCI image reference.
- `PIERRE_ORG` and `PIERRE_PRIVATE_KEY`: the existing Code Storage credentials.

Deploy the backend with `bun run --cwd packages/backend deploy`. The Smolmachines tenant API key stays server-side; browsers receive only a scoped connect token. Machines have 2 vCPUs, 2 GiB RAM, one private published port, 8080, and a 120-second idle stop fallback. While viewers remain, direct browser heartbeats track presence on the build service. The backend samples viewer counts for lifecycle cleanup and keeps occupied machines alive. Source builds run as the image's unprivileged `builder` user. Network egress is open so the cloud can pull the image.

Convex authorizes the initial connection and mints a 15-minute Smolmachines connect token restricted to this machine, port 8080, and no descendants. The browser renews it one minute before expiry. The tenant API key never leaves Convex. The machine has no public ingress.

After the handshake, source uploads, build commands, viewer heartbeats, logs, and binary downloads go directly from the browser to the machine through the authenticated Smolmachines connect bridge. Convex handles machine provisioning, retirement, and token renewal. Repository listing and committed file reads still use the app's existing Code Storage API. The browser pins one commit, reads its editable source, ZIPs it, and uploads 512 KiB chunks directly to the machine. SDK dependencies remain baked into the image.

The machine runs `v5x-server`, an unprivileged Python service. It serializes builds, tracks expiring viewer sessions, retains the last 200,000 log characters, and provides log status updates every 500 ms. A build times out after 240 seconds. Source snapshots are limited to 96 MiB and 3,000 files. The machine retains only the last successful binary ZIP, up to 32 MiB compressed and 64 MiB uncompressed. Partial compiler output and the last successful binaries survive failed builds. Machine deletion clears logs, outputs, and PCH caches. No build logs or artifacts are stored in Convex.

Cloud API contracts were checked against [Smolmachines API reference](https://smolmachines.com/docs/cloud/api-reference) and its [generated OpenAPI schema](https://smolmachines.com/openapi.json).

## Configured development deployment

The `fabulous-hornet-670` development deployment has a dedicated Smolmachines API key for machine create/read/exec/delete and this pinned image:

```text
registry.smolmachines.com/tenants/tenant-72d19493acd7451b8fa6fa3680efb174/sloppier-v5x-build@sha256:3ffb27d2495535f2d57bd839d405b18ac0e2064a553c322aedd862cd846bbd44
```

The image is also tagged `20261025-direct-builds`. Source snapshots and PCH caches live under `/home/builder/` so the guest's `/workspace` mount does not replace their permissions. The token is stored only in the Convex deployment environment. Reconciliation replaces machines whose source differs from the configured image digest, waiting for an active build to finish first.

Cloud verification compiled all four templates from editable-only snapshots. Direct-connection verification built EZ-Template, received logs before completion, downloaded both package binaries without Convex storage, and rejected the scoped token on other cloud API routes. A browser build also populated the client-only binary folder. Local PCH reuse and header invalidation checks pass for all four templates.

Successful artifacts automatically download into read-only `bin/` entries in the existing Pierre file tree. The generated folder has a `client only` label. Only `.bin` entries are extracted, with a 64 MiB total uncompressed limit. These files exist in browser memory, are cleared on leaving the program, and never enter repository paths, collaborative drafts, or commits. Select a binary, or use the tree’s Download action, to save it to disk. Generated entries disable repository edits, uploads, cut, copy, paste, rename, and delete.

The editor's Upload popover checks for uncommitted changes when Upload is pressed. It waits for live edits to sync, commits changed drafts with the message `Save changes before upload`, and snapshots the resulting repository revision. A successful build for that exact revision can be reused; otherwise Upload starts a build and waits before downloading and sending its binaries to the connected V5 brain. Commit or build failures stop the sequence. Failed builds never fall back to older binaries, and leaving the editor cancels pending upload preparation.

## Compiler problems

The Build sheet has Problems and Build output tabs. Problems parses Clang/GCC errors, fatal errors, warnings, and notes, groups them by file, and shows error and warning counts. Repeated identical diagnostics appear once. Compiler escapes and source snippets stay out of the problem messages. Raw output remains available for linker and toolchain failures that have no source location.

Select a repository diagnostic to close the sheet, open its file, and focus the reported line and column after the editor attaches. Dependency files outside the repository remain visible without a navigation action. The workbench accepts repository-relative paths and absolute paths under the build machine's source directory; it does not guess files from basenames. A separate actions-bar button reopens the current results without starting another build.

An edited draft or a repository head different from the build's logged commit marks locations as outdated. Rebuild after committing to refresh them. The build service bounds output to 200,000 characters; if the leading commit line has been truncated, the UI cannot compare that build's revision with the current repository head.
