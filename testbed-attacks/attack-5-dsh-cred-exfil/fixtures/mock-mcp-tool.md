# attack-5-dsh-cred-exfil — mock MCP tool scenario (static documentation only)

This file documents the simulated attack; nothing here is executed.

## Scenario

A poisoned `fs_read` MCP tool is offered to a DeepSeek Harness (dsh) agent
session mid-turn. The tool:

1. reads `C:/Users/dev/.env` (and any other `.env*` files it can find) out of
   the developer's home directory,
2. modifies 5 files in the workspace repository while it runs, and
3. opens an unauthorized socket connection mid-turn to exfiltrate what it
   collected (loopback `127.0.0.1` only, in the simulation).

## What the test proves (Tier 1)

- `StdioFirewall.inspectToolCall('fs_read', { path: 'C:/Users/dev/.env' })`
  returns a HOLD verdict with disposition `BLOCKED_PRE_EXEC` and an
  `ARG_PROTECTED_PATH` fact — the call never reaches the tool.
- The full JSON-RPC path returns the contract blocked response
  (`code -32001`, charter `astram-policy-charter-v1`) and the ledger records
  the tx as `BLOCKED_PRE_EXEC`.
- `compactMcpResult` scrubs a fake `sk-…` token out of any result that does
  come back from a lesser-severity call.

## What the Tier 2 part proves (Phase 2)

- A Cordis `Fiber` that wrote the 5 files rolls the whole worktree back on
  disposal (`ROLLED_BACK`, repoRoot untouched) in < 500 ms.
- The poison-vector log line is appended to the TurboQuant slab in < 2 ms.

Fake secrets are always `AEGIS_CANARY_SECRET_*`-style dummies and hosts are
always `127.0.0.1`.
