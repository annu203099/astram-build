/**
 * Tauri v2 Desktop Bridge & Web Fallback.
 *
 * When running inside the native Tauri v2 desktop shell, leverages native
 * IPC commands for directory dialogs and system integration; when running in
 * the browser, falls back gracefully to standard web APIs and REST endpoints.
 */
import { api } from './api';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function selectDirectory(): Promise<string | null> {
  if (isTauri()) {
    try {
      // In Tauri v2, dialog plugin is available via window.__TAURI__.dialog or core invoke
      const tauri = (window as any).__TAURI__;
      if (tauri?.dialog?.open) {
        const selected = await tauri.dialog.open({
          directory: true,
          multiple: false,
          title: 'Select Project Directory for Astram Protection',
        });
        return typeof selected === 'string' ? selected : null;
      }
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('open_folder_dialog');
      }
    } catch (e) {
      console.warn('Tauri native dialog failed, falling back to manual entry', e);
    }
  }
  return null;
}

export async function setAutostartSetting(enabled: boolean): Promise<boolean> {
  if (isTauri()) {
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('set_autostart', { enabled });
      }
    } catch (e) {
      console.warn('Tauri autostart command failed', e);
    }
  }
  localStorage.setItem('astram_autostart_preference', enabled ? 'true' : 'false');
  return enabled;
}

export interface DiscoveredAgentUI {
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
}

export async function detectAgentsUI(
  rootDir?: string,
  homeDir?: string
): Promise<DiscoveredAgentUI[]> {
  if (isTauri()) {
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        const res = await tauri.core.invoke('detect_agents', { rootDir, homeDir });
        if (Array.isArray(res)) return res;
      }
    } catch {
      // Fall through to HTTP api
    }
  }
  const res = await api.detectAgents(rootDir, homeDir);
  return res.ok ? res.agents : [];
}

export async function applyProtectionUI(options: {
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
}> {
  if (isTauri()) {
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('apply_protection', options);
      }
    } catch {
      // Fall through to HTTP api
    }
  }
  return await api.protectAgents(options);
}

