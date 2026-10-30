/**
 * Apple Human Interface Sticky Top Navigation for Astram Landing Page.
 * Monochromatic OLED glass with smooth scroll anchors and Command Center CTA.
 */

import { useState, useEffect } from 'react';
import type { JSX } from 'react';
import { ArrowRight, Terminal, Menu, X, Download } from 'lucide-react';

export interface LandingNavProps {
  onLaunchDashboard: () => void;
}

export function LandingNav({ onLaunchDashboard }: LandingNavProps): JSX.Element {
  const [scrolled, setScrolled] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    const handleScroll = (): void => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'The Threat', href: '#pain' },
    { label: 'Architecture', href: '#pillars' },
    { label: 'Showcase', href: '#showcase' },
    { label: 'Quick Setup', href: '#setup' },
    { label: 'Documentation', href: '#docs' },
    { label: 'FAQ', href: '#faq' },
  ];

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string): void => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? 'bg-[#0D0D0F]/85 backdrop-blur-2xl border-b border-white/[0.12] shadow-2xl shadow-black/80'
          : 'bg-black/60 backdrop-blur-xl border-b border-white/[0.06]'
      }`}
    >
      <div className="mx-auto max-w-7xl h-16 flex items-center justify-between px-6">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] border border-white/[0.14] text-white font-mono text-sm font-semibold shadow-inner">
            Λ
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-white">Astram</span>
            <span className="text-[10px] font-mono text-white/40 tracking-wider uppercase px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
              v0.1.0-alpha
            </span>
          </div>
        </div>

        {/* Center: Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right: Actions */}
        <div className="hidden sm:flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/50">
            <Terminal size={12} className="stroke-[1.8] text-white/40" />
            <span>npx @astram/cli</span>
          </div>

          <a
            href="https://github.com/annu203099/astram-build/releases/tag/v0.1.0"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-medium text-xs border border-white/[0.12] transition shadow-sm cursor-pointer"
            title="Download v0.1.0 Release (.exe)"
          >
            <Download size={13} className="stroke-[2] text-[#30D158]" />
            <span>Download</span>
          </a>

          <button
            type="button"
            onClick={onLaunchDashboard}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-white/90 active:scale-95 text-black font-semibold text-xs transition cursor-pointer shadow-sm"
          >
            <span>Open Command Center</span>
            <ArrowRight size={13} className="stroke-[2.2]" />
          </button>
        </div>

        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="lg:hidden p-2 rounded-xl bg-white/[0.04] text-white/70 hover:text-white border border-white/[0.08] cursor-pointer"
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#0D0D0F] border-b border-white/[0.1] px-6 py-4 flex flex-col gap-2">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="px-3 py-2 rounded-xl text-xs font-medium text-white/70 hover:text-white hover:bg-white/[0.06] transition"
            >
              {link.label}
            </a>
          ))}
          <div className="pt-3 border-t border-white/[0.08] flex flex-col gap-2">
            <a
              href="https://github.com/annu203099/astram-build/releases/tag/v0.1.0"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white font-medium text-xs border border-white/[0.12] transition"
            >
              <Download size={13} className="text-[#30D158]" />
              <span>Download v0.1.0 (.exe)</span>
            </a>

            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onLaunchDashboard();
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-white/90 transition cursor-pointer"
            >
              <span>Open Command Center</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
