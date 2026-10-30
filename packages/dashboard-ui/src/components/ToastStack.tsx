/**
 * Apple-Grade Physics-Based Toast Stack.
 * Floats in bottom-right with fluid spring entrance, auto-dismissal, and tactile close.
 */

import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { appleSpring } from '../lib/theme';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  text: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}): JSX.Element | null {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-84 flex-col gap-2.5">
      <AnimatePresence>
        {toasts.map((toast) => {
          const isSuccess = toast.kind === 'success';
          const isError = toast.kind === 'error';

          return (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
              transition={appleSpring.fluid}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-3.5 shadow-2xl backdrop-blur-2xl bg-[#121214]/95 ${
                isError
                  ? 'border-[#FF453A]/30 text-white'
                  : isSuccess
                    ? 'border-[#30D158]/30 text-white'
                    : 'border-white/[0.12] text-white'
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {isError ? (
                  <AlertCircle size={15} className="text-[#FF453A] stroke-[2.2]" />
                ) : isSuccess ? (
                  <CheckCircle2 size={15} className="text-[#30D158] stroke-[2.2]" />
                ) : (
                  <AlertTriangle size={15} className="text-[#FF9F0A] stroke-[2.2]" />
                )}
              </div>

              <p className="min-w-0 flex-1 text-xs leading-relaxed text-white/85">
                {toast.text}
              </p>

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss toast"
                className="shrink-0 text-white/40 hover:text-white p-0.5 rounded-md transition-colors"
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
