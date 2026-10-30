/**
 * astram Command Center — Apple Human Interface Root Shell.
 *
 * Owns:
 * - Centered Apple Dynamic Notch (with interactive Astra mascot, live telemetry & rollback)
 * - Interactive Customer Feedback Dialog
 * - Segmented Tab Bar with fluid spring animation
 * - Four Core Workspaces: Manifest, Live Feed, Inspector, 3D Fiber Tree
 */

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Activity, Search, Network } from 'lucide-react';
import type {
  AtomicAuditTx,
  BoardingManifestItem,
  DagEdge,
  DagNode,
  TelemetryEvent,
} from '@astram/types';
import { Dag3dTab } from './components/Dag3dTab';
import { FeedTab } from './components/FeedTab';
import { Header, type HealthState } from './components/Header';
import { InspectorTab } from './components/InspectorTab';
import { ManifestTab } from './components/ManifestTab';
import { OnboardingWizard } from './components/OnboardingWizard';
import { ToastStack, type Toast } from './components/ToastStack';
import { DynamicNotch } from './components/DynamicNotch';
import { CustomerFeedbackModal } from './components/AstraMascot';
import type { AlertItem } from './components/AlertBanner';
import { api } from './lib/api';
import { useTelemetry } from './lib/useTelemetry';
import { appleSpring } from './lib/theme';

type TabId = 'manifest' | 'feed' | 'inspector' | 'dag3d';

interface TabDefinition {
  id: TabId;
  label: string;
  icon: typeof ShieldCheck;
}

const TABS: TabDefinition[] = [
  { id: 'manifest', label: 'Slowship Manifest', icon: ShieldCheck },
  { id: 'feed', label: 'Live MCP Feed', icon: Activity },
  { id: 'inspector', label: 'Deception Inspector', icon: Search },
  { id: 'dag3d', label: 'Multiverse 3D Tree', icon: Network },
];

const TX_FEED_CAP = 200;
const ALERT_CAP = 5;
const TOAST_TTL_MS = 5000;

