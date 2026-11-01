# Code web

Read [README.md](README.md) for development, isolated browser tests, fixtures,
cleanup, and recordings. Read [the architecture map](../../../docs/code-architecture.md)
for state ownership and the critical-path verification matrix.

Use `bun run test:e2e:workos` and `bun run test:e2e:editor` for authenticated
integration checks against a temporary local backend. Use `bun run demo:visual`
for manual checks of the real app; open its printed URL and reported port.
Use a distinct named browser session for each independent collaborator.

For recordings, exercise the actual Program route, workbench, and requested
controls. Simulate external services and devices at their integration boundaries.
Inspect the recording for the requested states and report its accessible path;
do not substitute a reconstruction of the app. Keep artifacts outside tracked source.
