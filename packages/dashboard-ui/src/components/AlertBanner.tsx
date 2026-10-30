/**
 * Apple Human Interface Alert Banner for WS 'alert' events.
 * High-clarity indicative alert card with physics-based interactions.
 */

import type { JSX } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, AlertTriangle, X } from 'lucide-react';
import { appleSpring } from '../lib/theme';

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
  const isHold = alert.level === 'HOLD';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={appleSpring.fluid}
      role="alert"
      className={`mb-3 flex items-start gap-3.5 rounded-2xl border p-3.5 text-xs ${
        isHold
          ? 'border-[#FF453A]/30 bg-[#FF453A]/10 text-white'
          : 'border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-white'
      }`}
    >
      <div className="shrink-0 mt-0.5">
        {isHold ? (
          <ShieldAlert size={16} className="text-[#FF453A] stroke-[2.2]" />
        ) : (
          <AlertTriangle size={16} className="text-[#FF9F0A] stroke-[2.2]" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
              isHold ? 'text-[#FF453A]' : 'text-[#FF9F0A]'
            }`}
          >
            {alert.level}
          </span>
          {alert.target && (
            <span className="font-mono text-[11px] text-white/50">{alert.target}</span>
          )}
        </div>
        <p className="text-white/85 leading-relaxed">{alert.message}</p>
        {alert.txId && (
          <p className="font-mono text-[10px] text-white/40">
            Tx ID: {alert.txId.slice(0, 16)}…
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(alert.id)}
        aria-label="Dismiss alert"
        className="shrink-0 rounded-lg p-1 text-white/40 hover:text-white transition-colors"
      >
        <X size={13} />
      </button>
    </motion.div>
  );
}
