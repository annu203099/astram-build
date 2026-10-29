#!/usr/bin/env node
/**
 * astram-mcp-proxy — the stdio pump bin (contract docs/CONTRACTS.md §6).
 *
 *   astram-mcp-proxy --agent-host H --server-id S --target-cmd C --target-args a,b,c
 *
 * Sits between an agent host and one MCP server process:
 *  - stdin lines are parsed as JSON-RPC; tools/call requests pass through the
 *    StdioFirewall — HOLD calls get the blocked response on stdout and are
 *    NEVER forwarded (the target is spawned lazily on first forward);
 *  - everything else is forwarded to the target as the ORIGINAL raw line;
 *  - target stdout is compacted (redact / strip ANSI / byte cap) before
 *    being written back to stdout;
 *  - target stderr passes through; target exit code becomes our exit code;
 *  - LedgerDb is opened lazily from AEGIS_LEDGER_DB when set;
 *  - when AEGIS_DASHBOARD_WS is set, recorded txs (and HOLD alerts) are pushed
 *    to the daemon over a global WebSocket, fire-and-forget, failures silent;
 *  - HTTP-bridged (url) servers are detected via ASTRAM_TARGET_URL and exit 1
 *    with the documented Tier 2 message.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { LedgerDb } from '@astram/db';
import type { AgentHost, AtomicAuditTx } from '@astram/types';
import { StdioFirewall } from './index.js';
import { resolveSpawnPlan } from './spawn-target.js';

interface ProxyArgs {
  agentHost: AgentHost;
  serverId: string;
  targetCmd: string;
  targetArgs: string[];
}

function parseArgv(argv: string[]): ProxyArgs | null {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    if (eq > 0) {
      map.set(tok.slice(2, eq), tok.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      map.set(tok.slice(2), argv[i + 1]);
      i++;
    } else {
      map.set(tok.slice(2), '');
    }
  }
  const targetCmd = map.get('target-cmd') ?? '';
  if (!targetCmd && !process.env.ASTRAM_TARGET_URL) return null;
  const rawArgs = map.get('target-args') ?? '';
  let exactArgs: string[] | null = null;
  try {
    const j = process.env.ASTRAM_TARGET_ARGS_JSON;
    const parsed: unknown = j ? JSON.parse(j) : null;
    if (Array.isArray(parsed)) exactArgs = parsed.map(String);
  } catch {
    exactArgs = null; // fall back to the comma-joined form
  }
  return {
    agentHost: (map.get('agent-host') || 'claude-code') as AgentHost,
    serverId: map.get('server-id') || 'unknown',
    targetCmd,
    targetArgs: exactArgs ?? (rawArgs === '' ? [] : rawArgs.split(',')),
  };
}

// Minimal structural type for the global WebSocket (avoids DOM lib dependency).
interface WsLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const WS_OPEN = 1;

function main(): void {
  const parsed = parseArgv(process.argv.slice(2));
  if (!parsed) {
    process.stderr.write(
      'usage: astram-mcp-proxy --agent-host H --server-id S --target-cmd C --target-args a,b,c\n'
    );
    process.exit(2);
  }
  const args: ProxyArgs = parsed;

  // -- ledger (lazy: only when the daemon/config provided a DB path) --------
  let ledger: LedgerDb | null = null;
  let ledgerOpened = false;
  function getLedger(): LedgerDb | null {
    const dbPath = process.env.AEGIS_LEDGER_DB;
    if (!ledgerOpened && dbPath) {
      try {
        ledger = new LedgerDb(dbPath);
      } catch {
        ledger = null; // firewall still runs without persistence
      }
      ledgerOpened = true;
    }
    return ledger;
  }

  // -- telemetry (fire-and-forget, all failures silent) ---------------------
  let ws: WsLike | null = null;
  const pendingTelemetry: string[] = []; // events sent while the socket is still CONNECTING
  function connectTelemetry(): void {
    const url = process.env.AEGIS_DASHBOARD_WS;
    if (!url || ws) return;
    const ctor = (globalThis as {
      WebSocket?: new (u: string) => WsLike & {
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        onerror: (() => void) | null;
      };
    }).WebSocket;
    if (!ctor) return;
    try {
      const sock = new ctor(url);
      ws = sock;
      sock.onopen = () => {
        for (const wire of pendingTelemetry.splice(0)) {
          try {
            sock.send(wire);
          } catch {
            /* silent by contract */
          }
        }
      };
      // daemon down / socket dropped: forget it so the next event retries
      sock.onclose = () => {
        if (ws === sock) ws = null;
      };
      sock.onerror = () => {
        if (ws === sock) ws = null;
      };
    } catch {
      ws = null;
    }
  }
  function sendTelemetry(evt: unknown): void {
    if (!process.env.AEGIS_DASHBOARD_WS) return;
    const wire = JSON.stringify(evt);
    connectTelemetry();
    if (ws && ws.readyState === WS_OPEN) {
      try {
        ws.send(wire);
      } catch {
        /* silent by contract */
      }
    } else if (ws && pendingTelemetry.length < 200) {
      pendingTelemetry.push(wire);
    }
  }
  connectTelemetry(); // connect eagerly so the first event is not lost

  const firewall = new StdioFirewall({
    agentHost: args.agentHost,
    serverId: args.serverId,
    ledger: getLedger(),
    jev: null,
  });

  firewall.onTx = (tx: AtomicAuditTx): void => {
    sendTelemetry({ type: 'ingest-tx', payload: tx });
    if (tx.disposition === 'BLOCKED_PRE_EXEC') {
      sendTelemetry({
        type: 'ingest-alert',
        payload: {
          level: 'HOLD',
          message: `astram blocked tools/call ${tx.toolName} (finalRisk HOLD)`,
          txId: tx.txId,
          target: tx.toolName,
        },
      });
    }
  };

  firewall.onAlert = (alert): void => {
    sendTelemetry({ type: 'ingest-alert', payload: alert });
  };

  // -- target process (spawned LAZILY on the first forwarded message) -------
  let target: ChildProcess | null = null;
  function ensureTarget(): ChildProcess {
    if (target) return target;
    const plan = resolveSpawnPlan(args.targetCmd, args.targetArgs);
    target = spawn(plan.file, plan.args, {
      shell: false,
      env: { ...process.env },
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });

    const outRl = createInterface({ input: target.stdout as NodeJS.ReadableStream });
    outRl.on('line', (line) => {
      void (async () => {
        try {
          const msg = JSON.parse(line);
          const compacted = await firewall.handleServerMessage(msg);
          process.stdout.write(`${JSON.stringify(compacted)}\n`);
        } catch {
          process.stdout.write(`${line}\n`); // non-JSON target output: pass through
        }
      })();
    });

    (target.stderr as NodeJS.ReadableStream).setEncoding('utf8');
    target.stderr?.on('data', (chunk: string) => process.stderr.write(chunk));

    target.on('exit', (code) => {
      try {
        ws?.close();
      } catch {
        /* silent */
      }
      getLedger()?.close();
      process.exit(code ?? 0);
    });
    target.on('error', (err) => {
      process.stderr.write(`astram-mcp-proxy: target error: ${err.message}\n`);
      process.exit(1);
    });
    return target;
  }

  // -- HTTP bridge (url entries): MCP streamable-HTTP over POST -------------
  const targetUrl = process.env.ASTRAM_TARGET_URL;
  let httpSession: string | undefined;
  const inflight = new Set<Promise<void>>();
  const httpHeaders: Record<string, string> = (() => {
    try {
      return JSON.parse(process.env.ASTRAM_TARGET_HEADERS_JSON ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  })();

  async function emitServer(msg: unknown): Promise<void> {
    const compacted = await firewall.handleServerMessage(msg);
    process.stdout.write(`${JSON.stringify(compacted)}\n`);
  }

  async function forwardHttp(line: string, msg: unknown): Promise<void> {
    const id = (msg as { id?: unknown })?.id;
    try {
      const res = await fetch(targetUrl as string, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...httpHeaders,
          ...(httpSession ? { 'mcp-session-id': httpSession } : {}),
        },
        body: line,
        signal: AbortSignal.timeout(120_000),
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) httpSession = sid;
      if (id === undefined) {
        await res.arrayBuffer().catch(() => undefined); // notification: 202, nothing to relay
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from remote MCP server`);
      const text = await res.text();
      const payloads: unknown[] = [];
      if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        for (const block of text.split(/\r?\n\r?\n/)) {
          const data = block
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (data) payloads.push(JSON.parse(data));
        }
      } else if (text.trim() !== '') {
        const parsedBody: unknown = JSON.parse(text);
        payloads.push(...(Array.isArray(parsedBody) ? parsedBody : [parsedBody]));
      }
      for (const m of payloads) await emitServer(m);
    } catch (err) {
      if (id !== undefined) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: `astram bridge: ${(err as Error).message}` },
          })}\n`
        );
      }
    }
  }

  // -- stdin pump (serialized so blocked/forward decisions stay ordered) ----
  const stdinRl = createInterface({ input: process.stdin });
  let queue: Promise<void> = Promise.resolve();

  stdinRl.on('line', (line) => {
    queue = queue.then(async () => {
      const trimmed = line.trim();
      if (trimmed === '') return;

      let msg: unknown;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' }})}\n`
        );
        return;
      }

      let response: unknown | null = null;
      try {
        response = await firewall.handleClientMessage(msg);
      } catch (err) {
        // Fail closed: an internal inspection error must never reach the target.
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: (msg as { id?: unknown })?.id ?? null,
            error: {
              code: -32603,
              message: 'astram internal inspection error (call not forwarded)',
              data: { detail: (err as Error).message },
            },
          })}\n`
        );
        return;
      }

      if (response !== null && response !== undefined) {
        process.stdout.write(`${JSON.stringify(response)}\n`); // blocked: DO NOT forward
        return;
      }
      if (targetUrl) {
        const job: Promise<void> = forwardHttp(line, msg).finally(() => inflight.delete(job));
        inflight.add(job);
        return;
      }
      // Forward the ORIGINAL raw line (never re-serialized).
      const t = ensureTarget();
      t.stdin?.write(`${line}\n`);
    });
  });

  stdinRl.on('close', () => {
    // Client went away. Close the target's stdin so it can finish/exit; its
    // exit handler closes the ledger, the telemetry socket and re-exits us
    // with its code. Without a target there is nothing to wait for.
    if (targetUrl) {
      void queue
        .then(() => Promise.allSettled([...inflight]))
        .then(() => {
          try {
            ws?.close();
          } catch {
            /* silent */
          }
          getLedger()?.close();
          // Exiting while undici/WebSocket handles are mid-close trips a libuv
          // assertion on Windows (exit 0xC0000409); let them settle first.
          process.exitCode = 0;
          setTimeout(() => process.exit(0), 150).unref();
        });
    } else if (target) {
      try {
        target.stdin?.end();
      } catch {
        /* already closed */
      }
    } else {
      getLedger()?.close();
      process.exit(0);
    }
  });
}

main();
