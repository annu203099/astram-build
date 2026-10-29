/**
 * Relative-fetch API client for the astram daemon (CONTRACTS §5).
 * All paths are relative so the UI works in dev (vite proxy -> :3080) and in
 * prod (dist served by the daemon itself from :3080).
 */
import type { AtomicAuditTx, BoardingManifestItem, DagEdge, DagNode } from '@astram/types';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export const api = {
  health: (): Promise<{ ok: boolean; version: string }> =>
    fetchJson<{ ok: boolean; version: string }>('/api/health'),

  manifest: (): Promise<BoardingManifestItem[]> =>
    fetchJson<BoardingManifestItem[]>('/api/manifest'),

  transactions: (limit = 200): Promise<AtomicAuditTx[]> =>
    fetchJson<AtomicAuditTx[]>(`/api/transactions?limit=${limit}`),

  dag: (): Promise<{ nodes: DagNode[]; edges: DagEdge[] }> =>
    fetchJson<{ nodes: DagNode[]; edges: DagEdge[] }>('/api/dag'),

  /** Tier 1 daemon answers 501; Tier 2 performs the actual fiber restore. */
  rollback: async (txId: string): Promise<{ status: number; body: string | null }> => {
    const res = await fetch(`/api/rollback/${encodeURIComponent(txId)}`, {
      method: 'POST',
    });
    let body: string | null = null;
    try {
      body = JSON.stringify(await res.json());
    } catch {
      body = null;
    }
    return { status: res.status, body };
  },

  accelerator: (): Promise<{
    device?: string;
    engine?: string;
    nvidiaGpu?: { available: boolean; name?: string; vramTotalMb?: number };
    cpu?: { model?: string; cores?: number; detectedType?: string; engine?: string };
    turboquantBudget?: { maxMemoryMb: number; maxVramMb: number };
  }> => fetchJson('/api/accelerator'),

  detectAgents: (
    rootDir?: string,
    homeDir?: string
  ): Promise<{
    ok: boolean;
    agents: {
      agentHost: string;
      name: string;
      description: string;
      installed: boolean;
      configPaths: {
        path: string;
        scope: 'global' | 'project';
        exists: boolean;
        isWrapped: boolean;
        serverCount: number;
        serverNames: string[];
      }[];
    }[];
  }> => {
    const params = new URLSearchParams();
    if (rootDir) params.set('rootDir', rootDir);
    if (homeDir) params.set('homeDir', homeDir);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson(`/api/agents/detect${qs}`);
  },

  protectAgents: async (options: {
    rootDir?: string;
    homeDir?: string;
    agentHosts?: string[];
    projectRoots?: string[];
  }): Promise<{
    ok: boolean;
    report?: {
      wrapped: { agentHost: string; configPath: string; servers: string[] }[];
      skipped: { configPath: string; reason: string }[];
    };
    error?: string;
  }> => {
    const res = await fetch('/api/agents/protect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return (await res.json()) as any;
  },
};
