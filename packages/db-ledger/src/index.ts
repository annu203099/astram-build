/**
 * @astram/db — astram atomic audit ledger (SQLite WAL + FTS5) + Multiverse DAG.
 *
 * Binding contract: docs/CONTRACTS.md §4. Schema: Handbook §5.2 verbatim plus
 * the documented additions in src/schema.sql (config_backups + FTS sync triggers).
 *
 * The public API exported from this module is EXACTLY the CONTRACTS §4 surface:
 *   LedgerDb, MultiverseDag, defaultLedgerPath.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  resolveAstramHome,
  type AgentHost,
  type AtomicAuditTx,
  type BoardingCategory,
  type BoardingManifestItem,
  type DagEdge,
  type DagNode,
  type Disposition,
  type RiskLevel,
} from '@astram/types';

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

/**
 * schema.sql lives in src/ next to this file. When tests / tsx run the TS
 * source, `import.meta.url` points at src/index.ts, so './schema.sql' resolves.
 * When the compiled dist/index.js runs and the .sql was not copied to dist,
 * the '../src/schema.sql' fallback still resolves (src and dist are siblings
 * inside the package). This keeps `tsc` the only build step.
 */
function loadSchemaSql(): string {
  const candidates = [
    fileURLToPath(new URL('./schema.sql', import.meta.url)),
    fileURLToPath(new URL('../src/schema.sql', import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(
    `@astram/db: schema.sql not found (looked in: ${candidates.join(', ')})`
  );
}

// ---------------------------------------------------------------------------
// snake_case row <-> camelCase domain object mapping
// ---------------------------------------------------------------------------

interface TxRow {
  tx_id: string;
  session_id: string;
  fiber_id: string;
  parent_tx_id: string | null;
  agent_host: string;
  timestamp_ms: number;
  policy_charter_id: string;
  stated_explanation: string;
  mcp_server_id: string;
  tool_name: string;
  redacted_arguments_json: string;
  deterministic_risk: number;
  decision_api_delta: number;
  final_monotonic_risk: number;
  fs_modified_files_json: string;
  turboquant_slab_index: number | null;
  anomaly_score: number;
  violation_detected: number;
  disposition: string;
}

function rowToTx(row: TxRow): AtomicAuditTx {
  return {
    txId: row.tx_id,
    sessionId: row.session_id,
    fiberId: row.fiber_id,
    parentTxId: row.parent_tx_id,
    agentHost: row.agent_host as AtomicAuditTx['agentHost'],
    timestampMs: row.timestamp_ms,
    policyCharterId: row.policy_charter_id,
    statedExplanation: row.stated_explanation,
    mcpServerId: row.mcp_server_id,
    toolName: row.tool_name,
    redactedArgumentsJson: row.redacted_arguments_json,
    deterministicRisk: row.deterministic_risk as RiskLevel,
    decisionApiDelta: row.decision_api_delta,
    finalMonotonicRisk: row.final_monotonic_risk as RiskLevel,
    fsModifiedFilesJson: row.fs_modified_files_json,
    turboquantSlabIndex: row.turboquant_slab_index,
    anomalyScore: row.anomaly_score,
    violationDetected: row.violation_detected as 0 | 1,
    disposition: row.disposition as Disposition,
  };
}

function txToParams(tx: AtomicAuditTx): unknown[] {
  return [
    tx.txId,
    tx.sessionId,
    tx.fiberId,
    tx.parentTxId,
    tx.agentHost,
    tx.timestampMs,
    tx.policyCharterId,
    tx.statedExplanation,
    tx.mcpServerId,
    tx.toolName,
    tx.redactedArgumentsJson,
    tx.deterministicRisk,
    tx.decisionApiDelta,
    tx.finalMonotonicRisk,
    tx.fsModifiedFilesJson,
    tx.turboquantSlabIndex,
    tx.anomalyScore,
    tx.violationDetected,
    tx.disposition,
  ];
}

const TX_COLUMNS = `tx_id, session_id, fiber_id, parent_tx_id, agent_host, timestamp_ms,
  policy_charter_id, stated_explanation, mcp_server_id, tool_name, redacted_arguments_json,
  deterministic_risk, decision_api_delta, final_monotonic_risk, fs_modified_files_json,
  turboquant_slab_index, anomaly_score, violation_detected, disposition`;

interface BoardingRow {
  item_id: string;
  category: string;
  target_name: string;
  deterministic_status: string;
  jev_api_adjustment: number;
  final_status: string;
  evidence_summary: string;
  ast_facts_json: string;
  ed25519_sig: string | null;
  updated_at_ms: number;
}

function rowToBoardingItem(row: BoardingRow): BoardingManifestItem {
  return {
    itemId: row.item_id,
    category: row.category as BoardingCategory,
    targetName: row.target_name,
    deterministicStatus: row.deterministic_status as BoardingManifestItem['deterministicStatus'],
    jevApiAdjustment: row.jev_api_adjustment,
    finalStatus: row.final_status as BoardingManifestItem['finalStatus'],
    evidenceSummary: row.evidence_summary,
    astFactsJson: row.ast_facts_json,
    ed25519Sig: row.ed25519_sig,
    updatedAtMs: row.updated_at_ms,
  };
}

export interface ConfigBackup {
  agentHost: string;
  configPath: string;
  contentJson: string;
  savedAtMs: number;
}

interface ConfigBackupRow {
  agent_host: string;
  config_path: string;
  content_json: string;
  saved_at_ms: number;
}

// ---------------------------------------------------------------------------
// LedgerDb
// ---------------------------------------------------------------------------

/**
 * Embedded SQLite ledger. One instance = one connection; not thread-shareable
 * (better-sqlite3 is synchronous). Apply pattern for servers/proxies:
 * one LedgerDb per process (or per fiber) over the same file — WAL +
 * busy_timeout make concurrent writers safe.
 */
export class LedgerDb {
  private db: Database.Database;
  private closed = false;

  /** Opens (creating parent dirs), applies Handbook §5.2 PRAGMAs + schema. */
  constructor(dbPath: string) {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(loadSchemaSql());
  }

  /** Convenience factory (contract-required static). */
  static open(dbPath: string): LedgerDb {
    return new LedgerDb(dbPath);
  }

  /** Inserts one atomic audit tx; the FTS sync trigger mirrors it into audit_fts. */
  insertAtomicTx(tx: AtomicAuditTx): void {
    this.assertOpen();
    this.db
      .prepare<unknown[], void>(
        `INSERT INTO atomic_audit_tx (${TX_COLUMNS}) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...txToParams(tx));
  }

  getTx(txId: string): AtomicAuditTx | undefined {
    this.assertOpen();
    const row = this.db
      .prepare<unknown[], TxRow>(
        `SELECT ${TX_COLUMNS} FROM atomic_audit_tx WHERE tx_id = ?`
      )
      .get(txId);
    return row ? rowToTx(row) : undefined;
  }

  /** Newest first. `limit` omitted → all rows; negative treated as unlimited. */
  listTxs(opts?: { limit?: number; sessionId?: string }): AtomicAuditTx[] {
    this.assertOpen();
    const limit = opts?.limit;
    const sessionId = opts?.sessionId;
    const where = sessionId !== undefined ? 'WHERE session_id = ?' : '';
    const hasLimit = typeof limit === 'number' && limit >= 0;
    const sql = `SELECT ${TX_COLUMNS} FROM atomic_audit_tx ${where}
      ORDER BY timestamp_ms DESC, tx_id DESC ${hasLimit ? 'LIMIT ?' : ''}`;
    const params: unknown[] = [];
    if (sessionId !== undefined) params.push(sessionId);
    if (hasLimit) params.push(limit);
    const rows = this.db.prepare<unknown[], TxRow>(sql).all(...params);
    return rows.map(rowToTx);
  }

  /** Patches disposition (± optional anomaly/slab fields). Throws on unknown txId. */
  updateTxDisposition(
    txId: string,
    disposition: Disposition,
    patch?: { anomalyScore?: number; turboquantSlabIndex?: number }
  ): void {
    this.assertOpen();
    const result = this.db
      .prepare<unknown[], unknown>(
        `UPDATE atomic_audit_tx SET
           disposition = ?,
           anomaly_score = COALESCE(?, anomaly_score),
           turboquant_slab_index = COALESCE(?, turboquant_slab_index)
         WHERE tx_id = ?`
      )
      .run(disposition, patch?.anomalyScore ?? null, patch?.turboquantSlabIndex ?? null, txId);
    if (result.changes === 0) {
      throw new Error(`updateTxDisposition: no such tx_id: ${txId}`);
    }
  }

  // -- boarding manifest ----------------------------------------------------

  upsertBoardingItem(item: BoardingManifestItem): void {
    this.assertOpen();
    this.db
      .prepare<unknown[], unknown>(
        `INSERT INTO boarding_manifest (
           item_id, category, target_name, deterministic_status, jev_api_adjustment,
           final_status, evidence_summary, ast_facts_json, ed25519_sig, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           category = excluded.category,
           target_name = excluded.target_name,
           deterministic_status = excluded.deterministic_status,
           jev_api_adjustment = excluded.jev_api_adjustment,
           final_status = excluded.final_status,
           evidence_summary = excluded.evidence_summary,
           ast_facts_json = excluded.ast_facts_json,
           ed25519_sig = excluded.ed25519_sig,
           updated_at_ms = excluded.updated_at_ms`
      )
      .run(
        item.itemId,
        item.category,
        item.targetName,
        item.deterministicStatus,
        item.jevApiAdjustment,
        item.finalStatus,
        item.evidenceSummary,
        item.astFactsJson,
        item.ed25519Sig,
        item.updatedAtMs
      );
  }

  getBoardingItem(itemId: string): BoardingManifestItem | undefined {
    this.assertOpen();
    const row = this.db
      .prepare<unknown[], BoardingRow>(
        `SELECT * FROM boarding_manifest WHERE item_id = ?`
      )
      .get(itemId);
    return row ? rowToBoardingItem(row) : undefined;
  }

  listBoardingItems(category?: BoardingCategory): BoardingManifestItem[] {
    this.assertOpen();
    const sql = category
      ? `SELECT * FROM boarding_manifest WHERE category = ? ORDER BY updated_at_ms DESC, item_id DESC`
      : `SELECT * FROM boarding_manifest ORDER BY updated_at_ms DESC, item_id DESC`;
    const rows = category
      ? this.db.prepare<unknown[], BoardingRow>(sql).all(category)
      : this.db.prepare<unknown[], BoardingRow>(sql).all();
    return rows.map(rowToBoardingItem);
  }

  // -- full-text search ------------------------------------------------------

  /**
   * FTS5 MATCH over audit_fts (porter unicode61). The user query is sanitized
   * into quoted terms so FTS operators / quotes in user input cannot raise
   * syntax errors or inject FTS query syntax. Snippet highlights column 3
   * (stated_explanation).
   */
  searchAuditFts(
    query: string,
    limit = 20
  ): { txId: string; agentHost: string; toolName: string; snippet: string }[] {
    this.assertOpen();
    const terms = String(query ?? '')
      .split(/\s+/)
      .map((t) => t.replace(/["^*()]/g, ''))
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"`);
    if (terms.length === 0) return [];
    const rows = this.db
      .prepare<unknown[], { tx_id: string; agent_host: string; tool_name: string; snippet: string }>(
        `SELECT tx_id, agent_host, tool_name,
                snippet(audit_fts, 3, '[', ']', '…', 12) AS snippet
         FROM audit_fts WHERE audit_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(terms.join(' '), limit);
    return rows.map((r) => ({
      txId: r.tx_id,
      agentHost: r.agent_host,
      toolName: r.tool_name,
      snippet: r.snippet,
    }));
  }

  // -- config backups ---------------------------------------------------------

  saveConfigBackup(agentHost: AgentHost, configPath: string, contentJson: string): void {
    this.assertOpen();
    this.db
      .prepare<unknown[], unknown>(
        `INSERT INTO config_backups (agent_host, config_path, content_json, saved_at_ms)
         VALUES (?, ?, ?, ?)`
      )
      .run(agentHost, configPath, contentJson, Date.now());
  }

  listConfigBackups(agentHost?: AgentHost): ConfigBackup[] {
    this.assertOpen();
    const sql = agentHost
      ? `SELECT * FROM config_backups WHERE agent_host = ? ORDER BY saved_at_ms DESC, config_path`
      : `SELECT * FROM config_backups ORDER BY saved_at_ms DESC, config_path`;
    const rows = agentHost
      ? this.db.prepare<unknown[], ConfigBackupRow>(sql).all(agentHost)
      : this.db.prepare<unknown[], ConfigBackupRow>(sql).all();
    return rows.map((r) => ({
      agentHost: r.agent_host,
      configPath: r.config_path,
      contentJson: r.content_json,
      savedAtMs: r.saved_at_ms,
    }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('LedgerDb: connection already closed');
  }
}

// ---------------------------------------------------------------------------
// MultiverseDag
// ---------------------------------------------------------------------------

/** Compare helper: deterministic lexicographic order by txId. */
function byTxId(a: DagNode, b: DagNode): number {
  return a.txId < b.txId ? -1 : a.txId > b.txId ? 1 : 0;
}

/**
 * In-memory Multiverse Execution DAG over atomic audit transactions.
 * Nodes are stored in a Map keyed by txId, so construction is
 * order-insensitive (parents may appear after children in any input array)
 * and toJSON() emits a canonical, sorted representation.
 */
export class MultiverseDag {
  private nodes = new Map<string, DagNode>();

  addNode(node: DagNode): void {
    // Preserve an existing canaryFork/label when re-adding the same node id.
    const existing = this.nodes.get(node.txId);
    this.nodes.set(node.txId, {
      ...node,
      canaryFork: existing?.canaryFork || node.canaryFork,
      label: node.label ?? existing?.label,
    });
  }

  /**
   * Creates a synthetic canary-heal branch under `txId` and returns the fork
   * node (canaryFork: true). Fork txId scheme: `${parent}::canary::${label}`.
   */
  forkNode(txId: string, label: string): DagNode {
    const parent = this.nodes.get(txId);
    if (!parent) throw new Error(`forkNode: unknown parent tx ${txId}`);
    const fork: DagNode = {
      txId: `${txId}::canary::${label}`,
      parentTxId: txId,
      disposition: parent.disposition,
      finalRisk: parent.finalRisk,
      canaryFork: true,
      label,
    };
    this.nodes.set(fork.txId, fork);
    return fork;
  }

  /** Throws on unknown txId. */
  markDisposition(txId: string, disposition: Disposition): void {
    const node = this.nodes.get(txId);
    if (!node) throw new Error(`markDisposition: unknown tx ${txId}`);
    node.disposition = disposition;
  }

  getChildren(txId: string): DagNode[] {
    const children: DagNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentTxId === txId) children.push({ ...node });
    }
    return children.sort(byTxId);
  }

  /** [node, parent, grandparent, ..., genesis] — throws on unknown txId. */
  pathToRoot(txId: string): DagNode[] {
    const path: DagNode[] = [];
    const seen = new Set<string>();
    let cursor: DagNode | undefined = this.nodes.get(txId);
    if (!cursor) throw new Error(`pathToRoot: unknown tx ${txId}`);
    while (cursor) {
      if (seen.has(cursor.txId)) break; // cycle guard (cannot happen with a strict tree)
      seen.add(cursor.txId);
      path.push({ ...cursor });
      // A parentTxId not present in the DAG ends the walk (node keeps the
      // dangling parentTxId in its emitted copy).
      cursor = cursor.parentTxId ? this.nodes.get(cursor.parentTxId) : undefined;
    }
    return path;
  }

  /** Canonical (sorted) JSON form — identical for any input ordering. */
  toJSON(): { nodes: DagNode[]; edges: DagEdge[] } {
    const nodes = [...this.nodes.values()].map((n) => ({ ...n })).sort(byTxId);
    const edges: DagEdge[] = nodes.map((n) => ({ from: n.parentTxId, to: n.txId }));
    // Canonical edge order aligns with the txId-sorted nodes array (keyed by
    // child `to`, then parent `from`), so any input ordering yields identical
    // JSON.
    edges.sort((a, b) => {
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      const ka = a.from ?? '';
      const kb = b.from ?? '';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return { nodes, edges };
  }

  /**
   * Rebuilds the DAG from ledger rows. Order-insensitive: `txs` may list
   * children before parents. A row whose parentTxId is not in the input keeps
   * its parentTxId (dangling edge preserved, treated as root on traversal).
   * Rows with disposition 'CANARY_HEALED' surface as canaryFork nodes.
   */
  static fromTxs(txs: AtomicAuditTx[]): MultiverseDag {
    const dag = new MultiverseDag();
    for (const tx of txs) {
      dag.addNode({
        txId: tx.txId,
        parentTxId: tx.parentTxId,
        disposition: tx.disposition,
        finalRisk: tx.finalMonotonicRisk,
        canaryFork: tx.disposition === 'CANARY_HEALED',
      });
    }
    return dag;
  }
}

// ---------------------------------------------------------------------------
// Default ledger location
// ---------------------------------------------------------------------------

/**
 * AEGIS_LEDGER_DB env override, else `<astram home>/aegis_ledger.db`
 * (astram home = ASTRAM_HOME || %USERPROFILE%\.astram).
 */
export function defaultLedgerPath(): string {
  if (process.env.AEGIS_LEDGER_DB && process.env.AEGIS_LEDGER_DB.trim() !== '') {
    return process.env.AEGIS_LEDGER_DB;
  }
  return path.join(resolveAstramHome(), 'aegis_ledger.db');
}
