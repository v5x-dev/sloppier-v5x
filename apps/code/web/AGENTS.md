# Code web browser testing without sign-in

For an authenticated browser check without a WorkOS account, run
`node apps/code/web/scripts/completion-demo.mjs` from the repository root.
The script creates a signed demo identity and a disposable Program with a source
commit, then starts Vite on port 3001. Wait for the ready message and Program
provisioning, then open the printed Alice URL with `agent-browser`. Exercise the
actual controls; this tests Convex authentication and workspace membership, but
not the WorkOS sign-in callback.

Before starting, confirm that `packages/backend/.env.local` selects the intended
dedicated `dev:` deployment, that its `CODE_DEMO_ISSUER` and `CODE_DEMO_JWKS`
settings are empty, and that the web app points at the same deployment. The
script overwrites those settings and clears them on exit. Do not run concurrent
demo sessions or use a shared deployment with another demo provider. After
backend changes, sync the functions first with `bunx convex dev --once` from
`packages/backend`.

Stop the demo process with Ctrl+C, then verify that both demo settings are empty.
Remove the printed temporary credentials directory after the session; it contains
signed tokens and must not be committed. The demo workspace and Program remain
on the development deployment.
