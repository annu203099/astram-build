#!/usr/bin/env node
/**
 * astram — top-level CLI bin (contract docs/CONTRACTS.md §6).
 *
 *   astram protect [--dir <d>]   protectWorkspace over <dir> (default cwd) with
 *                                the REAL user home — the only place os.homedir()
 *                                is touched in this package. Prints the report
 *                                table; exit 0.
 *   astram start   [--port N]    start @astram/server on N (or AEGIS_PORT or
 *                                3080) and await forever.
 *   astram status  [--port N]    GET http://127.0.0.1:N/api/health; exit 0/1.
 *   astram --help | help | (no args)   usage; exit 0. Unknown: usage, exit 1.
 */
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LedgerDb, defaultLedgerPath } from '@astram/db';
import type { AgentHost } from '@astram/types';
import { protectWorkspace, unprotectWorkspace, type ProtectReport } from './index.js';

const USAGE = `astram — Universal Security Microkernel & MCP Firewall

usage:
  astram protect [--dir <workspace>]   wrap every supported harness MCP config
                                       (antigravity, claude-code, cursor, codex,
                                       quill) in <workspace> + user home
  astram protect --scope global|project|both --agents antigravity,cursor,...
                                       limit which scopes / harnesses are wrapped
  astram unprotect                     restore the original (pre-astram) MCP configs
  astram start [--port <n>]            start the astram daemon (default port
                                       AEGIS_PORT or 3080)
  astram status [--port <n>]           check daemon health (exit 0 healthy)
  astram --help                        this help

options:
  --dir <d>    workspace root for protect (default: current directory)
  --scope <s>  global (user home only) | project (--dir only) | both (default)
  --agents <l> comma-separated agent hosts to wrap (default: all)
  --port <n>   daemon port for start/status (default: AEGIS_PORT or 3080)
`;

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8'
      ) as string
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function flagValue(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === flag && i + 1 < argv.length) return argv[i + 1];
    if (tok.startsWith(`${flag}=`)) return tok.slice(flag.length + 1);
  }
  return undefined;
}

function portOf(argv: string[]): number {
  const fromFlag = Number(flagValue(argv, '--port'));
  if (Number.isInteger(fromFlag) && fromFlag > 0 && fromFlag < 65536) return fromFlag;
  const fromEnv = Number(process.env.AEGIS_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  return 3080;
}

function printReport(report: ProtectReport): void {
  console.log('astram protect — MCP firewall config report');
  if (report.wrapped.length === 0 && report.skipped.length === 0) {
    console.log('  (nothing found)');
  }
  for (const w of report.wrapped) {
    console.log(`  WRAPPED  ${w.agentHost.padEnd(12)} ${w.configPath}`);
    console.log(`           servers: ${w.servers.join(', ')}`);
  }
  for (const s of report.skipped) {
    console.log(`  SKIPPED  ${s.configPath} — ${s.reason}`);
  }
}

async function cmdProtect(argv: string[]): Promise<number> {
  const dir = path.resolve(flagValue(argv, '--dir') ?? process.cwd());
  // The ONLY place the real user home is touched — never in tests.
  const homeDir = os.homedir();
  const ledger = new LedgerDb(defaultLedgerPath());
  try {
    const scopeRaw = flagValue(argv, '--scope') ?? 'both';
    if (scopeRaw !== 'global' && scopeRaw !== 'project' && scopeRaw !== 'both') {
      console.error(`astram: invalid --scope '${scopeRaw}' (global|project|both)`);
      return 1;
    }
    const agentsRaw = flagValue(argv, '--agents');
    const agentHosts = agentsRaw
      ? (agentsRaw.split(',').map((a) => a.trim()).filter(Boolean) as AgentHost[])
      : undefined;
    const report = await protectWorkspace(dir, {
      homeDir,
      ledger,
      scope: scopeRaw,
      agentHosts,
      dashboardWsUrl: `ws://127.0.0.1:${portOf(argv)}/ws/telemetry`,
    });
    printReport(report);
  } finally {
    ledger.close();
  }
  return 0;
}

async function cmdUnprotect(): Promise<number> {
  const ledger = new LedgerDb(defaultLedgerPath());
  try {
    const r = unprotectWorkspace(ledger);
    console.log('astram unprotect — restored original MCP configs');
    if (r.restored.length === 0 && r.skipped.length === 0) console.log('  (no backups recorded)');
    for (const f of r.restored) console.log(`  RESTORED ${f}`);
    for (const s of r.skipped) console.log(`  SKIPPED  ${s.configPath} — ${s.reason}`);
  } finally {
    ledger.close();
  }
  return 0;
}

async function cmdStart(argv: string[]): Promise<number> {
  const port = portOf(argv);
  const { startServer } = await import('@astram/server');
  const running = await startServer({ port });
  console.log(`astram daemon v${readVersion()} listening on ${running.url}`);
  await new Promise<never>(() => undefined); // run until killed
  return 0;
}

async function cmdStatus(argv: string[]): Promise<number> {
  const port = portOf(argv);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await res.json()) as { ok?: boolean; version?: string };
    console.log(JSON.stringify(body));
    return body.ok === true ? 0 : 1;
  } catch (err) {
    console.error(`astram: daemon not reachable on 127.0.0.1:${port} (${(err as Error).message})`);
    return 1;
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === 'protect') return cmdProtect(argv.slice(1));
  if (cmd === 'unprotect') return cmdUnprotect();
  if (cmd === 'start') return cmdStart(argv.slice(1));
  if (cmd === 'status') return cmdStatus(argv.slice(1));
  if (cmd === '--help' || cmd === '-h' || cmd === 'help' || cmd === undefined) {
    process.stdout.write(USAGE);
    return 0;
  }
  process.stderr.write(`astram: unknown command '${cmd}'\n\n${USAGE}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`astram: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
