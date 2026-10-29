/**
 * Header: astram Command Center — daemon health (polled every 5 s, green/red
 * dot + version) and live WS connection state.
 */
import type { JSX } from 'react';

export interface HealthState {
  up: boolean;
  version: string | null;
}

export function Header({
  health,
  wsState,
  onOpenWizard,
}: {
  health: HealthState | null;
  wsState: 'connecting' | 'open' | 'reconnecting';
  onOpenWizard?: () => void;
}): JSX.Element {
  const up = health?.up === true;
  const dotClass =
    health === null
      ? 'bg-zinc-500'
      : up
        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse'
        : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]';
  const healthText =
    health === null ? 'checking daemon…' : up ? `daemon v${health.version ?? '?'}` : 'daemon offline';

  const wsClass =
    wsState === 'open'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : wsState === 'connecting'
        ? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  const wsText = wsState === 'open' ? 'telemetry live' : `${wsState}…`;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 font-mono text-sm font-bold text-sky-400">
            Λ
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            astram Command Center
          </h1>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {onOpenWizard && (
            <button
              type="button"
              onClick={onOpenWizard}
              className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-sky-300 font-medium hover:bg-sky-500/20 transition"
              title="Configure Agent Protection Scopes"
            >
              <span>🛡️</span>
              <span>Setup & Protection</span>
            </button>
          )}
          <span className="flex items-center gap-2 text-zinc-400">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} />
            {healthText}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${wsClass}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                wsState === 'open' ? 'bg-emerald-400' : 'bg-zinc-500'
              }`}
            />
            {wsText}
          </span>
        </div>
      </div>
    </header>
  );
}
