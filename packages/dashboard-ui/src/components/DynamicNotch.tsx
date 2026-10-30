/**
 * DynamicNotch — Apple-Style Dynamic Island & Navigation Anchor for Astram.
 *
 * Rules:
 * - Fluid physics-based morphing between states (Idle, Scanning, Threat Alert, Expanded HUD).
 * - Houses the interactive Astra mascot, daemon telemetry heartbeat, and quick actions.
 * - 100% Monochrome foundation with Indicative Semantic coloration only.
 * - Zero gradients. Zero emojis. Precision SVG icons.
 */

import { useState, useEffect } from 'react';
import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  ShieldAlert,
  Sliders,
  ChevronDown,
  RotateCcw,
  Activity,
  Terminal,
  MessageSquare,
  Radio,
} from 'lucide-react';
import { AstraMascot } from './AstraMascot';
import { appleSpring } from '../lib/theme';
import type { HealthState } from './Header';

export type NotchState = 'idle' | 'scanning' | 'threat' | 'expanded';

export interface DynamicNotchProps {
  health: HealthState | null;
  wsState: 'connecting' | 'open' | 'reconnecting';
  activeAlert?: { id: string; level: 'WARN' | 'HOLD'; message: string; txId?: string; target?: string } | null;
  txCount?: number;
  onOpenWizard?: () => void;
  onOpenFeedback?: () => void;
  onRollbackLatest?: (txId: string) => void;
}

