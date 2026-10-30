# Project: Astram Command Center — Apple Minimalist Redesign

## Architecture
- Target package: `packages/dashboard-ui` (`@astram/ui`)
- Design paradigm: Apple Human Interface Guidelines + Minimalist Enterprise MNC Standard
- Core principles:
  - Strict monochrome foundation (zinc/slate slate-950/black)
  - Zero decorative multi-color gradients, zero emojis, zero artificial glow shadows
  - Semantic status colors only:
    - Normal / Safe / Active: Apple Green (`#30D158`)
    - Degraded / Warning / Pending: Apple Amber/Orange (`#FF9F0A`)
    - Threat / Error / Critical: Apple Red (`#FF453A`)
    - Primary Focus / Selected: Apple White (`#FFFFFF`)
  - Motion: Framer Motion physics-based springs (`appleSpring` presets: snappy, fluid, gentle, bounce); zero standard linear/cubic transitions
  - Proportions: Strict 8pt spatial grid, Golden Ratio Master-Detail splits ($\phi \approx 1.618 \implies 38.2\% / 61.8\%$)
  - Surface hierarchy: Apple frosted glass levels (Surface 0-3 with `backdrop-blur-md` and refined 1px border contrast)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Architecture Foundation & Tokens | Centralized `theme.ts` with tokens, spring configs, surface classes | Phase 1 | Audit §1.2 |
| 2 | Styling Hygiene & Purge | Purge emojis, multi-color gradients, raw Unicode glyphs, glow shadows | Phase 1 | Audit §1.1 |
| 3 | Semantic Status Colors | Centralize status colors (#30D158, #FF9F0A, #FF453A, #FFFFFF) across all components | Phase 1 | Audit §1.2 |
| 4 | Icon Unification | Replace emoji and raw Unicode characters with unified Lucide vector icons | Phase 1 | Audit §1.2 |
| 5 | Dynamic Notch | `<DynamicNotch />` with 4 states (Idle, Scanning, Threat, Expanded) and spring physics | Phase 2 | Audit §2.1 |
| 6 | Astra Mascot Engine | `<AstraMascot />` with geometric concentric vector rings & reactive spring animations | Phase 2 | Audit §2.2 |
| 7 | Notch Telemetry Integration | Connect Notch and Mascot to live daemon telemetry in `Header.tsx` & `App.tsx` | Phase 2 | Audit §2.3 |
| 8 | Workspace 8pt Grid & Hierarchy | Refactor cards, manifests, and feeds into Apple Surface hierarchy | Phase 3 | Audit §3.1 |
| 9 | Inspector Golden Ratio Split | Refactor `InspectorTab.tsx` into 38.2% / 61.8% Golden Ratio split | Phase 3 | Audit §3.2 |
| 10 | 3D DAG Spatial Viewport | Responsive aspect-ratio viewport for `Dag3dTab.tsx` with unified Apple canvas colors | Phase 3 | Audit §3.3 |
| 11 | Customer Feedback Sheet | Interactive feedback & diagnostic submission sheet inside expanded Notch | Phase 4 | Audit §4.1 |
| 12 | Keyboard Navigation | Global shortcuts (⌘1-4, ⌘Z, Esc) and Segmented Control navigation | Phase 4 | Audit §4.2 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Agent 1: CodeGraph & Blast Radius | Forensic verification of defects, CodeGraph symbol mapping | none | DONE |
| M2 | Agent 2: Implementation Planning | Phase-by-phase implementation plan & verification specs | M1 | DONE |
| M3 | Phase 1: Tokens & Styling Hygiene | `theme.ts`, `index.html`, `index.css`, emoji/gradient purge, Lucide icons, status tokens | M2 | READY_FOR_DISPATCH |
| M4 | Phase 2: Dynamic Notch & Mascot Engine | `<DynamicNotch />`, `<AstraMascot />`, spring physics, header integration | M3 | PLANNED |
| M5 | Phase 3: Workspace Refactoring | Golden ratio splits, 8pt grid, Slowship Manifest, Live Feed, 3D DAG | M4 | PLANNED |
| M6 | Phase 4: Feedback Loops & Polish | Feedback sheet in Notch, global keyboard shortcuts, tab segmented control | M5 | PLANNED |

## Interface Contracts
### `packages/dashboard-ui/src/lib/theme.ts`
- Exports `appleColors`: `green: '#30D158'`, `orange: '#FF9F0A'`, `red: '#FF453A'`, `white: '#FFFFFF'`, `zinc: { 950, 900, 800, 700, 600, 400, 200 }`
- Exports `appleSpring`: `snappy`, `fluid`, `gentle`, `bounce`
- Exports `appleSurfaces`: `s0`, `s1`, `s2`, `s3`, `pill`
- Exports `statusColors`: maps status keys to Apple semantic colors

### `packages/dashboard-ui/src/components/DynamicNotch.tsx`
- Props: `state: 'idle' | 'scanning' | 'threat' | 'expanded'`, `activeThreatCount?: number`, `liveEventCount?: number`, `onToggleExpand?: () => void`, `children?: React.ReactNode`

### `packages/dashboard-ui/src/components/AstraMascot.tsx`
- Props: `mode: 'idle' | 'scanning' | 'alert' | 'focused'`, `size?: number`, `accentColor?: string`

## Code Layout
- `packages/dashboard-ui/src/lib/theme.ts`: Central design tokens and spring presets
- `packages/dashboard-ui/src/components/DynamicNotch.tsx`: Apple Dynamic Island component
- `packages/dashboard-ui/src/components/AstraMascot.tsx`: Concentric vector rings mascot
- `packages/dashboard-ui/src/components/Header.tsx`: Top bar hosting the Notch and system health
- `packages/dashboard-ui/src/components/Badges.tsx`: Centralized semantic status badges
- `packages/dashboard-ui/src/components/OnboardingWizard.tsx`: Setup modal with Lucide icons
- `packages/dashboard-ui/src/components/InspectorTab.tsx`: Golden ratio deception inspector
- `packages/dashboard-ui/src/components/Dag3dTab.tsx`: Responsive 3D DAG spatial viewport
- `packages/dashboard-ui/src/components/ManifestTab.tsx`: Slowship manifest with 8pt grid
- `packages/dashboard-ui/src/components/FeedTab.tsx`: Live feed stream
