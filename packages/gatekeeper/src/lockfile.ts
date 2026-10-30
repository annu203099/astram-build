/**
 * @astram/gatekeeper — lockfile / dependency-manifest scanning.
 *
 * Flags every dependency matching @astram/types KNOWN_BAD_PACKAGES (semver
 * range, e.g. litellm<=1.107.0) with ruleId LOCKFILE_KNOWN_BAD.
 *
 * Category mapping deviation (recorded in docs/error-log/gatekeeper.md): the
 * contract rule table lists category `LOCKFILE_PKG`, but `CapabilityCategory`
 * has no such member. litellm<=1.107.0 IS a startup-hook package (its .pth
 * executes at interpreter startup), so the fact category is `STARTUP_HOOK`
 * and the LOCKFILE_PKG semantics live in the ruleId + snippet.
 *
 * Kinds: 'npm' (package-lock.json), 'pnpm' (pnpm-lock.yaml, parsed with the
 * `yaml` package), 'pip' (requirements.txt), 'pyproject' (pyproject.toml,
 * parsed with smol-toml; [project.dependencies] +
 * [project.optional-dependencies]). Malformed content never throws: [].
 */
import { coerce, intersects, satisfies, validRange } from 'semver';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { KNOWN_BAD_PACKAGES, type AstCapabilityFact } from '@astram/types';
import { formatRangeForSemver } from './scan-package-command.js';

export type LockfileKind = 'npm' | 'pnpm' | 'pip' | 'pyproject';

