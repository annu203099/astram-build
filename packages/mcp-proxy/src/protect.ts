/**
 * @astram/mcp-proxy — workspace/user-home harness config wrapper.
 *
 * `wrapMcpServerEntry` is the pure transform (Handbook §2 "Automatic MCP
 * Config Transformation Example"); `protectWorkspace` walks every supported
 * harness config (Antigravity, Claude Code/Desktop, Cursor, Codex, Quill),
 * persists the original via ledger.saveConfigBackup BEFORE rewriting, wraps
 * every unwrapped mcpServers entry through astram-mcp-proxy and is idempotent.
 * Binding contract: docs/CONTRACTS.md §6.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { defaultLedgerPath, type LedgerDb } from '@astram/db';
import { isProtectedPath, maxDeterministicRisk, riskToName, RiskLevel } from '@astram/types';
import type { AgentHost, AstCapabilityFact } from '@astram/types';
import { scanDangerousCommand } from './dangerous-commands.js';
import { scanLockfile } from '@astram/gatekeeper';
import { redactSecrets } from './redact.js';

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  [k: string]: unknown;
}

export interface WrapEntryInput {
  agentHost: AgentHost;
  serverId: string;
  proxyModulePath: string;
  ledgerDbPath: string;
  dashboardWsUrl: string;
}

export interface ProtectReport {
  wrapped: { agentHost: AgentHost; configPath: string; servers: string[] }[];
  skipped: { configPath: string; reason: string }[];
}

export interface ProtectOptions {
  homeDir?: string;
  ledger?: LedgerDb | null;
  proxyModulePath?: string;
  ledgerDbPath?: string;
  dashboardWsUrl?: string;
  agentHosts?: AgentHost[];
  projectRoots?: string[];
  /** Which config scopes to touch (default 'both'). */
  scope?: 'global' | 'project' | 'both';
}

export interface DiscoveredConfigPath {
  path: string;
  scope: 'global' | 'project';
  exists: boolean;
  isWrapped: boolean;
  serverCount: number;
  serverNames: string[];
}

export interface DiscoveredAgent {
  agentHost: AgentHost;
  name: string;
  description: string;
  installed: boolean;
  configPaths: DiscoveredConfigPath[];
}

/**
 * Absolute path of this package's compiled proxy CLI (dist/cli-proxy.js).
 * Works both from src/ (vitest/tsx) and dist/ (tsc output) because src and
 * dist are siblings inside the package.
 */
export function defaultProxyModulePath(): string {
  // Installed bundle: cli-proxy.mjs sits next to the bundled entry points.
  const bundled = fileURLToPath(new URL('./cli-proxy.mjs', import.meta.url));
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(new URL('../dist/cli-proxy.js', import.meta.url));
}

/** Node executable written into wrapped configs (installer sets ASTRAM_NODE to its bundled node.exe). */
function proxyNodeCommand(): string {
  return process.env.ASTRAM_NODE || 'node';
}

/** An entry is already proxied iff its first arg is the proxy module or it
 *  carries the ASTRAM_ORIGINAL_JSON marker env. Already-wrapped entries are
 *  returned unchanged (idempotency). */
export function isAlreadyWrapped(entry: McpServerEntry, proxyModulePath: string): boolean {
  if (Array.isArray(entry.args) && entry.args[0] === proxyModulePath) return true;
  const env = entry.env;
  return !!env && typeof env === 'object' && 'ASTRAM_ORIGINAL_JSON' in env;
}

