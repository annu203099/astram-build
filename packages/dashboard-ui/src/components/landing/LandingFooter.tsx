/**
 * LandingFooter for Astram Landing Page.
 * Apple Minimalist Monochrome Footer with Invariant I1 lock status badge.
 */

import type { JSX } from 'react';
import { Download, ExternalLink } from 'lucide-react';

export function LandingFooter(): JSX.Element {
  const scrollTo = (href: string): void => {
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="border-t border-white/[0.08] bg-black py-16 px-6">
      <div className="max-w-7xl mx-auto space-y-12">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          {/* Brand & Philosophy */}
          <div className="space-y-3 max-w-sm">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/[0.08] border border-white/[0.12] text-white font-mono text-xs font-semibold shadow-inner">
                Λ
              </div>
              <span className="text-base font-bold text-white tracking-tight">Astram</span>
            </div>
            <p className="text-xs text-white/50 leading-relaxed">
              Zero-trust runtime proxy and deterministic microkernel firewall for autonomous AI coding agents.
            </p>
          </div>

          {/* Quick Navigation Links */}
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-xs font-medium text-white/60">
            <button
              type="button"
              onClick={() => scrollTo('#pain')}
              className="hover:text-white transition cursor-pointer"
            >
              The Threat
            </button>
            <button
              type="button"
              onClick={() => scrollTo('#pillars')}
              className="hover:text-white transition cursor-pointer"
            >
              Architecture
            </button>
            <button
              type="button"
              onClick={() => scrollTo('#showcase')}
              className="hover:text-white transition cursor-pointer"
            >
              Showcase
            </button>
            <button
              type="button"
              onClick={() => scrollTo('#setup')}
              className="hover:text-white transition cursor-pointer"
            >
              Quick Setup
            </button>
            <button
              type="button"
              onClick={() => scrollTo('#docs')}
              className="hover:text-white transition cursor-pointer"
            >
              Documentation
            </button>
            <button
              type="button"
              onClick={() => scrollTo('#faq')}
              className="hover:text-white transition cursor-pointer"
            >
              FAQ
            </button>
            <a
              href="https://github.com/annu203099/astram-build/releases/download/v0.1.0/Astram_0.1.0_x64-setup.exe"
              className="hover:text-white flex items-center gap-1 text-[#30D158] transition"
            >
              <Download size={12} />
              <span>Download (.exe)</span>
            </a>
            <a
              href="https://github.com/annu203099/astram-build/releases/tag/v0.1.0"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white flex items-center gap-1 transition"
            >
              <ExternalLink size={12} />
              <span>Release v0.1.0</span>
            </a>
          </div>
        </div>

        {/* Bottom Bar: Copyright & Invariant I1 Lock Status */}
        <div className="pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-white/40">
          <div>
            © {new Date().getFullYear()} Astram Project. MIT Open Architecture. 100% Local-First.
          </div>

          {/* Invariant Lock Status Badge */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" />
            <span className="text-white/70">Invariant I1: LOCKED</span>
            <span className="text-white/30 hidden sm:inline">[PRE-EXEC ACTIVE]</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
