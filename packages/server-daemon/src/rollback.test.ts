/**
 * @astram/server — POST /api/rollback/:txId Tier-2 honest-contract coverage
 * (see docs/error-log/server-rollback.md; CONTRACTS §5 rollback row superseded).
 *
 * Uses a SECOND server instance (ephemeral port, own temp ledger) plus an
 * out-of-band LedgerDb connection over the same SQLite file (WAL +
 * busy_timeout make concurrent writers safe) to seed BLOCKED_PRE_EXEC and
 * COMMITTED transactions without needing a WS ingest.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerDb } from '@astram/db';
import { RiskLevel, type AtomicAuditTx } from '@astram/types';
import { startServer, type RunningServer } from './index.js';

let dir: string;
let server: RunningServer;
let baseUrl: string;
let seedLedger: LedgerDb;

function makeTx(overrides: Partial<AtomicAuditTx> = {}): AtomicAuditTx {
  return {
    txId: 'rb-tx',
    sessionId: 'rb-session',
    fiberId: 'rb-fiber',
    parentTxId: null,
    agentHost: 'dsh',
    timestampMs: 1_700_000_000_000,
    policyCharterId: 'astram-policy-charter-v1',
    statedExplanation: 'read a protected path',
    mcpServerId: 'mcp-fs',
    toolName: 'fs_read',
    redactedArgumentsJson: JSON.stringify({ path: 'C:/Users/dev/.env' }),
    deterministicRisk: RiskLevel.HOLD,
    decisionApiDelta: 0,
    finalMonotonicRisk: RiskLevel.HOLD,
    fsModifiedFilesJson: '[]',
    turboquantSlabIndex: null,
    anomalyScore: 0.8,
    violationDetected: 1,
    disposition: 'BLOCKED_PRE_EXEC',
    ...overrides,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astram-rollback-test-'));
  const ledgerPath = path.join(dir, 'aegis_ledger.db');
  server = await startServer({ port: 0, host: '127.0.0.1', ledgerPath });
  baseUrl = server.url;
  seedLedger = new LedgerDb(ledgerPath); // second connection over the same WAL db
});

afterAll(async () => {
  await server.close();
  seedLedger.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/rollback/:txId (Tier-2 honest contract)', () => {
  it('unknown txId -> 404 { error }', async () => {
    const res = await fetch(`${baseUrl}/api/rollback/no-such-tx`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('no-such-tx');
  });

  it('BLOCKED_PRE_EXEC tx -> 200 { rolledBack: true, mode: "pre-exec-block" } (true 0-work rollback)', async () => {
    seedLedger.insertAtomicTx(makeTx({ txId: 'rb-blocked', disposition: 'BLOCKED_PRE_EXEC' }));
    const res = await fetch(`${baseUrl}/api/rollback/rb-blocked`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rolledBack: boolean; mode: string; note: string; txId: string };
    expect(body.rolledBack).toBe(true);
    expect(body.mode).toBe('pre-exec-block');
    expect(body.note).toContain('call never executed');
    expect(body.txId).toBe('rb-blocked');
  });

  it('COMMITTED tx -> 200 { rolledBack: false, mode: "unavailable" } + WARN alert broadcast', async () => {
    seedLedger.insertAtomicTx(
      makeTx({
        txId: 'rb-committed',
        disposition: 'COMMITTED',
        violationDetected: 0,
        fsModifiedFilesJson: JSON.stringify(['C:/repo/README.md']),
      })
    );

    // WS client must receive the WARN alert the endpoint broadcasts.
    const ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/ws/telemetry');
    const alertPromise = new Promise<{ level: string; message: string; txId?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for WARN alert')), 8000);
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type: string; payload?: { level: string; message: string; txId?: string } };
          if (msg.type === 'alert' && msg.payload?.level === 'WARN') {
            clearTimeout(timer);
            resolve(msg.payload);
          }
        } catch {
          /* ignore malformed */
        }
      });
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws connect timed out')), 8000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(null);
      });
      ws.addEventListener('error', () => reject(new Error('ws connect error')));
    });

    const res = await fetch(`${baseUrl}/api/rollback/rb-committed`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rolledBack: boolean; mode: string; reason: string; txId: string };
    expect(body.rolledBack).toBe(false);
    expect(body.mode).toBe('unavailable');
    expect(body.reason).toContain('no pre-execution snapshot recorded for this tx');
    expect(body.txId).toBe('rb-committed');

    const alert = await alertPromise;
    expect(alert.level).toBe('WARN');
    expect(alert.message).toContain('rollback requested for tx rb-committed');
    expect(alert.txId).toBe('rb-committed');
    ws.close();
  });

  it('CANARY_HEALED and ROLLED_BACK txs also answer honestly via mode "unavailable"', async () => {
    seedLedger.insertAtomicTx(makeTx({ txId: 'rb-healed', disposition: 'CANARY_HEALED' }));
    const res = await fetch(`${baseUrl}/api/rollback/rb-healed`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rolledBack: boolean; mode: string };
    expect(body.rolledBack).toBe(false);
    expect(body.mode).toBe('unavailable');
  });
});
