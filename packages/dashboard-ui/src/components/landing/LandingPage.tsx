/**
 * Main LandingPage component for Astram.
 * Follows the owner.com content psychology sequence:
 * 1. Agitation Hero ("What is the real pain?")
 * 2. Villain vs Hero Narrative (Status Quo vs Astram Shield)
 * 3. 3-Pillar Outcome Breakdown (<5ms, Invariant I1, 1-Click Rollback)
 * 4. Interactive Product Showcase (Dynamic Notch, Slowship Manifest, Deception Inspector)
 * 5. Frictionless 60-Second Setup Guide (Claude, Cursor, Roo-Code, Windsurf, Cline)
 * 6. Structured Technical Documentation (Architecture, Invariants, API)
 * 7. Risk Mitigation & FAQ Accordion
 * 8. High-Contrast Final CTA
 */

import type { JSX } from 'react';
import { LandingNav } from './LandingNav';
import { HeroSection } from './HeroSection';
import { VillainHeroNarrative } from './VillainHeroNarrative';
import { ThreePillarsSection } from './ThreePillarsSection';
import { ProductShowcase } from './ProductShowcase';
import { SetupGuideSection } from './SetupGuideSection';
import { DocumentationSection } from './DocumentationSection';
import { FaqSection } from './FaqSection';
import { FinalCtaSection } from './FinalCtaSection';
import { LandingFooter } from './LandingFooter';

export interface LandingPageProps {
  onLaunchDashboard: () => void;
}

export function LandingPage({ onLaunchDashboard }: LandingPageProps): JSX.Element {
  return (
    <div className="min-h-screen bg-black text-[#EDEDED] font-sans antialiased selection:bg-white/20">
      {/* Sticky Apple Glass Top Navigation */}
      <LandingNav onLaunchDashboard={onLaunchDashboard} />

      {/* Main Narrative Flow */}
      <main>
        {/* Section 1: Hero Agitation */}
        <HeroSection onLaunchDashboard={onLaunchDashboard} />

        {/* Section 2: Villain vs Hero Narrative */}
        <VillainHeroNarrative />

        {/* Section 3: 3 Pillars of Deterministic Defense */}
        <ThreePillarsSection />

        {/* Section 4: Interactive Product Showcase */}
        <ProductShowcase />

        {/* Section 5: 60-Second Setup Guide */}
        <SetupGuideSection onLaunchDashboard={onLaunchDashboard} />

        {/* Section 6: Structured Documentation Tabs */}
        <DocumentationSection />

        {/* Section 7: Risk Mitigation & FAQ Accordion */}
        <FaqSection />

        {/* Section 8: Final High-Contrast CTA */}
        <FinalCtaSection onLaunchDashboard={onLaunchDashboard} />
      </main>

      {/* Apple Minimalist Footer */}
      <LandingFooter />
    </div>
  );
}
