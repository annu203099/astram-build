/**
 * @astram/mcp-proxy — public API, exactly docs/CONTRACTS.md §6.
 *
 * Re-exports: StdioFirewall (+ FirewallOptions), compactMcpResult,
 * wrapMcpServerEntry (+ McpServerEntry), protectWorkspace (+ ProtectReport).
 * CLI bins live in cli-proxy.ts / cli-astram.ts (package.json#bin).
 */
export { StdioFirewall, POLICY_CHARTER_ID, extractDownloadedFiles, scanDownloadThenExec } from './firewall.js';
export {
  scanPackageInstall,
  normalizePackageName,
  extractPipPackages,
  extractNpmPackages,
} from './package-install.js';
export type { ParsedPackageSpec } from './package-install.js';
export type { FirewallOptions } from './firewall.js';
export { compactMcpResult, redactSecrets, stripAnsi, truncateUtf8Safe } from './redact.js';
export type { CompactResult } from './redact.js';
export {
  protectWorkspace,
  recordLockfileBoardingItems,
  detectInstalledAgents,
  wrapMcpServerEntry,
  isAlreadyWrapped,
  defaultProxyModulePath,
  unprotectWorkspace,
} from './protect.js';
export type {
  McpServerEntry,
  WrapEntryInput,
  ProtectReport,
  ProtectOptions,
  DiscoveredAgent,
  DiscoveredConfigPath,
  UnprotectReport,
} from './protect.js';
