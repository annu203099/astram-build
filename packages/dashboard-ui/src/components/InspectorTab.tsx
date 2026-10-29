/**
 * Tab 3 — Deception Inspector.
 *
 * GET /api/transactions (limit 200); selecting one shows two side-by-side
 * panels: CLAIMED (untrusted) — the tool's own statedExplanation — versus
 * ACTUAL (observed) — deterministic facts, modified files and the final
 * monotonic risk from the audit ledger.
 */
import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { AtomicAuditTx } from '@astram/types';
import { api } from '../lib/api';
import { clockTime, parseStringArray, prettyJson, riskName } from '../lib/format';
import { HostBadge, RiskBadge } from './Badges';

/** The §5.2 ledger schema does not persist per-fact rows at Tier 1; render them when present. */
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
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-800/60 py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="min-w-0 break-all text-right text-zinc-200">{children}</span>
    </div>
  );
}

export function InspectorTab(): JSX.Element {
  const [txs, setTxs] = useState<AtomicAuditTx[]>([]);
  const [selected, setSelected] = useState<AtomicAuditTx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = (): void => {
    setLoading(true);
    api
      .transactions(200)
      .then((list) => {
        setTxs(list);
        setSelected((prev) => prev && list.some((t) => t.txId === prev.txId) ? prev : (list[0] ?? null));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const fsModified = selected ? parseStringArray(selected.fsModifiedFilesJson) : [];
  const facts = selected ? factsOf(selected) : [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          Compare what a tool <em>claimed</em> it would do against what the ledger actually observed.
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
        >
          {loading ? 'loading…' : 'refresh'}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* transaction list */}
        <div className="scrollbar-thin max-h-[32rem] overflow-auto rounded-xl border border-zinc-800">
          {txs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              No transactions in the ledger yet.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {txs.map((tx) => (
                <li key={tx.txId}>
                  <button
                    type="button"
                    onClick={() => setSelected(tx)}
                    className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition hover:bg-zinc-800/40 ${
                      selected?.txId === tx.txId ? 'bg-zinc-800/60' : ''
                    }`}
                  >
                    <RiskBadge label={riskName(tx.finalMonotonicRisk)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-zinc-200">
                        {tx.toolName}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">
                        {tx.txId.slice(0, 20)}…
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                      {clockTime(tx.timestampMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* claimed vs actual */}
        {!selected ? (
          <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500">
            Select a transaction to inspect it.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/* CLAIMED — untrusted */}
            <div className="overflow-hidden rounded-xl border border-amber-500/40">
              <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-amber-200">CLAIMED</h3>
                <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  untrusted
                </span>
              </div>
              <div className="p-4">
                <p className="text-sm italic leading-relaxed text-zinc-300">
                  {selected.statedExplanation?.trim() ||
                    '(the tool offered no explanation for this call)'}
                </p>
                <p className="mt-4 text-xs uppercase tracking-wider text-zinc-500">
                  redacted arguments (as claimed context)
                </p>
                <pre className="scrollbar-thin mt-1.5 max-h-40 overflow-auto rounded-lg border border-zinc-800 bg-black/60 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400">
                  {prettyJson(selected.redactedArgumentsJson || '[]')}
                </pre>
              </div>
            </div>

            {/* ACTUAL — observed */}
            <div className="overflow-hidden rounded-xl border border-zinc-700">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-700 bg-zinc-800/60 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-zinc-200">ACTUAL</h3>
                <span className="rounded-full border border-zinc-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  observed
                </span>
              </div>
              <div className="p-4">
                <ObservedRow label="final risk">
                  <RiskBadge label={riskName(selected.finalMonotonicRisk)} />
                </ObservedRow>
                <ObservedRow label="disposition">
                  <span className="font-mono text-xs">{selected.disposition}</span>
                </ObservedRow>
                <ObservedRow label="deterministic / jev Δ">
                  <span className="font-mono text-xs">
                    {riskName(selected.deterministicRisk)} /{' '}
                    {selected.decisionApiDelta > 0
                      ? `+${selected.decisionApiDelta}`
                      : selected.decisionApiDelta}
                  </span>
                </ObservedRow>
                <ObservedRow label="host">
                  <HostBadge host={selected.agentHost} />
                </ObservedRow>
                <ObservedRow label="anomaly">
                  <span className="font-mono text-xs tabular-nums">
                    {selected.anomalyScore.toFixed(2)}
                  </span>
                </ObservedRow>

                <p className="mt-3 text-xs uppercase tracking-wider text-zinc-500">facts</p>
                {facts.length > 0 ? (
                  <table className="mt-1.5 w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="pr-2 font-medium">rule</th>
                        <th className="pr-2 font-medium">category</th>
                        <th className="pr-2 font-medium">line</th>
                        <th className="font-medium">snippet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facts.map((fact, i) => (
                        <tr key={i} className="border-t border-zinc-800/60 align-top">
                          <td className="whitespace-nowrap py-1 pr-2 font-mono text-zinc-300">
                            {fact.ruleId ?? '—'}
                          </td>
                          <td className="py-1 pr-2 text-zinc-400">{fact.category ?? '—'}</td>
                          <td className="py-1 pr-2 font-mono text-zinc-500">{fact.line ?? '—'}</td>
                          <td className="py-1 break-all font-mono text-zinc-400">
                            {fact.snippet ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    The Tier-1 ledger schema (Handbook §5.2) does not persist per-fact AST rows;
                    the observed verdict above is the authoritative monotonic result.
                  </p>
                )}

                <p className="mt-3 text-xs uppercase tracking-wider text-zinc-500">
                  fs modified files
                </p>
                {fsModified.length > 0 ? (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-mono text-xs text-zinc-300">
                    {fsModified.map((f) => (
                      <li key={f} className="break-all">
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 font-mono text-xs text-zinc-500">(none recorded)</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
