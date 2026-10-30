/**
 * @astram/gatekeeper — Live package command inspection & interception.
 *
 * Scans shell command lines for package manager invocations (pip, npm, pnpm,
 * yarn, bun) attempting to install known malicious packages or vulnerable
 * versions (from @astram/types KNOWN_BAD_PACKAGES).
 *
 * Emits capability facts with:
 *   ruleId: 'PACKAGE_INSTALL_KNOWN_BAD'
 *   category: 'DEP_SUPPLY_CHAIN'
 *   deterministicRisk: RiskLevel.HOLD
 */
import fs from 'node:fs';
import path from 'node:path';
import { coerce, intersects, satisfies, validRange } from 'semver';
import { KNOWN_BAD_PACKAGES, RiskLevel, type AstCapabilityFact } from '@astram/types';
import { scanLockfile } from './lockfile.js';

/**
 * Normalizes Python package name per PEP 503:
 * lowercases and replaces runs of [-_.]+ with a single hyphen '-'.
 */
export function normalizePythonPackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Normalizes npm package name: lowercases and trims.
 */
export function normalizeNpmPackageName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Dual normalization matcher:
 * Compares names under PEP 503 canonical hyphen form, and also under stripped
 * delimiter form so that 'litellm', 'lite-llm', 'lite_llm', and 'Lite.LLM' all match.
 */
export function packageNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const normA = normalizePythonPackageName(a);
  const normB = normalizePythonPackageName(b);
  if (normA === normB) return true;
  return normA.replace(/-/g, '') === normB.replace(/-/g, '');
}

/** Formats python/loose version ranges into a valid semver range string. */
export function formatRangeForSemver(rangeStr: string): string {
  let s = rangeStr.trim();
  // Strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // Replace ~= with ~
  s = s.replace(/~=\s*/g, '~');
  // Replace == with =
  s = s.replace(/==\s*/g, '=');
  // Replace commas with space
  s = s.replace(/,\s*/g, ' ');
  return s;
}

/**
 * Evaluates whether a requested version specification matches/intersects a known bad range.
 *
 * Invariants:
 * 1. Unpinned / unversioned installations (*, latest, empty) of a known bad package match -> HOLD.
 * 2. If advisory is wildcard '*' (all versions bad), any install matches -> HOLD.
 * 3. Exact pins (==1.107.0) are checked via satisfies.
 * 4. Ranges (<2.0.0, <=1.107.0, >=1.100,<1.108) are checked via semver.intersects.
 */
export function evaluateVersionMatch(specVersion: string | undefined, badRange: string): boolean {
  if (!specVersion || specVersion === '' || specVersion === '*' || specVersion === 'latest' || specVersion === 'unpinned') {
    return true; // Unpinned install of known compromised package is inherently unsafe
  }
  if (!badRange || badRange === '*') {
    return true;
  }

  const clean = specVersion.trim().replace(/^['"]|['"]$/g, '');

  // Exact pin check (e.g. ==1.107.0, =1.107.0)
  const pin = /^={1,2}\s*([^,;\s]+)$/.exec(clean);
  if (pin) {
    const v = coerce(pin[1]);
    return !!(v && satisfies(v, badRange));
  }

  // Plain version without operators (e.g. npm "3.3.6")
  if (!/[<>=~^,]/.test(clean)) {
    const v = coerce(clean);
    return !!(v && satisfies(v, badRange));
  }

  // Convert to valid semver range
  const formatted = formatRangeForSemver(clean);
  const vr = validRange(formatted);
  if (vr) {
    return intersects(vr, badRange);
  }

  // Direct coerce fallback
  const directV = coerce(clean);
  if (directV && satisfies(directV, badRange)) {
    return true;
  }

  return false;
}

export type PackageManagerKind = 'pip' | 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ParsedPackageSpec {
  name: string;
  version?: string;
  manager: PackageManagerKind;
  rawSpec: string;
}

export interface ParsedPackageCommand {
  manager: PackageManagerKind;
  packages: ParsedPackageSpec[];
  requirementsFiles?: string[];
}

/** Python install command pattern */
const PIP_INSTALL_PATTERN = /\b(?:python[0-9.]*|py)\s+(?:-[a-zA-Z0-9_-]+\s+)*(?:-m\s+)?pip\s+install\b|\bpip[0-9.]*\s+install\b/i;

/** Node install command patterns */
const NPM_INSTALL_PATTERN = /\bnpm\s+(?:i|install|add)\b/i;
const PNPM_INSTALL_PATTERN = /\bpnpm\s+(?:add|i|install)\b/i;
const YARN_INSTALL_PATTERN = /\byarn\s+add\b/i;
const BUN_INSTALL_PATTERN = /\bbun\s+(?:add|i|install)\b/i;

/** Python options that take a trailing argument to ignore */
const PYTHON_FLAGS_WITH_ARG = new Set([
  '-r', '--requirement',
  '-c', '--constraint',
  '-t', '--target',
  '-e', '--editable',
  '-i', '--index-url',
  '--extra-index-url',
  '-f', '--find-links',
  '--prefix',
  '--root',
  '--src',
  '--platform',
  '--python-version',
  '--implementation',
  '--abi',
  '--trusted-host',
]);

/** Node options that take a trailing argument to ignore */
const NODE_FLAGS_WITH_ARG = new Set([
  '-w', '--workspace',
  '--prefix',
  '-C', '--directory',
  '--registry',
  '--dist-tag',
]);

/**
 * Splits command strings respecting quotes into chained segments (;, &&, ||, |).
 */
export function splitCommandChains(line: string): string[] {
  const segments: string[] = [];
  let cur = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      cur += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      cur += ch;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === ';') {
        if (cur.trim()) segments.push(cur.trim());
        cur = '';
      } else if (ch === '&' && line[i + 1] === '&') {
        if (cur.trim()) segments.push(cur.trim());
        cur = '';
        i++; // skip second &
      } else if (ch === '|' && line[i + 1] === '|') {
        if (cur.trim()) segments.push(cur.trim());
        cur = '';
        i++; // skip second |
      } else if (ch === '|') {
        if (cur.trim()) segments.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    } else {
      cur += ch;
    }
  }

  if (cur.trim()) {
    segments.push(cur.trim());
  }
  return segments;
}

