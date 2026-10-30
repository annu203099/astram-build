/**
 * FinalCtaSection for Astram Landing Page.
 * Conforms to owner.com content psychology:
 * High-contrast final conversion section with primary Command Center launch button,
 * terminal quick-start command, and Apple trust badges.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  ArrowRight,
  Terminal,
  Copy,
  Check,
  Lock,
  Cpu,
  Layers,
  Download,
  ExternalLink,
} from 'lucide-react';
import { appleSpring } from '../../lib/theme';

export interface FinalCtaSectionProps {
  onLaunchDashboard: () => void;
}

export function FinalCtaSection({ onLaunchDashboard }: FinalCtaSectionProps): JSX.Element {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopyCli = (): void => {
    navigator.clipboard.writeText('npx @astram/cli protect');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const badges = [
    { label: '100% Local & Offline', icon: Lock },
    { label: 'Invariant I1 Guaranteed', icon: ShieldCheck },
    { label: '5 IDE Integrations', icon: Layers },
    { label: '< 5ms Interception', icon: Cpu },
  ];

  return (
    <section className="py-24 px-6 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={appleSpring.fluid}
        className="rounded-3xl bg-[#161618] border border-white/[0.18] p-8 sm:p-14 text-center relative overflow-hidden shadow-2xl"
      >
        {/* Subtle Ambient Radial Highlight */}
        <div className="absolute inset-0 bg-radial from-white/[0.04] to-transparent pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.12] text-xs font-mono text-white/80">
            <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" />
            <span>READY FOR PRODUCTION DEPLOYMENT</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Take Control of Your Autonomous Agents Today
          </h2>

          <p className="text-sm sm:text-base text-white/65 leading-relaxed max-w-2xl mx-auto">
            Stop trusting unconstrained AI agents with your files, keys, and production repositories. Activate the zero-trust microkernel shield in 60 seconds.
          </p>

          {/* Action Cluster */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://github.com/annu203099/astram-build/releases/download/v0.1.0/Astram_0.1.0_x64-setup.exe"
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-white text-black font-semibold text-sm hover:bg-white/90 active:scale-95 transition cursor-pointer shadow-xl"
            >
              <Download size={16} className="stroke-[2.2]" />
              <span>Download Setup (.exe)</span>
            </a>

            <button
              type="button"
              onClick={onLaunchDashboard}
              className="flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white font-semibold text-sm border border-white/[0.14] transition cursor-pointer shadow-md"
            >
              <ShieldCheck size={16} className="stroke-[2]" />
              <span>Open Command Center</span>
              <ArrowRight size={14} className="stroke-[2]" />
            </button>

            {/* Quick-Start Terminal Command */}
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-black border border-white/[0.12] text-xs font-mono">
              <Terminal size={14} className="text-white/40" />
              <span className="text-[#30D158]">$</span>
              <span className="text-white/90">npx @astram/cli protect</span>
              <button
                type="button"
                onClick={handleCopyCli}
                className="ml-2 p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-white/70 hover:text-white transition cursor-pointer"
                title="Copy Command"
              >
                {copied ? <Check size={12} className="text-[#30D158]" /> : <Copy size={12} />}
              </button>
            </div>

            {/* GitHub Releases Link */}
            <a
              href="https://github.com/annu203099/astram-build/releases/tag/v0.1.0"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white border border-white/[0.08] text-xs font-mono transition"
            >
              <ExternalLink size={13} />
              <span>Release v0.1.0</span>
            </a>
          </div>

          {/* Trust Badges */}
          <div className="pt-8 border-t border-white/[0.08] grid grid-cols-2 sm:grid-cols-4 gap-4">
            {badges.map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.label}
                  className="flex items-center justify-center gap-2 p-2 rounded-xl bg-white/[0.03] text-xs font-mono text-white/60"
                >
                  <Icon size={13} className="text-white/40" />
                  <span>{b.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
