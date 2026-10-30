/**
 * Tab 3 — Deception Inspector (Apple Human Interface Standard).
 *
 * Golden Ratio ($38.2% / 61.8%) Master-Detail View:
 * Compares what a tool CLAIMED it would do against what the microkernel ACTUALLY observed.
 */

import { useState, useEffect } from 'react';
import type { JSX, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RotateCw, ShieldCheck, FileText, Search } from 'lucide-react';
import type { AtomicAuditTx } from '@astram/types';
import { api } from '../lib/api';
import { clockTime, parseStringArray, prettyJson, riskName } from '../lib/format';
import { HostBadge, RiskBadge } from './Badges';
import { appleSpring } from '../lib/theme';

interface ObservedFact {
  ruleId?: string;
  category?: string;
  line?: number | string;
  snippet?: string;
}

function factsOf(tx: AtomicAuditTx): ObservedFact[] {
  const maybe = (tx as AtomicAuditTx & { facts?: unknown }).facts;
  return Array.isArray(maybe) ? (maybe as ObservedFact[]) : [];
}

function ObservedRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.04] py-2 text-xs last:border-0">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</span>
      <span className="min-w-0 break-all text-right text-white/80">{children}</span>
    </div>
  );
}

export function InspectorTab(): JSX.Element {
  const [txs, setTxs] = useState<AtomicAuditTx[]>([]);
  const [selected, setSelected] = useState<AtomicAuditTx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const load = (): void => {
    setLoading(true);
    api
      .transactions(200)
      .then((list) => {
        setTxs(list);
        setSelected((prev) => (prev && list.some((t) => t.txId === prev.txId) ? prev : (list[0] ?? null)));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Keyboard navigation through ledger items with ArrowUp and ArrowDown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selected || txs.length === 0) return;
      const currentIndex = txs.findIndex((t) => t.txId === selected.txId);
      if (e.key === 'ArrowDown' && currentIndex < txs.length - 1) {
        e.preventDefault();
        setSelected(txs[currentIndex + 1]);
      } else if (e.key === 'ArrowUp' && currentIndex > 0) {
        e.preventDefault();
        setSelected(txs[currentIndex - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, txs]);

  const filteredTxs = txs.filter((tx) => {
    return (
      searchQuery === '' ||
      tx.toolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.txId.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const fsModified = selected ? parseStringArray(selected.fsModifiedFilesJson) : [];
  const facts = selected ? factsOf(selected) : [];

  return (
    <section className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Deception Inspector
          </h2>
          <p className="text-xs text-white/50">
            Compare tool stated intent against deterministic AST facts and filesystem mutations.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white border border-white/[0.08] text-xs font-medium transition cursor-pointer disabled:opacity-50 active:scale-95 self-start sm:self-auto"
        >
          <RotateCw size={12} className={`stroke-[2] ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3.5 text-xs text-[#FF453A]">
          {error}
        </div>
      )}

      {/* Golden Ratio Master-Detail Grid: 38.2% Master / 61.8% Detail */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* MASTER: Transactions List (38.2%) */}
        <div className="w-full lg:w-[38.2%] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0D0D0F] overflow-hidden">
          <div className="p-3 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
              Ledger ({filteredTxs.length})
            </span>
            <span className="text-[10px] text-white/35 font-mono">Use ↑ / ↓ keys</span>
          </div>

          <div className="p-2 border-b border-white/[0.04]">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter ledger…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/20"
              />
            </div>
          </div>

          <div className="scrollbar-thin max-h-[38rem] overflow-auto">
            {filteredTxs.length === 0 ? (
              <p className="px-4 py-12 text-center text-xs text-white/40">
                No matching transactions in ledger.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {filteredTxs.map((tx) => {
                  const isSelected = selected?.txId === tx.txId;

                  return (
                    <li key={tx.txId}>
                      <button
                        type="button"
                        onClick={() => setSelected(tx)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                          isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <RiskBadge label={riskName(tx.finalMonotonicRisk)} />

                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="block truncate font-mono text-xs font-medium text-white">
                            {tx.toolName}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-white/40">
                            {tx.txId.slice(0, 18)}…
                          </span>
                        </span>

                        <span className="shrink-0 font-mono text-[10px] text-white/40">
                          {clockTime(tx.timestampMs)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* DETAIL: Stated vs Actual Comparison (61.8%) */}
        <div className="w-full lg:w-[61.8%]">
          {!selected ? (
            <div className="flex h-96 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0D0D0F] p-8 text-center text-white/40 text-xs">
              Select a transaction from the ledger to inspect deception telemetry.
            </div>
          ) : (
            <motion.div
              key={selected.txId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={appleSpring.snappy}
              className="grid gap-4 md:grid-cols-2"
            >
              {/* CLAIMED CARD */}
              <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0D0F]">
                <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-white/50" />
                    <h3 className="text-xs font-semibold text-white">CLAIMED INTENT</h3>
                  </div>
                  <span className="rounded-full bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-[10px] font-mono text-white/50">
                    Tool Stated
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 block mb-1">
                      Stated Purpose
                    </span>
                    <div className="rounded-xl border border-white/[0.06] bg-black/40 p-3 text-xs leading-relaxed text-white/80">
                      {selected.statedPurpose || '(none provided by tool caller)'}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 block mb-1">
                      Tool Arguments (Redacted)
                    </span>
                    <pre className="scrollbar-thin max-h-48 overflow-auto rounded-xl border border-white/[0.06] bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-white/70">
                      {prettyJson(selected.redactedArgumentsJson || '[]')}
                    </pre>
                  </div>
                </div>
              </div>

              {/* ACTUAL OBSERVED CARD */}
              <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#121214]">
                <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-[#30D158]" />
                    <h3 className="text-xs font-semibold text-white">ACTUAL OBSERVATION</h3>
                  </div>
                  <span className="rounded-full bg-[#30D158]/10 border border-[#30D158]/30 px-2 py-0.5 text-[10px] font-mono font-medium text-[#30D158]">
                    Kernel Verified
                  </span>
                </div>

                <div className="p-4 space-y-2">
                  <ObservedRow label="Final Monotonic Risk">
                    <RiskBadge label={riskName(selected.finalMonotonicRisk)} />
                  </ObservedRow>

                  <ObservedRow label="Kernel Disposition">
                    <span className="font-mono text-xs">{selected.disposition}</span>
                  </ObservedRow>

                  <ObservedRow label="AST Risk / Jev Δ">
                    <span className="font-mono text-xs text-white/90">
                      {riskName(selected.deterministicRisk)} /{' '}
                      {selected.decisionApiDelta > 0
                        ? `+${selected.decisionApiDelta}`
                        : selected.decisionApiDelta}
                    </span>
                  </ObservedRow>

                  <ObservedRow label="Protected Host">
                    <HostBadge host={selected.agentHost} />
                  </ObservedRow>

                  <ObservedRow label="Anomaly Metric">
                    <span className="font-mono text-xs text-white/70 tabular-nums">
                      {selected.anomalyScore.toFixed(2)}
                    </span>
                  </ObservedRow>

                  <div className="pt-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 block mb-1.5">
                      Extracted AST Facts
                    </span>
                    {facts.length > 0 ? (
                      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/40">
                        <table className="w-full text-left text-[11px]">
                          <thead>
                            <tr className="border-b border-white/[0.04] text-white/40 text-[10px]">
                              <th className="p-2">Rule</th>
                              <th className="p-2">Category</th>
                              <th className="p-2">Line</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.03]">
                            {facts.map((fact, idx) => (
                              <tr key={idx} className="font-mono text-white/70">
                                <td className="p-2">{fact.ruleId ?? '—'}</td>
                                <td className="p-2 text-white/50">{fact.category ?? '—'}</td>
                                <td className="p-2 text-white/40">{fact.line ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                        Authoritative monotonic verdict locked via deterministic invariants.
                      </p>
                    )}
                  </div>

                  <div className="pt-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40 block mb-1">
                      Filesystem Interceptions
                    </span>
                    {fsModified.length > 0 ? (
                      <ul className="rounded-xl border border-white/[0.06] bg-black/40 p-2.5 font-mono text-[11px] text-white/70 space-y-1">
                        {fsModified.map((f) => (
                          <li key={f} className="truncate">
                            {f}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-white/40 font-mono">(zero file mutations)</p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}