export function DynamicNotch({
  health,
  wsState,
  activeAlert,
  txCount = 0,
  onOpenWizard,
  onOpenFeedback,
  onRollbackLatest,
}: DynamicNotchProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const isUp = health?.up === true;
  const isThreat = activeAlert?.level === 'HOLD';
  const isScanning = wsState === 'open' && txCount > 0 && !isThreat;

  const astraMood = isThreat ? 'alert' : isScanning ? 'scanning' : 'idle';

  // Global Keyboard shortcuts: Escape collapses, ⌘Z rollbacks latest threat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'z' &&
        isThreat &&
        activeAlert?.txId &&
        onRollbackLatest
      ) {
        e.preventDefault();
        onRollbackLatest(activeAlert.txId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, isThreat, activeAlert, onRollbackLatest]);

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center pointer-events-none">
      <motion.div
        layout
        transition={appleSpring.fluid}
        className={`pointer-events-auto relative overflow-hidden bg-black/90 text-white backdrop-blur-2xl border ${
          isThreat
            ? 'border-[#FF453A]/50 shadow-[0_12px_45px_rgba(255,69,58,0.25),inset_0_1px_0_rgba(255,69,58,0.3)]'
            : 'border-white/[0.14] shadow-[0_10px_35px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.12)]'
        } ${isExpanded ? 'rounded-2xl p-5 w-[92vw] max-w-xl' : 'rounded-full px-3.5 py-1.5'}`}
      >
        {/* COMPACT PILL STATE */}
        {!isExpanded && (
          <motion.div
            layout="position"
            className="flex items-center gap-3 text-xs select-none"
          >
            {/* Mascot on the left */}
            <div className="flex items-center">
              <AstraMascot
                size={22}
                mood={astraMood}
                onClick={onOpenFeedback}
              />
            </div>

            {/* Middle: Brand & Context */}
            <div
              onClick={() => setIsExpanded(true)}
              className="flex items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity"
            >
              <span className="font-semibold tracking-tight text-white/90">
                Astram
              </span>

              <span className="w-1 h-1 rounded-full bg-white/20" />

              {isThreat ? (
                <span className="flex items-center gap-1.5 font-medium text-[#FF453A]">
                  <ShieldAlert size={13} className="stroke-[2.2]" />
                  <span>Threat Intercepted</span>
                  {activeAlert?.target && (
                    <span className="hidden sm:inline font-mono text-[10px] text-[#FF453A]/80">
                      ({activeAlert.target})
                    </span>
                  )}
                </span>
              ) : isScanning ? (
                <span className="flex items-center gap-1.5 text-white/70 font-mono text-[11px]">
                  <Radio size={12} className="text-[#FF9F0A] animate-pulse" />
                  <span>Inspecting</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-white/[0.08] text-[10px] text-white/60 tabular-nums">
                    {txCount} calls
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-white/60 font-mono text-[11px]">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: isUp ? '#30D158' : '#FF453A',
                    }}
                  />
                  <span>{isUp ? `v${health?.version ?? '0.1.0'}` : 'daemon offline'}</span>
                </span>
              )}
            </div>

            {/* Right: Quick Action Pill */}
            <div className="flex items-center gap-1.5 pl-1.5 border-l border-white/[0.08]">
              {isThreat && activeAlert?.txId && onRollbackLatest ? (
                <button
                  type="button"
                  onClick={() => onRollbackLatest(activeAlert.txId!)}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FF453A]/20 hover:bg-[#FF453A]/30 text-[#FF453A] border border-[#FF453A]/40 text-[11px] font-medium transition cursor-pointer active:scale-95"
                  title="Immediate Pre-Exec Rollback (⌘Z)"
                >
                  <RotateCcw size={11} className="stroke-[2.5]" />
                  <span>Rollback</span>
                  <span className="hidden sm:inline text-[9px] opacity-60">⌘Z</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenWizard}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white border border-white/[0.08] text-[11px] font-medium transition cursor-pointer active:scale-95"
                  title="Zero-Trust Harness Protection Settings"
                >
                  <Sliders size={11} className="stroke-[2]" />
                  <span>Protect</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="p-1 rounded-full text-white/40 hover:text-white transition cursor-pointer"
                title="Expand Notch HUD"
              >
                <ChevronDown size={13} />
              </button>
            </div>
          </motion.div>
        )}

        {/* EXPANDED NOTCH HUD STATE */}
        {isExpanded && (
          <motion.div
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4 select-none"
          >
            {/* Header row */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <AstraMascot size={28} mood={astraMood} onClick={onOpenFeedback} />
                <div>
                  <h3 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
                    <span>Astram Universal Microkernel</span>
                    <span className="px-2 py-0.2 rounded-full bg-white/[0.08] text-[10px] text-white/60 font-mono">
                      {isUp ? 'ACTIVE' : 'OFFLINE'}
                    </span>
                  </h3>
                  <p className="text-xs text-white/45">
                    Zero-Trust Pre-Execution Interception & Telemetry Monitor
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-white/60 hover:text-white transition cursor-pointer"
              >
                Collapse (Esc)
              </button>
            </div>

            {/* Active Alert Banner if any */}
            {activeAlert && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                  isThreat
                    ? 'bg-[#FF453A]/10 border-[#FF453A]/30 text-[#FF453A]'
                    : 'bg-[#FF9F0A]/10 border-[#FF9F0A]/30 text-[#FF9F0A]'
                }`}
              >
                <div className="space-y-1">
                  <p className="font-semibold uppercase tracking-wider text-[10px]">
                    {activeAlert.level} Interception
                  </p>
                  <p className="text-white/85 leading-relaxed">{activeAlert.message}</p>
                </div>

                {activeAlert.txId && onRollbackLatest && (
                  <button
                    type="button"
                    onClick={() => onRollbackLatest(activeAlert.txId!)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF453A] text-black font-semibold text-xs hover:bg-[#FF453A]/90 transition cursor-pointer active:scale-95"
                  >
                    <RotateCcw size={12} className="stroke-[2.5]" />
                    <span>Rollback</span>
                  </button>
                )}
              </div>
            )}

            {/* Metric grid */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-1.5 text-white/45 text-[11px] mb-1">
                  <Activity size={12} />
                  <span>Telemetry</span>
                </div>
                <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: wsState === 'open' ? '#30D158' : '#FF9F0A',
                    }}
                  />
                  <span className="capitalize">{wsState}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-1.5 text-white/45 text-[11px] mb-1">
                  <Terminal size={12} />
                  <span>Processed Calls</span>
                </div>
                <div className="text-sm font-semibold text-white font-mono tabular-nums">
                  {txCount} transactions
                </div>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-1.5 text-white/45 text-[11px] mb-1">
                  <ShieldCheck size={12} />
                  <span>Invariant I1</span>
                </div>
                <div className="text-sm font-semibold text-[#30D158]">
                  Mathematically Locked
                </div>
              </div>
            </div>

            {/* Quick Actions Footer */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsExpanded(false);
                  onOpenFeedback?.();
                }}
                className="text-xs text-white/60 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
              >
                <MessageSquare size={13} className="stroke-[1.8]" />
                <span>Give Feedback to Astra</span>
              </button>

              <div className="flex items-center gap-2">
                {onOpenWizard && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsExpanded(false);
                      onOpenWizard();
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-white/90 active:scale-95 transition cursor-pointer"
                  >
                    Configure Protection
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
