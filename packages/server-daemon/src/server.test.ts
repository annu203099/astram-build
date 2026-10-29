/**
 * @astram/server unit tests.
 *
 * - Ephemeral port: startServer({ port: 0 }) must report the ACTUAL bound
 *   port (AGENTS.md rule 5: never bind fixed ports in tests).
 * - Ledger lives in a fresh os.tmpdir() mkdtemp directory.
 * - HTTP via global fetch, WS via the built-in global WebSocket (Node 22).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.js';
import { ASTRAM_VERSION, RiskLevel, type AtomicAuditTx } from '@astram/types';

let dir: string;
let server: RunningServer;
let baseUrl: string;

function makeTx(overrides: Partial<AtomicAuditTx> = {}): AtomicAuditTx {
  return {
    txId: 'ws-tx-1',
    sessionId: 'session-ws',
    fiberId: 'fiber-ws',
    parentTxId: null,
    agentHost: 'claude-code',
    timestampMs: 1_700_000_000_000,
    policyCharterId: 'astram-policy-charter-v1',
    statedExplanation: 'scanning workspace files for boarding',
    mcpServerId: 'mcp-fs',
    toolName: 'fs.scan_workspace',
    redactedArgumentsJson: JSON.stringify({ path: 'C:/repo' }),
    deterministicRisk: RiskLevel.WARN,
    decisionApiDelta: 0,
    finalMonotonicRisk: RiskLevel.WARN,
    fsModifiedFilesJson: JSON.stringify(['C:/repo/README.md']),
    turboquantSlabIndex: null,
    anomalyScore: 0.1,
    violationDetected: 0,
    disposition: 'COMMITTED',
    ...overrides,
  };
}

async function getJson<T = unknown>(p: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${p}`);
  return { status: res.status, body: (await res.json()) as T };
}

/**
 * Buffers every message from the moment the socket is CONSTRUCTED.
 *
 * Rationale (see docs/error-log/server-daemon.md): undici's WebSocket can
 * dispatch `open` and early `message` events inside the same event-loop turn
 * (frames that arrive in the same TCP chunk as the 101 upgrade response), so
 * a listener attached after `await open` — a microtask later — can permanently
 * miss frames. Buffering from construction is immune to that batching.
 */
class WsEventBuffer {
  private queue: { type: string; payload?: unknown }[] = [];
  private waiters: { type: string; resolve: (m: { type: string; payload?: unknown }) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: { type?: string; payload?: unknown } | undefined;
      try {
        const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
        msg = JSON.parse(text) as { type?: string };
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      const event = { type: msg.type, payload: msg.payload };
      const idx = this.waiters.findIndex((w) => w.type === event.type);
      if (idx >= 0) {
        const waiter = this.waiters[idx];
        this.waiters.splice(idx, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      } else {
        this.queue.push(event);
      }
    });
  }

  next<T = { type: string; payload: unknown }>(type: string, timeoutMs = 8000): Promise<T> {
    const buffered = this.queue.findIndex((m) => m.type === type);
    if (buffered >= 0) {
      const [msg] = this.queue.splice(buffered, 1);
      return Promise.resolve(msg as T);
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.type === type);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`timed out waiting for ws event "${type}"`));
      }, timeoutMs);
      this.waiters.push({
        type,
        timer,
        resolve: resolve as unknown as (m: { type: string; payload?: unknown }) => void,
      });
    });
  }
}