/**
 * Tokenizes a command segment respecting quoted strings.
 */
function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(segment)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]); // unquoted double
    } else if (match[2] !== undefined) {
      tokens.push(match[2]); // unquoted single
    } else if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }
  return tokens;
}

/**
 * Extracts package specifications from a single command segment.
 */
function extractFromSegment(segment: string): ParsedPackageCommand | null {
  let manager: PackageManagerKind | null = null;
  if (PIP_INSTALL_PATTERN.test(segment)) {
    manager = 'pip';
  } else if (NPM_INSTALL_PATTERN.test(segment)) {
    manager = 'npm';
  } else if (PNPM_INSTALL_PATTERN.test(segment)) {
    manager = 'pnpm';
  } else if (YARN_INSTALL_PATTERN.test(segment)) {
    manager = 'yarn';
  } else if (BUN_INSTALL_PATTERN.test(segment)) {
    manager = 'bun';
  }

  if (!manager) return null;

  const tokens = tokenizeSegment(segment);
  const packages: ParsedPackageSpec[] = [];
  const requirementsFiles: string[] = [];

  // Find install keyword position
  let installIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const low = tokens[i].toLowerCase();
    if (manager === 'pip' && low === 'install') {
      installIdx = i;
      break;
    }
    if ((manager === 'npm' || manager === 'pnpm' || manager === 'bun') && (low === 'install' || low === 'i' || low === 'add')) {
      installIdx = i;
      break;
    }
    if (manager === 'yarn' && low === 'add') {
      installIdx = i;
      break;
    }
  }

  if (installIdx === -1) return null;

  for (let i = installIdx + 1; i < tokens.length; i++) {
    const tok = tokens[i].trim();
    if (!tok) continue;

    // Flags
    if (tok.startsWith('-')) {
      const lower = tok.toLowerCase();
      const hasEqual = lower.includes('=');
      const flagName = hasEqual ? lower.split('=')[0] : lower;

      if (manager === 'pip') {
        if (flagName === '-r' || flagName === '--requirement') {
          const reqFile = hasEqual ? tok.slice(tok.indexOf('=') + 1) : tokens[++i];
          if (reqFile) requirementsFiles.push(reqFile.replace(/^['"]|['"]$/g, ''));
          continue;
        }
        if (!hasEqual && PYTHON_FLAGS_WITH_ARG.has(flagName)) {
          i++; // Skip argument
        }
      } else {
        if (!hasEqual && NODE_FLAGS_WITH_ARG.has(flagName)) {
          i++; // Skip argument
        }
      }
      continue;
    }

    if (manager === 'pip') {
      // Python requirement specifier: e.g. litellm==1.107.0, lite-llm<=1.107.0, litellm
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(tok);
      if (m) {
        const name = m[1];
        const version = m[2] ? m[2].trim() : undefined;
        packages.push({ name, version, manager, rawSpec: tok });
      }
    } else {
      // Node package specifier: e.g. event-stream@3.3.6, @scope/package@1.0.0, express
      let name = tok;
      let version: string | undefined = undefined;

      if (tok.startsWith('@')) {
        const atIdx = tok.indexOf('@', 1);
        if (atIdx > 0) {
          name = tok.slice(0, atIdx);
          version = tok.slice(atIdx + 1);
        }
      } else {
        const atIdx = tok.lastIndexOf('@');
        if (atIdx > 0) {
          name = tok.slice(0, atIdx);
          version = tok.slice(atIdx + 1);
        }
      }
      packages.push({ name, version, manager, rawSpec: tok });
    }
  }

  return { manager, packages, requirementsFiles };
}

/**
 * Extracts all package manager commands and their package specs from a commandLine string.
 */
export function extractPackageCommands(commandLine: string): ParsedPackageCommand[] {
  if (!commandLine || typeof commandLine !== 'string') return [];
  const results: ParsedPackageCommand[] = [];

  const lines = commandLine.split(/\r?\n/);
  for (const line of lines) {
    const segments = splitCommandChains(line);
    for (const segment of segments) {
      const parsed = extractFromSegment(segment);
      if (parsed && (parsed.packages.length > 0 || (parsed.requirementsFiles && parsed.requirementsFiles.length > 0))) {
        results.push(parsed);
      }
    }
  }

  return results;
}

/**
 * Scans a shell command line (e.g. MCP tool argument) for package install commands
 * targeting known bad packages.
 *
 * @param commandLine The shell command string (may be chained or multiline)
 * @param file Pseudo-file or origin identifier (default '<args>')
 */
export function scanPackageInstallCommand(
  commandLine: string,
  file: string = '<args>'
): AstCapabilityFact[] {
  const facts: AstCapabilityFact[] = [];
  if (!commandLine || typeof commandLine !== 'string') return facts;

  const lines = commandLine.split(/\r?\n/);
  for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
    const line = lines[lineNo - 1];
    if (!line || !line.trim()) continue;

    const segments = splitCommandChains(line);
    for (const segment of segments) {
      const cmd = extractFromSegment(segment);
      if (!cmd) continue;

      if (cmd.requirementsFiles && cmd.requirementsFiles.length > 0) {
        for (const reqPath of cmd.requirementsFiles) {
          try {
            const resolved = path.isAbsolute(reqPath) ? reqPath : path.resolve(process.cwd(), reqPath);
            if (fs.existsSync(resolved)) {
              const content = fs.readFileSync(resolved, 'utf8');
              const lockFacts = scanLockfile(content, 'pip', resolved);
              facts.push(...lockFacts);
            }
          } catch {
            // graceful ignore on disk read error
          }
        }
      }

      for (const spec of cmd.packages) {
        for (const bad of KNOWN_BAD_PACKAGES) {
          if (!packageNamesMatch(spec.name, bad.name)) continue;

          const effectiveRange = bad.vulnerableVersion ?? bad.versionRange;
          const isUnpinned = !spec.version || spec.version === '' || spec.version === 'unpinned' || spec.version === '*';

          if (isUnpinned) {
            if (bad.versionRange === '*') {
              facts.push({
                ruleId: 'PACKAGE_INSTALL_KNOWN_BAD',
                category: 'DEP_SUPPLY_CHAIN',
                file,
                line: lineNo,
                snippet: `Blocked ${cmd.manager} install of malicious package ${spec.name}@unpinned (${bad.advisoryId}: ${bad.name} ${bad.versionRange})`.slice(0, 200),
                deterministicRisk: RiskLevel.HOLD,
              });
            } else {
              facts.push({
                ruleId: 'PACKAGE_INSTALL_UNPINNED',
                category: 'DEP_SUPPLY_CHAIN',
                file,
                line: lineNo,
                snippet: `Warning: unpinned install of ${spec.name} with known vulnerable version ${effectiveRange} (${bad.advisoryId})`.slice(0, 200),
                deterministicRisk: RiskLevel.WARN,
              });
            }
          } else if (evaluateVersionMatch(spec.version, effectiveRange)) {
            facts.push({
              ruleId: 'PACKAGE_INSTALL_KNOWN_BAD',
              category: 'DEP_SUPPLY_CHAIN',
              file,
              line: lineNo,
              snippet: `Blocked ${cmd.manager} install of malicious package ${spec.name}@${spec.version} (${bad.advisoryId}: ${bad.name} ${effectiveRange})`.slice(0, 200),
              deterministicRisk: RiskLevel.HOLD,
            });
          }
        }
      }
    }
  }

  return facts;
}
