/**
 * ThreePillarsSection for Astram Landing Page.
 * Conforms to owner.com content psychology:
 * 3-Pillar Outcome Breakdown:
 * Pillar 1: Zero-Latency Microkernel Firewall (<5ms)
 * Pillar 2: Deception Detection & Spec Verification (Invariant I1)
 * Pillar 3: Atomic 1-Click Rollback (SQLite WAL snapshots)
 */

import type { JSX } from 'react';
import { motion } from 'framer-motion';
import { Zap, Eye, RotateCcw, Cpu, Lock, History } from 'lucide-react';
import { appleSpring } from '../../lib/theme';

export function ThreePillarsSection(): JSX.Element {
  const pillars = [
    {
      id: 'pillar-1',
      number: '01',
      title: 'Zero-Latency Microkernel Firewall',
      headline: 'Sub-5ms interception latency with zero IPC bottlenecks.',
      desc: 'Operates as an ultra-compact stdio proxy directly between your coding agent and tool runtimes. Parses JSON-RPC messages and verifies syntax trees in-memory without round-tripping to cloud servers or delaying generation tokens.',
      metric: '< 5ms',
      metricLabel: 'Interception Overhead',
      accent: 'text-[#30D158]',
      accentBg: 'bg-[#30D158]/10 border-[#30D158]/30',
      icon: Zap,
      specs: [
        'Pure in-memory AST evaluation',
        'Transparent stdio IPC interception',
        'Zero cloud token or network delays',
        'Native streaming JSON-RPC multiplexer',
      ],
    },
    {
      id: 'pillar-2',
      number: '02',
      title: 'Deception Detection & Spec Verification',
      headline: 'Invariant I1: Stated intent versus syntactic reality.',
      desc: 'Autonomous models often claim benign intent while running destructive code. Astram contrasts the stated tool parameters against extracted AST facts. If a formatter accesses credentials or opens outbound sockets, Invariant I1 locks the verdict to HOLD.',
      metric: 'Invariant I1',
      metricLabel: 'Monotonicity Law Proof',
      accent: 'text-[#FF9F0A]',
      accentBg: 'bg-[#FF9F0A]/10 border-[#FF9F0A]/30',
      icon: Eye,
      specs: [
        'enforceInvariantI1(HOLD, delta) === HOLD',
        'Dual-spec: intent vs AST reality check',
        'Immune to LLM prompt injection jailbreaks',
        'Absorbing state prevents privilege bypass',
      ],
    },
    {
      id: 'pillar-3',
      number: '03',
      title: 'Atomic 1-Click Rollback',
      headline: 'Instant recovery powered by SQLite WAL snapshots.',
      desc: 'Prevention is primary: suspicious calls are stopped before execution, ensuring zero bytes are mutated. For approved actions that later prove undesirable, Astram’s atomic audit ledger enables 1-click state rollback via SQLite WAL journals or the ⌘Z shortcut.',
      metric: '100%',
      metricLabel: 'Workspace Reversibility',
      accent: 'text-white',
      accentBg: 'bg-white/10 border-white/20',
      icon: RotateCcw,
      specs: [
        'Pre-execution blocks guarantee 0 disk damage',
        'SQLite WAL snapshotting before mutations',
        'Global keyboard shortcut ⌘Z instant undo',
        'Audit ledger with cryptographic hashing',
      ],
    },
  ];

  return (
    <section id="pillars" className="py-24 px-6 max-w-7xl mx-auto border-t border-white/[0.08]">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-white/50 mb-4">
          <span>DETERMINISTIC OUTCOMES</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
          Three Pillars of Deterministic Defense
        </h2>
        <p className="mt-4 text-base sm:text-lg text-white/60">
          Engineered for real production coding environments where speed, privacy, and mathematical guarantees are non-negotiable.
        </p>
      </div>

      {/* 3 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {pillars.map((pillar, index) => {
          const Icon = pillar.icon;
          return (
            <motion.div
              key={pillar.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ ...appleSpring.fluid, delay: index * 0.1 }}
              className="rounded-3xl bg-[#0D0D0F] border border-white/[0.1] hover:border-white/[0.2] transition-all p-8 flex flex-col justify-between shadow-xl relative group"
            >
              <div>
                {/* Top Number & Icon */}
                <div className="flex items-center justify-between mb-6">
                  <span className="font-mono text-xs font-bold text-white/30 tracking-widest">
                    {pillar.number}
                  </span>
                  <span className={`p-2.5 rounded-2xl ${pillar.accentBg} ${pillar.accent} border`}>
                    <Icon size={18} className="stroke-[2]" />
                  </span>
                </div>

                {/* Metric Callout */}
                <div className="mb-4">
                  <div className={`text-3xl font-mono font-bold tracking-tight ${pillar.accent}`}>
                    {pillar.metric}
                  </div>
                  <div className="text-[11px] font-mono text-white/40 uppercase tracking-wider mt-0.5">
                    {pillar.metricLabel}
                  </div>
                </div>

                {/* Title & Subheading */}
                <h3 className="text-xl font-bold text-white tracking-tight mb-2">
                  {pillar.title}
                </h3>
                <p className="text-xs font-medium text-white/80 leading-relaxed mb-4">
                  {pillar.headline}
                </p>

                {/* Narrative Body */}
                <p className="text-xs text-white/55 leading-relaxed mb-6">
                  {pillar.desc}
                </p>
              </div>

              {/* Technical Specifications List */}
              <div className="pt-6 border-t border-white/[0.08] space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/35 mb-2">
                  Key Specifications
                </div>
                {pillar.specs.map((spec) => (
                  <div key={spec} className="flex items-start gap-2 text-[11px] text-white/70">
                    <span className="text-white/30 mt-0.5">•</span>
                    <span>{spec}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
