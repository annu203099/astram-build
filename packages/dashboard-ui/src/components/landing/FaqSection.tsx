/**
 * FaqSection for Astram Landing Page.
 * Conforms to owner.com content psychology:
 * Risk Mitigation & Objection Neutralization Accordion:
 * 1. Performance Overhead (<5ms)
 * 2. 100% Local-Only Offline Privacy
 * 3. Hardware Budget (16GB RAM / 4GB VRAM)
 * 4. Adversarial Resilience & Invariant I1
 * 5. Rollback Safety & Pre-Execution Guarantees
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { appleSpring } from '../../lib/theme';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  highlight: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'perf',
    question: 'Will Astram introduce noticeable latency or slow down my AI coding agents?',
    answer:
      'No. Astram’s microkernel is engineered in native Rust and high-performance TypeScript with zero cloud roundtrips. Every tool call undergoes regex denylisting and in-memory AST evaluation in under 5 milliseconds. Since LLM generation tokens take 1,000ms to 4,000ms to produce, Astram’s 4.1ms verification overhead is completely imperceptible to human developers and agent loops.',
    highlight: 'Overhead is strictly bounded under 5ms.',
  },
  {
    id: 'privacy',
    question: 'Does my source code, credentials, or prompts ever leave my local machine?',
    answer:
      'Never. Astram is 100% local-first and completely offline-capable. There are zero remote telemetry pings, zero cloud logging servers, and zero third-party proxies. All AST parsing, policy verification, and SQLite WAL snapshot ledgers reside entirely on your local filesystem. You can run Astram with your Wi-Fi disconnected and experience full functionality.',
    highlight: '100% Local-Only. Zero telemetry egress.',
  },
  {
    id: 'hardware',
    question: 'What are the minimum system and hardware requirements to run Astram?',
    answer:
      'Astram is calibrated to run comfortably on standard developer machines with a 16GB RAM and 4GB VRAM budget. The microkernel daemon consumes fewer than 85MB of resident memory. Optional hardware acceleration for NVIDIA CUDA and AMD Ryzen AI is included for local neural classifiers, but the primary deterministic AST firewall runs seamlessly on any modern CPU.',
    highlight: 'Calibrated for standard 16GB RAM / 4GB VRAM systems.',
  },
  {
    id: 'injection',
    question: 'Can an adversarial prompt injection trick Astram into approving a malicious tool call?',
    answer:
      'No. Probabilistic guardrails that ask an LLM "Is this safe?" are easily jailbroken. Astram does not ask an LLM. Instead, it extracts concrete syntactic facts from the command AST (e.g. file targets, subprocess invocations, network sockets) and applies Invariant I1 (Monotonicity Law). If an action accesses credentials or executes an unlisted binary, it is mechanically locked to HOLD regardless of what the prompt or model claims.',
    highlight: 'Deterministic AST verification prevents prompt injection bypass.',
  },
  {
    id: 'rollback',
    question: 'What happens if an agent mutates or deletes code before an alert is raised?',
    answer:
      'First, Astram is a pre-execution firewall: unauthorized commands (like rm -rf or credential exfiltration) are blocked before the subprocess is spawned, meaning 0 bytes are ever damaged. Second, for authorized operations that later introduce unwanted changes, Astram maintains transactional SQLite WAL snapshots, letting you instantly revert the workspace with a single click or the global ⌘Z shortcut.',
    highlight: 'Pre-exec blocks prevent damage; SQLite WAL provides 1-click ⌘Z rollback.',
  },
];

export function FaqSection(): JSX.Element {
  const [openId, setOpenId] = useState<string | null>('perf');

  const toggleItem = (id: string): void => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section id="faq" className="py-24 px-6 max-w-4xl mx-auto border-t border-white/[0.08]">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-white/50 mb-4">
          <HelpCircle size={13} className="text-white/60" />
          <span>OBJECTION NEUTRALIZATION</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
          Frequently Asked Questions
        </h2>
        <p className="mt-4 text-base sm:text-lg text-white/60">
          Everything you need to know about performance, offline privacy, and deterministic guarantees.
        </p>
      </div>

      {/* Accordion List */}
      <div className="space-y-4">
        {FAQ_ITEMS.map((item) => {
          const isOpen = openId === item.id;
          return (
            <div
              key={item.id}
              className="rounded-2xl bg-[#0D0D0F] border border-white/[0.1] hover:border-white/[0.18] transition-all overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 cursor-pointer"
              >
                <span className="text-sm sm:text-base font-semibold text-white leading-snug">
                  {item.question}
                </span>
                <span
                  className={`p-2 rounded-xl bg-white/[0.04] text-white/60 shrink-0 transition-transform duration-200 ${
                    isOpen ? 'rotate-180 text-white' : ''
                  }`}
                >
                  <ChevronDown size={15} />
                </span>
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={appleSpring.snappy}
                    className="overflow-hidden"
                  >
                    <div className="px-5 sm:px-6 pb-6 pt-1 border-t border-white/[0.06] text-xs sm:text-sm text-white/65 leading-relaxed space-y-3">
                      <p>{item.answer}</p>
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-white/90">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" />
                        <span>{item.highlight}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
