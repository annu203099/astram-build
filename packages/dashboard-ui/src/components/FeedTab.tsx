/**
 * Tab 2 — Live MCP Feed (Apple Human Interface Standard).
 *
 * Real-time audit transactions streamed via WebSocket.
 * Physics-based entry and rollback controls for HOLD violations.
 */

import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Activity } from 'lucide-react';
import type { AtomicAuditTx } from '@astram/types';
import { clockTime, riskName } from '../lib/format';
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
  return (
    <section className="space-y-4">
      {/* Alerts Stack */}
      <AnimatePresence>
        {alerts.map((alert) => (
          <AlertBanner key={alert.id} alert={alert} onDismiss={onDismissAlert} />
        ))}
      </AnimatePresence>

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Live MCP Audit Transactions
          </h2>
          <p className="text-xs text-white/50">
            Real-time pre-execution intercept stream. Showing latest {txs.length} transactions.
          </p>
        </div>

        {txs.length > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/50">
            <span className="w-1.5 h-1.5 rounded-full bg-[#30D158] animate-pulse" />
            <span>Streaming</span>
          </span>
        )}
      </div>

      {/* Grouped Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0D0F]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] font-medium uppercase tracking-wider text-white/45">
              <th className="px-5 py-3">Timestamp</th>
              <th className="px-4 py-3">Harness</th>
              <th className="px-4 py-3">Tool & MCP Server</th>
              <th className="px-4 py-3">Final Risk</th>
              <th className="px-4 py-3">Disposition</th>
              <th className="px-4 py-3 font-mono">Anomaly</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {txs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center text-white/40">
                  <div className="max-w-sm mx-auto space-y-2">
                    <Activity size={28} className="mx-auto text-white/20 stroke-[1.5]" />
                    <p className="text-xs font-medium text-white/60">
                      Awaiting tool telemetry
                    </p>
                    <p className="text-[11px] text-white/40">
                      Wrap an MCP server with <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-white/70">astram protect</code> and trigger a call.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              txs.map((tx) => {
                const final = riskName(tx.finalMonotonicRisk);
                const isHold = final === 'HOLD';

                return (
                  <motion.tr
                    key={`${tx.txId}:${tx.timestampMs}`}
                    initial={{ opacity: 0, backgroundColor: isHold ? 'rgba(255, 69, 58, 0.15)' : 'rgba(255, 255, 255, 0.05)' }}
                    animate={{ opacity: 1, backgroundColor: isHold ? 'rgba(255, 69, 58, 0.04)' : 'rgba(0, 0, 0, 0)' }}
                    transition={appleSpring.fluid}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-[11px] text-white/45">
                      {clockTime(tx.timestampMs)}
                    </td>
                    <td className="px-4 py-3">
                      <HostBadge host={tx.agentHost} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-white font-medium">{tx.toolName}</span>
                        <span className="font-mono text-[11px] text-white/40">{tx.mcpServerId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge label={final} />
                    </td>
                    <td className="px-4 py-3">
                      <DispositionLabel disposition={tx.disposition} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-white/50 tabular-nums">
                      {tx.anomalyScore.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isHold && (
                        <button
                          type="button"
                          onClick={() => onRollback(tx.txId)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FF453A]/15 hover:bg-[#FF453A]/25 text-[#FF453A] border border-[#FF453A]/30 text-xs font-medium transition cursor-pointer"
                        >
                          <RotateCcw size={11} className="stroke-[2.5]" />
                          <span>Rollback</span>
                        </button>
                      )}
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
