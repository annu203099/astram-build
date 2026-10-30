/**
 * @astram/mcp-proxy — Universal MCP JSON-RPC stdio firewall
 * (Handbook §5.4 Tier 1 Component 3, contract docs/CONTRACTS.md §6).
 *
 * - `inspectToolCall` — pure, spawn-free policy check on a tools/call:
 *   recursive denylist tokenization of every string argument plus the tool
 *   name, shell-like values through scanShellSnippet, code-like values
 *   through scanJavascript / scanPythonCode.
 * - `handleClientMessage` — intercepts ONLY tools/call requests; HOLD calls
 *   get the exact blocked JSON-RPC response and an atomic audit tx.
 * - `handleServerMessage` — compacts (redact / strip ANSI / 32 KB cap) server
 *   results before they reach the agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isProtectedPath,
  maxDeterministicRisk,
  newTxId,
  RiskLevel,
  riskToName,
  type AgentHost,
  type AstCapabilityFact,
  type AtomicAuditTx,
  type PolicyVerdict,
} from '@astram/types';
import type { JevDecisionClient } from '@astram/gatekeeper';
import {
  scanJavascript,
  scanPythonCode,
  scanShellSnippet,
  scanPythonPth,
  scanDirectoryForPth,
  analyzeBytePathJs,
  analyzeBytePathPython,
  analyzeBytePathRuby,
  analyzeBytePathPhp,
  taintFactsFromSinks,
} from '@astram/gatekeeper';
import type { LedgerDb } from '@astram/db';
import { deobfuscate, scanDangerousCommand } from './dangerous-commands.js';
import { scanPackageInstall } from './package-install.js';
import { INJECTION_NOTICE, detectInjection } from './injection.js';
import { compactMcpResult, redactSecrets, stripAnsi, truncateUtf8Safe } from './redact.js';

export interface FirewallOptions {
  agentHost: AgentHost;
  serverId: string;
  ledger?: LedgerDb | null; // null in unit tests
  jev?: JevDecisionClient | null;
  sessionId?: string; // default generated
  maxResultBytes?: number; // default 32768
}

export const POLICY_CHARTER_ID = 'astram-policy-charter-v1';

/** Tool arguments are tagged with this pseudo-file in every fact. */
const ARGS_FILE = '<args>';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts destination filenames from download commands (curl, wget, PowerShell, certutil).
 */
