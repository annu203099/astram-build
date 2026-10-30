/**
 * Astram Black October Test Pack — Six Layer Protection Verification
 *
 * Runs step-by-step verification on all 6 attack folders in astram-test-pack:
 * 1. 01-secret-theft: Protected paths firewall blocks credential reads
 * 2. 02-known-bad-package: Boarding manifest records litellm==1.107.0 & evil_init.pth as HOLD
 * 3. 03-poisoned-skill: Boarding manifest records format-code/SKILL.md as HOLD (Invariant I1)
 * 4. 04-dangerous-script: StdioFirewall blocks live writes of setup.ps1 and run.js (HOLD / BLOCKED_PRE_EXEC)
 * 5. 05-byte-path-taint: Boarding manifest records handler.js (Brotli) and handler.rb (Regex) as HOLD
 * 6. 06-mid-task-sequence: Benign actions pass (a-e.txt), malicious beacon.js blocked (HOLD / BLOCKED_PRE_EXEC)
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerDb } from '@astram/db';
import { StdioFirewall } from './firewall.js';
import { protectWorkspace } from './protect.js';
import { RiskLevel, riskToName } from '@astram/types';

describe('Astram Six Layer Protection — Black October Test Pack', () => {
  let tmpDir: string;
  let ledger: LedgerDb;
  let firewall: StdioFirewall;
  const testPackRoot = path.resolve(__dirname, '../../../astram-test-pack');

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'astram-test-pack-run-'));
    ledger = new LedgerDb(path.join(tmpDir, 'aegis_ledger.db'));
    firewall = new StdioFirewall({ agentHost: 'antigravity', serverId: 'filesystem', ledger });
  });

  afterAll(() => {
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Layer 1: Secret Theft (01-secret-theft)
  describe('Layer 1: Protected-Path Firewall (01-secret-theft)', () => {
    const protectedPaths = [
      '.env',
      '.ssh/id_rsa',
      '.aws/credentials',
      '.codex/auth.json',
      '.gemini/antigravity/mcp_oauth_tokens.json',
    ];

    for (const p of protectedPaths) {
      it(`blocks access to protected path: ${p}`, async () => {
        const verdict = await firewall.inspectToolCall('read_file', { path: p });
        expect(verdict.finalRisk).toBe(RiskLevel.HOLD);
        expect(verdict.disposition).toBe('BLOCKED_PRE_EXEC');
        expect(verdict.facts.some((f) => f.ruleId === 'ARG_PROTECTED_PATH')).toBe(true);
      });
    }

    it('passes benign control file read: README.txt', async () => {
      const verdict = await firewall.inspectToolCall('read_file', { path: 'README.txt' });
      expect(verdict.finalRisk).toBe(RiskLevel.PASS);
      expect(verdict.disposition).toBe('COMMITTED');
      expect(verdict.facts).toHaveLength(0);
    });
  });

  // Layer 2: Known-Bad Package / Startup Hook (02-known-bad-package)
  describe('Layer 2: Supply Chain Security (02-known-bad-package)', () => {
    it('manifest flags litellm==1.107.0 and evil_init.pth as HOLD in boarding manifest', async () => {
      const demoDir = path.join(tmpDir, 'demo-02');
      mkdirSync(path.join(demoDir, 'site-packages'), { recursive: true });

      const reqSrc = path.join(testPackRoot, '02-known-bad-package', 'requirements.txt');
      const pthSrc = path.join(testPackRoot, '02-known-bad-package', 'site-packages', 'evil_init.pth');

      writeFileSync(path.join(demoDir, 'requirements.txt'), readFileSync(reqSrc, 'utf8'));
      writeFileSync(path.join(demoDir, 'site-packages', 'evil_init.pth'), readFileSync(pthSrc, 'utf8'));

      await protectWorkspace(demoDir, { ledger, scope: 'project', proxyModulePath: 'dummy.js' });

      const items = ledger.listBoardingItems();
      const reqItem = items.find((i) => i.targetName.includes('requirements.txt'));
      expect(reqItem).toBeDefined();
      expect(reqItem?.finalStatus).toBe('HOLD');
      expect(reqItem?.category).toBe('LOCKFILE_PKG');

      const pthItem = items.find((i) => i.targetName.includes('evil_init.pth'));
      expect(pthItem).toBeDefined();
      expect(pthItem?.finalStatus).toBe('HOLD');
      expect(pthItem?.category).toBe('LOCKFILE_PKG');
    });
  });

  // Layer 3: Poisoned Skill / Prompt Injection (03-poisoned-skill)
  describe('Layer 3: Semantic Safety & Invariant I1 (03-poisoned-skill)', () => {
    it('manifest flags format-code/SKILL.md as HOLD despite injection override', async () => {
      const demoDir = path.join(tmpDir, 'demo-03');
      const skillDestDir = path.join(demoDir, '.agents', 'skills', 'format-code');
      mkdirSync(skillDestDir, { recursive: true });

      const skillSrc = path.join(
        testPackRoot,
        '03-poisoned-skill',
        '.agents',
        'skills',
        'format-code',
        'SKILL.md'
      );
      writeFileSync(path.join(skillDestDir, 'SKILL.md'), readFileSync(skillSrc, 'utf8'));

      await protectWorkspace(demoDir, { ledger, scope: 'project', proxyModulePath: 'dummy.js' });

      const items = ledger.listBoardingItems();
      const skillItem = items.find((i) => i.targetName.includes('SKILL.md'));
      expect(skillItem).toBeDefined();
      expect(skillItem?.category).toBe('AGENT_SKILL');
      expect(skillItem?.finalStatus).toBe('HOLD');
      expect(skillItem?.evidenceSummary).toContain('ignore previous rules');
    });
  });

  // Layer 4: Dangerous Script Write (04-dangerous-script)
  describe('Layer 4: Pre-Execution Sandbox / Script Write Firewall (04-dangerous-script)', () => {
    it('blocks live writing of setup.ps1 (ARG_PIPE_DOWNLOAD_EXEC)', async () => {
      const ps1Src = readFileSync(path.join(testPackRoot, '04-dangerous-script', 'setup.ps1'), 'utf8');
      const verdict = await firewall.inspectToolCall('write_file', {
        path: 'setup.ps1',
        content: ps1Src,
      });
      expect(verdict.finalRisk).toBe(RiskLevel.HOLD);
      expect(verdict.disposition).toBe('BLOCKED_PRE_EXEC');
      expect(verdict.facts.some((f) => f.ruleId === 'ARG_PIPE_DOWNLOAD_EXEC')).toBe(true);
    });

    it('blocks live writing of run.js (JS_CHILD_PROCESS + exfiltration)', async () => {
      const jsSrc = readFileSync(path.join(testPackRoot, '04-dangerous-script', 'run.js'), 'utf8');
      const verdict = await firewall.inspectToolCall('write_file', {
        path: 'run.js',
        content: jsSrc,
      });
      expect(verdict.finalRisk).toBe(RiskLevel.HOLD);
      expect(verdict.disposition).toBe('BLOCKED_PRE_EXEC');
      expect(verdict.facts.some((f) => f.ruleId === 'JS_CHILD_PROCESS')).toBe(true);
    });
  });

  // Layer 5: Byte-Path Taint Sinks (05-byte-path-taint)
  describe('Layer 5: Dataflow Taint Tracking (05-byte-path-taint)', () => {
    it('manifest flags handler.js (Brotli RCE) and handler.rb (Regex ReDoS) as HOLD', async () => {
      const demoDir = path.join(tmpDir, 'demo-05');
      mkdirSync(demoDir, { recursive: true });

      const jsSrc = path.join(testPackRoot, '05-byte-path-taint', 'handler.js');
      const rbSrc = path.join(testPackRoot, '05-byte-path-taint', 'handler.rb');

      writeFileSync(path.join(demoDir, 'handler.js'), readFileSync(jsSrc, 'utf8'));
      writeFileSync(path.join(demoDir, 'handler.rb'), readFileSync(rbSrc, 'utf8'));

      await protectWorkspace(demoDir, { ledger, scope: 'project', proxyModulePath: 'dummy.js' });

      const items = ledger.listBoardingItems();
      const jsItem = items.find((i) => i.targetName.includes('handler.js'));
      expect(jsItem).toBeDefined();
      expect(jsItem?.category).toBe('BYTEPATH_SINK');
      expect(jsItem?.finalStatus).toBe('HOLD');

      const rbItem = items.find((i) => i.targetName.includes('handler.rb'));
      expect(rbItem).toBeDefined();
      expect(rbItem?.category).toBe('BYTEPATH_SINK');
      expect(rbItem?.finalStatus).toBe('HOLD');
    });
  });

  // Layer 6: Mid-Task Multi-Step Sequence & Fiber Rollback (06-mid-task-sequence)
  describe('Layer 6: Mid-Task Sequence & Rollback (06-mid-task-sequence)', () => {
    it('Step 1 succeeds (benign files a-e.txt committed)', async () => {
      for (const fname of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) {
        const verdict = await firewall.inspectToolCall('write_file', {
          path: fname,
          content: 'test',
        });
        expect(verdict.finalRisk).toBe(RiskLevel.PASS);
        expect(verdict.disposition).toBe('COMMITTED');
      }
    });

    it('Step 2 blocked (beacon.js callback to 127.0.0.1:19999 blocked with HOLD)', async () => {
      const verdict = await firewall.inspectToolCall('write_file', {
        path: 'beacon.js',
        content: "require('http').get('http://127.0.0.1:19999')",
      });
      expect(verdict.finalRisk).toBe(RiskLevel.HOLD);
      expect(verdict.disposition).toBe('BLOCKED_PRE_EXEC');
      expect(verdict.facts.some((f) => f.ruleId === 'NET_EXFIL_BEACON')).toBe(true);
    });
  });
});

