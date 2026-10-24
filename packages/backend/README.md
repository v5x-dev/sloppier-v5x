# Shared backend

`@workspace/backend` is the shared Convex deployment for the web and mobile apps.
WorkOS AuthKit tokens authenticate users; workspace membership checks protect
programs, repository operations, live CRDT updates, and editor presence.
Run `bun run dev` from this package to link it to a Convex deployment and have
Convex regenerate the local function and component references.

## Program and repository lifecycle

Create a workspace with `workspaces.create`, then add collaborators using
`workspaces.addMember` with each collaborator's WorkOS subject as `userId`.
Create a program with
`projects.create({ workspaceId, template })`. The backend generates a dashed
name with `boring-name-generator`; callers can pass `name` to choose one
explicitly. Supported template IDs are `vexcode`, `jar`, `pros`, and
`ez-template`. The project record is created immediately with
`repositoryStatus: "provisioning"`. A Convex action then
creates a Code Storage repository named `programs/<projectId>`, writes the
template files to its `main` branch, and changes the status to `ready`. If the
import fails, the project is marked `failed`; members can call
`projects.retryProvisioning`.
Call `projects.listTemplates` to get the template IDs and display labels.

The JAR starter is pinned to a JAR-Template commit. PROS and EZ-Template use
the pinned EZ-Template 3.2.2 example archive: the PROS template keeps the PROS
4.1.1 kernel files, and the EZ template keeps its complete source and firmware
tree. The template research and first-party sources are in
[`docs/research/code-templates.md`](../../docs/research/code-templates.md).

## Files and live editing

- `codeStorage.listFiles` reads a page of up to 500 repository paths from Code
  Storage. Pass `nextCursor` back as `cursor` while `hasMore` is true.
- `codeStorage.readFile` reads a byte range, up to 512 KiB per call.
- `codeStorage.commitFiles` commits up to 100 source file changes at once, with
  an aggregate 512 KiB text limit. The `.v5x` directory is reserved.
- `crdt.appendUpdate` accepts an opaque binary CRDT update up to 512 KiB. It is
  stored in Convex immediately for reactive reads and asynchronously committed
  to Code Storage at `.v5x/<documentId>-<sequence>.bin`.
- `crdt.updatesSince` is the live Convex subscription point for replaying
  updates. It returns updates in sequence, bounded to 100 updates and 900 KiB
  per response; continue with the last returned sequence when `hasMore` is
  true. The backend does not interpret or merge the CRDT format.
- Each accepted CRDT update creates one Code Storage commit, so all update blobs
  remain in the repository tree and its Git history. Source files and CRDT
  blobs share the same `main` branch; branch-tip conflicts are retried.
- `presence.joinFile` starts a Convex Presence session. The client must call
  `presence.heartbeatFile` every `intervalMs` (10 seconds by default, with a
  permitted interval of 4–30 seconds) while the file is open. Call
  `presence.updateCarets` with that session ID and the editor offsets, then
  subscribe with `presence.listFile`. Each online entry's `data.carets`,
  `data.name`, and `data.color` can be mapped to the remote caret input for
  `@pierre/diffs/edit` `setCarets()`.

The CRDT update payload is an opaque binary contract: the client must send
updates from the same CRDT document and apply them in sequence. This backend
stores and distributes those bytes; it does not implement the editor-side CRDT
binding.

## Environment variables

Set these in each Convex deployment's environment settings:

| Variable             | Required | Purpose                                                                                                        |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`   | Yes      | AuthKit issuer/JWKS configuration in `convex/auth.config.ts`. Use the matching WorkOS environment's Client ID. |
| `PIERRE_ORG`         | Yes      | Code Storage organization name.                                                                                |
| `PIERRE_PRIVATE_KEY` | Yes      | Code Storage PKCS#8 PEM signing key. Keep it server-side.                                                      |

The web and mobile apps also need the Convex deployment URL and the public
WorkOS Client ID/redirect URI in their own app configuration. The backend does
not read `WORKOS_API_KEY`; add it only if a WorkOS Component or server-side
WorkOS API workflow is introduced.
