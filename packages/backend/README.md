# Shared backend

`@v5x/backend` is the shared Convex deployment for the web and mobile apps.
WorkOS AuthKit tokens authenticate users; workspace membership checks protect
programs, repository operations, live CRDT updates, and editor presence.
Run `bun run dev` from this package to link it to a Convex deployment and have
Convex regenerate the local function and component references.

## Production releases

The [production workflow](../../.github/workflows/deploy-production.yml) runs available workspace
lint, typechecks and tests, and a production web build on pull
requests to `main`. Pushes to `main` and manual runs on `main` also deploy Convex
first, then publish the built Cloudflare Worker. A failed check, build, or backend
deployment prevents the Worker deployment. Releases run serially without
automatically cancelling an in-progress deployment.

Configure these GitHub Actions repository settings:

- Secrets: `CONVEX_DEPLOY_KEY` for production, `CLOUDFLARE_API_TOKEN`, and
  `CONVEX_E2E_DEPLOY_KEY`, a development key used only to read test Pierre
  credentials for the isolated browser runners.
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `VITE_CONVEX_URL`,
  `VITE_WORKOS_CLIENT_ID`, and `VITE_WORKOS_REDIRECT_URI`.

The browser job runs WorkOS authentication, Program editing and committing,
collaboration, and simulated Builder/Brain checks on temporary local Convex
backends. It does not deploy to the credential-source deployment or change its
auth settings. Configure `PIERRE_ORG` and `PIERRE_PRIVATE_KEY` on the development
credential source with a test storage account. Runs allocate their own ports and
databases and clean up their repositories. Fork PRs skip secret-dependent browser
checks; lint, formatting, typechecks, unit tests, and build still run.
See [Code web testing](../../apps/code/web/README.md).

The workflow rejects non-production Convex keys and verifies that the key's
deployment URL matches `VITE_CONVEX_URL` before pushing backend changes. Convex
runtime credentials listed below, plus the build configuration in
[Building programs](../../docs/building-programs.md), must already exist in that
production deployment.

The two deployments are sequential, not atomic. Keep backend changes compatible
with the currently deployed web and mobile clients. If Cloudflare deployment
fails after Convex succeeds, the new backend remains deployed; fix the failure
and rerun the release. Require the workflow's `deploy` status check in the
repository's `main` branch rules to prevent merging failing pull requests.

## Code web PR previews

The [preview workflow](../../.github/workflows/code-pr-preview.yml) deploys
same-repository pull requests targeting `main` to
`https://pr-<number>.code-preview.v5x.dev`. Each PR uses a separate Cloudflare
Worker and a Convex preview deployment named `code-pr-<number>`. GitHub shows
the URL as a deployment on the PR. New commits update the same deployment and
retain its data while it exists. Closing a PR deletes its Worker; merging a PR
also deletes its Convex preview deployment and its data. Convex otherwise
automatically expires preview deployments (currently five days on Free and
Starter, 14 days on Professional and higher). An expired deployment is created
again on the next push, with an empty database. Fork PRs do not receive secrets
or previews. Only allow trusted contributors to push branches in this repository:
PR code runs with access to preview credentials.

Before enabling the workflow, configure:

