/**
 * Apple Human Interface Badges for Astram.
 * Pure Monochrome foundation with Indicative Semantic coloration only.
 * Zero emojis, zero gradients.
 */

import type { JSX } from 'react';
import { getRiskTheme } from '../lib/theme';

export function RiskBadge({ label }: { label: string }): JSX.Element {
  const theme = getRiskTheme(label);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono font-medium tracking-tight ${theme.badgeClass}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: theme.dotColor }}
      />
      <span>{label}</span>
    </span>
  );
}

export function HostBadge({ host }: { host: string }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-mono text-white/70">
      {host}
    </span>
  );
}

const DISPOSITION_STYLES: Record<string, string> = {
  COMMITTED: 'text-white/45',
  BLOCKED_PRE_EXEC: 'text-[#FF453A]',
  ROLLED_BACK: 'text-white',
  CANARY_HEALED: 'text-[#30D158]',
};

export function DispositionLabel({ disposition }: { disposition: string }): JSX.Element {
  const color = DISPOSITION_STYLES[disposition] ?? 'text-white/50';
  return (
    <span className={`text-xs font-mono font-medium ${color}`}>
      {disposition}
    </span>
  );
}
