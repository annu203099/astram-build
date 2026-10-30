/**
 * Astra — Astram's Apple-Grade Physics-Based Microkernel Mascot.
 *
 * Design:
 * - Minimalist concentric geometric vector rings with an optical reactive core.
 * - Interactive parallax eye-tracking toward the cursor.
 * - Zero emojis, zero gradients.
 * - Reactive states: idle breathing, scan radar sweep, threat-defense shield, and click-to-interact feedback.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { appleSpring } from '../lib/theme';

export type AstraMood = 'idle' | 'scanning' | 'alert' | 'secure';

export interface AstraMascotProps {
  mood?: AstraMood;
  size?: number;
  onClick?: () => void;
  showFeedbackPrompt?: boolean;
}

export function AstraMascot({
  mood = 'idle',
  size = 28,
  onClick,
}: AstraMascotProps): JSX.Element {
  const [isHovered, setIsHovered] = useState(false);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });

  // Status color purely indicative: green for secure/idle, amber for scanning, red for alert
  const coreColor =
    mood === 'alert'
      ? '#FF453A'
      : mood === 'scanning'
        ? '#FF9F0A'
        : '#30D158';

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const relY = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    setPupilOffset({
      x: Math.max(-2.5, Math.min(2.5, relX * 2.5)),
      y: Math.max(-2.5, Math.min(2.5, relY * 2.5)),
    });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setPupilOffset({ x: 0, y: 0 });
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      title="Astra — Kernel Guardian (Click for Assistant & Feedback)"
      className="relative flex items-center justify-center cursor-pointer p-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      transition={appleSpring.snappy}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="overflow-visible"
      >
        {/* Outer Orbital Ring — rotates on scanning, expands on alert */}
        <motion.circle
          cx="16"
          cy="16"
          r="13"
          stroke={mood === 'alert' ? '#FF453A' : 'rgba(255, 255, 255, 0.22)'}
          strokeWidth="1.25"
          strokeDasharray={mood === 'scanning' ? '6 4' : undefined}
          animate={{
            rotate: mood === 'scanning' ? 360 : 0,
            scale: isHovered ? 1.08 : 1,
          }}
          transition={
            mood === 'scanning'
              ? { repeat: Infinity, duration: 4, ease: 'linear' }
              : appleSpring.fluid
          }
        />

        {/* Middle Resonance Ring — breathing physics */}
        <motion.circle
          cx="16"
          cy="16"
          r="8.5"
          stroke={mood === 'alert' ? '#FF453A' : 'rgba(255, 255, 255, 0.45)'}
          strokeWidth="1.5"
          animate={{
            scale: isHovered ? 1.15 : [1, 1.06, 1],
            opacity: isHovered ? 0.9 : [0.5, 0.8, 0.5],
          }}
          transition={
            isHovered
              ? appleSpring.snappy
              : { repeat: Infinity, duration: 3.2, ease: 'easeInOut' }
          }
        />

        {/* Inner Sentinel Pupil — Reactive Optical Gaze + Indicative Status Dot */}
        <motion.circle
          cx="16"
          cy="16"
          r="3.5"
          fill={coreColor}
          animate={{
            x: pupilOffset.x,
            y: pupilOffset.y,
            scale: isHovered ? 1.25 : 1,
          }}
          transition={appleSpring.snappy}
        />

        {/* Ambient Ring Pulse on Threat Alert */}
        {mood === 'alert' && (
          <motion.circle
            cx="16"
            cy="16"
            r="15"
            stroke="#FF453A"
            strokeWidth="1"
            initial={{ opacity: 0.8, scale: 0.9 }}
            animate={{ opacity: 0, scale: 1.5 }}
            transition={{ repeat: Infinity, duration: 1.2, ease: 'easeOut' }}
          />
        )}
      </svg>
    </motion.button>
  );
}

// ============================================================================
// Astra Interactive Feedback Modal (Apple Clean Sheet)
// ============================================================================

export interface CustomerFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitFeedback: (sentiment: 'positive' | 'neutral' | 'issue', comment: string) => void;
}

export function CustomerFeedbackModal({
  isOpen,
  onClose,
  onSubmitFeedback,
}: CustomerFeedbackModalProps): JSX.Element | null {
  const [sentiment, setSentiment] = useState<'positive' | 'neutral' | 'issue'>('positive');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitFeedback(sentiment, comment);
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setComment('');
      onClose();
    }, 1200);
  };

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

        {/* Apple-style Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 12 }}
          transition={appleSpring.fluid}
          className="relative w-full max-w-md rounded-2xl bg-[#121214] border border-white/10 p-6 shadow-2xl text-white z-10"
        >
          <div className="flex items-center justify-between pb-4 border-b border-white/8">
            <div className="flex items-center gap-3">
              <AstraMascot size={32} mood={submitted ? 'secure' : 'idle'} />
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-white">
                  Astra Assistant & Feedback
                </h3>
                <p className="text-[11px] text-white/50">
                  Continuous Zero-Trust Quality & User Experience
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

          {submitted ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-10 text-center space-y-2"
            >
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#30D158]/10 text-[#30D158] border border-[#30D158]/30">
                <Check size={20} className="stroke-[2.5]" />
              </div>
              <h4 className="text-sm font-semibold text-white">Thank You for Your Feedback</h4>
              <p className="text-xs text-white/50">
                Your evaluation and telemetry logs have been securely filed for review.
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">
                  How is your experience with Astram today?
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { key: 'positive', label: 'Flawless', dot: '#30D158' },
                      { key: 'neutral', label: 'Adequate', dot: '#FF9F0A' },
                      { key: 'issue', label: 'Report Issue', dot: '#FF453A' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSentiment(opt.key)}
                      className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                        sentiment === opt.key
                          ? 'bg-white/12 border-white/30 text-white'
                          : 'bg-white/[0.03] border-white/8 text-white/50 hover:bg-white/[0.06]'
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: opt.dot }}
                      />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  Comments or Suggestions (Optional)
                </label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Share details on protection accuracy, UX responsiveness, or unexpected blocks…"
                  className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none font-sans"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
                >
                  Submit Feedback
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
