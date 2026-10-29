/**
 * @astram/server — astram daemon (Fastify 5 + WebSocket telemetry on localhost).
 *
 * Binding contract: docs/CONTRACTS §5.
 *  - JSON API: /api/health, /api/manifest, /api/transactions, /api/tx/:txId,
 *    /api/dag, /api/fts, /api/scan, /api/rollback/:txId (Tier 1: 501)
 *  - WS /ws/telemetry: hello on connect; proxy clients send `ingest-tx` /
 *    `ingest-alert`, which are persisted (LedgerDb) and rebroadcast as
 *    `tx` / `alert` (+ `dag-update`) to every connected client.
 *  - Serves ../../dashboard-ui/dist at / when that folder exists (skipped
 *    silently otherwise, so the daemon works before the UI is built).
 *
 * Dual-purpose module: exports `startServer` and, when executed directly
 * (`node dist/index.js` / `tsx src/index.ts`), starts on
 * Number(process.env.AEGIS_PORT || 3080), host 127.0.0.1, with graceful
 * SIGINT/SIGTERM shutdown.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { LedgerDb, MultiverseDag, defaultLedgerPath } from '@astram/db';
import {
  ASTRAM_VERSION,
  DEFAULT_AEGIS_PORT,
  type AtomicAuditTx,
  type BoardingManifestItem,
  type TelemetryEvent,
} from '@astram/types';

export interface ServerOptions {
  port?: number;
  host?: string; // default 127.0.0.1
  ledgerPath?: string; // default: defaultLedgerPath()
  astramHome?: string; // default: resolveAstramHome()
}

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Minimal structural type for a connected telemetry socket (ws-compatible). */
interface TelemetrySocket {
  send(data: string): void;
  readyState: number;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
}

const WS_OPEN = 1;

function rawToText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map((chunk) => rawToText(chunk)).join('');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return String(data);
}

interface McpProxyModule {
  detectInstalledAgents(rootDir?: string, homeDir?: string): unknown[];
  protectWorkspace(
    rootDir: string,
    opts?: {
      homeDir?: string;
      ledger?: LedgerDb | null;
      agentHosts?: never[] | string[];
      projectRoots?: string[];
    }
  ): Promise<unknown>;
}

/**
 * @astram/mcp-proxy and @astram/turboquant are not dependencies of this
 * package (mcp-proxy depends on us — circular), so bare-specifier resolution
 * fails at runtime. Resolve by name first (vitest alias), then by sibling
 * workspace path (dist, then src for tsx).
 */
async function loadSibling<T>(pkgName: string, dir: string): Promise<T> {
  const candidates: string[] = [pkgName];
  // ./<dir>-lib.mjs: sibling library bundle in an installed (bundled) layout.
  for (const rel of [`./${dir}-lib.mjs`, `../../${dir}/dist/index.js`, `../../${dir}/src/index.ts`]) {
    const abs = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(abs)) candidates.push(pathToFileURL(abs).href);
  }
  let lastErr: unknown;
  for (const spec of candidates) {
    try {
      return (await import(spec)) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`cannot load ${pkgName}`);
}

