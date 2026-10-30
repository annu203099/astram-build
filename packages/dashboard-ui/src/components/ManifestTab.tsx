/**
 * Tab 1 — Slowship Boarding Manifest (Apple Human Interface Standard).
 *
 * Scans every package, skill, and tool before execution.
 * Fluid spring expansion for evidence and AST facts inspection.
 */

import { Fragment, useState } from 'react';
import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCw, ChevronRight, FileCode, CheckCircle2 } from 'lucide-react';
import type { BoardingManifestItem } from '@astram/types';
import { deltaLabel, prettyJson, relativeTime } from '../lib/format';
import { RiskBadge } from './Badges';
import { appleSpring } from '../lib/theme';

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
    <section className="space-y-4">
      {/* Top action & description bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Slowship Boarding Manifest
          </h2>
          <p className="text-xs text-white/50">
            Pre-execution code & capability verification before processes board the runtime.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white border border-white/[0.08] text-xs font-medium transition cursor-pointer"
        >
          <RotateCw size={12} className="stroke-[2]" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Apple-style Grouped Table Card */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D0D0F]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] font-medium uppercase tracking-wider text-white/45">
              <th className="px-5 py-3 w-8" />
              <th className="px-3 py-3">Target</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Deterministic</th>
              <th className="px-4 py-3 font-mono">Jev Δ</th>
              <th className="px-4 py-3">Final Verdict</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center text-white/40">
                  <div className="max-w-sm mx-auto space-y-2">
                    <FileCode size={28} className="mx-auto text-white/20 stroke-[1.5]" />
                    <p className="text-xs font-medium text-white/60">
                      No boarding items recorded yet
                    </p>
                    <p className="text-[11px] text-white/40">
                      Run <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-white/70">astram protect</code> to board harnesses.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isExpanded = expandedId === item.itemId;

                return (
                  <Fragment key={item.itemId}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : item.itemId)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
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
                      <td className="px-3 py-3.5 font-medium text-white max-w-xs truncate">
                        {item.targetName}
                      </td>
                      <td className="px-4 py-3.5 text-white/50">
                        {CATEGORY_LABELS[item.category] ?? item.category}
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBadge label={item.deterministicStatus} />
                      </td>
                      <td
                        className={`px-4 py-3.5 font-mono text-xs ${
                          item.jevApiAdjustment > 0
                            ? 'text-[#FF9F0A]'
                            : item.jevApiAdjustment < 0
                              ? 'text-white/40'
                              : 'text-white/60'
                        }`}
                      >
                        {deltaLabel(item.jevApiAdjustment)}
                      </td>
                      <td className="px-4 py-3.5">
                        <RiskBadge label={item.finalStatus} />
                      </td>
                      <td className="px-4 py-3.5 font-mono text-white/40 text-[11px]">
                        {relativeTime(item.updatedAtMs)}
                      </td>
                    </tr>

                    {/* Expandable Evidence Drawer */}
                    {isExpanded && (
                      <tr className="bg-white/[0.02]">
                        <td colSpan={7} className="px-6 py-4">
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={appleSpring.fluid}
                            className="space-y-3"
                          >
                            <div className="flex items-center gap-3 text-[11px] text-white/45">
                              <span>
                                Item ID: <span className="font-mono text-white/70">{item.itemId}</span>
                              </span>
                              <span className="w-1 h-1 rounded-full bg-white/20" />
                              <span className="flex items-center gap-1 text-[#30D158]">
                                <CheckCircle2 size={12} />
                                <span>{item.ed25519Sig ? 'Cryptographically Signed' : 'Local Verification'}</span>
                              </span>
                            </div>

                            <div className="rounded-xl bg-black/50 border border-white/[0.06] p-3 text-xs">
                              <span className="font-semibold text-white/50 block mb-1 uppercase text-[10px] tracking-wider">
                                Observed Evidence Summary
                              </span>
                              <p className="text-white/80 leading-relaxed font-sans">
                                {item.evidenceSummary || 'No behavioral anomalies reported for this item.'}
                              </p>
                            </div>

                            <div className="space-y-1">
                              <span className="font-semibold text-white/45 block uppercase text-[10px] tracking-wider">
                                AST Capability Extraction
                              </span>
                              <pre className="scrollbar-thin max-h-60 overflow-auto rounded-xl border border-white/[0.08] bg-black/70 p-3.5 font-mono text-[11px] leading-relaxed text-white/75">
                                {prettyJson(item.astFactsJson)}
                              </pre>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
