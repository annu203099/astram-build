/**
 * VillainHeroNarrative for Astram Landing Page.
 * Conforms to owner.com content psychology:
 * Direct side-by-side contrast between the dangerous Status Quo (Blind Faith)
 * and the Astram Shield (Zero-Trust Microkernel).
 */

import type { JSX } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldAlert,
  ShieldCheck,
  FileX,
  Radio,
  Binary,
  Layers,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { appleSpring } from '../../lib/theme';

export function VillainHeroNarrative(): JSX.Element {
  const villainPoints = [
    {
      title: 'Unrestricted Stdio Execution',
      desc: 'Coding agents execute binaries, invoke arbitrary bash scripts, and mutate files directly without an independent security ring.',
      icon: Binary,
    },
    {
      title: 'Poisoned MCP Tools & Skills',
      desc: 'Latent prompt injections buried in third-party SKILL.md files silently siphon SSH keys, API secrets, and source code via background curl calls.',
      icon: Radio,
    },
    {
      title: 'Irreversible Workspace Corruption',
      desc: 'Once an autonomous agent over-prunes directories or drops git branches, recovery requires grueling manual reconstruction and lost hours.',
      icon: FileX,
    },
  ];

  const heroPoints = [
    {
      title: 'Zero-Latency Microkernel Proxy',
      desc: 'Astram runs as an inline transparent firewall between your IDE and agent tools, parsing JSON-RPC calls with under 5ms overhead.',
      icon: Layers,
    },
    {
      title: 'Deterministic AST Spec Verification',
      desc: 'Compares the LLM stated intent against verified syntactic AST facts. Invariant I1 mathematically locks HOLD verdicts against bypasses.',
      icon: ShieldCheck,
    },
    {
      title: 'Atomic 1-Click State Rollback',
      desc: 'Pre-exec blocks keep rogue calls from touching disk. If permitted mutations cause unexpected drift, 1 click or ⌘Z resets SQLite WAL state.',
      icon: CheckCircle2,
    },
  ];

  return (
    <section id="pain" className="py-24 px-6 max-w-7xl mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-white/50 mb-4">
          <span>THE THREAT MODEL</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
          Status Quo Blind Faith vs The Astram Shield
        </h2>
        <p className="mt-4 text-base sm:text-lg text-white/60">
          Why traditional agent security fails in the field, and how mathematical invariants provide deterministic protection.
        </p>
      </div>

      {/* Side-by-Side Comparison Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Column 1: The Threat (Status Quo / Villain) */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={appleSpring.fluid}
          className="rounded-3xl bg-[#0D0D0F] border border-[#FF453A]/20 p-8 flex flex-col justify-between shadow-2xl relative overflow-hidden"
        >
          <div>
            {/* Header Badge */}
            <div className="flex items-center justify-between pb-6 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-[#FF453A]/10 border border-[#FF453A]/30 text-[#FF453A]">
                  <ShieldAlert size={18} />
                </span>
                <div>
                  <div className="text-xs font-mono font-semibold text-[#FF453A] tracking-wider uppercase">
                    Status Quo Architecture
                  </div>
                  <div className="text-lg font-bold text-white">Blind Faith & Hallucination</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#FF453A] bg-[#FF453A]/10 px-2 py-1 rounded-md border border-[#FF453A]/20">
                UNPROTECTED
              </span>
            </div>

            {/* Danger Points */}
            <div className="mt-8 space-y-6">
              {villainPoints.map((point) => {
                const Icon = point.icon;
                return (
                  <div key={point.title} className="flex items-start gap-4">
                    <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[#FF453A] shrink-0 mt-0.5">
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        <span>{point.title}</span>
                        <XCircle size={13} className="text-[#FF453A]" />
                      </div>
                      <p className="text-xs text-white/55 mt-1 leading-relaxed">
                        {point.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Threat Assessment */}
          <div className="mt-10 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs font-mono text-white/40">
            <span>Failure Mode:</span>
            <span className="text-[#FF453A] font-semibold">Total Silent Catastrophe</span>
          </div>
        </motion.div>

        {/* Column 2: The Solution (Astram Shield / Hero) */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={appleSpring.fluid}
          className="rounded-3xl bg-[#0D0D0F] border border-[#30D158]/30 p-8 flex flex-col justify-between shadow-2xl relative overflow-hidden"
        >
          <div>
            {/* Header Badge */}
            <div className="flex items-center justify-between pb-6 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-[#30D158]/10 border border-[#30D158]/30 text-[#30D158]">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <div className="text-xs font-mono font-semibold text-[#30D158] tracking-wider uppercase">
                    The Astram Shield
                  </div>
                  <div className="text-lg font-bold text-white">Zero-Trust Microkernel Proxy</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#30D158] bg-[#30D158]/10 px-2 py-1 rounded-md border border-[#30D158]/20">
                INVARIANT I1
              </span>
            </div>

            {/* Defense Points */}
            <div className="mt-8 space-y-6">
              {heroPoints.map((point) => {
                const Icon = point.icon;
                return (
                  <div key={point.title} className="flex items-start gap-4">
                    <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[#30D158] shrink-0 mt-0.5">
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        <span>{point.title}</span>
                        <CheckCircle2 size={13} className="text-[#30D158]" />
                      </div>
                      <p className="text-xs text-white/55 mt-1 leading-relaxed">
                        {point.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Security Guarantee */}
          <div className="mt-10 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs font-mono text-white/40">
            <span>Security Guarantee:</span>
            <span className="text-[#30D158] font-semibold">Mathematically Monotonic Protection</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
