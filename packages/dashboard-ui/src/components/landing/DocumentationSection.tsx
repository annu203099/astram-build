/**
 * DocumentationSection for Astram Landing Page.
 * Conforms to owner.com content psychology:
 * Structured documentation tabs covering:
 * 1. Architecture: Microkernel Proxy Topology & 4-Tier Defense Pipeline
 * 2. Invariants: Mathematical proofs for Invariants I1 through I4
 * 3. API & Telemetry: REST Endpoints and WebSocket Real-Time Schemas
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { motion } from 'framer-motion';
import {
  Layers,
  BookOpen,
  Code,
  Lock,
  ArrowRight,
  Copy,
  Check,
  Server,
  Terminal,
  Activity,
} from 'lucide-react';
import { appleSpring } from '../../lib/theme';

type DocTab = 'architecture' | 'invariants' | 'api';

export function DocumentationSection(): JSX.Element {
  const [activeTab, setActiveTab] = useState<DocTab>('architecture');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const handleCopy = (key: string, content: string): void => {
    navigator.clipboard.writeText(content);
    setCopiedSnippet(key);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const tsWsSnippet = `// Astram Real-Time Telemetry WebSocket Client
import { WebSocket } from 'ws';

interface TelemetryEvent {
  type: 'tx' | 'manifest-update' | 'alert' | 'dag-update';
  payload: any;
  timestamp: number;
}

const socket = new WebSocket('ws://127.0.0.1:3080/ws');

socket.on('message', (data: string) => {
  const event: TelemetryEvent = JSON.parse(data);
  if (event.type === 'alert' && event.payload.level === 'HOLD') {
    console.warn('[ASTRAM HOLD INTERCEPT]', event.payload.message);
  }
});`;

  return (
    <section id="docs" className="py-24 px-6 max-w-7xl mx-auto border-t border-white/[0.08]">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-white/50 mb-4">
          <span>TECHNICAL SPECIFICATIONS</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
          Microkernel Architecture & Invariant Proofs
        </h2>
        <p className="mt-4 text-base sm:text-lg text-white/60">
          Deterministic systems engineering designed for high-assurance autonomous agent operations.
        </p>
      </div>

      {/* Tab Switcher */}
      <div className="flex justify-center mb-10">
        <div className="flex items-center p-1.5 rounded-2xl bg-[#0D0D0F] border border-white/[0.1]">
          <button
            type="button"
            onClick={() => setActiveTab('architecture')}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition cursor-pointer ${
              activeTab === 'architecture' ? 'text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {activeTab === 'architecture' && (
              <motion.div
                layoutId="activeDocTab"
                transition={appleSpring.gentle}
                className="absolute inset-0 rounded-xl bg-white/[0.12] border border-white/[0.16] shadow-sm"
              />
            )}
            <Layers size={14} className="relative z-10" />
            <span className="relative z-10">Architecture</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('invariants')}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition cursor-pointer ${
              activeTab === 'invariants' ? 'text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {activeTab === 'invariants' && (
              <motion.div
                layoutId="activeDocTab"
                transition={appleSpring.gentle}
                className="absolute inset-0 rounded-xl bg-white/[0.12] border border-white/[0.16] shadow-sm"
              />
            )}
            <Lock size={14} className="relative z-10" />
            <span className="relative z-10">Invariants I1–I4</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('api')}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition cursor-pointer ${
              activeTab === 'api' ? 'text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {activeTab === 'api' && (
              <motion.div
                layoutId="activeDocTab"
                transition={appleSpring.gentle}
                className="absolute inset-0 rounded-xl bg-white/[0.12] border border-white/[0.16] shadow-sm"
              />
            )}
            <Code size={14} className="relative z-10" />
            <span className="relative z-10">REST & Telemetry API</span>
          </button>
        </div>
      </div>

      {/* Tab Content Container */}
      <div className="rounded-3xl bg-[#0D0D0F] border border-white/[0.12] p-6 sm:p-10 shadow-2xl">
        {/* ==================================================================== */}
        {/* TAB 1: ARCHITECTURE TOPOLOGY & 4-TIER DEFENSE PIPELINE */}
        {/* ==================================================================== */}
        {activeTab === 'architecture' && (
          <div className="space-y-10">
            <div>
              <h3 className="text-xl font-bold text-white mb-2">
                Transparent Stdio Microkernel Proxy Topology
              </h3>
              <p className="text-xs sm:text-sm text-white/60 leading-relaxed max-w-3xl">
                Astram inserts itself transparently between the agent client process (Claude Desktop, Cursor, Cline) and the target execution environment via standard input/output pipes. All JSON-RPC communications pass through a 4-tier verification pipeline before any byte reaches the operating system kernel.
              </p>
            </div>

            {/* ASCII Architecture Diagram Box */}
            <div className="p-6 rounded-2xl bg-black border border-white/[0.1] font-mono text-xs text-white/80 overflow-x-auto leading-relaxed shadow-inner">
              <pre className="text-white/70">
{`┌────────────────────────────────────────────────────────────────────────┐
│                        AI CODING AGENT HARNESS                         │
│               (Claude Desktop / Cursor / Roo-Code / Cline)              │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │  stdio JSON-RPC (Unmodified)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     ASTRAM ZERO-TRUST MICROKERNEL                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Tier 1: Deterministic Denylist & Regex Filter            (<0.5ms)│  │
│  │         Instant block of raw shell bombs & destructive cmds      │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ Tier 2: Syntactic AST Fact Extractor                      (<2.0ms)│  │
│  │         Extracts filesystem paths, sockets, and subprocess trees │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ Tier 3: Invariant I1 Monotonic Spec Verifier             (<1.5ms)│  │
│  │         Locks state to HOLD if intent contradicts observed AST   │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │ Tier 4: SQLite WAL Audit Ledger Snapshot                  (<0.5ms)│  │
│  │         Tamper-evident append-only journaling & rollback anchor  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
       [ PRE-EXECUTION BLOCKED ]           [ AUTHORIZED DISPATCH ]
          0 bytes touch disk                Local OS / MCP Servers`}
              </pre>
            </div>

            {/* 4 Tiers Breakdown Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-black border border-white/[0.08]">
                <div className="text-xs font-mono font-bold text-[#30D158] mb-1">TIER 1</div>
                <div className="text-sm font-bold text-white mb-1">Deterministic Denylist</div>
                <div className="text-[11px] font-mono text-white/40 mb-2">Latency: &lt; 0.5ms</div>
                <p className="text-xs text-white/60 leading-relaxed">
                  O(1) memory lookup stopping dangerous shell primitives (`rm -rf /`, `mkfs`, raw device manipulation) before AST parsing.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-black border border-white/[0.08]">
                <div className="text-xs font-mono font-bold text-[#FF9F0A] mb-1">TIER 2</div>
                <div className="text-sm font-bold text-white mb-1">AST Fact Extraction</div>
                <div className="text-[11px] font-mono text-white/40 mb-2">Latency: &lt; 2.0ms</div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Extracts full structural facts from scripts, command flags, filesystem targets, and socket descriptors into a deterministic vector.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-black border border-white/[0.08]">
                <div className="text-xs font-mono font-bold text-[#FF453A] mb-1">TIER 3</div>
                <div className="text-sm font-bold text-white mb-1">Invariant I1 Verifier</div>
                <div className="text-[11px] font-mono text-white/40 mb-2">Latency: &lt; 1.5ms</div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Enforces mathematical monotonicity. If risk evaluation reaches HOLD, no future parameter mutation can demote it to PASS.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-black border border-white/[0.08]">
                <div className="text-xs font-mono font-bold text-white mb-1">TIER 4</div>
                <div className="text-sm font-bold text-white mb-1">SQLite WAL Ledger</div>
                <div className="text-[11px] font-mono text-white/40 mb-2">Latency: &lt; 0.5ms</div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Cryptographically hashes each transaction into an append-only WAL ledger, enabling instant 1-click state rollback.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 2: INVARIANTS I1 THROUGH I4 MATHEMATICAL PROOFS */}
        {/* ==================================================================== */}
        {activeTab === 'invariants' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-white mb-2">
                Four Mathematical Invariants of the Astram Microkernel
              </h3>
              <p className="text-xs sm:text-sm text-white/60 leading-relaxed max-w-3xl">
                Unlike probabilistic LLM safety checks that can be jailbroken with clever phrasing, Astram’s security model is anchored in provable mathematical invariants.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Invariant I1 */}
              <div className="p-6 rounded-2xl bg-black border border-[#FF453A]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-[#FF453A] uppercase">
                    Invariant I1
                  </span>
                  <span className="text-[10px] font-mono text-white/40 bg-white/[0.06] px-2 py-0.5 rounded">
                    Monotonicity Law
                  </span>
                </div>
                <h4 className="text-base font-bold text-white">Non-Decreasing Risk Monotonicity</h4>
                <div className="p-3 rounded-xl bg-[#0D0D0F] border border-white/[0.08] font-mono text-xs text-[#FF453A]">
                  ∀ t ∈ Tx, Δ ∈ Inputs : State(t) = HOLD ⟹ State(t + Δ) = HOLD
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Once an execution has been classified as `HOLD` due to a dangerous capability (e.g. credential read or socket egress), `HOLD` is an absorbing state in the state machine. No successive prompt injection or jailbreak string can lower the verdict.
                </p>
              </div>

              {/* Invariant I2 */}
              <div className="p-6 rounded-2xl bg-black border border-white/[0.12] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-white uppercase">
                    Invariant I2
                  </span>
                  <span className="text-[10px] font-mono text-white/40 bg-white/[0.06] px-2 py-0.5 rounded">
                    Reversibility Law
                  </span>
                </div>
                <h4 className="text-base font-bold text-white">Atomic State Rollback Guarantee</h4>
                <div className="p-3 rounded-xl bg-[#0D0D0F] border border-white/[0.08] font-mono text-xs text-white">
                  ∀ S_k ∈ State : ∃ Rollback(S_k) ⟹ S_prev ∧ DiskDiff(S_prev, S_k) = ∅
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Every permitted state modification creates a reversible SQLite WAL transaction journal. Pre-execution blocks prevent unauthorized writes before they occur. Any unintended authorized mutations can be atomically reverted with 0 loss of uncorrupted work.
                </p>
              </div>

              {/* Invariant I3 */}
              <div className="p-6 rounded-2xl bg-black border border-white/[0.12] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-white uppercase">
                    Invariant I3
                  </span>
                  <span className="text-[10px] font-mono text-white/40 bg-white/[0.06] px-2 py-0.5 rounded">
                    Ledger Integrity
                  </span>
                </div>
                <h4 className="text-base font-bold text-white">Tamper-Evident Append-Only Log</h4>
                <div className="p-3 rounded-xl bg-[#0D0D0F] border border-white/[0.08] font-mono text-xs text-white">
                  Hash(Tx_n) = H(Tx_n || Hash(Tx_(n-1))) ∧ Mutate(Tx_i) = ⊥
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  All transaction verdicts and AST evaluations are cryptographically chained in an append-only ledger. Agents cannot modify or delete previous audit entries even if they possess full write rights.
                </p>
              </div>

              {/* Invariant I4 */}
              <div className="p-6 rounded-2xl bg-black border border-[#30D158]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-[#30D158] uppercase">
                    Invariant I4
                  </span>
                  <span className="text-[10px] font-mono text-white/40 bg-white/[0.06] px-2 py-0.5 rounded">
                    Latency Bound
                  </span>
                </div>
                <h4 className="text-base font-bold text-white">Deterministic Upper Bound on Overhead</h4>
                <div className="p-3 rounded-xl bg-[#0D0D0F] border border-white/[0.08] font-mono text-xs text-[#30D158]">
                  T_intercept = T_regex + T_ast + T_verify + T_wal &lt; 5.0ms
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  The cumulative overhead of the microkernel verification pipeline is strictly bounded under 5 milliseconds. It never initiates network I/O during the critical path, ensuring zero slowdown to coding workflows.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 3: REST & WEBSOCKET TELEMETRY API */}
        {/* ==================================================================== */}
        {activeTab === 'api' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-white mb-2">
                Local Microkernel Daemon API Specification
              </h3>
              <p className="text-xs sm:text-sm text-white/60 leading-relaxed max-w-3xl">
                The Astram daemon exposes a lightweight local HTTP/WebSocket interface at <code className="text-white font-mono bg-white/[0.08] px-1 py-0.5 rounded">http://127.0.0.1:3080</code> for telemetry, manifest management, and atomic rollback triggers.
              </p>
            </div>

            {/* REST Table */}
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3">
                Core REST Endpoints
              </div>
              <div className="rounded-2xl bg-black border border-white/[0.1] overflow-hidden">
                <div className="grid grid-cols-12 px-4 py-2.5 bg-[#121214] border-b border-white/[0.08] text-[11px] font-mono text-white/40 uppercase">
                  <div className="col-span-3 sm:col-span-2">Method</div>
                  <div className="col-span-5 sm:col-span-4">Endpoint</div>
                  <div className="col-span-4 sm:col-span-6">Description</div>
                </div>

                <div className="divide-y divide-white/[0.06] text-xs font-mono">
                  <div className="grid grid-cols-12 px-4 py-3 items-center">
                    <div className="col-span-3 sm:col-span-2 text-[#30D158] font-bold">GET</div>
                    <div className="col-span-5 sm:col-span-4 text-white">/api/health</div>
                    <div className="col-span-4 sm:col-span-6 text-white/60">Daemon status, version, and uptime</div>
                  </div>
                  <div className="grid grid-cols-12 px-4 py-3 items-center">
                    <div className="col-span-3 sm:col-span-2 text-[#30D158] font-bold">GET</div>
                    <div className="col-span-5 sm:col-span-4 text-white">/api/manifest</div>
                    <div className="col-span-4 sm:col-span-6 text-white/60">Boarding manifest items & capability rules</div>
                  </div>
                  <div className="grid grid-cols-12 px-4 py-3 items-center">
                    <div className="col-span-3 sm:col-span-2 text-[#30D158] font-bold">GET</div>
                    <div className="col-span-5 sm:col-span-4 text-white">/api/transactions</div>
                    <div className="col-span-4 sm:col-span-6 text-white/60">Append-only audit log of intercepted calls</div>
                  </div>
                  <div className="grid grid-cols-12 px-4 py-3 items-center">
                    <div className="col-span-3 sm:col-span-2 text-[#FF9F0A] font-bold">POST</div>
                    <div className="col-span-5 sm:col-span-4 text-white">/api/rollback/:txId</div>
                    <div className="col-span-4 sm:col-span-6 text-white/60">Trigger atomic SQLite WAL snapshot rollback</div>
                  </div>
                  <div className="grid grid-cols-12 px-4 py-3 items-center">
                    <div className="col-span-3 sm:col-span-2 text-[#FF9F0A] font-bold">POST</div>
                    <div className="col-span-5 sm:col-span-4 text-white">/api/agents/detect</div>
                    <div className="col-span-4 sm:col-span-6 text-white/60">Scan local filesystem for installed AI IDEs</div>
                  </div>
                </div>
              </div>
            </div>

            {/* WebSocket Telemetry Snippet */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-mono uppercase tracking-wider text-white/40">
                  WebSocket Real-Time Telemetry Client (`ws://127.0.0.1:3080/ws`)
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('ws', tsWsSnippet)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white text-xs font-mono transition cursor-pointer"
                >
                  {copiedSnippet === 'ws' ? <Check size={12} className="text-[#30D158]" /> : <Copy size={12} />}
                  <span>{copiedSnippet === 'ws' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <pre className="p-4 rounded-2xl bg-black border border-white/[0.1] font-mono text-xs text-white/80 overflow-x-auto leading-relaxed">
                {tsWsSnippet}
              </pre>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
