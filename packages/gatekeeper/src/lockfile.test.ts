import { describe, expect, it } from 'vitest';
import { RiskLevel } from '@astram/types';
import { scanLockfile } from './lockfile.js';

describe('scanLockfile — npm (package-lock.json)', () => {
  const lock = JSON.stringify(
    {
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', version: '0.0.0' },
        'node_modules/express': { version: '5.0.0' },
        'node_modules/litellm': { version: '1.107.0' },
        'node_modules/express/node_modules/litellm': { version: '1.108.0' },
      },
      dependencies: { litellm: { version: '1.107.0' } },
    },
    null,
    2
  );

  it('flags litellm<=1.107.0 as LOCKFILE_KNOWN_BAD HOLD; nested 1.108.0 clean', () => {
    const facts = scanLockfile(lock, 'npm', 'package-lock.json');
    expect(facts).toHaveLength(1); // deduped by name@version across sections
    const f = facts[0]!;
    expect(f.ruleId).toBe('LOCKFILE_KNOWN_BAD');
    expect(f.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(f.snippet).toContain('litellm@1.107.0');
  });

  it('litellm 1.108.0+ is clean', () => {
    const clean = JSON.stringify({
      packages: { 'node_modules/litellm': { version: '1.108.0' } },
    });
    expect(scanLockfile(clean, 'npm', 'package-lock.json')).toEqual([]);
  });

  it('malformed JSON never throws', () => {
    expect(scanLockfile('{ not json', 'npm', 'package-lock.json')).toEqual([]);
  });
});

describe('scanLockfile — pnpm (pnpm-lock.yaml)', () => {
  it('walks packages keys (name@version) and importers dependencies', () => {
    const yaml = [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '  .:',
      '    dependencies:',
      '      litellm:',
      "        specifier: ^1.107.0",
      '        version: 1.107.0',
      '      express:',
      "        specifier: ^5.0.0",
      '        version: 5.0.0',
      '',
      'packages:',
      '  litellm@1.107.0:',
      '    resolution: {integrity: sha512-deadbeef}',
      '  express@5.0.0:',
      '    resolution: {integrity: sha512-cafebabe}',
      '',
    ].join('\n');
    const facts = scanLockfile(yaml, 'pnpm', 'pnpm-lock.yaml');
    expect(facts).toHaveLength(1);
    expect(facts[0]!.ruleId).toBe('LOCKFILE_KNOWN_BAD');
    expect(facts[0]!.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(facts[0]!.snippet).toContain('litellm@1.107.0');
  });

  it('handles version-suffixed keys and 1.108.0+ clean case', () => {
    const yaml = ['packages:', '  litellm@1.108.0:', '    resolution: {integrity: sha512-x}'].join('\n');
    expect(scanLockfile(yaml, 'pnpm', 'pnpm-lock.yaml')).toEqual([]);
  });

  it('malformed YAML never throws', () => {
    expect(scanLockfile('a: [unclosed', 'pnpm', 'pnpm-lock.yaml')).toEqual([]);
  });
});

describe('scanLockfile — pip (requirements.txt)', () => {
  it('takes the pinned == version and flags litellm 1.107.0 with the source line', () => {
    const reqs = ['# project deps', 'requests>=2.28,<3.0', 'litellm==1.107.0', 'numpy~=1.26; python_version>="3.10"'].join('\n');
    const facts = scanLockfile(reqs, 'pip', 'requirements.txt');
    expect(facts).toHaveLength(1);
    expect(facts[0]!.ruleId).toBe('LOCKFILE_KNOWN_BAD');
    expect(facts[0]!.line).toBe(3);
    expect(facts[0]!.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('litellm 1.108.0 pinned is clean; range-only litellm uses first constraint', () => {
    expect(scanLockfile('litellm==1.108.0', 'pip', 'requirements.txt')).toEqual([]);
    const range = scanLockfile('litellm>=1.108.0,<2.0', 'pip', 'requirements.txt');
    expect(range).toEqual([]);
  });

  it('litellm>=1.0,<1.108 still flags (range max within bad range)', () => {
    const facts = scanLockfile('litellm>=1.100,<1.108', 'pip', 'requirements.txt');
    expect(facts).toHaveLength(1);
  });
});

describe('scanLockfile — pyproject (pyproject.toml)', () => {
  const toml = [
    '[project]',
    'name = "app"',
    'dependencies = [',
    '  "litellm==1.107.0",',
    '  "requests>=2.28",',
    ']',
    '',
    '[project.optional-dependencies]',
    'dev = [',
    '  "pytest>=8",',
    ']',
  ].join('\n');

  it('walks [project].dependencies and flags litellm 1.107.0 HOLD', () => {
    const facts = scanLockfile(toml, 'pyproject', 'pyproject.toml');
    expect(facts).toHaveLength(1);
    expect(facts[0]!.ruleId).toBe('LOCKFILE_KNOWN_BAD');
    expect(facts[0]!.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('litellm 1.108.0 in pyproject is clean; malformed TOML never throws', () => {
    const clean = ['[project]', 'dependencies = ["litellm==1.108.0"]'].join('\n');
    expect(scanLockfile(clean, 'pyproject', 'pyproject.toml')).toEqual([]);
    expect(scanLockfile('[project', 'pyproject', 'pyproject.toml')).toEqual([]);
  });
});