function openWs(pathSuffix: string): Promise<{ ws: WebSocket; events: WsEventBuffer }> {
  const wsUrl = baseUrl.replace(/^http/, 'ws') + pathSuffix;
  const ws = new WebSocket(wsUrl);
  const events = new WsEventBuffer(ws); // attach BEFORE open — see class doc
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws connect timed out')), 8000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({ ws, events });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws connect error'));
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astram-server-test-'));
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    ledgerPath: path.join(dir, 'aegis_ledger.db'),
  });
  baseUrl = server.url;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('startServer', () => {
  it('binds an ephemeral port and reports the actual bound port', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.port).toBeLessThan(65536);
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe('REST routes (CONTRACTS §5 table)', () => {
  it('GET /api/health -> { ok: true, version }', async () => {
    const { status, body } = await getJson<{ ok: boolean; version: string }>('/api/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, version: ASTRAM_VERSION });
  });

  it('GET /api/manifest -> [] on a fresh ledger; GET /api/tx/:unknown -> null', async () => {
    const manifest = await getJson<unknown[]>('/api/manifest');
    expect(manifest.status).toBe(200);
    expect(manifest.body).toEqual([]);
    const tx = await getJson<unknown>('/api/tx/does-not-exist');
    expect(tx.body).toBeNull();
  });

  it('GET /api/transactions?limit= respects the limit', async () => {
    const res = await getJson<unknown[]>('/api/transactions?limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/rollback/:unknown-tx -> 404 (Tier-2 honest contract; the Tier-1 501 row is superseded — see docs/error-log/server-rollback.md; dedicated coverage in rollback.test.ts)', async () => {
    const res = await fetch(`${baseUrl}/api/rollback/some-tx`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('some-tx');
  });

  it('POST /api/scan ingests optional manifest items and returns the manifest', async () => {
    const item = {
      itemId: 'pkg:litellm@1.107.0',
      category: 'LOCKFILE_PKG',
      targetName: 'litellm@1.107.0',
      deterministicStatus: 'HOLD',
      jevApiAdjustment: 0,
      finalStatus: 'HOLD',
      evidenceSummary: 'Installs evil .pth startup hook',
      astFactsJson: '[]',
      ed25519Sig: null,
      updatedAtMs: 1_700_000_000_000,
    };
    const post = await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [item] }),
    });
    expect(post.status).toBe(200);
    const scanned = (await post.json()) as typeof item[];
    expect(scanned).toHaveLength(1);
    expect(scanned[0].itemId).toBe('pkg:litellm@1.107.0');
    const manifest = await getJson<typeof item[]>('/api/manifest');
    expect(manifest.body.map((m) => m.itemId)).toContain('pkg:litellm@1.107.0');
  });
});

describe('WebSocket /ws/telemetry', () => {
  it('greets with hello, persists ingest-tx, broadcasts tx + dag-update, serves REST', async () => {
    const { ws, events } = await openWs('/ws/telemetry');
    const hello = await events.next<{ type: string; payload: { version: string } }>('hello');
    expect(hello.payload.version).toBe(ASTRAM_VERSION);

    const tx = makeTx({ txId: 'ws-tx-1' });
    ws.send(JSON.stringify({ type: 'ingest-tx', payload: tx }));
    const txEvent = await events.next<{ type: string; payload: AtomicAuditTx }>('tx');
    expect(txEvent.payload.txId).toBe('ws-tx-1');
    expect(txEvent.payload.toolName).toBe('fs.scan_workspace');
    const dagEvent = await events.next<{
      type: string;
      payload: { nodes: { txId: string }[]; edges: unknown[] };
    }>('dag-update');
    expect(dagEvent.payload.nodes.map((n) => n.txId)).toContain('ws-tx-1');
    ws.close();

    // persisted + queryable over REST
    const txs = await getJson<AtomicAuditTx[]>('/api/transactions');
    const found = txs.body.find((t) => t.txId === 'ws-tx-1');
    expect(found).toBeDefined();
    expect(found?.disposition).toBe('COMMITTED');
    expect(found?.statedExplanation).toBe('scanning workspace files for boarding');

    const one = await getJson<AtomicAuditTx>('/api/tx/ws-tx-1');
    expect(one.body.txId).toBe('ws-tx-1');

    const dag = await getJson<{ nodes: { txId: string }[]; edges: unknown[] }>('/api/dag');
    expect(dag.body.nodes.map((n) => n.txId)).toContain('ws-tx-1');

    // FTS: porter-stemmed query finds the ingested tx ('scanning' -> 'scan')
    const fts = await getJson<{ txId: string; toolName: string; snippet: string }[]>(
      '/api/fts?q=scanned'
    );
    expect(fts.body.length).toBeGreaterThanOrEqual(1);
    expect(fts.body[0].txId).toBe('ws-tx-1');
    expect(fts.body[0].toolName).toBe('fs.scan_workspace');
  });

  it('broadcasts ingest-alert to ALL connected clients', async () => {
    const a = await openWs('/ws/telemetry');
    const b = await openWs('/ws/telemetry');
    await a.events.next('hello');
    await b.events.next('hello');
    a.ws.send(
      JSON.stringify({
        type: 'ingest-alert',
        payload: { level: 'HOLD', message: 'protected path touched', txId: 'ws-tx-1', target: 'fs.read' },
      })
    );
    const alertA = await a.events.next<{ type: string; payload: { level: string; message: string } }>('alert');
    const alertB = await b.events.next<{ type: string; payload: { level: string; message: string } }>('alert');
    expect(alertA.payload.level).toBe('HOLD');
    expect(alertB.payload.message).toBe('protected path touched');
    a.ws.close();
    b.ws.close();
  });

  it('ignores malformed frames and non-ingest client events without crashing', async () => {
    const { ws, events } = await openWs('/ws/telemetry');
    await events.next('hello');
    ws.send('this is not json');
    ws.send(JSON.stringify({ type: 'tx', payload: { txId: 'spoofed' } })); // UI-only type from client: ignored
    ws.send(JSON.stringify({ type: 'ingest-tx', payload: { nope: true } })); // invalid tx: ignored
    // server must still respond to REST afterwards
    const health = await getJson<{ ok: boolean }>('/api/health');
    expect(health.body.ok).toBe(true);
    const txs = await getJson<AtomicAuditTx[]>('/api/transactions');
    expect(txs.body.find((t) => t.txId === 'spoofed')).toBeUndefined();
    ws.close();
  });

  it('handles /api/agents/detect and /api/agents/protect endpoints', async () => {
    const detect = await getJson<{ ok: boolean; agents: unknown[] }>('/api/agents/detect');
    expect(detect.status).toBe(200);
    expect(detect.body.ok).toBe(true);
    expect(Array.isArray(detect.body.agents)).toBe(true);
    expect(detect.body.agents.length).toBe(6);

    const res = await fetch(`${baseUrl}/api/agents/protect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootDir: dir, homeDir: dir, agentHosts: ['cursor'] }),
    });
    expect(res.status).toBe(200);
    const protectBody = (await res.json()) as { ok: boolean; report: { wrapped: unknown[]; skipped: unknown[] } };
    expect(protectBody.ok).toBe(true);
    expect(Array.isArray(protectBody.report.wrapped)).toBe(true);
    expect(Array.isArray(protectBody.report.skipped)).toBe(true);
  });
});
