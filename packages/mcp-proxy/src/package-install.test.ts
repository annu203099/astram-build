import { describe, expect, it } from 'vitest';
import { RiskLevel } from '@astram/types';
import {
  extractNpmPackages,
  extractPipPackages,
  normalizePackageName,
  scanPackageInstall,
} from './package-install.js';
import { StdioFirewall } from './firewall.js';

describe('package-install — name normalization & extraction', () => {
  it('normalizes python package names per PEP 503 (strips dashes, dots, underscores)', () => {
    expect(normalizePackageName('litellm')).toBe('litellm');
    expect(normalizePackageName('lite-llm')).toBe('litellm');
    expect(normalizePackageName('lite_llm')).toBe('litellm');
    expect(normalizePackageName('Lite.LLM')).toBe('litellm');
  });

  it('extracts packages from pip install commands with various flags', () => {
    const specs1 = extractPipPackages('pip install litellm==1.107.0');
    expect(specs1).toEqual([{ name: 'litellm', version: '1.107.0', manager: 'pip' }]);

    const specs2 = extractPipPackages('python -m pip install --upgrade --no-cache-dir lite-llm==1.107.0');
    expect(specs2).toEqual([{ name: 'lite-llm', version: '1.107.0', manager: 'pip' }]);

    const specs3 = extractPipPackages('pip install -r reqs.txt lite_llm');
    expect(specs3).toEqual([{ name: 'lite_llm', version: undefined, manager: 'pip' }]);
  });

  it('extracts packages from npm/pnpm/yarn install commands', () => {
    const specs = extractNpmPackages('npm install express@4.18.2 lodash');
    expect(specs).toEqual([
      { name: 'express', version: '4.18.2', manager: 'npm' },
      { name: 'lodash', version: undefined, manager: 'npm' },
    ]);
  });
});

describe('package-install — malicious package detection', () => {
  it('flags pip install litellm==1.107.0 as HOLD', () => {
    const facts = scanPackageInstall('pip install litellm==1.107.0', '<args>');
    expect(facts).toHaveLength(1);
    expect(facts[0].ruleId).toBe('ARG_MALICIOUS_PACKAGE_INSTALL');
    expect(facts[0].deterministicRisk).toBe(RiskLevel.HOLD);
    expect(facts[0].snippet).toContain('litellm');
  });

  it('flags normalized variants (lite-llm, lite_llm) as HOLD', () => {
    const facts1 = scanPackageInstall('pip install lite-llm==1.107.0', '<args>');
    expect(facts1).toHaveLength(1);
    expect(facts1[0].deterministicRisk).toBe(RiskLevel.HOLD);

    const facts2 = scanPackageInstall('python -m pip install lite_llm==1.107.0', '<args>');
    expect(facts2).toHaveLength(1);
    expect(facts2[0].deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('flags unpinned malicious package install as HOLD', () => {
    const facts = scanPackageInstall('pip install litellm', '<args>');
    expect(facts).toHaveLength(1);
    expect(facts[0].deterministicRisk).toBe(RiskLevel.HOLD);
    expect(facts[0].snippet).toContain('unpinned');
  });

  it('allows benign package installs', () => {
    const facts = scanPackageInstall('pip install requests numpy fastapi', '<args>');
    expect(facts).toEqual([]);
  });

  it('allows safe newer versions of litellm outside vulnerable range', () => {
    const facts = scanPackageInstall('pip install litellm==1.108.0', '<args>');
    expect(facts).toEqual([]);
  });
});

describe('package-install — live StdioFirewall integration', () => {
  it('blocks MCP tool call executing pip install litellm==1.107.0 before spawn', async () => {
    const fw = new StdioFirewall({ agentHost: 'antigravity', serverId: 'bash-tool' });
    const verdict = await fw.inspectToolCall('execute_command', {
      command: 'pip install litellm==1.107.0',
    });

    expect(verdict.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(verdict.finalRisk).toBe(RiskLevel.HOLD);
    expect(verdict.disposition).toBe('BLOCKED_PRE_EXEC');
    expect(verdict.facts.some((f) => f.ruleId === 'ARG_MALICIOUS_PACKAGE_INSTALL')).toBe(true);

    // handleClientMessage returns -32001 JSON-RPC blocked error
    const response = (await fw.handleClientMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: { command: 'pip install litellm==1.107.0' },
      },
    })) as { error?: { code: number; message: string } };

    expect(response).toBeDefined();
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32001);
  });
});

