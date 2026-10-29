/**
 * Tab 2 — Live MCP Feed.
 *
 * WS 'tx' events are prepended (cap 200); 'alert' events show a dismissible
 * red banner on top. HOLD rows carry a Rollback button — the Tier-2 daemon
 * answers 200 with an honest JSON verdict (pre-exec block / unavailable);
 * App.tsx renders the result as a toast.
 */
import type { JSX } from 'react';
import type { AtomicAuditTx } from '@astram/types';
import { clockTime, riskName } from '../lib/format';
import { AlertBanner, type AlertItem } from './AlertBanner';
import { DispositionLabel, HostBadge, RiskBadge } from './Badges';

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
    <section>
      {alerts.map((alert) => (
        <AlertBanner key={alert.id} alert={alert} onDismiss={onDismissAlert} />
      ))}

      <p className="mb-3 text-sm text-zinc-400">
        Atomic audit transactions as they happen. Showing the latest {txs.length}
        {txs.length >= 200 ? ' (capped at 200)' : ''}.
      </p>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-900/80 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Host</th>
              <th className="px-4 py-2.5 font-medium">Tool</th>
              <th className="px-4 py-2.5 font-medium">Final</th>
              <th className="px-4 py-2.5 font-medium">Disposition</th>
              <th className="px-4 py-2.5 font-medium">Anomaly</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {txs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                  Waiting for tx telemetry — wrap an MCP server with{' '}
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5">astram protect</code> and make a tool call.
                </td>
              </tr>
            ) : (
              txs.map((tx) => {
                const final = riskName(tx.finalMonotonicRisk);
                return (
                  <tr
                    key={`${tx.txId}:${tx.timestampMs}`}
                    className={`border-t border-zinc-800/70 ${
                      final === 'HOLD' ? 'bg-red-500/[0.04]' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-zinc-400">
                      {clockTime(tx.timestampMs)}
                    </td>
                    <td className="px-4 py-2.5">
                      <HostBadge host={tx.agentHost} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-zinc-200">{tx.toolName}</span>
                      <span className="ml-2 text-xs text-zinc-500">{tx.mcpServerId}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <RiskBadge label={final} />
                    </td>
                    <td className="px-4 py-2.5">
                      <DispositionLabel disposition={tx.disposition} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-400 tabular-nums">
                      {tx.anomalyScore.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {final === 'HOLD' && (
                        <button
                          type="button"
                          onClick={() => onRollback(tx.txId)}
                          className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300 transition hover:border-sky-400 hover:bg-sky-500/20"
                        >
                          Rollback
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
