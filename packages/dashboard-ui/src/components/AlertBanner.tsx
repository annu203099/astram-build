/** Dismissible red alert banner stack for WS 'alert' events (HOLD/WARN). */
import type { JSX } from 'react';

export interface AlertItem {
  id: string;
  level: 'WARN' | 'HOLD';
  message: string;
  txId?: string;
  target?: string;
}

export function AlertBanner({
  alert,
  onDismiss,
}: {
  alert: AlertItem;
  onDismiss: (id: string) => void;
}): JSX.Element {
  return (
    <div
      role="alert"
      className={`mb-2 flex items-start gap-3 rounded-lg border px-4 py-2.5 text-sm ${
        alert.level === 'HOLD'
          ? 'border-red-500/50 bg-red-500/10 text-red-200'
          : 'border-amber-500/50 bg-amber-500/10 text-amber-200'
      }`}
    >
      <span className="mt-0.5 shrink-0 font-mono text-xs font-bold uppercase tracking-wider opacity-80">
        {alert.level}
      </span>
      <p className="min-w-0 flex-1 break-words">
        {alert.message}
        {alert.target ? <span className="ml-2 font-mono text-xs opacity-70">{alert.target}</span> : null}
        {alert.txId ? <span className="ml-2 font-mono text-xs opacity-50">{alert.txId.slice(0, 16)}…</span> : null}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(alert.id)}
        aria-label="Dismiss alert"
        className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
      >
        ✕
      </button>
    </div>
  );
}
