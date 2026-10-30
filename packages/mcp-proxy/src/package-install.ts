/**
 * @astram/mcp-proxy — Live interception of package manager commands
 * (pip, npm, pnpm, yarn).
 *
 * Detects and blocks installation of known malicious packages (e.g. litellm 1.107.0)
 * before the command ever reaches the execution environment.
 */
import { matchesVersionRange } from '@astram/gatekeeper';
import { KNOWN_BAD_PACKAGES, RiskLevel, type AstCapabilityFact } from '@astram/types';

/**
 * Normalizes package names according to PEP 503 / npm conventions:
 * Lowercases and collapses runs of [-_.] into empty string for comparison.
 */
export function normalizePackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '');
}

export interface ParsedPackageSpec {
  name: string;
  version?: string;
  manager: 'pip' | 'npm' | 'pnpm' | 'yarn';
}

/**
 * Regex for package manager install invocations.
 */
const PIP_INSTALL_RE = /\b(?:python[0-9.]*|py)\s+(?:-m\s+)?pip\s+install\b|\bpip[0-9.]*\s+install\b/i;
const NPM_INSTALL_RE = /\bnpm\s+(?:i|install|add)\b|\bpnpm\s+(?:add|i|install)\b|\byarn\s+add\b/i;

/** Flags that take arguments that shouldn't be treated as package names. */
const IGNORED_FLAGS_WITH_ARG = new Set([
  '-r', '--requirement',
  '-c', '--constraint',
  '-t', '--target',
  '-e', '--editable',
  '-i', '--index-url',
  '--extra-index-url',
  '-f', '--find-links',
  '--prefix',
]);

/**
 * Parses package specifications from a pip install command line.
 */
export function extractPipPackages(commandLine: string): ParsedPackageSpec[] {
  const specs: ParsedPackageSpec[] = [];
  const tokens = commandLine.match(/[^\s"';&|]+/g) ?? [];
  let inPipInstall = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.toLowerCase() === 'install' && i > 0 && /pip/i.test(tokens[i - 1])) {
      inPipInstall = true;
      continue;
    }
    if (!inPipInstall) continue;

    // Stop if command chained via ;, &&, ||
    if (/[;&|]/.test(tok)) {
      break;
    }

    if (tok.startsWith('-')) {
      if (IGNORED_FLAGS_WITH_ARG.has(tok.toLowerCase())) {
        i++; // skip flag value
      }
      continue;
    }

    // Parse package name and version
    // e.g. litellm==1.107.0, litellm<=1.107.0, litellm>=1.100,<1.108, litellm
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(.*)$/.exec(tok);
    if (match) {
      const name = match[1];
      const rest = match[2];
      let version: string | undefined = undefined;

      const pin = /==\s*([^,;\s]+)/.exec(rest);
      if (pin) {
        version = pin[1];
      } else {
        const loose = /(?:>=|<=|~=|>|<|!=|\^)\s*([0-9][^\s,;]*)/.exec(rest);
        if (loose) {
          version = loose[1];
        }
      }
      specs.push({ name, version, manager: 'pip' });
    }
  }
  return specs;
}

/**
 * Parses package specifications from npm/pnpm/yarn install command line.
 */
export function extractNpmPackages(commandLine: string): ParsedPackageSpec[] {
  const specs: ParsedPackageSpec[] = [];
  const tokens = commandLine.match(/[^\s"';&|]+/g) ?? [];
  let inInstall = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const low = tok.toLowerCase();
    if ((low === 'install' || low === 'i' || low === 'add') && i > 0 && /(?:npm|pnpm|yarn)/i.test(tokens[i - 1])) {
      inInstall = true;
      continue;
    }
    if (!inInstall) continue;

    if (/[;&|]/.test(tok)) break;
    if (tok.startsWith('-')) continue;

    // npm format: name@version or @scope/name@version
    let name = tok;
    let version: string | undefined = undefined;
    const atIdx = tok.lastIndexOf('@');
    if (atIdx > 0) {
      name = tok.slice(0, atIdx);
      version = tok.slice(atIdx + 1);
    }
    specs.push({ name, version, manager: 'npm' });
  }
  return specs;
}

/**
 * Scans a string (e.g. MCP tool-call argument) for malicious package installation commands.
 */
export function scanPackageInstall(value: string, file: string): AstCapabilityFact[] {
  const facts: AstCapabilityFact[] = [];
  if (!value || typeof value !== 'string') return facts;

  const lines = value.split('\n');
  for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
    const line = lines[lineNo - 1].trim();
    if (!line) continue;

    const specs: ParsedPackageSpec[] = [];
    if (PIP_INSTALL_RE.test(line)) {
      specs.push(...extractPipPackages(line));
    }
    if (NPM_INSTALL_RE.test(line)) {
      specs.push(...extractNpmPackages(line));
    }

    const seenKeys = new Set<string>();
    for (const spec of specs) {
      const normName = normalizePackageName(spec.name);

      for (const bad of KNOWN_BAD_PACKAGES) {
        const normBadName = normalizePackageName(bad.name);
        if (normName !== normBadName) continue;

        let matches = false;
        let displayVersion = spec.version ?? 'unpinned';

        if (!spec.version) {
          // Unpinned installation of known malicious package is blocked
          matches = true;
        } else if (matchesVersionRange(spec.version, bad.versionRange)) {
          matches = true;
          displayVersion = spec.version;
        }

        if (matches) {
          const key = `${normName}@${displayVersion}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          facts.push({
            ruleId: 'ARG_MALICIOUS_PACKAGE_INSTALL',
            category: 'STARTUP_HOOK',
            file,
            line: lineNo,
            snippet: `Blocked ${spec.manager} install of malicious package ${spec.name}@${displayVersion} matching ${bad.advisoryId} (${bad.name} ${bad.versionRange}: ${bad.reason})`.slice(0, 200),
            deterministicRisk: RiskLevel.HOLD,
          });
        }
      }
    }
  }

  return facts;
}