/** Pure config transform — wraps one mcpServers entry through the proxy. */
export function wrapMcpServerEntry(entry: McpServerEntry, input: WrapEntryInput): McpServerEntry {
  if (isAlreadyWrapped(entry, input.proxyModulePath)) return entry;

  const baseArgs = [
    input.proxyModulePath,
    '--agent-host',
    input.agentHost,
    '--server-id',
    input.serverId,
  ];
  const env: Record<string, string> = { ...(entry.env ?? {}) };
  env.AEGIS_LEDGER_DB = input.ledgerDbPath;
  env.AEGIS_DASHBOARD_WS = input.dashboardWsUrl;
  // The full original entry (extra keys included) survives, redacted, in env.
  env.ASTRAM_ORIGINAL_JSON = redactSecrets(JSON.stringify(entry ?? {})).output;

  if (typeof entry.url === 'string') {
    // http entry: url kept in ASTRAM_TARGET_URL; proxy spawned the same way.
    env.ASTRAM_TARGET_URL = entry.url;
    // Auth headers must reach the remote server verbatim (ASTRAM_ORIGINAL_JSON is redacted).
    if (entry.headers && typeof entry.headers === 'object') {
      env.ASTRAM_TARGET_HEADERS_JSON = JSON.stringify(entry.headers);
    }
    return { command: proxyNodeCommand(), args: baseArgs, env };
  }

  // --target-args is comma-joined (contract); args that themselves contain a
  // comma would be split apart, so ship the exact array out-of-band too.
  if (Array.isArray(entry.args) && entry.args.some((a) => String(a).includes(','))) {
    env.ASTRAM_TARGET_ARGS_JSON = JSON.stringify(entry.args.map(String));
  }

  return {
    command: proxyNodeCommand(),
    args: [
      ...baseArgs,
      '--target-cmd',
      String(entry.command ?? ''),
      '--target-args',
      (Array.isArray(entry.args) ? entry.args : []).join(','),
    ],
    env,
  };
}

// ---------------------------------------------------------------------------
// protectWorkspace
// ---------------------------------------------------------------------------

type ConfigFormat = 'json' | 'toml' | 'yaml';

interface TargetSpec {
  agentHost: AgentHost;
  file: string;
  format: ConfigFormat;
  /** Where server entries live once parsed ('mcpServers' or 'mcp_servers'). */
  serversKey: string;
  scope?: 'global' | 'project';
  /** Also wrap projects.<path>.<serversKey> (Claude Code ~/.claude.json). */
  nestedProjects?: boolean;
}

/** Antigravity user-level MCP configs (legacy ~/.gemini/antigravity + current ~/.gemini/config). */
function antigravityGlobalTargets(homeDir: string): TargetSpec[] {
  return [
    path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'),
    path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
  ].map((file) => ({
    agentHost: 'antigravity' as AgentHost,
    file,
    format: 'json' as ConfigFormat,
    serversKey: 'mcpServers',
    scope: 'global' as const,
  }));
}

/** An entry is wrappable iff it declares a stdio command or an HTTP url. */
function isWrappable(entry: unknown): entry is McpServerEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
  const e = entry as McpServerEntry;
  return typeof e.command === 'string' || typeof e.url === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per-target shared pieces of WrapEntryInput (agentHost/serverId vary per entry). */
interface SharedWrapInput {
  proxyModulePath: string;
  ledgerDbPath: string;
  dashboardWsUrl: string;
}

/**
 * Register a server in the Slowship Boarding Manifest with a deterministic scan
 * of its launch command (what the agent would execute), so the dashboard shows
 * what is boarding the ship. Never throws: the manifest must not block wrapping.
 */
function recordBoardingItem(
  ledger: LedgerDb | null,
  spec: TargetSpec,
  name: string,
  entry: McpServerEntry
): void {
  if (!ledger) return;
  try {
    const parts = [entry.command ?? '', ...(Array.isArray(entry.args) ? entry.args.map(String) : [])];
    const commandLine = parts.join(' ').trim();
    const facts: AstCapabilityFact[] = [...scanDangerousCommand(commandLine, '<launch>')];
    for (const tok of parts) {
      if (isProtectedPath(tok).protected) {
        facts.push({
          ruleId: 'ARG_PROTECTED_PATH',
          category: 'CRED_ACCESS',
          file: '<launch>',
          line: 0,
          snippet: tok.slice(0, 200),
          deterministicRisk: RiskLevel.HOLD,
        });
      }
    }
    const risk = maxDeterministicRisk(facts);
    const status = riskToName(risk);
    ledger.upsertBoardingItem({
      itemId: `mcp:${spec.agentHost}:${spec.file}:${name}`,
      category: 'MCP_SERVER',
      targetName: `${spec.agentHost}/${name}`,
      deterministicStatus: status,
      jevApiAdjustment: 0,
      finalStatus: status,
      evidenceSummary:
        facts.length > 0
          ? `launch command flagged: ${[...new Set(facts.map((f) => f.ruleId))].join(', ')}`
          : typeof entry.url === 'string'
            ? 'remote MCP server (HTTP bridge) wrapped by astram-mcp-proxy'
            : 'launch command clean; wrapped by astram-mcp-proxy',
      astFactsJson: JSON.stringify(facts),
      ed25519Sig: null,
      updatedAtMs: Date.now(),
    });
  } catch {
    /* manifest is best-effort */
  }
}

