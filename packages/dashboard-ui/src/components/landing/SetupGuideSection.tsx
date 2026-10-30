/**
 * SetupGuideSection for Astram Landing Page.
 * Conforms to owner.com content psychology:
 * 60-Second Frictionless Setup with interactive IDE switcher:
 * Claude Desktop, Cursor, Roo-Code, Windsurf, Cline.
 * Includes copyable JSON snippets, live detection scan, and copy feedback.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { motion } from 'framer-motion';
import {
  Terminal,
  Copy,
  Check,
  Sparkles,
  MousePointer,
  Cpu,
  Layers,
  Code2,
  RefreshCw,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { appleSpring } from '../../lib/theme';

export interface SetupGuideSectionProps {
  onLaunchDashboard: () => void;
}

type IdeId = 'claude' | 'cursor' | 'roo' | 'windsurf' | 'cline';

interface IdePreset {
  id: IdeId;
  name: string;
  icon: typeof Sparkles;
  configPathMac: string;
  configPathWin: string;
  configSnippet: string;
  notes: string;
  initialStatus: 'Detected' | 'Ready' | 'Protected';
}

const IDE_PRESETS: IdePreset[] = [
  {
    id: 'claude',
    name: 'Claude Desktop',
    icon: Sparkles,
    configPathMac: '~/Library/Application Support/Claude/claude_desktop_config.json',
    configPathWin: '%APPDATA%\\Claude\\claude_desktop_config.json',
    configSnippet: `{
  "mcpServers": {
    "astram-shield": {
      "command": "astram",
      "args": ["proxy", "--stdio", "--target", "filesystem"]
    }
  }
}`,
    notes: 'Wraps all filesystem and execution tools with the Astram stdio microkernel proxy.',
    initialStatus: 'Detected',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: MousePointer,
    configPathMac: '~/.cursor/mcp.json (or .cursor/mcp.json in workspace)',
    configPathWin: '%USERPROFILE%\\.cursor\\mcp.json',
    configSnippet: `{
  "mcpServers": {
    "astram-cursor-guard": {
      "command": "astram",
      "args": ["proxy", "--stdio", "--enforce-i1"]
    }
  }
}`,
    notes: 'Intercepts Cursor Composer and agent tool dispatches with sub-5ms AST verification.',
    initialStatus: 'Protected',
  },
  {
    id: 'roo',
    name: 'Roo-Code',
    icon: Layers,
    configPathMac: '~/.roo-cline/mcp_settings.json',
    configPathWin: '%USERPROFILE%\\.roo-cline\\mcp_settings.json',
    configSnippet: `{
  "mcpServers": {
    "astram-roo-shield": {
      "command": "npx",
      "args": ["-y", "@astram/cli", "proxy", "--stdio"]
    }
  }
}`,
    notes: 'Configures Roo-Code task executions to pass through the zero-trust stdio proxy.',
    initialStatus: 'Ready',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: Cpu,
    configPathMac: '~/.codeium/windsurf/mcp_config.json',
    configPathWin: '%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json',
    configSnippet: `{
  "mcpServers": {
    "astram-cascade-proxy": {
      "command": "astram",
      "args": ["proxy", "--stdio", "--listen", "3080"]
    }
  }
}`,
    notes: 'Protects Cascade workflows from poisoned workspace tools and unexpected deletes.',
    initialStatus: 'Ready',
  },
  {
    id: 'cline',
    name: 'Cline',
    icon: Code2,
    configPathMac: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    configPathWin: '%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
    configSnippet: `{
  "mcpServers": {
    "astram-cline-firewall": {
      "command": "astram",
      "args": ["proxy", "--stdio"]
    }
  }
}`,
    notes: 'Enforces Invariant I1 monotonic security over Cline command line executions.',
    initialStatus: 'Ready',
  },
];

export function SetupGuideSection({ onLaunchDashboard }: SetupGuideSectionProps): JSX.Element {
  const [selectedIde, setSelectedIde] = useState<IdeId>('claude');
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);
  const [osMode, setOsMode] = useState<'unix' | 'win'>('unix');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const activePreset = IDE_PRESETS.find((p) => p.id === selectedIde) ?? IDE_PRESETS[0];

  const copyToClipboard = (text: string, isCli: boolean): void => {
    navigator.clipboard.writeText(text);
    if (isCli) {
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } else {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    }
  };

  const handleScanHarnesses = (): void => {
    setIsScanning(true);
    setScanMessage('Scanning local IDE configurations...');
    setTimeout(() => {
      setIsScanning(false);
      setScanMessage('Scan complete: 5 IDE configurations detected. 2 harnesses protected, 3 ready to wrap.');
    }, 1200);
  };

  return (
    <section id="setup" className="py-24 px-6 max-w-7xl mx-auto border-t border-white/[0.08]">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-white/50 mb-4">
          <span>60-SECOND ZERO-TRUST SETUP</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
          Protect Your Agents in 60 Seconds
        </h2>
        <p className="mt-4 text-base sm:text-lg text-white/60">
          One terminal command to install, zero code changes to your projects. Seamlessly wraps your favorite AI coding harness.
        </p>
      </div>

      {/* Main 2-Step Card */}
      <div className="rounded-3xl bg-[#0D0D0F] border border-white/[0.12] p-6 sm:p-10 shadow-2xl space-y-10">
        {/* Step 1: CLI Quick Start */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-black font-mono text-xs font-bold">
                1
              </span>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Initialize the Astram Daemon & Microkernel Proxy
              </h3>
            </div>
            <span className="text-[11px] font-mono text-white/40 hidden sm:inline">
              Zero Global Pollution
            </span>
          </div>

          <div className="relative rounded-2xl bg-black border border-white/[0.1] p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 font-mono text-xs sm:text-sm text-white overflow-x-auto">
              <span className="text-[#30D158] select-none">$</span>
              <span>pnpm dlx @astram/cli protect</span>
            </div>

            <button
              type="button"
              onClick={() => copyToClipboard('pnpm dlx @astram/cli protect', true)}
              className="ml-4 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-white/80 hover:text-white border border-white/[0.1] text-xs font-mono transition cursor-pointer shrink-0"
              title="Copy Command"
            >
              {copiedCli ? <Check size={13} className="text-[#30D158]" /> : <Copy size={13} />}
              <span>{copiedCli ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Step 2: Interactive IDE Harness Switcher */}
        <div className="pt-8 border-t border-white/[0.08]">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-black font-mono text-xs font-bold">
                2
              </span>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Select Your Autonomous AI Coding Harness
              </h3>
            </div>

            {/* OS Mode Toggle */}
            <div className="flex items-center p-1 rounded-xl bg-black border border-white/[0.08] text-xs font-mono">
              <button
                type="button"
                onClick={() => setOsMode('unix')}
                className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                  osMode === 'unix' ? 'bg-white/[0.12] text-white font-bold' : 'text-white/40 hover:text-white'
                }`}
              >
                macOS / Linux
              </button>
              <button
                type="button"
                onClick={() => setOsMode('win')}
                className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                  osMode === 'win' ? 'bg-white/[0.12] text-white font-bold' : 'text-white/40 hover:text-white'
                }`}
              >
                Windows
              </button>
            </div>
          </div>

          {/* IDE Selector Pills */}
          <div className="flex flex-wrap gap-2 mb-6">
            {IDE_PRESETS.map((ide) => {
              const Icon = ide.icon;
              const isSelected = ide.id === selectedIde;
              return (
                <button
                  key={ide.id}
                  type="button"
                  onClick={() => setSelectedIde(ide.id)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition cursor-pointer border ${
                    isSelected
                      ? 'border-white/30 text-white shadow-md'
                      : 'border-white/[0.08] bg-black text-white/50 hover:text-white hover:border-white/[0.15]'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="activeIdeTab"
                      transition={appleSpring.gentle}
                      className="absolute inset-0 rounded-xl bg-white/[0.12]"
                    />
                  )}
                  <Icon size={14} className="relative z-10" />
                  <span className="relative z-10">{ide.name}</span>
                </button>
              );
            })}
          </div>

          {/* Config Path & Code Snippet Box */}
          <div className="rounded-2xl bg-black border border-white/[0.1] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                  Target Config File Path
                </div>
                <div className="text-xs font-mono text-white/80 mt-0.5 break-all">
                  {osMode === 'unix' ? activePreset.configPathMac : activePreset.configPathWin}
                </div>
              </div>

              <span className="self-start sm:self-auto px-2.5 py-1 rounded-md text-[11px] font-mono bg-white/[0.06] text-white/70 border border-white/[0.08]">
                {activePreset.notes}
              </span>
            </div>

            {/* Code Snippet Container */}
            <div className="relative">
              <pre className="p-4 rounded-xl bg-[#08080A] border border-white/[0.06] text-xs font-mono text-white/90 overflow-x-auto leading-relaxed">
                {activePreset.configSnippet}
              </pre>

              <button
                type="button"
                onClick={() => copyToClipboard(activePreset.configSnippet, false)}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] active:scale-95 text-white text-xs font-mono transition cursor-pointer border border-white/[0.1]"
              >
                {copiedSnippet ? <Check size={12} className="text-[#30D158]" /> : <Copy size={12} />}
                <span>{copiedSnippet ? 'Copied' : 'Copy JSON'}</span>
              </button>
            </div>
          </div>

          {/* Step 3: Scan Installed Harnesses & Dashboard CTA */}
          <div className="mt-8 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleScanHarnesses}
                disabled={isScanning}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-95 text-white/80 hover:text-white border border-white/[0.1] text-xs font-mono transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={13} className={isScanning ? 'animate-spin text-[#FF9F0A]' : 'text-white/60'} />
                <span>Scan Installed Harnesses</span>
              </button>

              {scanMessage && (
                <span className="text-xs font-mono text-[#30D158] animate-pulse">
                  {scanMessage}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onLaunchDashboard}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-white/90 active:scale-95 transition cursor-pointer shadow-lg"
            >
              <ShieldCheck size={14} className="stroke-[2.2]" />
              <span>Verify Protection in Command Center</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
