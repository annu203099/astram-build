/**
 * @astram/types — shared contracts for the astram security microkernel.
 *
 * This file is the single authority for cross-package types and pure helpers.
 * See docs/CONTRACTS.md. Handbook reference: "astram Hackathon Engineering
 * Handbook & Multi-Agent Build Specification" §5.1 / §5.3.
 */
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const ASTRAM_VERSION = '0.1.0';
export const DEFAULT_AEGIS_PORT = 3080;

// ---------------------------------------------------------------------------
// Risk levels & Invariant I1
// ---------------------------------------------------------------------------

export enum RiskLevel {
  PASS = 0,
  WARN = 1,
  HOLD = 2,
}

export type RiskName = 'PASS' | 'WARN' | 'HOLD';

export function riskToName(r: RiskLevel): RiskName {
  return r === RiskLevel.HOLD ? 'HOLD' : r === RiskLevel.WARN ? 'WARN' : 'PASS';
}

export function riskFromName(name: string): RiskLevel {
  const n = String(name ?? '').trim().toUpperCase();
  if (n === 'HOLD') return RiskLevel.HOLD;
  if (n === 'WARN') return RiskLevel.WARN;
  return RiskLevel.PASS;
}

/**
 * HARD ARCHITECTURAL INVARIANT I1 (Slowship Monotonicity Law):
 * An external LLM/Decision API may adjust a non-HOLD fact by at most ±1 step,
 * and is mathematically prohibited from lowering a deterministic HOLD (2).
 */
export function enforceInvariantI1(
  deterministicRisk: RiskLevel,
  apiDelta: number
): RiskLevel {
  if (deterministicRisk === RiskLevel.HOLD) {
    return RiskLevel.HOLD; // Locked: README prompt injection cannot lower a code HOLD
  }
  const safeDelta = Math.max(-1, Math.min(1, Math.trunc(apiDelta || 0)));
  const computed = deterministicRisk + safeDelta;
  return Math.max(RiskLevel.PASS, Math.min(RiskLevel.HOLD, computed)) as RiskLevel;
}

export function maxDeterministicRisk(facts: AstCapabilityFact[]): RiskLevel {
  return facts.reduce((max, f) => Math.max(max, f.deterministicRisk), RiskLevel.PASS) as RiskLevel;
}

// ---------------------------------------------------------------------------
// Agents, capability categories, facts
// ---------------------------------------------------------------------------

export type AgentHost = 'antigravity' | 'claude-code' | 'cursor' | 'codex' | 'quill' | 'dsh';

export const AGENT_HOSTS: readonly AgentHost[] = [
  'antigravity',
  'claude-code',
  'cursor',
  'codex',
  'quill',
  'dsh',
];

export type CapabilityCategory =
  | 'PROC_EXEC'
  | 'DYNAMIC_EVAL'
  | 'CRED_ACCESS'
  | 'NET_EGRESS'
  | 'STARTUP_HOOK'
  | 'BYTEPATH_SINK';

export interface AstCapabilityFact {
  ruleId: string;
  category: CapabilityCategory;
  file: string;
  line: number; // 1-based
  snippet: string; // <= 200 chars, redacted before it ever leaves the host
  deterministicRisk: RiskLevel;
}

export interface JevDecisionResponse {
  contextualDelta: -1 | 0 | 1;
  reasoning: string;
  suggestedPatchSnippet?: string;
}

// ---------------------------------------------------------------------------
// Ledger rows (mirror Handbook §5.2 SQL columns, camelCase in TS)
// ---------------------------------------------------------------------------

export type Disposition = 'COMMITTED' | 'BLOCKED_PRE_EXEC' | 'ROLLED_BACK' | 'CANARY_HEALED';

export interface AtomicAuditTx {
  txId: string; // sha-256 of envelope
  sessionId: string;
  fiberId: string;
  parentTxId: string | null; // Multiverse Execution DAG edge
  agentHost: AgentHost;
  timestampMs: number;
  policyCharterId: string;
  statedExplanation: string; // model/skill claimed intent (untrusted)
  mcpServerId: string;
  toolName: string;
  redactedArgumentsJson: string;
  deterministicRisk: RiskLevel; // 0 | 1 | 2
  decisionApiDelta: number; // -1 | 0 | +1 from Jev
  finalMonotonicRisk: RiskLevel; // enforceInvariantI1 output
  fsModifiedFilesJson: string; // JSON string array
  turboquantSlabIndex: number | null; // Tier 2
  anomalyScore: number;
  violationDetected: 0 | 1;
  disposition: Disposition;
}

export type BoardingCategory =
  | 'LOCKFILE_PKG'
  | 'AGENT_SKILL'
  | 'MCP_SERVER'
  | 'TLS_TRUSTSTORE'
  | 'BYTEPATH_SINK'
  | 'DSH_HOST';

export type BoardingStatus = 'PASS' | 'WARN' | 'HOLD' | 'REMEDIATED';