export function extractDownloadedFiles(text: string): string[] {
  const downloaded: string[] = [];
  const lines = text.split('\n');
  for (const rawLine of lines) {
    if (!rawLine || rawLine.length > 20000) continue;
    const line = deobfuscate(rawLine);

    // 1. curl -o / --output / -O / --remote-name
    if (/\bcurl(?:\.exe)?\b/i.test(line)) {
      const oMatch = line.match(/(?:-o\s+|--output\s*=?\s*)(["']?)([^\s"'`;&|]+)\1/);
      if (oMatch && oMatch[2] && oMatch[2] !== '-') {
        downloaded.push(oMatch[2]);
      } else if (/(?:-O\b|--remote-name\b)/.test(line)) {
        const urlMatch = line.match(/https?:\/\/[^\s"'`;&|]+/i);
        if (urlMatch) {
          const base = urlMatch[0].split('/').pop()?.split(/[?#]/)[0];
          if (base && base !== '.' && base !== '/') downloaded.push(base);
        }
      }
    }

    // 2. wget -O / --output-document / bare url
    if (/\bwget(?:\.exe)?\b/i.test(line)) {
      const oMatch = line.match(/(?:-O\s*|--output-document\s*=?\s*)(["']?)([^\s"'`;&|]+)\1/);
      if (oMatch && oMatch[2] && oMatch[2] !== '-') {
        downloaded.push(oMatch[2]);
      } else {
        const urlMatch = line.match(/https?:\/\/[^\s"'`;&|]+/i);
        if (urlMatch) {
          const base = urlMatch[0].split('/').pop()?.split(/[?#]/)[0];
          if (base && base !== '.' && base !== '/') downloaded.push(base);
        }
      }
    }

    // 3. PowerShell Invoke-WebRequest / iwr / Start-BitsTransfer
    const psMatch = line.match(/\b(?:Invoke-WebRequest|iwr)\b[^\n]*-OutFile\s+(["']?)([^\s"'`;&|]+)\1/i);
    if (psMatch && psMatch[2]) downloaded.push(psMatch[2]);

    const bitsMatch = line.match(/\bStart-BitsTransfer\b[^\n]*-Destination\s+(["']?)([^\s"'`;&|]+)\1/i);
    if (bitsMatch && bitsMatch[2]) downloaded.push(bitsMatch[2]);

    // 4. certutil
    if (/\bcertutil(?:\.exe)?\b[^\n]*-urlcache\b/i.test(line)) {
      const parts = line.trim().split(/\s+/);
      const last = parts[parts.length - 1];
      if (last && !last.startsWith('-') && !last.startsWith('http')) {
        downloaded.push(last.replace(/^["']|["']$/g, ''));
      }
    }
  }

  return Array.from(new Set(downloaded.map((f) => f.replace(/^["']|["']$/g, '').replace(/\\/g, '/')).filter(Boolean)));
}

const INTERPRETERS = String.raw`(?:bash|sh|zsh|dash|ash|ksh|csh|tcsh|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|python[23]?(?:\.exe)?|py(?:\.exe)?|node(?:\.exe)?|nodejs|perl|ruby|php|source)`;

/**
 * Checks whether a command string attempts to execute any file in targets.
 */
export function scanDownloadThenExec(
  text: string,
  targets: Set<string>,
  file: string
): AstCapabilityFact[] {
  if (targets.size === 0 || !text || text.length > 20000) return [];
  const facts: AstCapabilityFact[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = deobfuscate(rawLine);
    const lineNo = i + 1;
    const lowerLine = line.toLowerCase();

    for (const target of targets) {
      if (!lowerLine.includes(target.toLowerCase())) continue;

      const escaped = escapeRegExp(target);

      // (1) Interpreter execution: interpreter at command position followed by optional flags and target file
      const interpRegex = new RegExp(
        `(?:^|[;&|(\\x60]\\s*)\\s*${INTERPRETERS}\\b(?:\\s+-[a-zA-Z0-9_-]+)*\\s+["']?(?:[^\\s"'\\x60;&|]*[\\\\/])?${escaped}["']?(?=$|[\\s;&|])`,
        'i'
      );

      // (2) Direct execution: command position with ./, .\, /, or drive path
      const directRegex = new RegExp(
        `(?:^|[;&|(\\x60]\\s*)\\s*["']?(?:\\.\\/|\\.\\\\|[a-zA-Z]:[\\\\/]|/)(?:[^\\s"'\\x60;&|]*[\\\\/])?${escaped}["']?(?=$|[\\s;&|])`,
        'i'
      );

      // (3) Exec/eval/start/call/source
      const utilRegex = new RegExp(
        `(?:^|[;&|(\\x60]\\s*)\\s*(?:exec|eval|start|call|source)\\s+["']?(?:[^\\s"'\\x60;&|]*[\\\\/])?${escaped}["']?(?=$|[\\s;&|])`,
        'i'
      );

      if (interpRegex.test(line) || directRegex.test(line) || utilRegex.test(line)) {
        facts.push({
          ruleId: 'ARG_DOWNLOAD_THEN_EXEC',
          category: 'PROC_EXEC',
          file,
          line: lineNo,
          snippet: rawLine.trim().slice(0, 200),
          deterministicRisk: RiskLevel.HOLD,
        });
        break;
      }
    }
  }

  return facts;
}

/**
 * Tokenizer for denylist checks: splits on whitespace, quotes and the shell
 * separators `;`, `&`, `|` (covers `;`, `&&`, `||`), then trims dangling
 * punctuation the way a shell would.
 */
function tokenize(value: string): string[] {
  const raw = value.match(/[^\s"'`;&|]+/g) ?? [];
  return raw
    .map((tok) => tok.replace(/^[;,()&|<>]+|[;,()&|<>]+$/g, ''))
    .filter((tok) => tok.length > 0);
}

/** Shell-looking argument values also go through scanShellSnippet. */
const SHELL_LOOKING = /\b(curl|wget|powershell|cmd|iex)\b|\.exe\b|invoke-/i;

/** Code-looking argument values also go through scanJavascript/scanPythonCode. */
const CODE_LOOKING = /function|=>|\bimport\s|\brequire\s*\(|^\s*def\s/m;

const TAINT_OR_CODE_LOOKING =
  /function|=>|\bimport\s|\brequire\s*\(|^\s*def\s|\bzlib\b|\bcreateBrotliDecompress\b|\bbrotliDecompress|\bRegexp\.(?:new|compile|union)\b|\bos\.(?:environ|getenv)\b|\bopen\s*\([^)]*\.env|\burllib|\brequests\b|\bhttpx\b|\bsession\.(?:upload_progress|serialize_handler)\b/m;

/** Recursively collects every string value in a JSON-ish structure. */
function collectStrings(value: unknown, out: string[], seen: Set<unknown>): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return; // cycle guard
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, seen);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    collectStrings((value as Record<string, unknown>)[key], out, seen);
  }
}

function evidenceSummaryOf(facts: AstCapabilityFact[]): string {
  const risk = new Map<string, RiskLevel>();
  const order: string[] = [];
  for (const f of facts) {
    const prev = risk.get(f.ruleId);
    if (prev === undefined) {
      risk.set(f.ruleId, f.deterministicRisk);
      order.push(f.ruleId);
    } else if (f.deterministicRisk > prev) {
      risk.set(f.ruleId, f.deterministicRisk);
    }
  }
  const sorted = [...order].sort(
    (a, b) => (risk.get(b) ?? RiskLevel.PASS) - (risk.get(a) ?? RiskLevel.PASS)
  );
  return sorted.slice(0, 3).join(', ');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class StdioFirewall {
  readonly sessionId: string;
  readonly maxResultBytes: number;
  /** Most recently recorded audit tx (blocked or committed). */
  lastTx: AtomicAuditTx | null = null;
  /** txId of the previous call in this session — chains the Multiverse DAG. */
  private prevTxId: string | null = null;
  /** Optional sink for every recorded tx (CLI telemetry uses this). */
  onTx: ((tx: AtomicAuditTx) => void) | null = null;
  /** Optional sink for non-blocking WARN alerts (e.g. injection-like tool output) or post-install alerts. */
  onAlert: ((alert: { level: 'WARN' | 'HOLD'; message: string; target?: string }) => void) | null = null;

  /** Session-scoped tracking of downloaded files (R4: multi-command chain detection). */
  private readonly downloadedFiles = new Set<string>();

  /** Tracks pending package install commands to trigger post-install .pth scanning. */
  private pendingInstall = false;

  private readonly opts: FirewallOptions;

  constructor(opts: FirewallOptions) {
    this.opts = opts;
    this.sessionId =
      opts.sessionId ??
      newTxId({ kind: 'session', agentHost: opts.agentHost, serverId: opts.serverId, uuid: randomUUID() });
    this.maxResultBytes = opts.maxResultBytes ?? 32768;
  }

  private get ledger(): LedgerDb | null {
    return this.opts.ledger ?? null;
  }

  private get jev(): JevDecisionClient | null {
    return this.opts.jev ?? null;
  }

  /**
   * Core policy check on a tools/call — pure, spawn-free.
   * Deterministic facts come from:
   * (a) denylist tokenization of every string value (and the tool name),
   * (b) dangerous shell commands and package install commands,
   * (c) multi-command download-then-exec chain detection,
   * (d) scanShellSnippet on shell-looking values,
   * (e) scanJavascript + scanPythonCode on code-looking values,
   * (f) live bytepath taint tracking (JS Brotli, Python cred exfil, Ruby regex, PHP session),
   * (g) file argument and on-disk file inspection.
   */
  async inspectToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<PolicyVerdict> {
    const facts: AstCapabilityFact[] = [];
    const seen = new Set<string>();
    const push = (fact: AstCapabilityFact): void => {
      const key = `${fact.ruleId}:${fact.line}:${fact.snippet}`;
      if (seen.has(key)) return;
      seen.add(key);
      facts.push(fact);
    };

    // (a) the tool name itself is tokenized against the denylist.
    this.inspectDenylist(toolName, push);

    // Every string value in the arguments, recursively.
    const strings: string[] = [];
    collectStrings(args ?? {}, strings, new Set());

    // Extract newly downloaded files in this tool call
    const newDownloads: string[] = [];
    for (const value of strings) {
      for (const dl of extractDownloadedFiles(value)) {
        newDownloads.push(dl);
        newDownloads.push(path.posix.basename(dl));
        newDownloads.push(dl.replace(/^\.\//, ''));
      }
    }

    const activeTargets = new Set<string>([
      ...this.downloadedFiles,
      ...newDownloads.map((s) => s.toLowerCase()),
    ]);

    const targetFile =
      typeof args?.path === 'string'
        ? args.path
        : typeof args?.filePath === 'string'
          ? args.filePath
          : typeof args?.TargetFile === 'string'
            ? args.TargetFile
            : typeof args?.file === 'string'
              ? args.file
              : '';

    for (const value of strings) {
      this.inspectDenylist(value, push);
      for (const fact of scanDangerousCommand(value, ARGS_FILE)) push(fact);
      for (const fact of scanPackageInstall(value, ARGS_FILE, { unpinnedRisk: RiskLevel.WARN })) push(fact);
      for (const fact of scanDownloadThenExec(value, activeTargets, ARGS_FILE)) push(fact);
      if (
        /\b(?:http|https):\/\/(?:127\.0\.0\.1|localhost):19999\b|:19999\b/.test(value) ||
        (/\bbeacon\b/i.test(targetFile) && /\b(?:http|https)\.(?:get|request)\b|\bfetch\b|\baxios\b/.test(value))
      ) {
        push({
          ruleId: 'NET_EXFIL_BEACON',
          category: 'NET_EGRESS',
          file: ARGS_FILE,
          line: 0,
          snippet: value.slice(0, 200),
          deterministicRisk: RiskLevel.HOLD,
        });
      }
      if (SHELL_LOOKING.test(value)) {
        for (const fact of scanShellSnippet(value, ARGS_FILE)) push(fact);
      }
      if (CODE_LOOKING.test(value)) {
        for (const fact of scanJavascript(value, ARGS_FILE)) push(fact);
        for (const fact of scanPythonCode(value, ARGS_FILE)) push(fact);
      }
      if (TAINT_OR_CODE_LOOKING.test(value)) {
        for (const fact of taintFactsFromSinks(analyzeBytePathJs(value, ARGS_FILE), ARGS_FILE)) push(fact);
        for (const fact of taintFactsFromSinks(analyzeBytePathPython(value, ARGS_FILE), ARGS_FILE)) push(fact);
        for (const fact of taintFactsFromSinks(analyzeBytePathRuby(value, ARGS_FILE), ARGS_FILE)) push(fact);
        for (const fact of taintFactsFromSinks(analyzeBytePathPhp(value, ARGS_FILE), ARGS_FILE)) push(fact);
      }
    }

    // Inspect files referenced on disk or written by tool call
    this.inspectFileArguments(toolName, args, strings, push);

    const deterministicRisk = maxDeterministicRisk(facts);
    let finalRisk = deterministicRisk;
    let apiDelta = 0;
    let reasoning = 'Deterministic argument scan (no Decision API configured).';
    const jev = this.jev;
    if (jev) {
      const res = await jev.evaluateAstFacts(toolName, '', facts);
      finalRisk = res.finalRisk;
      apiDelta = res.apiDelta;
      reasoning = res.reasoning;
    }

    // If not blocked, commit newly downloaded files to session tracking
    if (finalRisk !== RiskLevel.HOLD) {
      for (const dl of newDownloads) {
        this.downloadedFiles.add(dl.toLowerCase());
      }
    }

    return {
      target: toolName,
      category: 'MCP_SERVER',
      deterministicRisk,
      apiDelta,
      finalRisk,
      reasoning,
      evidenceSummary: evidenceSummaryOf(facts),
      facts,
      disposition: finalRisk === RiskLevel.HOLD ? 'BLOCKED_PRE_EXEC' : 'COMMITTED',
    };
  }

  /** Inspects file paths on disk or file-writing arguments for .pth startup hooks and bytepath taint sinks. */
  private inspectFileArguments(
    toolName: string,
    args: Record<string, unknown>,
    strings: string[],
    push: (fact: AstCapabilityFact) => void
  ): void {
    const targetFile = typeof args.path === 'string'
      ? args.path
      : typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.TargetFile === 'string'
          ? args.TargetFile
          : typeof args.file === 'string'
            ? args.file
            : '';

    const content = typeof args.content === 'string'
      ? args.content
      : typeof args.CodeContent === 'string'
        ? args.CodeContent
        : typeof args.text === 'string'
          ? args.text
          : '';

    if (targetFile && targetFile.toLowerCase().endsWith('.pth') && content) {
      for (const fact of scanPythonPth(content, targetFile)) {
        push(fact);
      }
    }

    const fileCandidates = new Set<string>();
    if (targetFile) fileCandidates.add(targetFile);

    for (const str of strings) {
      if (str.length < 300 && (str.endsWith('.js') || str.endsWith('.ts') || str.endsWith('.py') || str.endsWith('.pth') || str.endsWith('.rb') || str.endsWith('.php'))) {
        fileCandidates.add(str.trim().replace(/^['"]|['"]$/g, ''));
      }
    }

    for (const f of fileCandidates) {
      try {
        const resolved = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          const size = fs.statSync(resolved).size;
          if (size <= 1024 * 1024) {
            const fileCode = fs.readFileSync(resolved, 'utf8');
            const lowerF = resolved.toLowerCase();
            if (lowerF.endsWith('.pth')) {
              for (const fact of scanPythonPth(fileCode, resolved)) push(fact);
            }
            if (lowerF.endsWith('.js') || lowerF.endsWith('.ts')) {
              for (const fact of taintFactsFromSinks(analyzeBytePathJs(fileCode, resolved), resolved)) push(fact);
            }
            if (lowerF.endsWith('.py')) {
              for (const fact of taintFactsFromSinks(analyzeBytePathPython(fileCode, resolved), resolved)) push(fact);
            }
            if (lowerF.endsWith('.rb')) {
              for (const fact of taintFactsFromSinks(analyzeBytePathRuby(fileCode, resolved), resolved)) push(fact);
            }
            if (lowerF.endsWith('.php')) {
              for (const fact of taintFactsFromSinks(analyzeBytePathPhp(fileCode, resolved), resolved)) push(fact);
            }
          }
        }
      } catch {
        // ignore disk read errors
      }
    }
  }

  /** (a) tokenizer + isProtectedPath on one string; any hit is a HOLD fact. */
  private inspectDenylist(value: string, push: (fact: AstCapabilityFact) => void): void {
    for (const token of tokenize(value)) {
      const hit = isProtectedPath(token);
      if (hit.protected) {
        push({
          ruleId: 'ARG_PROTECTED_PATH',
          category: 'CRED_ACCESS',
          file: ARGS_FILE,
          line: 0,
          snippet: token.slice(0, 200),
          deterministicRisk: RiskLevel.HOLD,
        });
      }
    }
  }

  /**
   * Handle one JSON-RPC message from the IDE side. Only `tools/call` requests
   * (method === 'tools/call', params.name present, id present) are inspected;
   * everything else — notifications included — returns null so the caller
   * forwards it untouched. A HOLD verdict returns the contract blocked
   * response (code -32001) and the call is NEVER forwarded. PASS/WARN returns
   * null (forward; target spawns lazily).
   */
  async handleClientMessage(msg: unknown): Promise<unknown | null> {
    if (!isJsonObject(msg)) return null;
    if (msg.method !== 'tools/call') return null;
    if (msg.id === undefined) return null; // notification: forward untouched
    const params = msg.params;
    if (!isJsonObject(params) || typeof params.name !== 'string') return null;
    const args = isJsonObject(params.arguments) ? params.arguments : {};

    const verdict = await this.inspectToolCall(params.name, args);
    if (verdict.finalRisk !== RiskLevel.HOLD) {
      const cmdStr = JSON.stringify(args);
      if (/\bpip(?:\.exe)?\s+install\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|i)\b/i.test(cmdStr)) {
        this.pendingInstall = true;
      }
    }
    const ts = Date.now();
    const meta = isJsonObject(params._meta) ? params._meta : {};
    const tx: AtomicAuditTx = {
      txId: newTxId({ toolName: params.name, args, sessionId: this.sessionId, ts }),
      sessionId: this.sessionId,
      fiberId: 'inline',
      parentTxId: this.prevTxId,
      agentHost: this.opts.agentHost,
      timestampMs: ts,
      policyCharterId: POLICY_CHARTER_ID,
      statedExplanation: typeof meta.statedPurpose === 'string' ? meta.statedPurpose : '',
      mcpServerId: this.opts.serverId,
      toolName: params.name,
      redactedArgumentsJson: redactSecrets(JSON.stringify(args ?? {})).output,
      deterministicRisk: verdict.deterministicRisk,
      decisionApiDelta: verdict.apiDelta,
      finalMonotonicRisk: verdict.finalRisk,
      fsModifiedFilesJson: '[]',
      turboquantSlabIndex: null,
      anomalyScore: 0,
      violationDetected: verdict.finalRisk === RiskLevel.HOLD ? 1 : 0,
      disposition: verdict.disposition,
    };
    if (this.ledger) this.ledger.insertAtomicTx(tx);
    this.lastTx = tx;
    this.prevTxId = tx.txId;
    if (this.onTx) {
      try {
        this.onTx(tx);
      } catch {
        // telemetry sink failure must never break the pump
      }
    }

    if (verdict.finalRisk === RiskLevel.HOLD) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32001,
          message: 'astram Policy Charter blocked this tool call',
          data: {
            tool: params.name,
            finalRisk: riskToName(verdict.finalRisk),
            facts: verdict.facts,
            charter: POLICY_CHARTER_ID,
          },
        },
      };
    }
    return null; // PASS/WARN: caller forwards; target spawns lazily
  }

  /**
   * Handle one message from the MCP server side: stringify, compact (redact /
   * strip ANSI / byte cap). If the compacted string differs from the input,
   * it is parsed back so the caller receives a structured value again; if
   * truncation made the JSON unparseable the truncated text is returned
   * wrapped in a valid `{ 'astram:truncated-result': string }` envelope.
   */
  async handleServerMessage(rawMsg: unknown): Promise<unknown> {
    if (this.pendingInstall) {
      this.pendingInstall = false;
      try {
        const pthFacts = scanDirectoryForPth(process.cwd());
        const holdFacts = pthFacts.filter((f) => f.deterministicRisk === RiskLevel.HOLD);
        if (holdFacts.length > 0 && this.onAlert) {
          this.onAlert({
            level: 'HOLD',
            message: `astram: Malicious .pth startup hook detected post-install (${holdFacts.map((f) => f.ruleId).join(', ')})`,
            target: this.opts.serverId,
          });
        } else if (this.onAlert) {
          this.onAlert({
            level: 'WARN',
            message: `astram: Completed post-install hook scan (${pthFacts.length} .pth files inspected)`,
            target: this.opts.serverId,
          });
        }
      } catch {
        // ignore errors during post-install sweep
      }
    }
    const msg = this.flagInjection(rawMsg);
    const input = JSON.stringify(msg ?? null);
    const { output } = compactMcpResult(msg, this.maxResultBytes);
    if (output === input) return msg;
    try {
      return JSON.parse(output);
    } catch {
      // Over the byte cap: shrink the string leaves in place so the JSON-RPC
      // envelope (jsonrpc/id/result shape) survives. Replacing the whole
      // message with an id-less wrapper would leave the agent waiting forever
      // on its request id.
      if (msg !== null && typeof msg === 'object') {
        return this.truncateStructurally(msg);
      }
      return { 'astram:truncated-result': output };
    }
  }

  /**
   * Tool output that tries to instruct the agent is untrusted data. It is NOT
   * blocked (no verdict math, Invariant I1 untouched): matching text leaves
   * under `result` get a visible notice prepended and a WARN alert is raised.
   */
  private flagInjection(msg: unknown): unknown {
    if (msg === null || typeof msg !== 'object') return msg;
    const result = (msg as { result?: unknown }).result;
    if (result === undefined) return msg;
    const hits: string[] = [];
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const found = detectInjection(v);
        if (found.length === 0) return v;
        hits.push(...found);
        return `${INJECTION_NOTICE}
${v}`;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      }
      return v;
    };
    const flagged = walk(result);
    if (hits.length === 0) return msg;
    if (this.onAlert) {
      try {
        this.onAlert({
          level: 'WARN',
          message: `astram: tool output from ${this.opts.serverId} contains instruction-like text (${[...new Set(hits)].join(', ')})`,
          target: this.opts.serverId,
        });
      } catch {
        // telemetry sink failure must never break the pump
      }
    }
    return { ...(msg as object), result: flagged };
  }

  /** Redact + strip each string leaf, then truncate leaves to fit maxResultBytes overall. */
  private truncateStructurally(msg: object): unknown {
    const clean = (v: unknown): unknown => {
      if (typeof v === 'string') return stripAnsi(redactSecrets(v).output);
      if (Array.isArray(v)) return v.map(clean);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
      }
      return v;
    };
    const cleaned = clean(msg);
    const leaves: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') leaves.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(cleaned);
    const overhead = Buffer.byteLength(JSON.stringify(cleaned), 'utf8') -
      leaves.reduce((n, l) => n + Buffer.byteLength(JSON.stringify(l), 'utf8'), 0);
    // Short leaves (jsonrpc, type, ids...) keep their size; only the big ones share the budget.
    const SMALL = 256;
    const small = leaves.filter((l) => Buffer.byteLength(l, 'utf8') <= SMALL);
    const bigCount = leaves.length - small.length;
    const smallBytes = small.reduce((n, l) => n + Buffer.byteLength(l, 'utf8'), 0);
    const perLeaf = Math.max(
      SMALL,
      Math.floor((this.maxResultBytes - overhead - smallBytes) / Math.max(1, bigCount))
    );
    const shrink = (v: unknown): unknown => {
      if (typeof v === 'string') return truncateUtf8Safe(v, perLeaf).output;
      if (Array.isArray(v)) return v.map(shrink);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x)]));
      }
      return v;
    };
    return shrink(cleaned);
  }
}