/**
 * Scans workspace lockfiles (requirements.txt, pyproject.toml, package-lock.json, pnpm-lock.yaml)
 * and records any identified facts into the Slowship Boarding Manifest in SQLite.
 */
export function recordLockfileBoardingItems(
  ledger: LedgerDb | null,
  rootDir: string
): AstCapabilityFact[] {
  if (!existsSync(rootDir)) return [];
  const candidates: { file: string; kind: 'pip' | 'pyproject' | 'npm' | 'pnpm' }[] = [
    { file: path.join(rootDir, 'requirements.txt'), kind: 'pip' },
    { file: path.join(rootDir, 'pyproject.toml'), kind: 'pyproject' },
    { file: path.join(rootDir, 'package-lock.json'), kind: 'npm' },
    { file: path.join(rootDir, 'pnpm-lock.yaml'), kind: 'pnpm' },
  ];
  const allFacts: AstCapabilityFact[] = [];
  for (const c of candidates) {
    if (existsSync(c.file)) {
      try {
        const content = readFileSync(c.file, 'utf8');
        const facts = scanLockfile(content, c.kind, c.file);
        allFacts.push(...facts);
        if (ledger && facts.length > 0) {
          const maxRisk = maxDeterministicRisk(facts);
          const status = riskToName(maxRisk);
          ledger.upsertBoardingItem({
            itemId: `lockfile:${path.basename(c.file)}`,
            category: 'LOCKFILE_PKG',
            targetName: path.basename(c.file),
            deterministicStatus: status,
            jevApiAdjustment: 0,
            finalStatus: status,
            evidenceSummary: facts.map((f) => f.snippet).slice(0, 3).join('; '),
            astFactsJson: JSON.stringify(facts),
            ed25519Sig: null,
            updatedAtMs: Date.now(),
          });
        }
      } catch {
        /* best effort */
      }
    }
  }
  return allFacts;
}

/**
 * Rewrites one config file. Returns the list of newly wrapped server names,
 * or a skip reason when nothing was (or could be) wrapped.
 */
function protectOneFile(
  spec: TargetSpec,
  shared: SharedWrapInput,
  ledger: LedgerDb | null
): { wrapped: string[] } | { skipped: string } {
  if (!existsSync(spec.file)) return { skipped: 'file not found' };
  let original: string;
  try {
    original = readFileSync(spec.file, 'utf8');
  } catch (err) {
    return { skipped: `unreadable: ${(err as Error).message}` };
  }

  if (original.trim() === '') return { skipped: `no ${spec.serversKey} (empty file)` };

  let doc: Record<string, unknown>;
  try {
    if (spec.format === 'toml') doc = parseToml(original) as Record<string, unknown>;
    else if (spec.format === 'yaml') doc = parseYaml(original) as Record<string, unknown>;
    else doc = JSON.parse(original) as Record<string, unknown>;
  } catch (err) {
    return { skipped: `parse error: ${(err as Error).message}` };
  }
  if (!isRecord(doc)) return { skipped: `no ${spec.serversKey} (document is not an object)` };

  const servers = doc[spec.serversKey];
  // Claude Code keeps local-scope servers per project: ~/.claude.json -> projects.<path>.mcpServers
  const containers: Record<string, unknown>[] = isRecord(servers) ? [servers] : [];
  if (spec.nestedProjects && isRecord(doc.projects)) {
    for (const proj of Object.values(doc.projects)) {
      if (isRecord(proj) && isRecord(proj[spec.serversKey])) {
        containers.push(proj[spec.serversKey] as Record<string, unknown>);
      }
    }
  }
  if (containers.length === 0) return { skipped: `no ${spec.serversKey}` };

  const wrappedNames: string[] = [];
  for (const container of containers) {
    for (const name of Object.keys(container)) {
      const entry = container[name];
      if (!isWrappable(entry)) continue; // malformed entry: leave untouched
      if (isAlreadyWrapped(entry, shared.proxyModulePath)) continue;
      recordBoardingItem(ledger, spec, name, entry);
      container[name] = wrapMcpServerEntry(entry, {
        agentHost: spec.agentHost,
        serverId: name,
        ...shared,
      });
      wrappedNames.push(name);
    }
  }
  if (wrappedNames.length === 0) {
    return { skipped: `no unwrapped ${spec.serversKey} entries (already wrapped or empty)` };
  }

  // Original persisted BEFORE the rewrite (Handbook §2: backup into SQLite).
  if (ledger) {
    ledger.saveConfigBackup(spec.agentHost, spec.file, original);
  }

  let out: string;
  if (spec.format === 'toml') out = `${stringifyToml(doc as never)}\n`;
  else if (spec.format === 'yaml') out = `${stringifyYaml(doc)}\n`;
  else out = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(spec.file, out, 'utf8');
  return { wrapped: wrappedNames };
}

