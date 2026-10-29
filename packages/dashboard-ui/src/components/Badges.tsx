/** Risk / boarding-status badges. PASS=emerald, WARN=amber, HOLD=red, REMEDIATED=sky. */
import type { JSX } from 'react';

const RISK_STYLES: Record<string, string> = {
  PASS: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  WARN: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  HOLD: 'border-red-500/40 bg-red-500/10 text-red-300',
  REMEDIATED: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
};

export function RiskBadge({ label }: { label: string }): JSX.Element {
  const cls = RISK_STYLES[label] ?? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

const HOST_STYLES: Record<string, string> = {
  antigravity: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  'claude-code': 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  cursor: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  codex: 'border-lime-500/40 bg-lime-500/10 text-lime-300',
  quill: 'border-pink-500/40 bg-pink-500/10 text-pink-300',
  dsh: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
};

export function HostBadge({ host }: { host: string }): JSX.Element {
  const cls = HOST_STYLES[host] ?? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300';
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {host}
    </span>
  );
}

const DISPOSITION_STYLES: Record<string, string> = {
  COMMITTED: 'text-zinc-400',
  BLOCKED_PRE_EXEC: 'text-red-300',
  ROLLED_BACK: 'text-sky-300',
  CANARY_HEALED: 'text-emerald-300',
};

export function DispositionLabel({ disposition }: { disposition: string }): JSX.Element {
  return (
    <span className={`text-xs font-medium ${DISPOSITION_STYLES[disposition] ?? 'text-zinc-400'}`}>
      {disposition}
    </span>
  );
}