export function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>('manifest');
  const [health, setHealth] = useState<HealthState | null>(null);
  const [manifest, setManifest] = useState<Record<string, BoardingManifestItem>>({});
  const [txs, setTxs] = useState<AtomicAuditTx[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [dag, setDag] = useState<{ nodes: DagNode[]; edges: DagEdge[] }>({ nodes: [], edges: [] });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showWizard, setShowWizard] = useState<boolean>(() => {
    return localStorage.getItem('astram_onboarding_completed') !== 'true';
  });
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);

  const pushToast = useCallback((kind: Toast['kind'], text: string): void => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_TTL_MS);
  }, []);

  const dismissToast = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---- daemon health poll (every 5 s) ---------------------------------------
  useEffect(() => {
    let disposed = false;
    const poll = (): void => {
      api
        .health()
        .then((h) => {
          if (!disposed) setHealth({ up: h.ok === true, version: h.version ?? null });
        })
        .catch(() => {
          if (!disposed) setHealth({ up: false, version: null });
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const loadManifest = useCallback((): void => {
    api
      .manifest()
      .then((items) =>
        setManifest(Object.fromEntries(items.map((item) => [item.itemId, item])))
      )
      .catch((err: unknown) =>
        pushToast('error', `manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      );
  }, [pushToast]);

  useEffect(loadManifest, [loadManifest]);

  // ---- WS telemetry fan-out ---------------------------------------------------
  const onEvent = useCallback((event: TelemetryEvent): void => {
    if (event.type === 'tx') {
      setTxs((prev) => [event.payload, ...prev].slice(0, TX_FEED_CAP));
    } else if (event.type === 'manifest-update') {
      setManifest((prev) => ({ ...prev, [event.payload.itemId]: event.payload }));
    } else if (event.type === 'alert') {
      setAlerts((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            level: event.payload.level,
            message: event.payload.message,
            txId: event.payload.txId,
            target: event.payload.target,
          },
          ...prev,
        ].slice(0, ALERT_CAP)
      );
    } else if (event.type === 'dag-update') {
      setDag({ nodes: event.payload.nodes, edges: event.payload.edges });
    }
  }, []);

  const wsState = useTelemetry(onEvent);

  const dismissAlert = useCallback((id: string): void => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const rollback = useCallback(
    (txId: string): void => {
      interface RollbackBody {
        rolledBack?: boolean;
        mode?: string;
        note?: string;
        reason?: string;
        error?: string;
      }
      api
        .rollback(txId)
        .then(({ status, body }) => {
          let parsed: RollbackBody | null = null;
          try {
            parsed = body ? (JSON.parse(body) as RollbackBody) : null;
          } catch {
            parsed = null;
          }
          const short = `${txId.slice(0, 16)}…`;
          if (status === 200 && parsed?.rolledBack === true) {
            const detail =
              parsed.mode === 'pre-exec-block'
                ? 'pre-exec block — call never executed'
                : (parsed.mode ?? 'restored');
            pushToast('success', `Rollback of ${short} succeeded (${detail})`);
          } else if (status === 200 && parsed) {
            pushToast('info', `Rollback of ${short} not applied: ${parsed.reason ?? 'no restorable snapshot'}`);
          } else if (status === 404) {
            pushToast('error', `Rollback failed: unknown transaction ${short}`);
          } else if (status === 501) {
            pushToast('info', 'Rollback requires cordis-sandbox (Tier 2)');
          } else {
            pushToast('error', `Rollback failed (HTTP ${status})`);
          }
        })
        .catch(() => pushToast('error', 'Rollback request failed — daemon unreachable'));
    },
    [pushToast]
  );

  const handleFeedbackSubmit = (sentiment: 'positive' | 'neutral' | 'issue', comment: string) => {
    pushToast(
      sentiment === 'issue' ? 'info' : 'success',
      `Feedback filed: ${sentiment} (${comment ? 'with comments' : 'instant rating'})`
    );
  };

  const manifestItems = Object.values(manifest).sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  return (
    <div className="min-h-screen bg-black text-[#EDEDED] font-sans antialiased selection:bg-white/20">
      {/* Floating Centered Apple Dynamic Notch */}
      <DynamicNotch
        health={health}
        wsState={wsState}
        activeAlert={alerts[0] ?? null}
        txCount={txs.length}
        onOpenWizard={() => setShowWizard(true)}
        onOpenFeedback={() => setShowFeedbackModal(true)}
        onRollbackLatest={rollback}
      />

      {/* Main Top Header */}
      <Header
        health={health}
        wsState={wsState}
        onOpenWizard={() => setShowWizard(true)}
        onOpenFeedback={() => setShowFeedbackModal(true)}
      />

      {/* Onboarding Wizard Sheet */}
      {showWizard && (
        <OnboardingWizard
          onComplete={() => {
            setShowWizard(false);
            loadManifest();
            pushToast('success', 'Zero-trust protection active across selected harnesses');
          }}
          onCancel={() => setShowWizard(false)}
        />
      )}

      {/* Customer Feedback Modal */}
      <CustomerFeedbackModal
        isOpen={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        onSubmitFeedback={handleFeedbackSubmit}
      />

      {/* Apple-style Segmented Navigation Control */}
      <nav className="border-b border-white/[0.08] bg-[#09090B]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
            {TABS.map(({ id, label, icon: Icon }) => {
              const isActive = tab === id;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`relative flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    isActive ? 'text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {/* Sliding spring background indicator */}
                  {isActive && (
                    <motion.div
                      layoutId="activeTabIndicator"
                      transition={appleSpring.gentle}
                      className="absolute inset-0 rounded-xl bg-white/[0.12] border border-white/[0.14] shadow-sm"
                    />
                  )}

                  <span className="relative z-10 flex items-center gap-2">
                    <Icon size={13} className={isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'} />
                    <span>{label}</span>

                    {id === 'manifest' && manifestItems.length > 0 && (
                      <span className="ml-1 rounded-full bg-white/[0.1] px-1.5 py-0.2 text-[10px] text-white/70 font-mono tabular-nums">
                        {manifestItems.length}
                      </span>
                    )}
                    {id === 'feed' && txs.length > 0 && (
                      <span className="ml-1 rounded-full bg-white/[0.1] px-1.5 py-0.2 text-[10px] text-white/70 font-mono tabular-nums">
                        {txs.length}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-white/40 font-mono">
            <span>Invariant I1:</span>
            <span className="text-[#30D158] font-semibold">LOCKED</span>
          </div>
        </div>
      </nav>

      {/* Main Workspace with Physics Animation */}
      <main className="mx-auto max-w-7xl px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={appleSpring.snappy}
          >
            {tab === 'manifest' && <ManifestTab items={manifestItems} onRefresh={loadManifest} />}
            {tab === 'feed' && (
              <FeedTab
                txs={txs}
                alerts={alerts}
                onDismissAlert={dismissAlert}
                onRollback={rollback}
              />
            )}
            {tab === 'inspector' && <InspectorTab />}
            {tab === 'dag3d' && <Dag3dTab dag={dag} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Apple Toast Notifications */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