/**
 * Scan a workspace (+user homes) and wrap every supported harness config
 * found. Idempotent: already-wrapped entries are detected and skipped, so a
 * second run wraps nothing new and writes no new backups.
 */
export async function protectWorkspace(
  rootDir: string,
  opts?: ProtectOptions
): Promise<ProtectReport> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const proxyModulePath = opts?.proxyModulePath ?? defaultProxyModulePath();
  const ledgerDbPath = opts?.ledgerDbPath ?? defaultLedgerPath();
  const dashboardWsUrl = opts?.dashboardWsUrl ?? 'ws://127.0.0.1:3080/ws/telemetry';
  const ledger = opts?.ledger ?? null;
  const shared: SharedWrapInput = { proxyModulePath, ledgerDbPath, dashboardWsUrl };

  const j = (agentHost: AgentHost, file: string, scope: 'global' | 'project'): TargetSpec => ({
    agentHost, file, format: 'json', serversKey: 'mcpServers', scope,
  });
  const globalTargets: TargetSpec[] = [
    ...antigravityGlobalTargets(homeDir),
    { ...j('claude-code', path.join(homeDir, '.claude.json'), 'global'), nestedProjects: true },
    j('claude-code', path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), 'global'),
    j('cursor', path.join(homeDir, '.cursor', 'mcp.json'), 'global'),
    { agentHost: 'codex', file: path.join(homeDir, '.codex', 'config.toml'), format: 'toml', serversKey: 'mcp_servers', scope: 'global' },
    { agentHost: 'quill', file: path.join(homeDir, '.quill', 'config.yaml'), format: 'yaml', serversKey: 'mcpServers', scope: 'global' },
    j('dsh', path.join(homeDir, '.dsh', 'config.json'), 'global'),
  ];
  const projectTargetsFor = (root: string): TargetSpec[] => [
    j('antigravity', path.join(root, '.agents', 'mcp_config.json'), 'project'),
    j('claude-code', path.join(root, '.mcp.json'), 'project'),
    j('cursor', path.join(root, '.cursor', 'mcp.json'), 'project'),
    { agentHost: 'codex', file: path.join(root, '.codex', 'config.toml'), format: 'toml', serversKey: 'mcp_servers', scope: 'project' },
    ...[
          { agentHost: 'quill' as AgentHost, file: path.join(root, '.quill', 'config.yaml'), format: 'yaml' as ConfigFormat, serversKey: 'mcpServers', scope: 'project' as const },
          j('dsh', path.join(root, 'dsh_home', 'config.json'), 'project'),
        ],
  ];

  const extended = !!(opts?.projectRoots && opts.projectRoots.length > 0);
  const roots = extended ? opts!.projectRoots! : [rootDir];
  const scope = opts?.scope ?? 'both';

  if (scope !== 'global') {
    for (const r of roots) {
      recordLockfileBoardingItems(ledger, r);
    }
  }
  let targets: TargetSpec[] = [
    ...(scope === 'global' ? [] : roots.flatMap((r) => projectTargetsFor(r))),
    ...(scope === 'project' ? [] : globalTargets),
  ];
  // de-duplicate (a project root may equal the home dir)
  const seen = new Set<string>();
  targets = targets.filter((t) => (seen.has(t.file) ? false : (seen.add(t.file), true)));

  const filteredTargets =
    opts?.agentHosts && opts.agentHosts.length > 0
      ? targets.filter((t) => opts.agentHosts!.includes(t.agentHost))
      : targets;

  const report: ProtectReport = { wrapped: [], skipped: [] };
  for (const spec of filteredTargets) {
    const result = protectOneFile(spec, shared, ledger);
    if ('wrapped' in result) {
      report.wrapped.push({ agentHost: spec.agentHost, configPath: spec.file, servers: result.wrapped });
    } else {
      report.skipped.push({ configPath: spec.file, reason: result.skipped });
    }
  }
  return report;
}

