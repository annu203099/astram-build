import { describe, expect, it } from 'vitest';
import {
  RiskLevel,
  enforceInvariantI1,
  isProtectedPath,
  maxDeterministicRisk,
  newTxId,
  riskFromName,
  riskToName,
  resolveAstramHome,
  KNOWN_BAD_PACKAGES,
} from './index.js';

describe('enforceInvariantI1 (Handbook Invariant I1)', () => {
  it('never lowers a deterministic HOLD, regardless of delta', () => {
    for (const delta of [-1, -5, 0, 1, 99, -99, 0.7, -0.9, NaN]) {
      expect(enforceInvariantI1(RiskLevel.HOLD, delta)).toBe(RiskLevel.HOLD);
    }
  });

  it('clamps adjustments to ±1 step for non-HOLD baselines', () => {
    expect(enforceInvariantI1(RiskLevel.PASS, 1)).toBe(RiskLevel.WARN);
    expect(enforceInvariantI1(RiskLevel.PASS, 5)).toBe(RiskLevel.WARN); // clamped to +1
    expect(enforceInvariantI1(RiskLevel.WARN, 1)).toBe(RiskLevel.HOLD);
    expect(enforceInvariantI1(RiskLevel.WARN, -1)).toBe(RiskLevel.PASS);
    expect(enforceInvariantI1(RiskLevel.PASS, -1)).toBe(RiskLevel.PASS); // floored at PASS
    expect(enforceInvariantI1(RiskLevel.PASS, -5)).toBe(RiskLevel.PASS);
  });

  it('truncates fractional deltas and treats junk as 0', () => {
    expect(enforceInvariantI1(RiskLevel.PASS, 0.9)).toBe(RiskLevel.PASS);
    expect(enforceInvariantI1(RiskLevel.PASS, 1.9)).toBe(RiskLevel.WARN);
    expect(enforceInvariantI1(RiskLevel.PASS, NaN)).toBe(RiskLevel.PASS);
    expect(enforceInvariantI1(RiskLevel.PASS, undefined as unknown as number)).toBe(RiskLevel.PASS);
  });
});

describe('risk helpers', () => {
  it('round-trips names', () => {
    for (const r of [RiskLevel.PASS, RiskLevel.WARN, RiskLevel.HOLD]) {
      expect(riskFromName(riskToName(r))).toBe(r);
    }
    expect(riskToName(RiskLevel.HOLD)).toBe('HOLD');
  });

  it('maxDeterministicRisk reduces over facts', () => {
    expect(maxDeterministicRisk([])).toBe(RiskLevel.PASS);
    const facts = [
      { ruleId: 'a', deterministicRisk: RiskLevel.PASS },
      { ruleId: 'b', deterministicRisk: RiskLevel.HOLD },
      { ruleId: 'c', deterministicRisk: RiskLevel.WARN },
    ] as never[];
    expect(maxDeterministicRisk(facts)).toBe(RiskLevel.HOLD);
  });
});

describe('isProtectedPath (Handbook §5.4 denylist)', () => {
  it('flags .env and variants but not .env.example', () => {
    expect(isProtectedPath('.env')).toEqual({ protected: true, rule: 'ENV_FILE' });
    expect(isProtectedPath('C:\\Users\\dev\\project\\.env')).toEqual({ protected: true, rule: 'ENV_FILE' });
    expect(isProtectedPath('C:/Users/dev/project/.env.local')).toEqual({ protected: true, rule: 'ENV_FILE' });
    expect(isProtectedPath('.env.example').protected).toBe(false);
    expect(isProtectedPath('src/env.ts').protected).toBe(false);
  });

  it('flags Antigravity oauth tokens and Codex auth.json', () => {
    expect(isProtectedPath('%USERPROFILE%/.gemini/antigravity/mcp_oauth_tokens.json')).toEqual({
      protected: true,
      rule: 'ANTIGRAVITY_OAUTH_TOKENS',
    });
    expect(isProtectedPath('C:\\Users\\dev\\.codex\\auth.json')).toEqual({ protected: true, rule: 'CODEX_AUTH' });
    expect(isProtectedPath('C:/Users/dev/.codex/config.toml').protected).toBe(false);
  });

  it('flags credential directories', () => {
    expect(isProtectedPath('~/.ssh/id_rsa')).toEqual({ protected: true, rule: 'SSH_DIR' });
    expect(isProtectedPath('C:\\Users\\dev\\.aws\\credentials')).toEqual({ protected: true, rule: 'AWS_DIR' });
    expect(isProtectedPath('/home/x/.gnupg/pubring.kbx').protected).toBe(true);
  });

  it('flags Claude Desktop config dir but not unrelated Claude paths', () => {
    expect(
      isProtectedPath('C:/Users/dev/AppData/Roaming/Claude/claude_desktop_config.json').protected
    ).toBe(true);
    expect(isProtectedPath('C:/dev/Claude/projects/notes.txt').protected).toBe(false);
  });

  it('is safe on junk input', () => {
    expect(isProtectedPath('').protected).toBe(false);
    expect(isProtectedPath('package.json').protected).toBe(false);
  });
});

describe('newTxId / resolveAstramHome', () => {
  it('is deterministic and 64 hex chars', () => {
    const a = newTxId({ tool: 'x' });
    expect(a).toBe(newTxId({ tool: 'x' }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newTxId({ tool: 'x' })).not.toBe(newTxId({ tool: 'y' }));
  });

  it('respects ASTRAM_HOME override', () => {
    const prev = process.env.ASTRAM_HOME;
    process.env.ASTRAM_HOME = 'X:/tmp-astram-home';
    try {
      expect(resolveAstramHome()).toBe('X:/tmp-astram-home');
    } finally {
      if (prev === undefined) delete process.env.ASTRAM_HOME;
      else process.env.ASTRAM_HOME = prev;
    }
  });
});

describe('KNOWN_BAD_PACKAGES seed', () => {
  it('contains the litellm Black October advisory', () => {
    const litellm = KNOWN_BAD_PACKAGES.find((p) => p.name === 'litellm');
    expect(litellm).toBeDefined();
    expect(litellm!.versionRange).toBe('<=1.107.0');
    expect(litellm!.risk).toBe(RiskLevel.HOLD);
  });
});