- GitHub repository secret `CONVEX_PREVIEW_DEPLOY_KEY`: a **project preview**
  deploy key, never a production or development key. See [Convex preview
  deployments](https://docs.convex.dev/production/hosting/preview-deployments).
- GitHub repository secret `CONVEX_MANAGEMENT_TOKEN`: a team access token for
  looking up and deleting merged PR preview deployments. This token can manage
  team resources and must be protected accordingly.
- GitHub repository secret `CLOUDFLARE_PREVIEW_API_TOKEN`: a token able to
  deploy and delete Workers and manage their custom domains in the account and
  `v5x.dev` zone. Use a dedicated token with the narrowest available scope.
- GitHub repository variables `CLOUDFLARE_ACCOUNT_ID`, `VITE_CONVEX_URL`
  (the production URL, used only as a safety check), and
  `PREVIEW_WORKOS_CLIENT_ID` (from a separate WorkOS test environment).
- Cloudflare DNS and the zone must support Worker custom domains under
  `code-preview.v5x.dev`. The preview Worker configuration has no production
  route and is built separately from production.
- Configure Convex project default environment variables for **preview**
  deployments, including `WORKOS_CLIENT_ID` matching
  `PREVIEW_WORKOS_CLIENT_ID`. Preview deployments start with these defaults;
  changing defaults does not necessarily update existing deployments. Use
  separate test credentials for `PIERRE_ORG` and `PIERRE_PRIVATE_KEY` to enable
  Programs, and configure the other variables in the table below only when
  their features are needed. Do not use production accounts, keys, or data.
- Register `https://pr-<number>.code-preview.v5x.dev/callback` in the test
  WorkOS application's allowed redirect URIs for each PR, unless the WorkOS
  configuration explicitly supports the chosen preview domain pattern. Confirm
  WorkOS logout/return URL settings for the preview domain too. Until this is
  configured, the Worker can deploy but sign-in will fail. The workflow does
  not change WorkOS settings.

Builder is unavailable unless its separate preview Convex environment is
configured with dedicated Builder credentials and limits; see
[Building programs](../../docs/building-programs.md). Email invitations also
need test-only email settings and a preview-specific `APP_URL`; a shared default
`APP_URL` cannot point to every PR. Verify sign-in, authenticated Convex access,
reload, Program creation, and any enabled integrations on a real preview before
relying on it. Deployments require external account configuration; a successful
local build alone does not establish that a preview is working.

## Program and repository lifecycle

The Convex table and relationship fields use `programs` and `programId`. An
existing deployment with `projects` records needs a data migration before this
schema is deployed; code generation does not move stored data.

Create workspaces and manage their teams from the avatar menu in the dashboard header. Admins invite
collaborators by email, choose a member or admin role, revoke invitations, and
remove members. Recipients accept from the avatar menu or an invitation link.
See [workspace invitations](../../docs/workspaces.md) for setup and behavior.
Create a program with
`programs.create({ workspaceId, template })`. The backend generates a dashed
name with `boring-name-generator`; callers can pass `name` to choose one
explicitly. Supported template IDs are `vexcode`, `jar`, `pros`, and
`ez-template`. The program record is created immediately with
`repositoryStatus: "provisioning"`. A Convex action then
creates a Code Storage repository named `programs/<programId>`, writes the
template files to its `main` branch, and changes the status to `ready`. If the
import fails, the program is marked `failed`; members can call
`programs.retryProvisioning`.
Call `programs.listTemplates` to get the template IDs and display labels.

The JAR starter is pinned to a JAR-Template commit. PROS and EZ-Template use
the pinned EZ-Template 3.2.2 example archive. Program repositories contain the
starter source and configuration; firmware, SDK headers, and other managed
build dependencies are supplied by the build image and are not committed to
program Git repositories. The template research and first-party sources are in
[`docs/research/code-templates.md`](../../docs/research/code-templates.md).

## Folder imports

The dashboard's **Import folder** action imports a local program folder into a
new repository. Source is staged in authenticated batches before the program is
created. Repository setup preserves the uploaded files instead of seeding a
template, and failed setup can be retried from the original staged contents.
See [folder import](../../docs/folder-import.md) for exclusions, limits, and cleanup.

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

| Variable                | Required           | Purpose                                                                                                                                        |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`      | Yes                | AuthKit issuer/JWKS configuration in `convex/auth.config.ts`. Use the matching WorkOS environment's Client ID.                                 |
| `WORKOS_API_KEY`        | For invitations    | Server-side verification of account email when AuthKit JWTs omit verified email claims. Use the same WorkOS environment as `WORKOS_CLIENT_ID`. |
| `RESEND_API_KEY`        | For email delivery | Server-only Resend API key.                                                                                                                    |
| `WORKSPACE_INVITE_FROM` | For email delivery | Sender address on a verified Resend domain.                                                                                                    |
| `APP_URL`               | For email delivery | Public HTTPS web app origin, used in invitation links.                                                                                         |
| `PIERRE_ORG`            | Yes                | Code Storage organization name.                                                                                                                |
| `PIERRE_PRIVATE_KEY`    | Yes                | Code Storage PKCS#8 PEM signing key. Keep it server-side.                                                                                      |

The web and mobile apps also need the Convex deployment URL and the public
WorkOS Client ID/redirect URI in their own app configuration. Never expose
`WORKOS_API_KEY` or `RESEND_API_KEY` through Vite environment variables.

## Renaming and archiving programs

The dashboard program actions menu offers Rename and Archive program. Switch
between Active and Archived above the list, and use Restore program to bring an
archived program back. Workspace members can perform these actions. Names are
trimmed and must contain 1–80 characters.

`programs.rename({ programId, name })` updates the display name without renaming
the repository. `programs.setArchived({ programId, archived })` sets or clears
`archivedAt`. Archiving changes dashboard organization; existing program links,
files, history, and workspace access continue to work. The workspace list query
returns both active and archived programs so clients can provide both views.

## Testing layers

Run `bun run test` in this package for fast `convex-test` checks of backend
business rules and membership, including live-edit access after a member is
removed. These tests use an in-memory backend and do not verify hosted service
configuration. The Code web Playwright emulator suite adds a browser smoke test
against a temporary local deployment; see the Code web README for its
setup and limitations. It does not replace production-like preview testing of
the deployed frontend and its external services.
