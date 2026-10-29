/**
 * Integration test — the astram-mcp-proxy stdio pump bin run through
 * `pnpm exec tsx` from the repo root. A temp mock MCP server (pure .mjs,
 * spawned as the proxy's lazy target) records every line it receives and
 * answers with a canned JSON-RPC result.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const MOCK_SERVER = `import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
// Log file lives next to this script (the proxy spawns plain 'node <this-file>').
const logFile = fileURLToPath(new URL('./mock-log.txt', import.meta.url));
writeFileSync(logFile, '');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  appendFileSync(logFile, line + '\\n');
  let id = null;
  try { id = JSON.parse(line).id ?? null; } catch { /* keep null */ }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true, from: 'mock' } }) + '\\n');
});
rl.on('close', () => process.exit(0));
`;

interface LineBuf {
  raw: string[];
  json: unknown[];
}

function spawnProxy(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const full = ['pnpm', 'exec', 'tsx', 'packages/mcp-proxy/src/cli-proxy.ts', ...args];
  // Windows: pnpm is a .cmd shim — spawn it through cmd.exe (still shell-free
  // as far as the proxy's own target spawn is concerned; that one is shell:false).
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    const effectiveEnv: NodeJS.ProcessEnv = { ...env };
    const sysPath = 'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Users\\Asus\\AppData\\Local\\pnpm\\bin';
    effectiveEnv.PATH = effectiveEnv.PATH ? `${sysPath};${effectiveEnv.PATH}` : (effectiveEnv.Path ? `${sysPath};${effectiveEnv.Path}` : sysPath);
    effectiveEnv.Path = effectiveEnv.PATH;
    return spawn(comspec, ['/c', ...full], { cwd: REPO_ROOT, env: effectiveEnv, shell: false });
  }
  return spawn('pnpm', full, { cwd: REPO_ROOT, env, shell: false });
}

function startLineBuf(proc: ChildProcess): LineBuf {
  const buf: LineBuf = { raw: [], json: [] };
  let pending = '';
  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    pending += chunk;
    let idx = pending.indexOf('\n');
    while (idx >= 0) {
      const line = pending.slice(0, idx).trim();
      pending = pending.slice(idx + 1);
      if (line !== '') {
        buf.raw.push(line);
        try {
          buf.json.push(JSON.parse(line));
        } catch {
          buf.raw.pop(); // non-JSON noise (pnpm banner etc.) — ignore
        }
      }
      idx = pending.indexOf('\n');
    }
  });
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', () => undefined); // swallow target/pnpm stderr noise
  return buf;
}

function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`timeout waiting for ${what}`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function killTree(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.killed) return;
  if (proc.pid === undefined) return;
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(existsSync(taskkill) ? taskkill : 'taskkill', ['/PID', String(proc.pid), '/T', '/F']);
  } else {
    proc.kill('SIGKILL');
  }
}

const spawned: ChildProcess[] = [];
afterAll(() => {
  for (const proc of spawned) killTree(proc);
});

describe('astram-mcp-proxy CLI (integration via pnpm exec tsx)', () => {
  it(
    'blocks a HOLD tools/call before spawn, forwards benign calls, compacts results',
    async () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'astram-cli-'));
      const mockPath = path.join(tmp, 'mock-server.mjs');
      // mock-log.txt is created by the mock itself, next to its own file.
      const logPath = path.join(tmp, 'mock-log.txt');
      writeFileSync(mockPath, MOCK_SERVER, 'utf8');

      const env: NodeJS.ProcessEnv = { ...process.env };
      env.AEGIS_LEDGER_DB = path.join(tmp, 'ledger.db');
      delete env.AEGIS_DASHBOARD_WS; // no telemetry in this test
      delete env.ASTRAM_TARGET_URL;

      const proc = spawnProxy(
        [
          '--agent-host',
          'claude-code',
          '--server-id',
          'itest',
          '--target-cmd',
          'node',
          '--target-args',
          mockPath,
        ],
        env
      );
      spawned.push(proc);
      const buf = startLineBuf(proc);

      const send = (obj: unknown): void => {
        proc.stdin?.write(`${JSON.stringify(obj)}\n`);
      };

      // 1. blocked tools/call — must answer -32001 WITHOUT spawning the target.
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'fs.read', arguments: { path: 'C:/Users/dev/.env' } },
      });
      await waitFor(() => buf.json.length >= 1, 45_000, 'blocked response');
      expect(buf.json[0]).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32001,
          message: 'astram Policy Charter blocked this tool call',
          data: {
            tool: 'fs.read',
            finalRisk: 'HOLD',
            facts: [expect.objectContaining({ ruleId: 'ARG_PROTECTED_PATH' })],
            charter: 'astram-policy-charter-v1',
          },
        },
      });

      // 2. benign tools/call — forwarded to the (now lazily spawned) mock.
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo_tool', arguments: { text: 'hello' } },
      });
      await waitFor(() => buf.json.length >= 2, 20_000, 'benign response');
      const benign = buf.json[1] as { id: number; result?: { ok?: boolean } };
      expect(benign.id).toBe(2);
      expect(benign.result?.ok).toBe(true);

      // 3. malformed line — JSON-RPC parse error, no forward.
      proc.stdin?.write('this is not json\n');
      await waitFor(() => buf.json.length >= 3, 10_000, 'parse-error response');
      expect(buf.json[2]).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });

      // The mock received ONLY the benign call (blocked + malformed never forwarded).
      const log = readFileSync(logPath, 'utf8').trim().split('\n').filter((l) => l !== '');
      expect(log).toHaveLength(1);
      const forwarded = JSON.parse(log[0]) as { method: string; params: { name: string } };
      expect(forwarded.method).toBe('tools/call');
      expect(forwarded.params.name).toBe('echo_tool');

      // 4. client closes stdin -> proxy ends target stdin -> mock exits 0 ->
      //    proxy propagates the target's exit code.
      proc.stdin?.end();
      const code = await new Promise<number | null>((resolve) => {
        proc.on('exit', (c) => resolve(c));
        setTimeout(() => resolve(-999), 20_000);
      });
      expect(code).toBe(0);
    },
    90_000
  );

  it(
    'bridges url entries over streamable HTTP (JSON + SSE), forwards auth headers, and still blocks HOLD calls',
    async () => {
      const seen: { auth: string | undefined; method: string }[] = [];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          const m = JSON.parse(body) as { id?: number; method: string };
          seen.push({ auth: req.headers.authorization, method: m.method });
          if (m.id === undefined) {
            res.writeHead(202).end();
            return;
          }
          const out = JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { from: 'remote', method: m.method } });
          if (m.method === 'tools/call') {
            res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${out}\n\n`);
          } else {
            res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'S1' }).end(out);
          }
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as { port: number }).port;
      try {
        const env: NodeJS.ProcessEnv = { ...process.env };
        env.ASTRAM_TARGET_URL = `http://127.0.0.1:${port}/mcp`;
        env.ASTRAM_TARGET_HEADERS_JSON = JSON.stringify({ Authorization: 'Bearer T0KEN' });
        delete env.AEGIS_DASHBOARD_WS;
        const proc = spawnProxy(['--agent-host', 'cursor', '--server-id', 'remote'], env);
        spawned.push(proc);
        const lines: Record<string, unknown>[] = [];
        let buf = '';
        proc.stdout?.setEncoding('utf8');
        proc.stdout?.on('data', (c: string) => {
          buf += c;
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
            buf = buf.slice(i + 1);
          }
        });
        const closed = new Promise<number | null>((resolve) => proc.on('close', (c) => resolve(c)));
        const send = (o: unknown) => proc.stdin?.write(`${JSON.stringify(o)}\n`);
        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } });
        send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { path: '~/.ssh/id_rsa' } } });
        proc.stdin?.end();
        expect(await closed).toBe(0);
        const byId = (id: number) => lines.find((l) => l.id === id) as { result?: { from: string }; error?: { code: number } };
        expect(byId(1).result?.from).toBe('remote');
        expect(byId(2).result?.from).toBe('remote'); // SSE response parsed
        expect(byId(3).error?.code).toBe(-32001); // HOLD never reaches the remote
        expect(seen.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
        expect(seen.every((s) => s.auth === 'Bearer T0KEN')).toBe(true);
      } finally {
        server.close();
      }
    },
    60_000
  );
});
