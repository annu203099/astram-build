/**
 * Astram Onboarding & Zero-Trust Security Setup Wizard.
 *
 * Provides a 4-step interactive setup:
 * 1. Auto-Detect installed AI IDEs and coding agents.
 * 2. Select harnesses & configure scope (Whole-Agent/Global vs. Project-Wise).
 * 3. Configure internal engine (NVIDIA CUDA / AMD Ryzen hardware acceleration, Decision API).
 * 4. Apply zero-trust protection and launch the command center dashboard.
 */
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api } from '../lib/api';
import {
  applyProtectionUI,
  detectAgentsUI,
  selectDirectory,
  setAutostartSetting,
  type DiscoveredAgentUI,
} from '../lib/tauriBridge';

export interface OnboardingWizardProps {
  onComplete: () => void;
  onCancel?: () => void;
}

type WizardStep = 'detect' | 'scope' | 'engine' | 'apply';

const AGENT_ICONS: Record<string, string> = {
  antigravity: 'Λ',
  'claude-code': '✦',
  cursor: '▲',
  codex: '⚙',
  quill: '✒',
  dsh: '⚡',
};

export function OnboardingWizard({ onComplete, onCancel }: OnboardingWizardProps): JSX.Element {
  const [step, setStep] = useState<WizardStep>('detect');
  const [loading, setLoading] = useState<boolean>(true);
  const [agents, setAgents] = useState<DiscoveredAgentUI[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Record<string, boolean>>({});
  const [agentScopes, setAgentScopes] = useState<Record<string, 'global' | 'project'>>({});
  const [projectRoots, setProjectRoots] = useState<string[]>([]);
  const [customRootInput, setCustomRootInput] = useState<string>('');

  // Engine Settings
  const [acceleratorInfo, setAcceleratorInfo] = useState<any>(null);
  const [hardwareMode, setHardwareMode] = useState<'auto' | 'cpu'>('auto');
  const [apiKey, setApiKey] = useState<string>('');
  const [daemonPort, setDaemonPort] = useState<number>(3080);
  const [autostart, setAutostart] = useState<boolean>(true);

  // Apply state
  const [applying, setApplying] = useState<boolean>(false);
  const [applyResult, setApplyResult] = useState<{
    wrappedCount: number;
    details: { agentHost: string; configPath: string; servers: string[] }[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Scan on mount
  useEffect(() => {
    refreshDetection();
    api
      .accelerator()
      .then((acc) => setAcceleratorInfo(acc))
      .catch(() => {});
  }, []);

  const refreshDetection = async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const detected = await detectAgentsUI();
      setAgents(detected);

      // Default selections
      const initialSelected: Record<string, boolean> = {};
      const initialScopes: Record<string, 'global' | 'project'> = {};

      for (const a of detected) {
        if (a.installed) {
          initialSelected[a.agentHost] = true;
          // If has project config, default to project; else global
          const hasProject = a.configPaths.some((c) => c.scope === 'project' && c.exists);
          initialScopes[a.agentHost] = hasProject ? 'project' : 'global';
        }
      }
      setSelectedAgents(initialSelected);
      setAgentScopes(initialScopes);
    } catch (err) {
      setErrorMsg(`Auto-detection failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAgent = (agentHost: string): void => {
    setSelectedAgents((prev) => ({ ...prev, [agentHost]: !prev[agentHost] }));
  };

  const handleScopeChange = (agentHost: string, scope: 'global' | 'project'): void => {
    setAgentScopes((prev) => ({ ...prev, [agentHost]: scope }));
  };

  const handleAddProjectRoot = (): void => {
    const trimmed = customRootInput.trim();
    if (trimmed && !projectRoots.includes(trimmed)) {
      setProjectRoots((prev) => [...prev, trimmed]);
      setCustomRootInput('');
    }
  };

  const handlePickDirectory = async (): Promise<void> => {
    const picked = await selectDirectory();
    if (picked && !projectRoots.includes(picked)) {
      setProjectRoots((prev) => [...prev, picked]);
    }
  };

  const handleRemoveProjectRoot = (p: string): void => {
    setProjectRoots((prev) => prev.filter((r) => r !== p));
  };

  const handleApply = async (): Promise<void> => {
    setApplying(true);
    setErrorMsg(null);
    try {
      const chosenHosts = Object.entries(selectedAgents)
        .filter(([, selected]) => selected)
        .map(([host]) => host);

      const res = await applyProtectionUI({
        agentHosts: chosenHosts,
        projectRoots: projectRoots.length > 0 ? projectRoots : undefined,
      });

      if (!res.ok) {
        throw new Error(res.error || 'Failed to apply protection');
      }

      await setAutostartSetting(autostart);
      localStorage.setItem('astram_onboarding_completed', 'true');
      if (apiKey) localStorage.setItem('astram_decision_api_key', apiKey);

      const wrapped = res.report?.wrapped || [];
      setApplyResult({
        wrappedCount: wrapped.reduce((sum, w) => sum + w.servers.length, 0),
        details: wrapped,
      });
    } catch (err) {
      setErrorMsg(`Protection error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = Object.values(selectedAgents).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-sky-950/30">
        {/* Wizard Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 font-mono text-base font-bold text-sky-400">
              Λ
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight text-zinc-100">
                Astram Zero-Trust Security Setup
              </h2>
              <p className="text-xs text-zinc-400">
                Autonomous AI IDE & Coding Agent Protection Microkernel
              </p>
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition"
            >
              Close
            </button>
          )}
        </div>

        {/* Step Indicator Tabs */}
        <div className="grid grid-cols-4 border-b border-zinc-800/60 bg-zinc-950/30 text-xs font-medium">
          <button
            type="button"
            onClick={() => setStep('detect')}
            className={`flex items-center justify-center gap-2 border-b-2 py-3 transition ${
              step === 'detect'
                ? 'border-sky-400 text-sky-300 bg-sky-500/5'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-mono">
              1
            </span>
            <span>Auto-Detect</span>
          </button>
          <button
            type="button"
            onClick={() => setStep('scope')}
            className={`flex items-center justify-center gap-2 border-b-2 py-3 transition ${
              step === 'scope'
                ? 'border-sky-400 text-sky-300 bg-sky-500/5'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-mono">
              2
            </span>
            <span>Agent & Scope</span>
          </button>
          <button
            type="button"
            onClick={() => setStep('engine')}
            className={`flex items-center justify-center gap-2 border-b-2 py-3 transition ${
              step === 'engine'
                ? 'border-sky-400 text-sky-300 bg-sky-500/5'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-mono">
              3
            </span>
            <span>Hardware & Engine</span>
          </button>
          <button
            type="button"
            onClick={() => setStep('apply')}
            className={`flex items-center justify-center gap-2 border-b-2 py-3 transition ${
              step === 'apply'
                ? 'border-sky-400 text-sky-300 bg-sky-500/5'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-mono">
              4
            </span>
            <span>Apply & Launch</span>
          </button>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto p-6 text-sm text-zinc-300">
          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/30 p-3.5 text-xs text-red-300">
              <div className="font-semibold text-red-200">Error:</div>
              <div>{errorMsg}</div>
            </div>
          )}

          {/* STEP 1: AUTO-DETECT */}
          {step === 'detect' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Discovered AI Coding Environments
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Astram auto-scanned your system for supported AI agents and their MCP server configurations.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshDetection}
                  disabled={loading}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition disabled:opacity-50"
                >
                  {loading ? 'Scanning…' : 'Re-Scan System'}
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                  <p className="mt-3 text-xs">Scanning system for AI IDEs and MCP harnesses…</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {agents.map((agent) => {
                    const isProtected = agent.configPaths.some((c) => c.exists && c.isWrapped);
                    const serverTotal = agent.configPaths.reduce((s, c) => s + c.serverCount, 0);

                    return (
                      <div
                        key={agent.agentHost}
                        className={`rounded-xl border p-4 transition ${
                          agent.installed
                            ? 'border-zinc-700/80 bg-zinc-800/40'
                            : 'border-zinc-800/40 bg-zinc-900/30 opacity-70'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 font-mono text-sm text-sky-300">
                              {AGENT_ICONS[agent.agentHost] || '•'}
                            </span>
                            <div>
                              <div className="font-medium text-zinc-100">{agent.name}</div>
                              <div className="text-[11px] text-zinc-400">{agent.description}</div>
                            </div>
                          </div>
                          <div className="ml-2 shrink-0 whitespace-nowrap">
                            {isProtected ? (
                              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                Protected
                              </span>
                            ) : agent.installed ? (
                              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                                Detected
                              </span>
                            ) : (
                              <span className="rounded-full border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 text-[10px] text-zinc-500">
                                Not Found
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 border-t border-zinc-800/60 pt-2.5 text-xs text-zinc-400 space-y-1">
                          {agent.configPaths.filter((c) => c.exists).length > 0 ? (
                            agent.configPaths
                              .filter((c) => c.exists)
                              .map((c) => (
                                <div
                                  key={c.path}
                                  className="flex items-center justify-between font-mono text-[11px]"
                                >
                                  <span className="truncate max-w-[240px] text-zinc-300" title={c.path}>
                                    {c.path.split(/[/\\]/).slice(-2).join('/')}
                                  </span>
                                  <span className="text-zinc-500">
                                    {c.serverCount} server{c.serverCount === 1 ? '' : 's'}
                                  </span>
                                </div>
                              ))
                          ) : (
                            <div className="text-[11px] text-zinc-500 italic">
                              No active MCP configuration found
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: AGENT & SCOPE SELECTION */}
          {step === 'scope' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Select Agents & Configuration Scope
                </h3>
                <p className="text-xs text-zinc-400">
                  Choose which AI agents to wrap with the Astram zero-trust microkernel, and configure whether protection applies globally or project-wise.
                </p>
              </div>

              <div className="space-y-3">
                {agents.map((agent) => {
                  const isSelected = selectedAgents[agent.agentHost] ?? false;
                  const currentScope = agentScopes[agent.agentHost] || 'global';

                  return (
                    <div
                      key={agent.agentHost}
                      className={`flex flex-col gap-2 rounded-xl border p-3.5 transition ${
                        isSelected
                          ? 'border-sky-500/40 bg-sky-500/5'
                          : 'border-zinc-800 bg-zinc-900/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleAgent(agent.agentHost)}
                            className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-sky-500 focus:ring-0"
                          />
                          <span className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 font-mono text-xs text-sky-300">
                            {AGENT_ICONS[agent.agentHost]}
                          </span>
                          <span className="font-medium text-zinc-100">{agent.name}</span>
                        </label>

                        {isSelected && (
                          <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800 p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => handleScopeChange(agent.agentHost, 'global')}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                                currentScope === 'global'
                                  ? 'bg-sky-500 text-zinc-950 font-semibold'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              Global / Whole-Agent
                            </button>
                            <button
                              type="button"
                              onClick={() => handleScopeChange(agent.agentHost, 'project')}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                                currentScope === 'project'
                                  ? 'bg-sky-500 text-zinc-950 font-semibold'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              Project-Wise
                            </button>
                          </div>
                        )}
                      </div>

                      {isSelected && currentScope === 'project' && (
                        <div className="ml-7 text-xs text-zinc-400">
                          Wraps project-level configs in selected workspace repositories.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Project Roots Section */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200">
                      Target Project Folders (Project-Wise Scope)
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Add specific project repository folders where local configs should be wrapped.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePickDirectory}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition"
                  >
                    Browse Folder…
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customRootInput}
                    onChange={(e) => setCustomRootInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddProjectRoot()}
                    placeholder="Enter absolute project path (e.g. C:\projects\my-app)"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddProjectRoot}
                    className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition"
                  >
                    Add
                  </button>
                </div>

                {projectRoots.length > 0 ? (
                  <div className="space-y-1.5">
                    {projectRoots.map((root) => (
                      <div
                        key={root}
                        className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-mono text-zinc-300"
                      >
                        <span className="truncate">{root}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveProjectRoot(root)}
                          className="ml-2 text-zinc-500 hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 italic">
                    No custom project folders specified; current working directory will be protected by default.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: ENGINE & HARDWARE SETTINGS */}
          {step === 'engine' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Internal Settings & Hardware Acceleration
                </h3>
                <p className="text-xs text-zinc-400">
                  Configure the TurboQuant quantization engine, Decision API keys, and background daemon execution.
                </p>
              </div>

              {/* Hardware Acceleration Box */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                  <span>Hardware Accelerator Status</span>
                  {acceleratorInfo?.nvidiaGpu?.available ? (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      NVIDIA CUDA Active
                    </span>
                  ) : acceleratorInfo?.cpu?.engine === 'bit-parallel-unrolled' ? (
                    <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
                      AMD Ryzen Bit-Parallel Engine Active
                    </span>
                  ) : (
                    <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                      CPU Engine
                    </span>
                  )}
                </h4>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                    <span className="text-zinc-500 block text-[10px] uppercase font-mono">
                      GPU Accelerator
                    </span>
                    <span className="text-zinc-200 font-medium">
                      {acceleratorInfo?.nvidiaGpu?.name || 'NVIDIA GeForce RTX 3050 Laptop GPU'}
                    </span>
                    <span className="text-zinc-400 block text-[11px] mt-0.5">
                      VRAM: {acceleratorInfo?.nvidiaGpu?.vramTotalMb || 4096} MB (350 MB TurboQuant budget)
                    </span>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                    <span className="text-zinc-500 block text-[10px] uppercase font-mono">
                      CPU Architecture
                    </span>
                    <span className="text-zinc-200 font-medium">
                      {acceleratorInfo?.cpu?.model || 'AMD Ryzen 7 7435HS'}
                    </span>
                    <span className="text-zinc-400 block text-[11px] mt-0.5">
                      Engine: 64 KB POPCOUNT LUT + unrolled FWHT
                    </span>
                  </div>
                </div>

                <div className="flex gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="hwMode"
                      checked={hardwareMode === 'auto'}
                      onChange={() => setHardwareMode('auto')}
                      className="text-sky-500"
                    />
                    <span>Auto-Detect (GPU CUDA when available, AMD Ryzen CPU fallback)</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="hwMode"
                      checked={hardwareMode === 'cpu'}
                      onChange={() => setHardwareMode('cpu')}
                      className="text-sky-500"
                    />
                    <span>Force CPU Only</span>
                  </label>
                </div>
              </div>

              {/* Jev Decision API Key */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-200">
                  Decision API Key (Optional — Jev / Groq / OpenAI compatible)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-jev-..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
                />
                <p className="text-[11px] text-zinc-500">
                  Invariant I1 Protection: External API verdicts can only adjust risk by ±1 step and can never lower a deterministic HOLD verdict.
                </p>
              </div>

              {/* Daemon Port & Autostart */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-200 mb-1">
                    Daemon Port
                  </label>
                  <input
                    type="number"
                    value={daemonPort}
                    onChange={(e) => setDaemonPort(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2.5 text-xs text-zinc-200 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={autostart}
                      onChange={(e) => setAutostart(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-sky-500"
                    />
                    <span>Start Astram daemon automatically with Windows</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: APPLY & LAUNCH */}
          {step === 'apply' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Review & Apply Zero-Trust Security Protection
                </h3>
                <p className="text-xs text-zinc-400">
                  Confirm your protection plan and click Apply to inject the microkernel proxy and start the daemon.
                </p>
              </div>

              {applyResult ? (
                <div className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-5">
                  <div className="flex items-center gap-2.5 text-emerald-300">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold">
                      ✓
                    </span>
                    <h4 className="font-semibold text-emerald-200">
                      Astram Protection Successfully Applied!
                    </h4>
                  </div>

                  <p className="text-xs text-zinc-300">
                    Secured {applyResult.wrappedCount} MCP server{applyResult.wrappedCount === 1 ? '' : 's'} across {applyResult.details.length} harness configuration file{applyResult.details.length === 1 ? '' : 's'}. All original configs were backed up into the SQLite WAL ledger before rewriting.
                  </p>

                  <div className="space-y-1 text-xs font-mono text-zinc-400 max-h-40 overflow-y-auto">
                    {applyResult.details.map((d) => (
                      <div key={d.configPath} className="truncate">
                        • [{d.agentHost}] {d.configPath} ({d.servers.join(', ')})
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={onComplete}
                    className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 py-2.5 font-semibold text-zinc-950 hover:from-sky-400 hover:to-emerald-400 transition"
                  >
                    Open Astram Command Center Dashboard
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-xs space-y-2">
                    <div className="font-semibold text-zinc-200">Protection Summary:</div>
                    <div className="text-zinc-300">
                      • Agents to protect: <span className="font-semibold text-sky-300">{selectedCount}</span> ({Object.entries(selectedAgents).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None'})
                    </div>
                    <div className="text-zinc-300">
                      • Accelerator: <span className="font-semibold text-sky-300">{hardwareMode === 'auto' ? 'Auto-Detect (CUDA / AMD)' : 'Force CPU'}</span>
                    </div>
                    <div className="text-zinc-300">
                      • Target Projects: <span className="font-semibold text-sky-300">{projectRoots.length > 0 ? projectRoots.length : 'Current Workspace'}</span>
                    </div>
                    <div className="text-zinc-300">
                      • Windows Autostart: <span className="font-semibold text-sky-300">{autostart ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={applying || selectedCount === 0}
                    className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 py-3 font-semibold text-zinc-950 hover:from-sky-400 hover:to-indigo-400 transition disabled:opacity-50"
                  >
                    {applying ? 'Applying Protection & Backing up Configs…' : 'Apply Zero-Trust Protection Now'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-950/60 px-6 py-3.5">
          <button
            type="button"
            onClick={() => {
              if (step === 'scope') setStep('detect');
              else if (step === 'engine') setStep('scope');
              else if (step === 'apply') setStep('engine');
            }}
            disabled={step === 'detect' || applying}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 transition"
          >
            Back
          </button>

          <div className="flex items-center gap-2">
            {step !== 'apply' ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 'detect') setStep('scope');
                  else if (step === 'scope') setStep('engine');
                  else if (step === 'engine') setStep('apply');
                }}
                className="rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-sky-400 transition"
              >
                Continue
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