/**
 * Inspect one candidate config file without modifying it.
 */
function inspectConfigPath(
  filePath: string,
  scope: 'global' | 'project',
  format: ConfigFormat,
  serversKey: string,
  proxyModulePath: string
): DiscoveredConfigPath {
  if (!existsSync(filePath)) {
    return {
      path: filePath,
      scope,
      exists: false,
      isWrapped: false,
      serverCount: 0,
      serverNames: [],
    };
  }

  let original: string;
  try {
    original = readFileSync(filePath, 'utf8');
  } catch {
    return {
      path: filePath,
      scope,
      exists: true,
      isWrapped: false,
      serverCount: 0,
      serverNames: [],
    };
  }

  let doc: Record<string, unknown>;
  try {
    if (format === 'toml') doc = parseToml(original) as Record<string, unknown>;
    else if (format === 'yaml') doc = parseYaml(original) as Record<string, unknown>;
    else doc = JSON.parse(original) as Record<string, unknown>;
  } catch {
    return {
      path: filePath,
      scope,
      exists: true,
      isWrapped: false,
      serverCount: 0,
      serverNames: [],
    };
  }

  if (!isRecord(doc)) {
    return {
      path: filePath,
      scope,
      exists: true,
      isWrapped: false,
      serverCount: 0,
      serverNames: [],
    };
  }

  const servers = doc[serversKey];
  if (!isRecord(servers)) {
    return {
      path: filePath,
      scope,
      exists: true,
      isWrapped: false,
      serverCount: 0,
      serverNames: [],
    };
  }

  const serverNames = Object.keys(servers);
  const serverCount = serverNames.length;
  const isWrapped =
    serverCount > 0 &&
    serverNames.every((name) => {
      const entry = servers[name];
      return isRecord(entry) && isAlreadyWrapped(entry as McpServerEntry, proxyModulePath);
    });

  return {
    path: filePath,
    scope,
    exists: true,
    isWrapped,
    serverCount,
    serverNames,
  };
}

/**
 * Scan workspace and user directories to detect installed AI IDEs and agents,
 * their configuration file states, and whether they are already protected.
 */