export interface BoardingManifestItem {
  itemId: string;
  category: BoardingCategory;
  targetName: string;
  deterministicStatus: RiskName;
  jevApiAdjustment: number;
  finalStatus: BoardingStatus;
  evidenceSummary: string;
  astFactsJson: string;
  ed25519Sig: string | null; // set when a clean SKILL.md is signed (Tier 2)
  updatedAtMs: number;
}

/** One gatekeeper evaluation result, consumed by proxy / server / testbed. */
export interface PolicyVerdict {
  target: string;
  category: BoardingCategory;
  deterministicRisk: RiskLevel;
  apiDelta: number;
  finalRisk: RiskLevel;
  reasoning: string;
  evidenceSummary: string;
  facts: AstCapabilityFact[];
  disposition: 'COMMITTED' | 'BLOCKED_PRE_EXEC';
}

// ---------------------------------------------------------------------------
// Multiverse DAG
// ---------------------------------------------------------------------------

export interface DagNode {
  txId: string;
  parentTxId: string | null;
  disposition: Disposition;
  finalRisk: RiskLevel;
  canaryFork: boolean;
  label?: string;
}

export interface DagEdge {
  from: string | null;
  to: string;
}

// ---------------------------------------------------------------------------
// Telemetry (server <-> dashboard, proxy -> server)
// ---------------------------------------------------------------------------

export type TelemetryEvent =
  | { type: 'hello'; payload: { version: string } }
  | { type: 'tx'; payload: AtomicAuditTx }
  | { type: 'alert'; payload: { level: 'WARN' | 'HOLD'; message: string; txId?: string; target?: string } }
  | { type: 'manifest-update'; payload: BoardingManifestItem }
  | { type: 'dag-update'; payload: { nodes: DagNode[]; edges: DagEdge[] } }
  | { type: 'ingest-tx'; payload: AtomicAuditTx }
  | { type: 'ingest-alert'; payload: { level: 'WARN' | 'HOLD'; message: string; txId?: string; target?: string } };

// ---------------------------------------------------------------------------
// Protected credential & path denylist (Handbook §5.4)
// ---------------------------------------------------------------------------

export interface ProtectedPathMatch {
  protected: boolean;
  rule: string | null;
}

const PROTECTED_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.kube']);

/**
 * Pure synchronous check whether a path-like string targets a protected
 * credential location. Normalizes backslashes and case. Callers should
 * tokenize their inputs and check each path-like token.
 */
export function isProtectedPath(pathLike: string): ProtectedPathMatch {
  if (!pathLike || typeof pathLike !== 'string') return { protected: false, rule: null };
  const norm = pathLike.replace(/\\/g, '/').toLowerCase();
  const segs = norm.split('/').filter((s) => s.length > 0);
  if (segs.length === 0) return { protected: false, rule: null };
  const file = segs[segs.length - 1];

  if (/^\.env(\.[^.]+)?$/.test(file) && file !== '.env.example') {
    return { protected: true, rule: 'ENV_FILE' };
  }
  if (file === 'mcp_oauth_tokens.json') {
    return { protected: true, rule: 'ANTIGRAVITY_OAUTH_TOKENS' };
  }
  if (segs.includes('.codex') && file === 'auth.json') {
    return { protected: true, rule: 'CODEX_AUTH' };
  }
  for (const seg of segs) {
    if (PROTECTED_DIR_SEGMENTS.has(seg)) {
      return { protected: true, rule: seg === '.ssh' ? 'SSH_DIR' : seg === '.aws' ? 'AWS_DIR' : seg === '.gnupg' ? 'GPG_DIR' : 'KUBE_DIR' };
    }
  }
  if (norm.includes('appdata') && norm.includes('roaming') && segs.includes('claude')) {
    return { protected: true, rule: 'CLAUDE_DESKTOP_CONFIG_DIR' };
  }
  return { protected: false, rule: null };
}

// ---------------------------------------------------------------------------
// Known-bad packages (supply-chain denylist seeded from the Handbook)
// ---------------------------------------------------------------------------

export interface KnownBadPackage {
  name: string;
  versionRange: string; // semver range understood by the gatekeeper's comparator
  reason: string;
  risk: RiskLevel;
  advisoryId: string;
}

export const KNOWN_BAD_PACKAGES: readonly KnownBadPackage[] = [
  {
    name: 'litellm',
    versionRange: '<=1.107.0',
    reason: 'Installs evil .pth startup hook exfiltrating credentials on interpreter startup (Black October)',
    risk: RiskLevel.HOLD,
    advisoryId: 'AEGIS-BB-LITELLM-1.107.0',
  },
];

// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------

/** Stable sha-256 hex id for an audit envelope. */
export function newTxId(envelope: unknown): string {
  return createHash('sha256').update(JSON.stringify(envelope ?? null)).digest('hex');
}

export function nowMs(): number {
  return Date.now();
}

/** astram home: ASTRAM_HOME override, else %USERPROFILE%\.astram */
export function resolveAstramHome(): string {
  return process.env.ASTRAM_HOME ?? path.join(os.homedir(), '.astram');
}
