/**
 * Tab 1 — Slowship Boarding Manifest.
 *
 * GET /api/manifest on mount; WS 'manifest-update' events merge by itemId
 * live (handled in App, which owns the merged map). Row click expands
 * evidenceSummary + astFactsJson pretty-printed.
 */
import { Fragment, useState } from 'react';
import type { JSX } from 'react';
import type { BoardingManifestItem } from '@astram/types';
import { deltaLabel, prettyJson, relativeTime } from '../lib/format';
import { RiskBadge } from './Badges';

const CATEGORY_LABELS: Record<string, string> = {
  LOCKFILE_PKG: 'lockfile pkg',
  AGENT_SKILL: 'agent skill',
  MCP_SERVER: 'mcp server',
  TLS_TRUSTSTORE: 'tls truststore',
  BYTEPATH_SINK: 'bytepath sink',
  DSH_HOST: 'dsh host',
};

export function ManifestTab({
  items,
  onRefresh,
}: {
  items: BoardingManifestItem[];
  onRefresh: () => void;
}): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          Everything boarding the ship, scanned before it executes. Click a row for evidence.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
        >
          refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-900/80 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
              <th className="px-4 py-2.5 font-medium">Deterministic</th>
              <th className="px-4 py-2.5 font-medium">Jev Δ</th>
              <th className="px-4 py-2.5 font-medium">Final</th>
              <th className="px-4 py-2.5 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                  No boarding items yet — run <code className="rounded bg-zinc-800 px-1.5 py-0.5">astram protect</code>{' '}
                  or POST <code className="rounded bg-zinc-800 px-1.5 py-0.5">/api/scan</code>.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <Fragment key={item.itemId}>
                  <tr
                    onClick={() => setExpandedId(expandedId === item.itemId ? null : item.itemId)}
                    className="cursor-pointer border-t border-zinc-800/70 transition hover:bg-zinc-800/40"
                  >
                    <td className="max-w-[22rem] truncate px-4 py-2.5 font-medium text-zinc-100">
                      {item.targetName}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </td>
                    <td className="px-4 py-2.5">
                      <RiskBadge label={item.deterministicStatus} />
                    </td>
                    <td
                      className={`px-4 py-2.5 font-mono text-xs ${
                        item.jevApiAdjustment > 0
                          ? 'text-amber-300'
                          : item.jevApiAdjustment < 0
                            ? 'text-zinc-500'
                            : 'text-zinc-400'
                      }`}
                    >
                      {deltaLabel(item.jevApiAdjustment)}
                    </td>
                    <td className="px-4 py-2.5">
                      <RiskBadge label={item.finalStatus} />
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{relativeTime(item.updatedAtMs)}</td>
                  </tr>
                  {expandedId === item.itemId && (
                    <tr className="border-t border-zinc-800/70 bg-zinc-900/60">
                      <td colSpan={6} className="px-4 py-3">
                        <p className="text-xs text-zinc-500">
                          itemId <span className="font-mono text-zinc-400">{item.itemId}</span>
                          {item.ed25519Sig ? ' · signed' : ' · unsigned'}
                        </p>
                        <p className="mt-1.5 text-sm text-zinc-300">
                          <span className="text-zinc-500">Evidence: </span>
                          {item.evidenceSummary || '—'}
                        </p>
                        <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-zinc-300">
                          {prettyJson(item.astFactsJson)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
