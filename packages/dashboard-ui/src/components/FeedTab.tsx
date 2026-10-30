/**
 * Tab 2 — Live MCP Feed (Apple Human Interface Standard).
 *
 * Real-time audit transactions streamed via WebSocket.
 * Physics-based entry, row inspection drawers, and pre-exec rollback controls.
 */

import { useState, useMemo } from 'react';
import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Activity, Search, ChevronRight, ShieldAlert } from 'lucide-react';
import type { AtomicAuditTx } from '@astram/types';
import { clockTime, prettyJson, riskName } from '../lib/format';
import { AlertBanner, type AlertItem } from './AlertBanner';
import { DispositionLabel, HostBadge, RiskBadge } from './Badges';
import { appleSpring } from '../lib/theme';

export function FeedTab({
  txs,
  alerts,
  onDismissAlert,
  onRollback,
}: {
  txs: AtomicAuditTx[];
  alerts: AlertItem[];
  onDismissAlert: (id: string) => void;
  onRollback: (txId: string) => void;
}): JSX.Element {
  const [filterMode, setFilterMode] = useState<'ALL' | 'HOLD' | 'COMMITTED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

  const filteredTxs = useMemo(() => {
    return txs.filter((tx) => {
      const final = riskName(tx.finalMonotonicRisk);
      const matchesFilter =
        filterMode === 'ALL' ||
        (filterMode === 'HOLD' && final === 'HOLD') ||
        (filterMode === 'COMMITTED' && tx.disposition === 'COMMITTED');
      const matchesSearch =
        searchQuery === '' ||
        tx.toolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.mcpServerId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.txId.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [txs, filterMode, searchQuery]);

  return (
    <section className="space-y-4">
      {/* Alerts Stack */}
      <AnimatePresence>
        {alerts.map((alert) => (
          <AlertBanner key={alert.id} alert={alert} onDismiss={onDismissAlert} />
        ))}
      </AnimatePresence>

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Live MCP Audit Transactions
          </h2>
          <p className="text-xs text-white/50">
            Real-time pre-execution intercept stream. Showing {filteredTxs.length} of {txs.length} transactions.
          </p>
        </div>

        {txs.length > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/50 self-start sm:self-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-[#30D158] animate-pulse" />
            <span>Telemetry Live</span>
          </span>
        )}
      </div>

      {/* Search & Status Filter Row */}
      <div className="flex flex-col sm:flex-row items-center gap-2.5">
        <div className="relative flex-1 w-full">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by tool name, MCP server, or txId…"
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder-white/35 focus:outline-none focus:border-white/25 transition-colors font-sans"
          />
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-white/[0.04] border border-white/[0.08] self-stretch sm:self-auto">
          {(
            [
              { id: 'ALL', label: 'All Transactions' },
              { id: 'HOLD', label: 'Threats (HOLD)' },
              { id: 'COMMITTED', label: 'Committed' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilterMode(opt.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                filterMode === opt.id
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0D0F]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] font-medium uppercase tracking-wider text-white/45">
              <th className="px-5 py-3 w-8" />
              <th className="px-3 py-3">Timestamp</th>
              <th className="px-4 py-3">Harness</th>
              <th className="px-4 py-3">Tool & MCP Server</th>
              <th className="px-4 py-3">Final Risk</th>
              <th className="px-4 py-3">Disposition</th>
              <th className="px-4 py-3 font-mono">Anomaly</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {filteredTxs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-white/40">
                  <div className="max-w-sm mx-auto space-y-2">
                    <Activity size={28} className="mx-auto text-white/20 stroke-[1.5]" />
                    <p className="text-xs font-medium text-white/60">
                      {searchQuery || filterMode !== 'ALL'
                        ? 'No transactions match filter criteria'
                        : 'Awaiting tool telemetry'}
                    </p>
                    <p className="text-[11px] text-white/40">
                      Wrap an MCP server with <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-white/70">astram protect</code> and trigger a call.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredTxs.map((tx) => {
                const final = riskName(tx.finalMonotonicRisk);
                const isHold = final === 'HOLD';
                const isExpanded = expandedTxId === tx.txId;

                return (
                  <tbody key={`${tx.txId}:${tx.timestampMs}`} className="border-none">
                    <motion.tr
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={appleSpring.snappy}
                      onClick={() => setExpandedTxId(isExpanded ? null : tx.txId)}
                      className={`cursor-pointer transition-colors ${
                        isHold
                          ? 'bg-[#FF453A]/[0.06] hover:bg-[#FF453A]/[0.09]'
                          : isExpanded
                            ? 'bg-white/[0.04]'
                            : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <td className="px-5 py-3.5 text-white/30">
                        <motion.div
                          animate={{ rotate: isExpanded ? 90 : 0 }}
                          transition={appleSpring.snappy}
                        >
                          <ChevronRight size={13} />
                        </motion.div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[11px] text-white/45">
                        {clockTime(tx.timestampMs)}
                      </td>
                      <td className="px-4 py-3.5">
                        <HostBadge host={tx.agentHost} />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-white font-medium">{tx.toolName}</span>
                          <span className="font-mono text-[11px] text-white/40">{tx.mcpServerId}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBadge label={final} />
                      </td>
                      <td className="px-4 py-3.5">
                        <DispositionLabel disposition={tx.disposition} />
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-white/50 tabular-nums">
                        {tx.anomalyScore.toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {isHold && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRollback(tx.txId);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FF453A]/15 hover:bg-[#FF453A]/25 text-[#FF453A] border border-[#FF453A]/30 text-xs font-medium transition cursor-pointer active:scale-95"
                          >
                            <RotateCcw size={11} className="stroke-[2.5]" />
                            <span>Rollback</span>
                          </button>
                        )}
                      </td>
                    </motion.tr>

                    {/* Inline Argument & Metric Drawer */}
                    {isExpanded && (
                      <tr className="bg-white/[0.02]">
                        <td colSpan={8} className="px-6 py-4">
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={appleSpring.fluid}
                            className="space-y-3"
                          >
                            <div className="flex items-center gap-3 text-[11px] text-white/45">
                              <span>
                                Transaction: <span className="font-mono text-white/70">{tx.txId}</span>
                              </span>
                              <span className="w-1 h-1 rounded-full bg-white/20" />
                              <span>Stated Intent: <span className="text-white/75">{tx.statedPurpose || 'Unspecified'}</span></span>
                            </div>

                            <div className="space-y-1">
                              <span className="font-semibold text-white/45 block uppercase text-[10px] tracking-wider">
                                Redacted Arguments Payload
                              </span>
                              <pre className="scrollbar-thin max-h-48 overflow-auto rounded-xl border border-white/[0.08] bg-black/70 p-3 font-mono text-[11px] leading-relaxed text-white/75">
                                {prettyJson(tx.redactedArgumentsJson || '[]')}
                              </pre>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