const loadMcpProxy = (): Promise<McpProxyModule> => loadSibling('@astram/mcp-proxy', 'mcp-proxy');

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const ledgerPath =
    opts.ledgerPath ??
    (opts.astramHome ? path.join(opts.astramHome, 'aegis_ledger.db') : defaultLedgerPath());
  const ledger = new LedgerDb(ledgerPath);

  const currentDag = () => MultiverseDag.fromTxs(ledger.listTxs({ limit: 5000 })).toJSON();

  const fastify = Fastify({ logger: false });
  await fastify.register(cors);
  await fastify.register(websocket);

  // ---- telemetry fan-out ---------------------------------------------------
  const clients = new Set<TelemetrySocket>();
  const broadcast = (event: TelemetryEvent): void => {
    const wire = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WS_OPEN) client.send(wire);
    }
  };

  fastify.get('/ws/telemetry', { websocket: true }, (socket) => {
    const sock = socket as TelemetrySocket;
    clients.add(sock);
    sock.send(JSON.stringify({ type: 'hello', payload: { version: ASTRAM_VERSION } }));
    sock.on('close', () => clients.delete(sock));
    sock.on('message', (data: unknown) => {
      let msg: { type?: string; payload?: unknown };
      try {
        msg = JSON.parse(rawToText(data)) as { type?: string; payload?: unknown };
      } catch {
        return; // malformed frame: ignore (fail-closed, never crash the daemon)
      }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'ingest-tx') {
        const tx = msg.payload as AtomicAuditTx | undefined;
        if (!tx || typeof tx.txId !== 'string' || typeof tx.toolName !== 'string') return;
        try {
          ledger.insertAtomicTx(tx);
        } catch {
          // duplicate txId (replayed ingest) or constraint violation — the tx
          // is already in the ledger; still rebroadcast so late clients catch up.
        }
        broadcast({ type: 'tx', payload: tx });
        broadcast({ type: 'dag-update', payload: currentDag() });
      } else if (msg.type === 'ingest-alert') {
        const alert = msg.payload as Extract<TelemetryEvent, { type: 'ingest-alert' }>['payload'];
        if (!alert || (alert.level !== 'WARN' && alert.level !== 'HOLD')) return;
        broadcast({ type: 'alert', payload: alert });
      }
      // UI-only event types (hello/tx/alert/manifest-update/dag-update) sent by
      // a client are ignored — the server is the only broadcaster for those.
    });
  });

  // ---- JSON API (CONTRACTS §5 route table, exact) ---------------------------
  fastify.get('/api/health', async () => ({ ok: true, version: ASTRAM_VERSION }));

  fastify.get('/api/accelerator', async () => {
    try {
      const { getAcceleratorInfo } = await loadSibling<{ getAcceleratorInfo(): unknown }>('@astram/turboquant', 'turboquant-worker');
      return getAcceleratorInfo();
    } catch {
      return { device: 'cpu', error: 'turboquant not loaded' };
    }
  });

  fastify.get('/api/agents/detect', async (request) => {
    const q = request.query as { rootDir?: string; homeDir?: string } | undefined;
    try {
      const { detectInstalledAgents } = await loadMcpProxy();
      const rootDir = q?.rootDir || process.cwd();
      const homeDir = q?.homeDir;
      const agents = detectInstalledAgents(rootDir, homeDir);
      return { ok: true, agents };
    } catch (err) {
      return { ok: false, error: (err as Error).message, agents: [] };
    }
  });

  fastify.post('/api/agents/protect', async (request) => {
    const body = (request.body as {
      rootDir?: string;
      homeDir?: string;
      agentHosts?: string[];
      projectRoots?: string[];
    }) || {};
    try {
      const { protectWorkspace } = await loadMcpProxy();
      const rootDir = body.rootDir || process.cwd();
      const report = await protectWorkspace(rootDir, {
        homeDir: body.homeDir,
        agentHosts: body.agentHosts,
        projectRoots: body.projectRoots,
        ledger,
      });
      // protect registers wrapped servers in the manifest: push it to open dashboards
      for (const item of ledger.listBoardingItems()) broadcast({ type: 'manifest-update', payload: item });
      return { ok: true, report };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  fastify.get('/api/manifest', async () => ledger.listBoardingItems());

  fastify.get('/api/transactions', async (request) => {
    const raw = (request.query as { limit?: string }).limit;
    const parsed = raw !== undefined ? Number(raw) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
    return ledger.listTxs({ limit });
  });

  fastify.get('/api/tx/:txId', async (request) => {
    const { txId } = request.params as { txId: string };
    return ledger.getTx(txId) ?? null;
  });

  fastify.get('/api/dag', async () => currentDag());

  fastify.get('/api/fts', async (request) => {
    const q = (request.query as { q?: string }).q ?? '';
    return ledger.searchAuditFts(q);
  });

  /**
   * Tier 1: workspace-config scanning is Phase 2 (gatekeeper filesystem walk).
   * The endpoint stays functional: it (optionally) ingests manifest items
   * supplied in the request body and returns the current manifest.
   */
  fastify.post('/api/scan', async (request) => {
    const body = request.body as { items?: BoardingManifestItem[] } | undefined;
    if (body && Array.isArray(body.items)) {
      for (const item of body.items) ledger.upsertBoardingItem(item);
    }
    return ledger.listBoardingItems();
  });

  /**
   * Rollback (CONTRACTS §5 Tier-2 update — supersedes the Tier-1 `501` row;
   * see docs/error-log/server-rollback.md). Honest semantics: the daemon
   * never captured pre-execution file snapshots for arbitrary transactions,
   * so a post-hoc restore of modified files is impossible. What IS real:
   *  - pre-exec block: the call never ran — the true 0-work rollback;
   *  - committed turns: rollback is covered by the cordis fiber promotion
   *    path (@astram/canary / Fiber.commitToMain), not by this endpoint.
   */
  fastify.post('/api/rollback/:txId', async (request, reply) => {
    const { txId } = request.params as { txId: string };
    const tx = ledger.getTx(txId);
    if (!tx) {
      reply.code(404);
      return { error: `rollback: unknown txId ${txId}` };
    }
    if (tx.disposition === 'BLOCKED_PRE_EXEC') {
      return {
        rolledBack: true,
        mode: 'pre-exec-block',
        note: 'call never executed — nothing to restore',
        txId,
      };
    }
    const reason =
      'no pre-execution snapshot recorded for this tx (cordis fiber promotion path covers committed-turn rollback)';
    broadcast({
      type: 'alert',
      payload: { level: 'WARN', message: `rollback requested for tx ${txId}: ${reason}`, txId },
    });
    return { rolledBack: false, mode: 'unavailable', reason, txId };
  });

  // ---- dashboard static hosting (optional at Tier 1) ------------------------
  const dashboardDist =
    [
      process.env.ASTRAM_UI_DIST,
      fileURLToPath(new URL('./ui/', import.meta.url)), // installed bundle
      fileURLToPath(new URL('../../dashboard-ui/dist/', import.meta.url)), // monorepo
    ].find((d): d is string => !!d && existsSync(path.join(d, 'index.html'))) ?? '';
  if (dashboardDist) {
    await fastify.register(fastifyStatic, { root: dashboardDist, prefix: '/' });
  }

  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.AEGIS_PORT || DEFAULT_AEGIS_PORT);
  await fastify.listen({ port, host });

  const address = fastify.server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

  let closed = false;
  return {
    url: `http://${displayHost}:${boundPort}`,
    port: boundPort,
    close: async () => {
      if (closed) return;
      closed = true;
      clients.clear();
      await fastify.close();
      ledger.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Direct-execution entry (node dist/index.js | tsx src/index.ts)
// ---------------------------------------------------------------------------

function isDirectExecution(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const self = path.resolve(fileURLToPath(import.meta.url));
    const entry = path.resolve(argv1);
    return process.platform === 'win32'
      ? self.toLowerCase() === entry.toLowerCase()
      : self === entry;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  const port = Number(process.env.AEGIS_PORT || DEFAULT_AEGIS_PORT);
  let handle: RunningServer | null = null;
  const shutdown = async (): Promise<void> => {
    try {
      await handle?.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  try {
    handle = await startServer({ port, host: '127.0.0.1' });
    console.log(`astram daemon listening on ${handle.url}`);
  } catch (err) {
    console.error(
      `astram daemon failed to start: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
