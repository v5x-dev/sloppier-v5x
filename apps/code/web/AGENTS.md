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

For recordings and visual checks of the editor, use the actual Program route
and workbench. If the user requests a fake Brain, simulate the device at the
connection or transport boundary while exercising the real connection, build,
upload, and revision-check flows. Do not replace the editor, Builder workflow,
or revision check with a fabricated page or fixed sequence of UI states. Exercise
the button and keyboard entry points, progress, completion, and the repeated
upload result; include errors where relevant. Verify the saved recording shows
those states before presenting it. If setup fails, investigate the documented
demo environment and browser diagnostics before concluding it is blocked.

For quick visual review, run `bun run demo:visual` from this app. It prints a
dashboard URL and a seeded Program URL after the local server is ready. For
parallel screenshot checks, start this demo once and give each read-only
reviewer one state and one separate browser tab. Useful states are the Programs
dashboard, the new-Program dialog, the Program editor, and Program history.
Have each reviewer save and inspect a screenshot of the requested state outside
tracked source, then report its path and any missing or loading UI. Do not have
parallel reviewers start separate demo sessions on the shared development
deployment or make simultaneous edits to the fixture Program.

When using `agent-browser`, use a distinct named session per reviewer rather
than the default shared session.
