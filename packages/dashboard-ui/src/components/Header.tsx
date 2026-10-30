/**
 * Apple Human Interface Header for Astram Command Center.
 * Clean, minimal navigation anchor with Apple typography and optical symmetry.
 */

import type { JSX } from 'react';
import { Sliders, MessageSquare, Command } from 'lucide-react';

export interface HealthState {
  up: boolean;
  version: string | null;
}

export function Header({
  health,
  wsState,
  onOpenWizard,
  onOpenFeedback,
  onOpenShortcuts,
}: {
  health: HealthState | null;
  wsState: 'connecting' | 'open' | 'reconnecting';
  onOpenWizard?: () => void;
  onOpenFeedback?: () => void;
  onOpenShortcuts?: () => void;
}): JSX.Element {
  const isUp = health?.up === true;

  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-black/60 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 h-14">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] border border-white/[0.12] text-white font-mono text-sm font-semibold shadow-inner">
            Λ
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-sm font-semibold tracking-tight text-white">
              Astram
            </h1>
            <span className="text-[11px] font-mono text-white/40 tracking-normal">
              Command Center
            </span>
          </div>
        </div>

        {/* Center: Open space reserved for the centered Dynamic Notch floating above */}
        <div className="hidden md:block w-72" />

        {/* Right: Micro Controls */}
        <div className="flex items-center gap-3 text-xs">
          {onOpenShortcuts && (
            <button
              type="button"
              onClick={onOpenShortcuts}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white border border-white/[0.08] text-xs font-mono transition cursor-pointer"
              title="Keyboard Shortcuts (⌘/ or ?)"
            >
              <Command size={12} className="stroke-[1.8]" />
              <span className="hidden sm:inline text-[11px]">⌘/</span>
            </button>
          )}

          {onOpenFeedback && (
            <button
              type="button"
              onClick={onOpenFeedback}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white border border-white/[0.08] text-xs font-medium transition cursor-pointer"
              title="Give Feedback"
            >
              <MessageSquare size={13} className="stroke-[1.8]" />
              <span className="hidden sm:inline">Feedback</span>
            </button>
          )}

          {onOpenWizard && (
            <button
              type="button"
              onClick={onOpenWizard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-white/90 active:scale-95 transition cursor-pointer"
              title="Configure Protection Harnesses"
            >
              <Sliders size={13} className="stroke-[2.2]" />
              <span>Configure</span>
            </button>
          )}

          {/* Connection status pill */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/50 font-mono">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isUp && wsState === 'open' ? '#30D158' : '#FF9F0A',
              }}
            />
            <span>{wsState === 'open' ? 'live' : wsState}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
