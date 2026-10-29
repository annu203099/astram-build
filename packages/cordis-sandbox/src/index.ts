/**
 * @astram/cordis-sandbox — public API, exactly docs/CONTRACTS.md §7
 * (Cordis Fiber worktree sandbox, FileSnapshot rollback fallback) plus the
 * DeepSeek Harness hardening surface from Handbook §6.1
 * (CredentialVault, ToolSchemaHotReload, dshPluginMount).
 */
export { Fiber, listActiveFibers } from './fiber.js';
export type {
  FiberOptions,
  FiberResult,
  FiberRegistryEntry,
  FiberExecOptions,
  FiberExecResult,
} from './fiber.js';
export { FileSnapshot } from './file-snapshot.js';
export type { FileSnapshotRestoreResult } from './file-snapshot.js';
export { CredentialVault } from './dsh-vault.js';
export type { VaultWrapMode, CredentialVaultOptions } from './dsh-vault.js';
export { ToolSchemaHotReload, dshPluginMount, AEGIS_TOOL_DEFS } from './dsh-plugin.js';
export type {
  Json,
  ToolsUpdatedHandler,
  DshCtxLike,
  DshPluginMountResult,
} from './dsh-plugin.js';
