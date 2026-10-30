/**
 * Apple Human Interface Design System Tokens for Astram Command Center.
 *
 * Rules:
 * - 100% Monochrome foundation (True OLED Black, Slate/Zinc Glass Surfaces).
 * - Indicative semantic colors ONLY (Apple Green #30D158, Apple Orange #FF9F0A, Apple Red #FF453A, Focus White).
 * - Zero decorative gradients. Zero emojis.
 * - Calibrated physics-based spring curves.
 */

import type { Transition } from 'framer-motion';

// ============================================================================
// 1. Spring Physics Presets
// ============================================================================

export const appleSpring = {
  /** Snappy micro-interactions: button presses, toggles, icon clicks */
  snappy: {
    type: 'spring',
    stiffness: 520,
    damping: 32,
    mass: 0.8,
  } as Transition,

  /** Fluid layout morphing: Dynamic Notch states, modals, sheets */
  fluid: {
    type: 'spring',
    stiffness: 320,
    damping: 28,
    mass: 1.0,
  } as Transition,

  /** Gentle spatial motion: tab transitions, sliding active indicator */
  gentle: {
    type: 'spring',
    stiffness: 220,
    damping: 26,
    mass: 1.1,
  } as Transition,

  /** Elastic recoil: threat alert triggers, error bounce */
  bounce: {
    type: 'spring',
    stiffness: 420,
    damping: 18,
    mass: 0.9,
  } as Transition,
};

// ============================================================================
// 2. Indicative Semantic Color System
// ============================================================================

export type RiskVerdict = 'PASS' | 'WARN' | 'HOLD' | 'REMEDIATED' | 'UNKNOWN';

export interface SemanticStyle {
  label: string;
  text: string;
  bg: string;
  border: string;
  dotColor: string;
  badgeClass: string;
}

export const RISK_THEME: Record<string, SemanticStyle> = {
  PASS: {
    label: 'PASS',
    text: 'text-[#30D158]',
    bg: 'bg-[#30D158]/10',
    border: 'border-[#30D158]/30',
    dotColor: '#30D158',
    badgeClass: 'text-[#30D158] bg-[#30D158]/10 border-[#30D158]/30',
  },
  WARN: {
    label: 'WARN',
    text: 'text-[#FF9F0A]',
    bg: 'bg-[#FF9F0A]/10',
    border: 'border-[#FF9F0A]/30',
    dotColor: '#FF9F0A',
    badgeClass: 'text-[#FF9F0A] bg-[#FF9F0A]/10 border-[#FF9F0A]/30',
  },
  HOLD: {
    label: 'HOLD',
    text: 'text-[#FF453A]',
    bg: 'bg-[#FF453A]/10',
    border: 'border-[#FF453A]/30',
    dotColor: '#FF453A',
    badgeClass: 'text-[#FF453A] bg-[#FF453A]/10 border-[#FF453A]/30',
  },
  REMEDIATED: {
    label: 'REMEDIATED',
    text: 'text-zinc-200',
    bg: 'bg-zinc-800/60',
    border: 'border-zinc-700/80',
    dotColor: '#E4E4E7',
    badgeClass: 'text-zinc-200 bg-zinc-800/60 border-zinc-700/80',
  },
};

export function getRiskTheme(verdict: string): SemanticStyle {
  return (
    RISK_THEME[verdict] ?? {
      label: verdict,
      text: 'text-zinc-400',
      bg: 'bg-zinc-800/40',
      border: 'border-zinc-700/50',
      dotColor: '#71717A',
      badgeClass: 'text-zinc-400 bg-zinc-800/40 border-zinc-700/50',
    }
  );
}

// ============================================================================
// 3. Apple Monochrome Surfaces
// ============================================================================

export const surfaceTokens = {
  canvas: 'bg-[#000000]',
  surfaceLevel1: 'bg-[#0D0D0F] border border-white/[0.08]',
  surfaceLevel2: 'bg-[#161618] border border-white/[0.12] backdrop-blur-2xl',
  surfaceLevel3: 'bg-[#1C1C1E] border border-white/[0.16] shadow-2xl shadow-black/80',
  cardHover: 'hover:bg-white/[0.04] transition-colors',
  divider: 'border-white/[0.08]',
  subtleText: 'text-white/45',
  bodyText: 'text-white/75',
  headlineText: 'text-white',
};
