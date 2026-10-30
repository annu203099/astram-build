/**
 * @astram/gatekeeper — public API, exactly docs/CONTRACTS.md §2 (Tier 1) and
 * §3 (Tier 2 additions: bytepath-taint + tls-windows-probe).
 */
export { extractMarkdownCodeBlocks } from './markdown.js';
export { scanJavascript, stripTypeScriptTypes, isTypeScript } from './scan-javascript.js';
export { scanShellSnippet } from './scan-shell.js';
export { scanPythonCode, scanPythonPth, scanDirectoryForPth } from './scan-python.js';
export { scanSkillMarkdown } from './scan-skill.js';
export type { SkillScanResult } from './scan-skill.js';
export { scanLockfile, matchesVersionRange } from './lockfile.js';
export type { LockfileKind } from './lockfile.js';
export {
  scanPackageInstallCommand,
  normalizePythonPackageName,
  normalizeNpmPackageName,
  packageNamesMatch,
  evaluateVersionMatch,
  extractPackageCommands,
} from './scan-package-command.js';
export type { PackageManagerKind, ParsedPackageSpec, ParsedPackageCommand } from './scan-package-command.js';
export { JevDecisionClient } from './jev-decision-client.js';
export type { JevClientOptions, JevEvaluationResult } from './jev-decision-client.js';
export { evaluateArtifact } from './evaluate.js';
export { analyzeBytePathJs, analyzeBytePathRuby, analyzeBytePathPython, analyzeBytePathPhp, taintFactsFromSinks } from './bytepath-taint.js';
export type { BytePathSinkKind, TaintSink } from './bytepath-taint.js';
export {
  REVOKED_EMUDHRA_FINGERPRINTS,
  probeWindowsTlsTruststores,
  buildHardenedCaBundle,
  fingerprintPemCert,
  tlsFactsFromResults,
  probeBoardingItems,
} from './tls-windows-probe.js';
export type { TlsProbeResult, TlsProbeContext } from './tls-windows-probe.js';
