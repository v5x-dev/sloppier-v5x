# Shared backend

Read [README.md](README.md) before setup, authentication, or deployment changes.
[Code's architecture map](../../docs/code-architecture.md) lists the public
contracts, callers, and verification paths.

`convex/codeStorage.ts` is a compatibility facade for deployed Code clients and
scheduled jobs. Implement capabilities in `convex/lib/codeStorage`; do not rename
or remove facade exports during a refactor. Each capability factory returns
registered functions only to the facade, avoiding duplicate public endpoints.
Keep Node-only storage dependencies in modules with `"use node"`.

For each backend change, record affected products/callers, server identity and
membership checks, compatibility with deployed clients, and the relevant tests.
For a breaking change, describe migration and rollout before removing the old API.
Run `bun run test` and `bun run typecheck` here plus affected app checks.
Regenerate API bindings with `bun run codegen`; do not edit generated files.
