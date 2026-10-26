# Live editing

Files in `apps/code` use Yjs text documents, the Pierre editor, and authenticated Convex subscriptions. Workspace members who open the same file share edits and see named cursors and selections. Undo and redo affect the current editor's changes.

The first open reads the source from Code Storage. A Convex transaction inserts its initial Yjs update once, even when several people open it together. Clients replay the ordered update log in bounded pages before enabling editing. Each client maintains a second document containing only acknowledged server updates, then sends the difference after a 250 ms batching window. Retries reuse the same update ID and bytes. The backend rejects ID reuse with different contents, malformed updates, and writes addressed to a replaced document.

IndexedDB stores the local document under the signed-in user and server document ID. Edits made while an already-open editor is offline remain available and merge when the connection returns. Reloading requires an initial server connection before the editor opens and restores its local document. Browser storage may be cleared by the browser or user, so it is not a substitute for a server acknowledgement. Closing a file with unsynchronized changes is blocked, and leaving the page prompts the browser's unsaved-changes warning.

Live autosave and source commits are separate. Convex accepts live updates first, then one durable worker per repository backs up their bytes to `.v5x/*.bin` in Code Storage. The worker batches up to 50 updates and 512 KiB per commit, retries transient failures with backoff, and drains edits received during the previous commit. A generation check rejects acknowledgements from stale workers; a watchdog restarts interrupted actions after the Node action timeout. Backup commits do not rewrite the project metadata read by every editor. The status distinguishes pending live saves from pending repository backup. Backup failures offer a retry. The Commit action writes the current source text to the repository; it waits for live synchronization. A commit captures the text at the moment it starts, and later edits remain dirty.

Presence uses a separate session per editor, including separate tabs signed in as the same user. Awareness carries Yjs relative cursor positions, which follow concurrent text edits. Heartbeats run every 10 seconds; expired sessions disappear after roughly 35 seconds while other clients are connected. Presence subscriptions never expose room or session tokens. Workspace membership protects every public read and write.

UTF-8 text files up to 256 KiB support live editing. Binary files and larger files have read-only previews, capped at 512 KiB. An individual encoded update is limited to 512 KiB. Very large offline histories may exceed that update limit; the editor reports the failure and retains the local document rather than claiming it saved. The update log is paginated but not compacted, so reopening documents with very long histories requires replaying those histories.

Deleting a repository file invalidates its live document. Recreating the same path gets a new document ID and a separate local cache. Old update rows are removed in scheduled batches; the repository's Git history retains their previous backups. Editors that observe a replacement stop accepting edits and ask the user to reopen the program.

Run checks from the repository root:

```sh
bun run --cwd apps/code/web test
bun run --cwd packages/backend test
bun run typecheck
bun run --cwd apps/code/web build
```

Backend tests cover membership, simultaneous initialization, retries, malformed updates, replacement, and paginated replay. Client tests cover concurrent insertions and deletions, acknowledgement during further typing, and undo isolation. Pierre adapter tests exercise its real TextDocument, replacement ranges, emoji offsets, and remote selections.

For a local four-account recording, run `node apps/code/web/scripts/collaboration-demo.mjs` from the repository root. This requires the backend's `.env.local` to select a `dev:` deployment and working Convex CLI credentials. The script registers an ephemeral public JWT key, creates a demo program and memberships for Alice, Ben, Clara, and Diego, and starts a loopback-only Vite server on port 3001. Open each printed URL in a separate browser session. The accounts use normal Convex authentication and workspace authorization. Tokens expire after one hour; the private signing key stays in process memory. Stop the script with Ctrl+C to clear the demo JWT provider settings. Demo workspace data remains available for inspection.

The frontend honors `VITE_CODE_DEMO_ACCOUNTS` only in Vite development mode. Never configure `CODE_DEMO_JWKS` or `CODE_DEMO_ISSUER` on a production deployment. These variables explicitly enable the additional JWT provider; ordinary WorkOS sign-in stays available.

## Program history

The actions bar's history button opens a popover with source commits, authors, timestamps, and paginated results. Select a commit to inspect changed files and unified Pierre diffs. Reserved `.v5x/` backup-only commits are omitted based on their changed paths. Large or binary diffs display a preview-unavailable message.

Restore file copies that file's contents from the selected commit into a new commit on `main`. It supports UTF-8 text up to 256 KiB, including files deleted from the current tree. To recover a file deleted in a historical commit, select an earlier commit where it exists. The popover requires local edits to be committed and synced, then shows the path and revision before restoration.

Open collaborative documents receive the restore as a normal Yjs replacement. Edits made concurrently after the restore snapshot remain mergeable. If saving succeeds but the live update fails, the popover reports that the commit exists and the program must be reopened. Restoring never rewinds the branch or removes earlier commits.

## Project search

The leftmost actions-bar button opens the search sheet on the right. Ctrl/Cmd + Shift + F opens it from the keyboard. Search matches literal text, with an optional case-sensitive toggle, and groups highlighted results by file. Select a match to open its file at the matching line and column.

Search combines committed files with collaborative documents and local editor drafts. It excludes reserved `.v5x/` files and displays up to 300 matches. Collaborative replay is bounded to 100 documents and 16 MiB per search; the sheet reports skipped files and truncated results. Search does not require a robot connection.

Search scope can be narrowed to source and header files, excluding bundled toolchain and library directories. The path field intersects that scope: `src/` searches a directory recursively, `*.cpp` matches filenames anywhere, and `src/**/*.cpp` matches nested paths. Both saved results and live drafts are filtered before applying the match limit.

Use Up/Down in the search field or result list to move the selected match into view, then Enter to open it. Arrow navigation from the search field keeps focus there so typing can continue. Changing the query or filters selects the first available result.

## Ownership and verification

`WorkbenchSource` owns workbench source identity and reconciliation. Commit captures the submitted text, so edits made during the write remain dirty. Explorer moves remap drafts, committed text, tabs, loaded editor identities, scroll positions, synchronization flags, and people together. Rendering subscribes to its snapshot; search and path previews subscribe separately to draft changes so typing in an already-dirty file does not rerender the whole workbench. Its tests use controlled repository writes to exercise moves, rejected writes, concurrent typing, restore warnings, and stale reads.

`createLiveFileSession` owns replay, local cache recovery, acknowledgements, backup status, presence, and disposal. The editor supplies a Pierre adapter after recovery and replay complete, and retains rendering, language registration, and browser navigation warnings. Session tests control subscriptions, cache hydration, and acknowledgements to verify lifecycle ordering without mounting the editor. Disposed sessions ignore late acknowledgements; replaced sessions keep their warning and stop writing.

History restoration and project search share `replayLiveDocument`. It checks document identity across pages, accounts for bytes even when replay fails, and rejects stalled pagination. Restore retains its 8 MiB limit and rejects failed replay. Search retains a shared 16 MiB budget, skips unreadable live documents, and suppresses their committed matches.
