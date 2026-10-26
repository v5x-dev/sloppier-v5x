# Persisting collaborative code with Code Storage

Research note, 2026-10-23.

## Finding

Code Storage can persist serialized CRDT snapshots or update bytes as ordinary Git file blobs. Its documented model is repositories, refs, commits, trees, and files, with no CRDT-aware API. Writes create Git commits, and the documented realtime notifications are webhooks after a push. The selected implementation keeps Convex as the live update and presence channel, then commits every accepted binary CRDT update to a unique `.v5x/*.bin` path in the same Code Storage repo as the program files. ([Introduction](https://code.storage/docs/getting-started/introduction), [webhooks](https://code.storage/docs/repos/webhooks.md))

That choice makes the latest Code Storage tree contain the complete update log and Git history preserve each update. It also creates one Git commit per CRDT update, so the editor client should batch its CRDT updates at a sensible cadence. The backend retries branch-tip conflicts and records whether each update has reached Code Storage.

## Storage model and limits

- The TypeScript SDK's `createCommit()` accepts bytes, buffers, readable streams, and async iterables with `addFile()`. `addFileFromString()` is for UTF-8. The HTTP commit endpoint streams NDJSON metadata and base64 blob chunks; each decoded chunk is limited to 4 MiB. The SDK also chunks streamed files into 4 MiB segments. ([SDK commit API](https://code.storage/docs/sdk/repos/commit-pack.md), [HTTP commit API](https://code.storage/docs/api/repos/commit-pack.md))
- The file read API returns raw `application/octet-stream` bytes, can read a branch, tag, or commit, and supports byte ranges and ETag validators. A saved CRDT snapshot could therefore live at a path such as `.crdt/<document-id>.bin`. ([file read API](https://code.storage/docs/api/repos/file-get.md))
- The homepage lists a 32 TB repository size and unlimited total storage. The regular commit API docs give the 4 MiB chunk limit but no maximum aggregate file or commit size. Git LFS supports files up to 5 GiB each, but the documented LFS path uses Git over HTTPS and the `git-lfs` client; the SDK docs do not say `addFile()` automatically routes files through LFS. LFS is unavailable on public GitHub sync and generic HTTPS Git sync repositories. ([Code Storage limits](https://code.storage/), [Git LFS](https://code.storage/docs/repos/git-lfs.md))
- Each commit has a SHA and updates a branch ref. `expectedHeadSha` provides a branch-tip guard; a stale write is rejected with a `RefUpdateError`, so callers must serialize or retry snapshot writes. Storage JWTs can be restricted to one repository and scopes such as `git:read` and `git:write`. ([SDK commit API](https://code.storage/docs/sdk/repos/commit-pack.md), [access and permissions](https://code.storage/docs/repos/access.md))

## Suggested app architecture

1. Use WorkOS AuthKit with Convex's first-party AuthKit integration. Convex validates the user's identity; Convex functions check workspace membership before any storage action. Keep the Code Storage signing key in the backend and use it only from Convex Node actions. ([Convex AuthKit](https://docs.convex.dev/auth/authkit/), [Code Storage permissions](https://code.storage/docs/repos/access.md))
2. Keep the active CRDT update exchange and presence in Convex. Authenticated mutations append opaque binary updates and reactive queries distribute them. The Convex Presence component tracks file-room heartbeats and caret data. ([Convex realtime](https://docs.convex.dev/realtime), [Convex Presence](https://github.com/get-convex/presence))
3. After Convex accepts an update, a scheduled Node action commits its bytes to `.v5x/<document-id>-<sequence>.bin` in the program's Code Storage repository. Normal source files use the same `main` branch through separate batch commits. Replaying the `.v5x` binary files is the client's CRDT responsibility because Code Storage does not understand their format.
4. Map the latest presence selection list to Pierre's `editor.setCarets()` after the editor attaches. That API is render-only: it does not synchronize edits, documents, selections, or presence. Each call replaces the whole remote-caret list; positions are zero-based `anchor`/`focus` values, and an empty list clears carets. ([Pierre Edit docs source](https://github.com/pierrecomputer/pierre/blob/99c888183425802a31c56c044450515aeb7b6b31/apps/docs/app/%28diffs%29/docs/Edit/content.mdx))

## Open API questions

The docs do not specify a maximum regular-file blob size, maximum aggregate commit size, or commit-latency target. The API reference documents dynamic capacity and `429` responses with `Retry-After`, while the homepage claims unlimited request rates. Code Storage webhooks report Git pushes, so they cannot carry the live edit stream. The upstream PROS and EZ-Template archives contain firmware blobs, but program repositories omit managed firmware and the build image supplies it. ([API overview](https://code.storage/docs/api/overview.md), [webhooks](https://code.storage/docs/repos/webhooks.md), [Git LFS](https://code.storage/docs/repos/git-lfs.md))
