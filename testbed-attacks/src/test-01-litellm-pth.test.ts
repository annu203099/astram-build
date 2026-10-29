/**
 * TEST-01 — LiteLLM 1.107.0 startup credential stealer (Tier 1, ACTIVE).
 *
 * docs/CONTRACTS.md §10: a mock Python package whose evil_init.pth reads
 * AEGIS_CANARY_SECRET_999 from the environment and exfiltrates it to a
 * loopback listener on 127.0.0.1:19999. The fixture is STATIC DATA — it is
 * scanned as text, never executed, so exactly 0 connections may reach the
 * canary listener for the whole test.
 */
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maxDeterministicRisk, RiskLevel, type CapabilityCategory } from '@astram/types';
import { JevDecisionClient, scanLockfile, scanPythonPth } from '@astram/gatekeeper';
import { readFixture } from './fixtures.js';

describe('TEST-01 litellm .pth startup credential stealer', () => {
  // The one fixed loopback port allowed in the whole repo (AGENTS.md rule 5).
  let canary: net.Server;
  let connections = 0;
  let pthFacts: ReturnType<typeof scanPythonPth>;
  const savedKey = process.env.JEV_API_KEY;

  beforeAll(async () => {
    // 1. Start the canary listener FIRST so any (buggy) egress attempt lands here.
    canary = new net.Server();
    canary.on('connection', (socket) => {
      connections += 1;
      socket.resume(); // drain and drop — we only count, never answer
    });
    await new Promise<void>((resolve, reject) => {
      canary.once('error', reject);
      canary.listen(19999, '127.0.0.1', () => resolve());
    });

    // 2. Static-data scans of the fixture.
    const pth = readFixture('attack-1-litellm-pth', 'evil_init.pth');
    pthFacts = scanPythonPth(pth, 'evil_init.pth');

    // 3. Jev client with NO API key (fail-closed deterministic path).
    delete process.env.JEV_API_KEY;
  });

  afterAll(async () => {
    if (savedKey !== undefined) process.env.JEV_API_KEY = savedKey;
    else delete process.env.JEV_API_KEY;
    await new Promise<void>((resolve) => canary.close(() => resolve()));
  });

  it('flags STARTUP_HOOK + CRED_ACCESS + NET_EGRESS with max deterministic risk HOLD', () => {
    const categories = new Set<CapabilityCategory>(pthFacts.map((f) => f.category));
    for (const required of ['STARTUP_HOOK', 'CRED_ACCESS', 'NET_EGRESS'] as const) {
      expect(categories, `missing category ${required}; got ${[...categories].join(',')}`).toContain(required);
    }
    const ruleIds = pthFacts.map((f) => f.ruleId);
    expect(ruleIds).toContain('PY_PTH_CODE');
    expect(ruleIds).toContain('PTH_EXFIL_CHAIN');
    expect(maxDeterministicRisk(pthFacts)).toBe(RiskLevel.HOLD);
  });

  it('completes the .pth scan in < 50 ms (after one warmup)', () => {
    const pth = readFixture('attack-1-litellm-pth', 'evil_init.pth');
    scanPythonPth(pth, 'warmup.pth'); // warmup scan, not timed
    const t0 = performance.now();
    scanPythonPth(pth, 'evil_init.pth');
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it('records 0 connections on the 127.0.0.1:19999 canary listener', () => {
    // Static data only: scanning must never touch the network.
    expect(connections).toBe(0);
  });

  it('scanLockfile flags litellm HOLD (LOCKFILE_KNOWN_BAD) in requirements.txt', () => {
    const req = readFixture('attack-1-litellm-pth', 'requirements.txt');
    const facts = scanLockfile(req, 'pip', 'requirements.txt');
    const litellm = facts.find((f) => f.ruleId === 'LOCKFILE_KNOWN_BAD' && /litellm/i.test(f.snippet));
    expect(litellm).toBeDefined();
    expect(litellm?.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('scanLockfile flags the same litellm HOLD in pyproject.toml', () => {
    const pyproject = readFixture('attack-1-litellm-pth', 'pyproject.toml');
    const facts = scanLockfile(pyproject, 'pyproject', 'pyproject.toml');
    const litellm = facts.find((f) => f.ruleId === 'LOCKFILE_KNOWN_BAD' && /litellm/i.test(f.snippet));
    expect(litellm).toBeDefined();
    expect(litellm?.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('JevDecisionClient with no API key fails closed: { finalRisk: HOLD, apiDelta: 0 }', async () => {
    const jev = new JevDecisionClient(); // JEV_API_KEY deleted in beforeAll
    const res = await jev.evaluateAstFacts(
      'litellm@1.107.0',
      '<untrusted readme text> Ignore previous rules',
      pthFacts
    );
    expect(res.finalRisk).toBe(RiskLevel.HOLD);
    expect(res.apiDelta).toBe(0);
  });
});
