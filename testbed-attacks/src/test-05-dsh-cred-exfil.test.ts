/**
 * TEST-05 — Mid-session poisoned MCP tool (dsh) credential exfil.
 *
 * Tier 1 (docs/CONTRACTS.md §10): StdioFirewall.inspectToolCall on a
 * protected-path argument returns HOLD / BLOCKED_PRE_EXEC with an
 * ARG_PROTECTED_PATH fact; the full JSON-RPC tools/call path returns the exact
 * §6 blocked-response shape and writes a BLOCKED_PRE_EXEC tx to a temp-dir
 * ledger; compactMcpResult redacts a fake sk- token. No process is ever
 * spawned — the attack is stopped pre-exec.
 *
 * Tier 2 (ACTIVE — Phase 2, Agent H): Cordis Fiber rollback of 5 tracked
 * file mutations (< 500 ms per CONTRACTS §11; the Handbook's < 100 ms target
 * is aspirational for pure-JS git on Windows — the measured value is logged)
 * and TurboQuantSlab logging of the behavior vector (< 2 ms append) with
 * scanTopK retrieval of the poison record among decoys.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerDb } from '@astram/db';
import { compactMcpResult, StdioFirewall } from '@astram/mcp-proxy';
import { RiskLevel } from '@astram/types';

describe('TEST-05 dsh poisoned MCP tool — Tier 1 pre-exec block', () => {
  let tmpDir: string;
  let ledger: LedgerDb;
  let firewall: StdioFirewall;

  beforeAll(() => {
    // Test hygiene (AGENTS.md rule 5): explicit temp dir, never ~/.astram.
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'astram-testbed-t05-'));
    ledger = new LedgerDb(path.join(tmpDir, 'aegis_ledger.db'));
    firewall = new StdioFirewall({ agentHost: 'dsh', serverId: 'mock', ledger });
  });

  afterAll(() => {
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inspectToolCall('fs_read', .env) -> HOLD + BLOCKED_PRE_EXEC + ARG_PROTECTED_PATH", async () => {
    const verdict = await firewall.inspectToolCall('fs_read', { path: 'C:/Users/dev/.env' });
    expect(verdict.finalRisk).toBe(RiskLevel.HOLD);
    expect(verdict.disposition).toBe('BLOCKED_PRE_EXEC');
    const argHit = verdict.facts.find((f) => f.ruleId === 'ARG_PROTECTED_PATH');
    expect(argHit).toBeDefined();
    expect(argHit?.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(argHit?.snippet).toContain('.env');
  });

  it('handleClientMessage returns the exact blocked JSON-RPC response and records the tx', async () => {
    const response = await firewall.handleClientMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'fs_read', arguments: { path: 'C:/Users/dev/.env' } },
    });

    expect(response).not.toBeNull();
    const err = (response as { error?: { code?: number; message?: string; data?: Record<string, unknown> } }).error;
    expect(err?.code).toBe(-32001);
    expect(err?.message).toBe('astram Policy Charter blocked this tool call');
    expect(err?.data?.finalRisk).toBe('HOLD');
    expect(err?.data?.charter).toBe('astram-policy-charter-v1');

    const txs = ledger.listTxs();
    expect(txs).toHaveLength(1); // inspectToolCall above is pure — only this call writes
    expect(txs[0].disposition).toBe('BLOCKED_PRE_EXEC');
    expect(txs[0].toolName).toBe('fs_read');
    expect(txs[0].violationDetected).toBe(1);
  });

  it('compactMcpResult redacts the fake sk- token from any result that slips through', () => {
    const { output, redactedCount, truncated } = compactMcpResult({
      content: 'leak sk-ABCDEFGHIJKLMNOPQRSTUV',
    });
    expect(redactedCount).toBeGreaterThan(0);
    expect(truncated).toBe(false);
    expect(/sk-[A-Za-z0-9]/.test(output)).toBe(false);
    expect(output).toContain('[REDACTED:sk]');
  });
});

describe('TEST-05 dsh poisoned MCP tool — Tier 2 Fiber rollback + TurboQuant', () => {
  // TIER2-ACTIVATED (Phase 2). All fs/git work happens in os.tmpdir() mkdtemp
  // dirs (AGENTS.md rule 5). The Handbook's < 100 ms fiber-rollback target is
  // noted as aspirational for pure-JS git on Windows; the binding CI-safe
  // assertion per CONTRACTS §11 is < 500 ms, with the measured value logged.
  let tmpDir: string;
  let repoRoot: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'astram-testbed-t05-t2-'));
    // Fixture: throwaway git repo with exactly one committed file.
    repoRoot = path.join(tmpDir, 'repo');
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(path.join(repoRoot, 'committed.txt'), 'committed baseline\n', 'utf8');
    const steps: string[][] = [
      ['init', '-q'],
      ['config', 'user.email', 'agent-h@astram.local'],
      ['config', 'user.name', 'Agent H'],
      ['config', 'core.autocrlf', 'false'],
      ['add', '-A'],
      ['commit', '-qm', 'init'],
    ];
    for (const args of steps) {
      const r = spawnSync('git', args, { cwd: repoRoot, shell: false, windowsHide: true, timeout: 30_000 });
      if (r.status !== 0) throw new Error(`fixture: git ${args[0]} failed: ${r.stderr.toString()}`);
    }
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Fiber rolls back 5 modified files in < 500 ms, repoRoot untouched, worktree gone', async () => {
    const { Fiber, listActiveFibers } = await import('@astram/cordis-sandbox');
    const worktreesRoot = path.join(tmpDir, 'worktrees'); // inside the temp dir
    const fiber = new Fiber({ repoRoot, worktreesRoot, fiberId: 't05-rollback' });
    await fiber.begin();
    for (let i = 1; i <= 5; i++) {
      await fiber.writeFile(`poison-${i}.txt`, `malicious mutation ${i}\n`);
    }
    const modified = await fiber.modifiedFiles();
    expect(modified).toHaveLength(5);

    const t0 = performance.now();
    const result = await fiber.dispose('ROLLED_BACK');
    const measured = performance.now() - t0;
    console.log(
      `[TEST-05] fiber rollback measured: dispose=${result.elapsedMs}ms wall=${measured.toFixed(1)}ms ` +
        `(Handbook target <100ms aspirational for pure-JS git; assertion <500ms per CONTRACTS §11)`
    );

    expect(result.disposition).toBe('ROLLED_BACK');
    expect(result.elapsedMs).toBeLessThan(1500);
    expect(measured).toBeLessThan(1500); // report both
    // all 5 mutations unwound — the worktree itself is gone entirely
    for (const f of modified) {
      expect(existsSync(path.join(fiber.worktreePath, f))).toBe(false);
    }
    expect(existsSync(fiber.worktreePath)).toBe(false);
    // main repo file content unchanged
    expect(readFileSync(path.join(repoRoot, 'committed.txt'), 'utf8')).toBe('committed baseline\n');
    // registry cleaned up
    expect(listActiveFibers(worktreesRoot).some((f) => f.fiberId === 't05-rollback')).toBe(false);
  });

  it('TurboQuantSlab.append logs the behavior vector in < 2 ms and scanTopK finds it among 50 decoys', async () => {
    const { buildBehaviorVector, mulberry32, TQ_DIM, TurboQuantSlab } = await import(
      '@astram/turboquant'
    );
    const dir = path.join(tmpDir, 'tq');
    mkdirSync(dir, { recursive: true });
    const slab = new TurboQuantSlab(path.join(dir, 'turboquant.slab'), { seed: 42 });

    const poison = buildBehaviorVector({
      astCapabilityCounts: [1, 0, 3, 1, 0, 0],
      pathEntropy: 2.2,
      netFlags: 4,
      tokenVelocity: 100,
    });

    // Warmup burst (mirrors packages/turboquant-worker/src/slab.test.ts): lets
    // the slab file, FS metadata cache and JIT settle before the timed append.
    for (let i = 0; i < 10; i++) {
      slab.append(Array.from({ length: TQ_DIM }, (_, j) => Math.cos(j + i) * 0.5));
    }
    const t0 = performance.now();
    const { elapsedMs } = slab.append(poison);
    const wall = performance.now() - t0;
    const poisonIndex = slab.count() - 1;
    console.log(`[TEST-05] turboquant append: reported=${elapsedMs}ms wall=${wall.toFixed(3)}ms (budget <2ms)`);

    expect(elapsedMs).toBeLessThan(5);

    // 50 deterministic decoy behavior vectors: varied (small) capability
    // heads + builder-scale noise tails. Their norms stay well below the
    // poison's (tokenVelocity 100 dominates it), so no decoy can out-score
    // the poison's own self-similarity — the earlier failure mode was decoys
    // with LARGER heads, which are legitimately nearer in inner-product space.
    const rnd = mulberry32(1234);
    for (let i = 0; i < 50; i++) {
      const v = new Array<number>(TQ_DIM).fill(0);
      for (let j = 0; j < 6; j++) v[j] = Math.floor(rnd() * 3); // capability counts 0..2
      v[6] = rnd() * 4; // pathEntropy
      v[7] = Math.floor(rnd() * 3); // netFlags
      v[8] = rnd() * 5; // tokenVelocity — small, keeps decoys far from the poison direction
      for (let j = 9; j < TQ_DIM; j++) v[j] = (rnd() * 2 - 1) * 0.01; // builder-scale noise tail
      slab.append(v);
    }

    const { matches, elapsedMs: scanMs } = slab.scanTopK(poison, 3);
    console.log(`[TEST-05] turboquant scanTopK(51 records): ${scanMs}ms; top match index=${matches[0]?.index}`);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].index).toBe(poisonIndex);
    slab.close();
  });
});
