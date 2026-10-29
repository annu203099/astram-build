/**
 * @astram/db unit tests — LedgerDb (SQLite WAL + FTS5 ledger).
 *
 * Every test opens its database inside a fresh os.tmpdir() mkdtemp directory
 * (AGENTS.md rule 5: never touch %USERPROFILE%\.astram from tests) and closes
 * + removes it in afterEach.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { LedgerDb } from './index.js';
import { RiskLevel, type AtomicAuditTx, type BoardingManifestItem } from '@astram/types';

let dir: string;
let dbPath: string;
let db: LedgerDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astram-db-test-'));
  dbPath = path.join(dir, 'aegis_ledger.db');
  db = new LedgerDb(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeTx(overrides: Partial<AtomicAuditTx> = {}): AtomicAuditTx {
  return {
    txId: `tx-${Math.random().toString(36).slice(2, 12)}`,
    sessionId: 'session-alpha',
    fiberId: 'fiber-1',
    parentTxId: null,
    agentHost: 'claude-code',
    timestampMs: 1_700_000_000_000,
    policyCharterId: 'astram-policy-charter-v1',
    statedExplanation: 'scanning workspace files for diagnostics',
    mcpServerId: 'mcp-fs',
    toolName: 'fs.scan_workspace',
    redactedArgumentsJson: JSON.stringify({ path: 'C:/repo', note: 'AEGIS_CANARY_SECRET_999-free' }),
    deterministicRisk: RiskLevel.WARN,
    decisionApiDelta: 0,
    finalMonotonicRisk: RiskLevel.WARN,
    fsModifiedFilesJson: JSON.stringify(['C:/repo/README.md']),
    turboquantSlabIndex: null,
    anomalyScore: 0.25,
    violationDetected: 0,
    disposition: 'COMMITTED',
    ...overrides,
  };
}

function makeItem(overrides: Partial<BoardingManifestItem> = {}): BoardingManifestItem {
  return {
    itemId: 'pkg:litellm@1.107.0',
    category: 'LOCKFILE_PKG',
    targetName: 'litellm@1.107.0',
    deterministicStatus: 'HOLD',
    jevApiAdjustment: 0,
    finalStatus: 'HOLD',
    evidenceSummary: 'Installs evil .pth startup hook exfiltrating credentials',
    astFactsJson: '[]',
    ed25519Sig: null,
    updatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('LedgerDb — pragmas & schema', () => {
  it('activates WAL journal mode (persistent across connections)', () => {
    const probe = new Database(dbPath);
    const mode = probe.pragma('journal_mode', { simple: true });
    probe.close();
    expect(mode).toBe('wal');
  });

  it('applies the Handbook §5.2 tables, indexes and FTS tokenizer', () => {
    const probe = new Database(dbPath);
    const tables = (
      probe.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    const indexes = (
      probe.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    const triggers = (
      probe.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain('atomic_audit_tx');
    expect(tables).toContain('boarding_manifest');
    expect(tables).toContain('audit_fts');
    expect(tables).toContain('config_backups');
    expect(indexes).toContain('idx_tx_session');
    expect(indexes).toContain('idx_tx_parent');
    expect(triggers).toContain('audit_fts_tx_insert');
    // tokenizer check: porter stemming must be active on audit_fts
    const tok = probe
      .prepare(
        `INSERT INTO audit_fts(tx_id, session_id, agent_host, stated_explanation, tool_name, evidence_summary)
         VALUES ('tok-test', 's', 'cursor', 'scanning things', 't', 'x')`
      )
      .run();
    expect(tok.changes).toBe(1);
    const hit = probe
      .prepare(`SELECT tx_id FROM audit_fts WHERE audit_fts MATCH '"scanned"'`)
      .get() as { tx_id: string } | undefined;
    expect(hit?.tx_id).toBe('tok-test');
    probe.close();
  });
});

describe('LedgerDb — atomic audit tx round-trip', () => {
  it('inserts and reads back a full root tx (parentTxId null) field-for-field', () => {
    const tx = makeTx({ txId: 'root-1' });
    db.insertAtomicTx(tx);
    const got = db.getTx('root-1');
    expect(got).toEqual(tx);
    expect(got?.parentTxId).toBeNull();
    expect(got?.deterministicRisk).toBe(RiskLevel.WARN);
    expect(got?.finalMonotonicRisk).toBe(RiskLevel.WARN);
    expect(got?.violationDetected).toBe(0);
    expect(got?.disposition).toBe('COMMITTED');
  });

  it('inserts and reads a child tx with a parent (DAG chain)', () => {
    const root = makeTx({ txId: 'root-1', timestampMs: 1_000 });
    const child = makeTx({ txId: 'child-1', parentTxId: 'root-1', timestampMs: 2_000, disposition: 'BLOCKED_PRE_EXEC' });
    db.insertAtomicTx(root);
    db.insertAtomicTx(child);
    expect(db.getTx('child-1')?.parentTxId).toBe('root-1');
    expect(db.getTx('missing')).toBeUndefined();
  });

  it('listTxs returns newest first and honors limit + sessionId', () => {
    const a = makeTx({ txId: 'a', sessionId: 's1', timestampMs: 1_000 });
    const b = makeTx({ txId: 'b', sessionId: 's1', timestampMs: 3_000 });
    const c = makeTx({ txId: 'c', sessionId: 's2', timestampMs: 2_000 });
    for (const t of [a, b, c]) db.insertAtomicTx(t);
    expect(db.listTxs().map((t) => t.txId)).toEqual(['b', 'c', 'a']);
    expect(db.listTxs({ limit: 2 }).map((t) => t.txId)).toEqual(['b', 'c']);
    expect(db.listTxs({ sessionId: 's1' }).map((t) => t.txId)).toEqual(['b', 'a']);
  });

  it('updateTxDisposition patches disposition and optional fields; throws on unknown id', () => {
    db.insertAtomicTx(makeTx({ txId: 'tx-x', anomalyScore: 0.1 }));
    db.updateTxDisposition('tx-x', 'ROLLED_BACK', { anomalyScore: 0.9, turboquantSlabIndex: 7 });
    const got = db.getTx('tx-x');
    expect(got?.disposition).toBe('ROLLED_BACK');
    expect(got?.anomalyScore).toBeCloseTo(0.9);
    expect(got?.turboquantSlabIndex).toBe(7);
    expect(() => db.updateTxDisposition('nope', 'COMMITTED')).toThrow(/no such tx_id/);
  });
});

describe('LedgerDb — FTS5 porter search', () => {
  it('finds a tx by the porter-stemmed form of a query word', () => {
    db.insertAtomicTx(
      makeTx({
        txId: 'fts-1',
        toolName: 'fs.scan_workspace',
        statedExplanation: 'quietly scanning workspace files before boarding',
      })
    );
    // 'scanning' and 'scanned' both porter-stem to 'scan' — plain substring
    // match would find nothing for 'scanned'.
    const hits = db.searchAuditFts('scanned');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ txId: 'fts-1', agentHost: 'claude-code', toolName: 'fs.scan_workspace' });
    expect(typeof hits[0].snippet).toBe('string');
    expect(hits[0].snippet.length).toBeGreaterThan(0);
  });

  it('returns [] for empty or FTS-operator-injected queries instead of throwing', () => {
    db.insertAtomicTx(makeTx({ txId: 'fts-2' }));
    expect(db.searchAuditFts('')).toEqual([]);
    expect(db.searchAuditFts('   ')).toEqual([]);
    expect(db.searchAuditFts('" ( OR ) *')).toEqual([]);
  });
});

describe('LedgerDb — boarding manifest', () => {
  it('upsert updates the existing item instead of duplicating it', () => {
    const v1 = makeItem({ itemId: 'item-1', finalStatus: 'HOLD', updatedAtMs: 1_000 });
    db.upsertBoardingItem(v1);
    db.upsertBoardingItem(makeItem({ itemId: 'item-1', finalStatus: 'REMEDIATED', updatedAtMs: 2_000 }));
    const all = db.listBoardingItems();
    expect(all).toHaveLength(1);
    const got = db.getBoardingItem('item-1');
    expect(got?.finalStatus).toBe('REMEDIATED');
    expect(got?.updatedAtMs).toBe(2_000);
    expect(got?.ed25519Sig).toBeNull();
    expect(db.getBoardingItem('missing')).toBeUndefined();
  });

  it('listBoardingItems filters by category and sorts newest first', () => {
    db.upsertBoardingItem(makeItem({ itemId: 'i1', category: 'LOCKFILE_PKG', updatedAtMs: 1_000 }));
    db.upsertBoardingItem(makeItem({ itemId: 'i2', category: 'AGENT_SKILL', updatedAtMs: 2_000, targetName: 'deploy.md' }));
    expect(db.listBoardingItems().map((i) => i.itemId)).toEqual(['i2', 'i1']);
    const skills = db.listBoardingItems('AGENT_SKILL');
    expect(skills.map((i) => i.itemId)).toEqual(['i2']);
    expect(skills[0].targetName).toBe('deploy.md');
  });
});

describe('LedgerDb — config backups', () => {
  it('round-trips config backups and filters by agent host', () => {
    db.saveConfigBackup('claude-code', 'C:/Users/dev/.claude.json', '{"mcpServers":{}}');
    db.saveConfigBackup('antigravity', 'C:/Users/dev/.agents/mcp_config.json', '{"a":1}');
    const all = db.listConfigBackups();
    expect(all).toHaveLength(2);
    const claude = db.listConfigBackups('claude-code');
    expect(claude).toHaveLength(1);
    expect(claude[0]).toMatchObject({
      agentHost: 'claude-code',
      configPath: 'C:/Users/dev/.claude.json',
      contentJson: '{"mcpServers":{}}',
    });
    expect(typeof claude[0].savedAtMs).toBe('number');
    expect(db.listConfigBackups('quill')).toEqual([]);
  });
});
