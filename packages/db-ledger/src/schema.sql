-- astram atomic audit ledger — Handbook §5.2 "Tier 1 Component 1" schema (VERBATIM),
-- plus the two documented CONTRACTS §4 additions at the bottom of this file:
--   (a) config_backups table
--   (b) FTS5 sync triggers keeping audit_fts in step with atomic_audit_tx inserts

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- 1. Ender's Bench Atomic Policy & Tool Execution Transactions
CREATE TABLE IF NOT EXISTS atomic_audit_tx (
    tx_id TEXT PRIMARY KEY,                  -- SHA-256 of envelope
    session_id TEXT NOT NULL,
    fiber_id TEXT NOT NULL,
    parent_tx_id TEXT,                       -- Forms the Multiverse Execution DAG
    agent_host TEXT NOT NULL,                -- 'antigravity' | 'claude-code' | 'cursor' | 'codex' | 'quill' | 'dsh'
    timestamp_ms INTEGER NOT NULL,
    policy_charter_id TEXT NOT NULL,
    stated_explanation TEXT NOT NULL,        -- Model/skill claimed intent
    mcp_server_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    redacted_arguments_json TEXT NOT NULL,
    deterministic_risk INTEGER NOT NULL,     -- 0 = PASS, 1 = WARN, 2 = HOLD
    decision_api_delta INTEGER NOT NULL,     -- -1, 0, +1 from Jev API
    final_monotonic_risk INTEGER NOT NULL,   -- Enforced via Invariant I1
    fs_modified_files_json TEXT NOT NULL,    -- Files touched in worktree/snapshot
    turboquant_slab_index INTEGER,           -- Row index in turboquant.slab (Tier 2)
    anomaly_score REAL DEFAULT 0.0,
    violation_detected INTEGER NOT NULL,     -- 0 or 1
    disposition TEXT NOT NULL CHECK (disposition IN ('COMMITTED', 'BLOCKED_PRE_EXEC', 'ROLLED_BACK', 'CANARY_HEALED'))
);

CREATE INDEX IF NOT EXISTS idx_tx_session ON atomic_audit_tx(session_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_tx_parent ON atomic_audit_tx(parent_tx_id);

-- 2. Slowship & Black-October-Check Verification Manifest (item | status | evidence)
CREATE TABLE IF NOT EXISTS boarding_manifest (
    item_id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('LOCKFILE_PKG', 'AGENT_SKILL', 'MCP_SERVER', 'TLS_TRUSTSTORE', 'BYTEPATH_SINK', 'DSH_HOST')),
    target_name TEXT NOT NULL,               -- e.g., 'litellm@1.107.0', '~/.quill/skills/deploy.md', 'Windows curl.exe eMudhra'
    deterministic_status TEXT NOT NULL CHECK (deterministic_status IN ('PASS', 'WARN', 'HOLD')),
    jev_api_adjustment INTEGER NOT NULL DEFAULT 0,
    final_status TEXT NOT NULL CHECK (final_status IN ('PASS', 'WARN', 'HOLD', 'REMEDIATED')),
    evidence_summary TEXT NOT NULL,          -- Redacted AST or TLS probe proof
    ast_facts_json TEXT NOT NULL,
    ed25519_sig TEXT,                        -- Populated when a clean SKILL.md is signed
    updated_at_ms INTEGER NOT NULL
);

-- 3. FTS5 Full-Text Search over Session Logs & Skills (Quill-Agent Pattern)
CREATE VIRTUAL TABLE IF NOT EXISTS audit_fts USING fts5(
    tx_id UNINDEXED,
    session_id UNINDEXED,
    agent_host,
    stated_explanation,
    tool_name,
    evidence_summary,
    tokenize = 'porter unicode61'
);

-- ---------------------------------------------------------------------------
-- CONTRACTS §4 documented addition (a): config backups.
-- Written by @astram/mcp-proxy (protectWorkspace) BEFORE any harness config is
-- rewritten, so every original stays recoverable from the ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_backups (
    agent_host TEXT NOT NULL,                -- AgentHost ('antigravity' | 'claude-code' | ...)
    config_path TEXT NOT NULL,               -- absolute path of the original config file
    content_json TEXT NOT NULL,              -- original file content (JSON-stringified)
    saved_at_ms INTEGER NOT NULL             -- Date.now() milliseconds
);

CREATE INDEX IF NOT EXISTS idx_config_backups_host ON config_backups(agent_host, saved_at_ms);

-- ---------------------------------------------------------------------------
-- CONTRACTS §4 documented addition (b): FTS5 sync triggers.
-- Every atomic_audit_tx insert mirrors its searchable text into audit_fts.
-- evidence_summary (a boarding-manifest column, kept verbatim from the Handbook)
-- has no direct counterpart on a tx row; we index fs_modified_files_json, the
-- tx's own evidence trail. Documented in docs/error-log/db-ledger.md.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS audit_fts_tx_insert
AFTER INSERT ON atomic_audit_tx
BEGIN
    INSERT INTO audit_fts(tx_id, session_id, agent_host, stated_explanation, tool_name, evidence_summary)
    VALUES (
        new.tx_id,
        new.session_id,
        new.agent_host,
        new.stated_explanation,
        new.tool_name,
        new.fs_modified_files_json
    );
END;
