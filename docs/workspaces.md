# Workspaces and team invitations

Use the avatar menu in the dashboard header to create and switch workspaces.
New workspaces make their creator the owner and an admin. New accounts also get a
Personal workspace automatically.

Admins open **Manage team** in the avatar menu to invite a teammate by email as a member
or admin. Both roles can work on every program in the workspace. Admins can also
manage invitations, change other members' roles, and remove members. The owner
cannot be removed or demoted. Admins cannot change their own access; another
admin must do it.

Admins can also upload or remove a workspace icon in **Manage team**. The icon
appears in the workspace switcher for all members. PNG, JPEG, WebP, and GIF
images up to 128 KB are supported.

Invitations expire after seven days. A recipient can accept an invitation from
**Invitations** in their avatar menu after signing in, or open the invitation link. The signed-in
account must have the exact invited email address, ignoring case, and that email
must be verified. Possessing a link alone does not grant access. Acceptance adds
membership and consumes the invitation in one transaction. An invitation never
changes an existing member's role. A revoked or consumed invitation cannot be
accepted again.

## Backend configuration

Deploy the Convex schema and functions together with the web app. Set
`WORKOS_API_KEY` in the Convex deployment, using the same WorkOS environment as
`WORKOS_CLIENT_ID`. AuthKit access tokens may omit email claims, so the backend
looks up the authenticated subject through WorkOS before showing or accepting
invitations. If the token already contains a signed, verified email claim, the
lookup is unnecessary. Email or verification status supplied by the browser is
never trusted.

To deliver invitation emails, configure these Convex environment variables:

- `RESEND_API_KEY`, a server-side Resend key.
- `WORKSPACE_INVITE_FROM`, a sender such as `Your team <invites@example.com>` on a
  domain verified in Resend.
- `APP_URL`, the public HTTPS origin of the web app, such as
  `https://code.example.com`. Local development may use `http://localhost:3000`.

Email delivery runs asynchronously. **Manage team** shows whether the provider
accepted the email, delivery failed, or email delivery is not configured. In all
cases, admins can copy the invitation link and share it themselves. Invitations
also appear under **Invitations** in the recipient's avatar menu once their account email is verified.
Email delivery failures do not grant membership or remove the invitation. Revoke
and create a new invitation to send another email.

Workspace member names and emails come from verified account profiles saved on
sign-in to the dashboard. Older members who have not opened it yet may appear as
"Team member" until their profile is synchronized.

Removal immediately prevents subsequent authorized Convex repository operations
and new build connections. An existing scoped build-machine connection token can
remain valid until its expiry, currently up to 15 minutes. Removing membership
does not erase files or copies already downloaded by that user.

## Verification

`bun run --cwd packages/backend test` covers invitation acceptance, verification,
expiry, revocation, email delivery failures, role changes, owner protection, and
cross-workspace authorization. Email provider calls are mocked. A deployment with
WorkOS and Resend configured is needed to check real email delivery and the full
hosted sign-in flow.
