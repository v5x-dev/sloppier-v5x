# Live editing

Files in `apps/code` use Yjs text documents, the Pierre editor, and authenticated Convex subscriptions. Workspace members who open the same file share edits and see named cursors and selections. Undo and redo affect the current editor's changes.

The first open reads the source from Code Storage. A Convex transaction inserts its initial Yjs update once, even when several people open it together. Clients replay the ordered update log in bounded pages before enabling editing. Each client maintains a second document containing only acknowledged server updates, then sends the difference after a 250 ms batching window. Retries reuse the same update ID and bytes. The backend rejects ID reuse with different contents, malformed updates, and writes addressed to a replaced document.

IndexedDB stores the local document under the signed-in user and server document ID. Edits made while an already-open editor is offline remain available and merge when the connection returns. Reloading requires an initial server connection before the editor opens and restores its local document. Browser storage may be cleared by the browser or user, so it is not a substitute for a server acknowledgement. Closing a file with unsynchronized changes is blocked, and leaving the page prompts the browser's unsaved-changes warning.

Live autosave and source commits are separate. Convex accepts live updates first, then scheduled actions back up their bytes to `.v5x/*.bin` in Code Storage. The status distinguishes pending live saves from pending repository backup. Backup failures offer a retry. The Commit action writes the current source text to the repository; it waits for live synchronization. A commit captures the text at the moment it starts, and later edits remain dirty.

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
