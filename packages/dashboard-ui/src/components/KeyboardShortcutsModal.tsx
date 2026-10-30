/**
 * Apple Human Interface Keyboard Shortcuts Sheet.
 * Displays all command center keybindings with spring animations.
 */

import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Command, X } from 'lucide-react';
import { appleSpring } from '../lib/theme';

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['⌘', '1'], label: 'Switch to Slowship Manifest' },
  { keys: ['⌘', '2'], label: 'Switch to Live MCP Feed' },
  { keys: ['⌘', '3'], label: 'Switch to Deception Inspector' },
  { keys: ['⌘', '4'], label: 'Switch to Multiverse 3D Tree' },
  { keys: ['⌘', 'Z'], label: 'Pre-Execution Rollback (Latest Threat)' },
  { keys: ['⌘', 'F'], label: 'Open Astra Feedback & Diagnostics' },
  { keys: ['↑', '↓'], label: 'Navigate Inspector Audit Ledger' },
  { keys: ['Esc'], label: 'Close Modal or Collapse Dynamic Notch' },
  { keys: ['?'], label: 'Toggle Keyboard Shortcuts' },
];

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps): JSX.Element | null {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/75 backdrop-blur-md"
        />

        {/* Apple Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 12 }}
          transition={appleSpring.fluid}
          className="relative w-full max-w-md rounded-2xl bg-[#121214] border border-white/10 p-6 shadow-2xl text-white z-10"
        >
          <div className="flex items-center justify-between pb-4 border-b border-white/8">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-white/[0.08] text-white">
                <Command size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-white">
                  Keyboard Shortcuts
                </h3>
                <p className="text-[11px] text-white/50">
                  Global navigation and instant microkernel controls
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/40 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-4 divide-y divide-white/[0.04]">
            {SHORTCUTS.map((sc, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 text-xs">
                <span className="text-white/70">{sc.label}</span>
                <div className="flex items-center gap-1 font-mono">
                  {sc.keys.map((k, j) => (
                    <kbd
                      key={j}
                      className="px-2 py-1 rounded-md bg-white/[0.08] border border-white/[0.12] text-[11px] font-semibold text-white shadow-sm"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-3 border-t border-white/8 flex items-center justify-between text-[11px] text-white/40">
            <span>Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.08] text-white/70">Esc</kbd> to dismiss</span>
            <span>Astram MNC Standard</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
