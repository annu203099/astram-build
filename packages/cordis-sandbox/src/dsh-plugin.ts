/**
 * ToolSchemaHotReload + dshPluginMount — DeepSeek Harness hardening,
 * DSH-BUG-04 (Handbook §6.1).
 *
 * New plugin tools are APPENDED AT THE TAIL of the LLM tool definition
 * array mid-session, so the serialized prefix (every byte the model has
 * already seen, and the prompt KV cache keyed on it) stays bit-identical —
 * verified by the prefix-preservation unit test.
 */
import os from 'node:os';
import { CredentialVault } from './dsh-vault.js';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type ToolsUpdatedHandler = (tools: Json[]) => void;

/**
 * Appends tool definitions to the tail of an existing tool array and emits
 * a `tools-updated` event. Pure with respect to the input: the existing
 * elements are carried over by reference, indices 0..n-1 unchanged.
 */
export class ToolSchemaHotReload {
  private readonly listeners = new Set<ToolsUpdatedHandler>();
  private revisions = 0;

  /** [...existing, ...additions] — tail append only; prefix indices unchanged. */
  appendToolDefinitions(existingTools: Json[], additions: Json[]): Json[] {
    const next = [...existingTools, ...additions];
    this.revisions += 1;
    for (const cb of [...this.listeners]) {
      try {
        cb(next);
      } catch {
        /* a broken listener must never break the reload */
      }
    }
    return next;
  }

  /** Register a tools-updated callback; returns an unsubscribe function. */
  onToolsUpdated(cb: ToolsUpdatedHandler): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** How many appends have run through this instance. */
  get revisionCount(): number {
    return this.revisions;
  }
}

// ---------------------------------------------------------------------------
// dshPluginMount — compose vault + hot-reload onto a Cordis-like ctx
// ---------------------------------------------------------------------------

export interface DshCtxLike {
  tools: unknown[];
  on?(event: string, cb: (payload?: unknown) => void): unknown;
}

export interface DshPluginMountResult {
  tools: Json[];
  vault: CredentialVault;
  hotReload: ToolSchemaHotReload;
  /** Names of the astram tools actually appended (empty when already mounted). */
  mounted: string[];
}

/** Minimal @astram/dsh-plugin tool set mounted natively on the Cordis ctx. */
export const AEGIS_TOOL_DEFS: Json[] = [
  {
    type: 'function',
    function: {
      name: 'aegis.status',
      description:
        'astram firewall status: policy verdict counters, blocked transaction count, ' +
        'and the active Cordis fiber registry.',
      parameters: {
        type: 'object',
        properties: {
          verbose: { type: 'boolean', description: 'include the full fiber registry' },
        },
        additionalProperties: false,
      },
    },
  },
];

function toolName(t: unknown): string | null {
  if (t === null || typeof t !== 'object') return null;
  const rec = t as Record<string, unknown>;
  const fn = rec.function;
  if (fn !== null && typeof fn === 'object' && typeof (fn as Record<string, unknown>).name === 'string') {
    return (fn as Record<string, string>).name;
  }
  return typeof rec.name === 'string' ? rec.name : null;
}

function hasTool(list: unknown[], name: string): boolean {
  return list.some((t) => toolName(t) === name);
}

/**
 * Mount the astram plugin toolset onto a Cordis-like ctx: the vault is
 * created against the relocated dsh home, and the tools are appended at the
 * tail via hot-reload (prefix-preserving). Subscribes to the ctx
 * `tools-updated` event so an astram tool dropped by a harness-side reset is
 * re-appended at the tail (idempotent self-heal).
 */
export function dshPluginMount(ctxLike: DshCtxLike, opts: { homeDir?: string } = {}): DshPluginMountResult {
  const vault = new CredentialVault(opts.homeDir ?? os.homedir());
  const hotReload = new ToolSchemaHotReload();
  const existing = (ctxLike.tools ?? []) as Json[];
  const additions = AEGIS_TOOL_DEFS.filter((t) => !hasTool(existing, toolName(t) ?? ''));
  const tools = hotReload.appendToolDefinitions(existing, additions);
  try {
    ctxLike.on?.('tools-updated', (payload: unknown) => {
      const emitted = (payload as { tools?: unknown } | undefined)?.tools;
      if (!Array.isArray(emitted)) return;
      const missing = AEGIS_TOOL_DEFS.filter((t) => !hasTool(emitted, toolName(t) ?? ''));
      if (missing.length > 0) hotReload.appendToolDefinitions(emitted as Json[], missing);
    });
  } catch {
    /* ctx without event support — the mount itself still succeeds */
  }
  return { tools, vault, hotReload, mounted: additions.map((t) => toolName(t) ?? '').filter((n) => n !== '') };
}
