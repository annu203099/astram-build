/**
 * astram Command Center — root shell.
 *
 * Owns: daemon health polling (5 s), the /ws/telemetry connection (via
 * useTelemetry, auto-reconnect 2 s), the merged boarding manifest (fetched +
 * live 'manifest-update' merges), the live tx feed (cap 200), alerts, toasts
 * and the rollback action.
 */
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { AtomicAuditTx, BoardingManifestItem, DagEdge, DagNode, TelemetryEvent } from '@astram/types';
import { Dag3dTab } from './components/Dag3dTab';
import { FeedTab } from './components/FeedTab';
import { Header, type HealthState } from './components/Header';
import { InspectorTab } from './components/InspectorTab';
import { ManifestTab } from './components/ManifestTab';
import { OnboardingWizard } from './components/OnboardingWizard';
import { ToastStack, type Toast } from './components/ToastStack';
import type { AlertItem } from './components/AlertBanner';
import { api } from './lib/api';
import { useTelemetry } from './lib/useTelemetry';

type TabId = 'manifest' | 'feed' | 'inspector' | 'dag3d';

const TABS: { id: TabId; label: string }[] = [
  { id: 'manifest', label: 'Slowship Boarding Manifest' },
  { id: 'feed', label: 'Live MCP Feed' },
  { id: 'inspector', label: 'Deception Inspector' },
  { id: 'dag3d', label: 'Multiverse 3D Fiber Tree' },
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
        pushToast('error', `manifest fetch failed: ${err instanceof Error ? err.message : err}`)
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
      // Full-state DAG payloads feed the Multiverse 3D Fiber Tree (Tab 4).
      setDag({ nodes: event.payload.nodes, edges: event.payload.edges });
    }
    // hello: no per-tab handling.
  }, []);

  const wsState = useTelemetry(onEvent);

  const dismissAlert = useCallback((id: string): void => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /**
   * Rollback action (Tab 2). The Tier-2 daemon answers 200 with an honest JSON
   * verdict ({ rolledBack, mode, note/reason }); 404 = unknown tx; a legacy
   * Tier-1 daemon may still answer 501 — every shape gets a readable toast.
   */
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
                ? 'pre-exec block — call never executed, nothing to restore'
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

  const manifestItems = Object.values(manifest).sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <Header
        health={health}
        wsState={wsState}
        onOpenWizard={() => setShowWizard(true)}
      />

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

      <nav className="border-b border-zinc-800/70 bg-zinc-900/40">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto scrollbar-thin px-4">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
                tab === id
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {label}
              {id === 'manifest' && manifestItems.length > 0 && (
                <span className="ml-2 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 tabular-nums">
                  {manifestItems.length}
                </span>
              )}
              {id === 'feed' && txs.length > 0 && (
                <span className="ml-2 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 tabular-nums">
                  {txs.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {tab === 'manifest' && <ManifestTab items={manifestItems} onRefresh={loadManifest} />}
        {tab === 'feed' && (
          <FeedTab txs={txs} alerts={alerts} onDismissAlert={dismissAlert} onRollback={rollback} />
        )}
        {tab === 'inspector' && <InspectorTab />}
        {tab === 'dag3d' && <Dag3dTab dag={dag} />}
      </main>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