export function matchesVersionRange(version: string, range: string): boolean {
  if (!version || version === '*' || version === 'latest' || version === 'unpinned') {
    return true;
  }
  if (!range || range === '*') {
    return true;
  }
  const clean = version.trim().replace(/^['"]|['"]$/g, '');
  const pin = /^={1,2}\s*([^,;\s]+)$/.exec(clean);
  if (pin) {
    const v = coerce(pin[1]);
    return !!(v && satisfies(v, range));
  }
  if (!/[<>=~^,]/.test(clean)) {
    const v = coerce(clean.split('(')[0].trim());
    return !!(v && satisfies(v, range));
  }
  const formatted = formatRangeForSemver(clean);
  const vr = validRange(formatted);
  if (vr && intersects(vr, range)) {
    return true;
  }
  const v = coerce(clean);
  return !!(v && satisfies(v, range));
}

interface DepRef {
  name: string;
  version: string;
  line: number; // 1-based; 1 for structured formats without a meaningful line
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[-_.]+/g, '');
}

function checkDeps(deps: DepRef[], file: string): AstCapabilityFact[] {
  const facts: AstCapabilityFact[] = [];
  const seen = new Set<string>();
  for (const dep of deps) {
    const rawName = dep.name.trim();
    if (!rawName) continue;
    const normName = normalizeName(rawName);
    for (const pkg of KNOWN_BAD_PACKAGES) {
      if (normalizeName(pkg.name) !== normName) continue;

      const targetRange = pkg.vulnerableVersion ?? pkg.versionRange;
      let matches = false;
      let displayVer = dep.version || 'unpinned';

      if (!dep.version || dep.version === 'unpinned' || dep.version === '*') {
        matches = true;
      } else {
        const clean = dep.version.trim();
        const pin = /^={1,2}\s*([^,;\s]+)$/.exec(clean);
        if (pin) {
          const v = coerce(pin[1]);
          if (v && satisfies(v, targetRange)) {
            matches = true;
            displayVer = v.version;
          }
        } else if (!/[<>=~^,]/.test(clean)) {
          const v = coerce(clean.split('(')[0].trim());
          if (v && satisfies(v, targetRange)) {
            matches = true;
            displayVer = v.version;
          }
        } else {
          // Range check e.g. >=1.100,<1.108
          const formatted = formatRangeForSemver(clean);
          const vr = validRange(formatted);
          if (vr && intersects(vr, targetRange)) {
            matches = true;
            displayVer = clean;
          } else {
            const v = coerce(clean);
            if (v && satisfies(v, targetRange)) {
              matches = true;
              displayVer = v.version;
            }
          }
        }
      }

      if (!matches) continue;
      const key = `${pkg.name}@${displayVer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const snippet = `${dep.name}@${displayVer} matches ${pkg.advisoryId} (${pkg.name} ${targetRange}: ${pkg.reason})`.slice(0, 200);
      facts.push({
        ruleId: 'LOCKFILE_KNOWN_BAD',
        category: 'STARTUP_HOOK',
        file,
        line: dep.line,
        snippet,
        deterministicRisk: pkg.risk,
      });
    }
  }
  return facts;
}

/** package-lock.json: walk `packages` keys (incl. nested node_modules) and the legacy `dependencies` map. */
function depsFromNpmLock(content: string): DepRef[] {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return [];
  }
  const deps: DepRef[] = [];
  if (!root || typeof root !== 'object') return deps;
  const packages = (root as Record<string, unknown>).packages;
  if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
    for (const key of Object.keys(packages as Record<string, unknown>)) {
      const val = (packages as Record<string, unknown>)[key];
      if (!val || typeof val !== 'object') continue;
      const v = val as Record<string, unknown>;
      if (typeof v.version !== 'string') continue;
      let name: string;
      if (key === '') {
        name = typeof v.name === 'string' ? v.name : '';
      } else if (key.includes('node_modules/')) {
        name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      } else {
        name = key;
      }
      if (name) deps.push({ name, version: v.version, line: 1 });
    }
  }
  const dependencies = (root as Record<string, unknown>).dependencies;
  if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
    for (const name of Object.keys(dependencies as Record<string, unknown>)) {
      const val = (dependencies as Record<string, unknown>)[name];
      let version = '';
      if (typeof val === 'string') version = val;
      else if (val && typeof val === 'object' && typeof (val as Record<string, unknown>).version === 'string') {
        version = (val as Record<string, string>).version;
      }
      if (version) deps.push({ name, version, line: 1 });
    }
  }
  return deps;
}

/** pnpm-lock.yaml: `packages` keys carry `name@version`; importers carry per-project deps. */
function depsFromPnpmLock(content: string): DepRef[] {
  let root: unknown;
  try {
    root = parseYaml(content);
  } catch {
    return [];
  }
  const deps: DepRef[] = [];
  if (!root || typeof root !== 'object') return deps;
  const doc = root as Record<string, unknown>;

  const packages = doc.packages;
  if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
    for (const key of Object.keys(packages as Record<string, unknown>)) {
      const clean = key.split('(')[0];
      const at = clean.lastIndexOf('@');
      if (at <= 0) continue; // bare names / malformed keys
      const name = clean.slice(0, at);
      const version = clean.slice(at + 1);
      if (name && version) deps.push({ name, version, line: 1 });
    }
  }

  const stripVersionSuffix = (v: string): string => {
    const noParen = v.split('(')[0].trim();
    if (noParen.includes('@') && !noParen.startsWith('@')) {
      return noParen.slice(noParen.lastIndexOf('@') + 1).split('(')[0].trim();
    }
    return noParen;
  };

  const collectDepsMap = (container: unknown): void => {
    if (!container || typeof container !== 'object') return;
    const c = container as Record<string, unknown>;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const sec = c[section];
      if (!sec || typeof sec !== 'object' || Array.isArray(sec)) continue;
      for (const name of Object.keys(sec as Record<string, unknown>)) {
        const val = (sec as Record<string, unknown>)[name];
        let version = '';
        if (typeof val === 'string') version = val;
        else if (val && typeof val === 'object' && typeof (val as Record<string, unknown>).version === 'string') {
          version = (val as Record<string, string>).version;
        }
        if (version) deps.push({ name, version: stripVersionSuffix(version), line: 1 });
      }
    }
  };

  const importers = doc.importers;
  if (importers && typeof importers === 'object' && !Array.isArray(importers)) {
    for (const key of Object.keys(importers as Record<string, unknown>)) {
      collectDepsMap((importers as Record<string, unknown>)[key]);
    }
  }
  // lockfileVersion 5/6 top-level dependency maps ({name: version}).
  collectDepsMap(doc);

  return deps;
}

/** requirements.txt / single PEP 508 requirement string. */
function depsFromRequirements(content: string): DepRef[] {
  const deps: DepRef[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash).trim();
    const semi = line.indexOf(';');
    if (semi >= 0) line = line.slice(0, semi).trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1];
    const rest = m[2] ?? '';
    let version = '';
    const pin = /==\s*([^,;\s]+)/.exec(rest);
    if (pin) version = pin[1];
    else {
      const loose = /(?:>=|<=|~=|>|<|!=|\^)\s*([0-9][^\s,;]*)/.exec(rest);
      if (loose) version = rest.trim();
    }
    if (version) deps.push({ name, version, line: i + 1 });
    else deps.push({ name, version: 'unpinned', line: i + 1 });
  }
  return deps;
}

/** pyproject.toml: [project].dependencies + [project.optional-dependencies]. */
function depsFromPyproject(content: string): DepRef[] {
  let root: unknown;
  try {
    root = parseToml(content);
  } catch {
    return [];
  }
  const deps: DepRef[] = [];
  const project = (root as Record<string, unknown> | null)?.project;
  if (!project || typeof project !== 'object') return deps;
  const addAll = (arr: unknown): void => {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (typeof entry !== 'string') continue;
      const req = depsFromRequirements(entry)[0];
      if (req) deps.push(req);
    }
  };
  addAll((project as Record<string, unknown>).dependencies);
  const opt = (project as Record<string, unknown>)['optional-dependencies'];
  if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
    for (const key of Object.keys(opt as Record<string, unknown>)) {
      addAll((opt as Record<string, unknown>)[key]);
    }
  }
  return deps;
}

export function scanLockfile(content: string, kind: LockfileKind, file: string): AstCapabilityFact[] {
  switch (kind) {
    case 'npm':
      return checkDeps(depsFromNpmLock(content), file);
    case 'pnpm':
      return checkDeps(depsFromPnpmLock(content), file);
    case 'pip':
      return checkDeps(depsFromRequirements(content), file);
    case 'pyproject':
      return checkDeps(depsFromPyproject(content), file);
    default:
      return [];
  }
}
