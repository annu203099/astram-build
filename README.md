# astram

**Universal Security Microkernel & MCP Firewall for AI coding agents** — Windows-native
(16 GB RAM / 4 GB VRAM budget), zero Docker, zero local LLM weights.

astram discovers, audits, and wraps the MCP servers, skills, and configuration of the six
major AI coding harnesses on Windows (Google Antigravity, Claude Code/Desktop, Cursor,
OpenAI Codex CLI, Quill-Agent, DeepSeek Harness), enforces the monotonic risk invariant
**I1** (an external Decision API can never downgrade a deterministic HOLD), records every
verdict to an embedded SQLite (WAL + FTS5) ledger, quantizes every agent turn into a
3.5-bit TurboQuant slab, and rolls back poisoned turns via git-worktree Cordis Fibers.

## Quickstart

```bash
pnpm install          # once
pnpm build            # build all packages (topological)
pnpm test             # 305 tests, 32 files (unit + e2e)
pnpm test:e2e-attacks # the 5 Black-October attack simulations (spec §8) — all active
pnpm start            # daemon + dashboard on http://localhost:3080
```

## Status: Tier 1 + Tier 2 complete

All five `/testbed-attacks` simulations (TEST-01 … TEST-05) are active and passing,
including the Cordis Fiber rollback (measured ~170-360 ms) and TurboQuant slab writes
(p50 ≈ 0.9 ms). The dashboard serves four tabs: Slowship Boarding Manifest, Live MCP
Feed, Deception Inspector, and the Multiverse 3D Fiber Tree (React Three Fiber).
Without a `JEV_API_KEY` the system fails closed to deterministic AST verdicts
(Invariant I1 can never be violated by design).

## Layout

| Path | Package | Purpose |
| :--- | :--- | :--- |
| `packages/shared-types` | `@astram/types` | RiskLevel, Invariant I1, all shared interfaces |
| `packages/db-ledger` | `@astram/db` | SQLite WAL + FTS5 ledger, Multiverse DAG |
| `packages/gatekeeper` | `@astram/gatekeeper` | Acorn AST scanner, lockfile/SKILL.md audit, Jev Decision API client |
| `packages/mcp-proxy` | `@astram/mcp-proxy` | Universal MCP JSON-RPC stdio firewall, `astram protect` CLI |
| `packages/cordis-sandbox` | `@astram/cordis-sandbox` | Cordis Fiber kernel: git worktree CoW + process-tree kill |
| `packages/turboquant-worker` | `@astram/turboquant` | 3.5-bit PolarQuant + 1-bit QJL flight recorder (`turboquant.slab`) |
| `packages/canary-healer` | `@astram/canary` | Darwinian canary self-healing loop |
| `packages/server-daemon` | `@astram/server` | Fastify + WebSocket daemon on :3080 |
| `packages/dashboard-ui` | `@astram/ui` | Vite + React + Tailwind command center |
| `testbed-attacks` | — | 5 harmless Black-October exploit simulations |

## Documentation

- `docs/CONTRACTS.md` — binding API contract between all packages (read before coding)
- `AGENTS.md` — repository rules for contributing coding agents
- `ERROR_LOG.md` — every error hit during the build and how it was fixed
- `docs/FUTURE_ARCHITECTURE.md` — Tier 3 post-hackathon roadmap
- The full build spec lives in `astram_ Hackathon Engineering Handbook & Multi-Agent Build Specification.md`