export function detectInstalledAgents(
  rootDir: string = process.cwd(),
  homeDir: string = os.homedir(),
  proxyModulePath: string = defaultProxyModulePath()
): DiscoveredAgent[] {
  // Antigravity
  const antigravityConfigs: DiscoveredConfigPath[] = [
    inspectConfigPath(path.join(rootDir, '.agents', 'mcp_config.json'), 'project', 'json', 'mcpServers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'), 'global', 'json', 'mcpServers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.gemini', 'config', 'mcp_config.json'), 'global', 'json', 'mcpServers', proxyModulePath),
  ];
  const antigravityInstalled =
    antigravityConfigs.some((c) => c.exists) ||
    existsSync(path.join(rootDir, '.agents')) ||
    existsSync(path.join(homeDir, '.gemini', 'antigravity')) ||
    existsSync(path.join(homeDir, '.gemini', 'config'));

  // Claude Code & Desktop
  const claudeConfigs: DiscoveredConfigPath[] = [
    inspectConfigPath(path.join(rootDir, '.mcp.json'), 'project', 'json', 'mcpServers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.claude.json'), 'global', 'json', 'mcpServers', proxyModulePath),
    inspectConfigPath(
      path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      'global',
      'json',
      'mcpServers',
      proxyModulePath
    ),
  ];
  const claudeInstalled =
    claudeConfigs.some((c) => c.exists) ||
    existsSync(path.join(homeDir, '.claude')) ||
    existsSync(path.join(homeDir, 'AppData', 'Roaming', 'Claude'));

  // Cursor
  const cursorConfigs: DiscoveredConfigPath[] = [
    inspectConfigPath(path.join(rootDir, '.cursor', 'mcp.json'), 'project', 'json', 'mcpServers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.cursor', 'mcp.json'), 'global', 'json', 'mcpServers', proxyModulePath),
  ];
  const cursorInstalled =
    cursorConfigs.some((c) => c.exists) ||
    existsSync(path.join(rootDir, '.cursor')) ||
    existsSync(path.join(homeDir, '.cursor'));

  // OpenAI Codex CLI
  const codexConfigs: DiscoveredConfigPath[] = [
    inspectConfigPath(path.join(rootDir, '.codex', 'config.toml'), 'project', 'toml', 'mcp_servers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.codex', 'config.toml'), 'global', 'toml', 'mcp_servers', proxyModulePath),
  ];
  const codexInstalled =
    codexConfigs.some((c) => c.exists) ||
    existsSync(path.join(rootDir, '.codex')) ||
    existsSync(path.join(homeDir, '.codex'));

  // Quill-Agent
  const quillConfigs: DiscoveredConfigPath[] = [
    inspectConfigPath(path.join(rootDir, '.quill', 'config.yaml'), 'project', 'yaml', 'mcpServers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.quill', 'config.yaml'), 'global', 'yaml', 'mcpServers', proxyModulePath),
  ];
  const quillInstalled =
    quillConfigs.some((c) => c.exists) ||
    existsSync(path.join(rootDir, '.quill')) ||
    existsSync(path.join(homeDir, '.quill'));

  // DeepSeek Harness
  const dshConfigs: DiscoveredConfigPath[] = [
    inspectConfigPath(path.join(rootDir, 'dsh_home', 'config.json'), 'project', 'json', 'mcpServers', proxyModulePath),
    inspectConfigPath(path.join(homeDir, '.dsh', 'config.json'), 'global', 'json', 'mcpServers', proxyModulePath),
  ];
  const dshInstalled =
    dshConfigs.some((c) => c.exists) ||
    existsSync(path.join(rootDir, 'dsh_home')) ||
    existsSync(path.join(homeDir, '.dsh'));

  return [
    {
      agentHost: 'antigravity',
      name: 'Google Antigravity',
      description: 'Gemini agentic IDE and developer workflow environment',
      installed: antigravityInstalled,
      configPaths: antigravityConfigs,
    },
    {
      agentHost: 'claude-code',
      name: 'Claude Code & Desktop',
      description: 'Anthropic Claude CLI agent and Claude Desktop MCP client',
      installed: claudeInstalled,
      configPaths: claudeConfigs,
    },
    {
      agentHost: 'cursor',
      name: 'Cursor',
      description: 'AI-first code editor with project and user MCP integrations',
      installed: cursorInstalled,
      configPaths: cursorConfigs,
    },
    {
      agentHost: 'codex',
      name: 'OpenAI Codex CLI',
      description: 'OpenAI Codex agent harness with TOML configuration',
      installed: codexInstalled,
      configPaths: codexConfigs,
    },
    {
      agentHost: 'quill',
      name: 'Quill-Agent',
      description: 'Autonomous editing agent harness with YAML configuration',
      installed: quillInstalled,
      configPaths: quillConfigs,
    },
    {
      agentHost: 'dsh',
      name: 'DeepSeek Harness',
      description: 'DeepSeek autonomous agent runner and worktree sandbox',
      installed: dshInstalled,
      configPaths: dshConfigs,
    },
  ];
}

export interface UnprotectReport {
  restored: string[];
  skipped: { configPath: string; reason: string }[];
}

/**
 * Undo `protectWorkspace`: for every config file that has a ledger backup,
 * restore the EARLIEST backup (the pre-astram original) if the file is still
 * wrapped. The wrapped version is kept next to it as <file>.astram-wrapped.bak.
 */
export function unprotectWorkspace(ledger: LedgerDb): UnprotectReport {
  const earliest = new Map<string, string>();
  // listConfigBackups is newest-first, so the last write per path is the original.
  for (const b of ledger.listConfigBackups()) earliest.set(b.configPath, b.contentJson);
  const report: UnprotectReport = { restored: [], skipped: [] };
  for (const [configPath, original] of earliest) {
    if (!existsSync(configPath)) {
      report.skipped.push({ configPath, reason: 'file no longer exists' });
      continue;
    }
    let current = '';
    try {
      current = readFileSync(configPath, 'utf8');
    } catch (err) {
      report.skipped.push({ configPath, reason: `unreadable: ${(err as Error).message}` });
      continue;
    }
    if (!current.includes('ASTRAM_ORIGINAL_JSON')) {
      report.skipped.push({ configPath, reason: 'not wrapped (nothing to restore)' });
      continue;
    }
    writeFileSync(`${configPath}.astram-wrapped.bak`, current, 'utf8');
    writeFileSync(configPath, original, 'utf8');
    report.restored.push(configPath);
  }
  return report;
}
