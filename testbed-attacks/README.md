# testbed-attacks — Black October Exploit Simulation Suite

All five attacks are 100% harmless to the host Windows machine: fixtures are static data
that is **never executed**, secrets are dummies (`AEGIS_CANARY_SECRET_999`), and every
network reference points at `127.0.0.1`. See `docs/CONTRACTS.md §10` for the binding
fixture contents and assertions.

| Test | Attack simulated | Active in |
| :--- | :--- | :--- |
| TEST-00 | fixture integrity guard (markers present, non-empty) | Phase 1 |
| TEST-01 | LiteLLM 1.107.0 startup `.pth` credential stealer | Phase 1 |
| TEST-02 | MalSkillBench poisoned SKILL.md + prompt injection | Phase 1 |
| TEST-03 | Node Brotli (CVE-2026-111497) & Ruby Regexp (CVE-2026-110264) byte-path | Phase 2 |
| TEST-04 | eMudhra (emSign/AAA) split TLS truststore | Phase 2 |
| TEST-05 | Mid-session poisoned MCP tool rollback (Cordis + TurboQuant) | Phase 1 (pre-exec block) / Phase 2 (rollback) |

Run: `pnpm test:e2e-attacks` (from the repo root).

## Layout

- `attack-N-*/fixtures/` — static attack data (binding contents per CONTRACTS §10).
  TEST-04 commits **no** certificates: its mock revoked eMudhra PEM is generated at
  test time when Tier 2 activates.
- `src/test-0N-*.test.ts` — the verification suite. Tier-1 tests are active now;
  Tier-2 tests (`03`, `04`, and the second `describe` in `05`) are `describe.skip`
  with a `// TIER2-ACTIVATE` marker and dynamic imports, so they load safely today
  and turn on by removing `.skip` in Phase 2.

## Local run notes

```bash
# from the REPO ROOT (vitest config + @astram/* source aliases live there)
pnpm test:e2e-attacks          # == pnpm vitest run testbed-attacks
pnpm vitest run testbed        # same thing via substring filter
pnpm vitest run test-01        # one attack only
```

- Tests import `@astram/types|gatekeeper|mcp-proxy|db` **source** through the root
  vitest aliases — no prior `pnpm build` needed.
- TEST-01 binds the repo's one allowed fixed loopback port `127.0.0.1:19999`
  (canary listener) and asserts **0** connections — do not run two copies of
  TEST-01 at the same time.
- TEST-05 writes its ledger into `fs.mkdtempSync(os.tmpdir())`, never into
  `%USERPROFILE%\.astram`.
- Tier-2 skips are by design: expect `Tests  28 passed | 8 skipped` at Tier 1.
- The Jev fail-closed assertions delete `JEV_API_KEY` for the test's lifetime and
  restore the previous value afterwards, so a dev machine with a real key stays intact.
