import { describe, expect, it } from 'vitest';
import { quoteForCmd, resolveSpawnPlan } from './spawn-target.js';

// Windows file lookups are case-insensitive and PATHEXT is upper-case.
const ci =
  (...names: string[]) =>
  (p: string): boolean =>
    names.some((n) => n.toLowerCase() === p.toLowerCase());
const env = { PATH: 'C:\\bin;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' };

describe('resolveSpawnPlan', () => {
  it('is a no-op off Windows', () => {
    expect(resolveSpawnPlan('npx', ['-y', 'x'], { platform: 'linux' })).toEqual({ file: 'npx', args: ['-y', 'x'] });
  });

  it('routes npx.cmd through cmd.exe with verbatim quoting', () => {
    const plan = resolveSpawnPlan('npx', ['-y', '@scope/pkg', 'C:\\My Dir'], {
      platform: 'win32',
      env,
      exists: ci('C:\\bin\\npx.cmd'),
    });
    expect(plan.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(plan.args[3].toLowerCase()).toBe('"c:\\bin\\npx.cmd -y @scope/pkg "c:\\my dir""');
  });

  it('prefers the .cmd shim over an extensionless file of the same name', () => {
    const plan = resolveSpawnPlan('npx', [], {
      platform: 'win32',
      env,
      exists: ci('C:\\bin\\npx', 'C:\\bin\\npx.cmd'),
    });
    expect((plan.args[3] ?? '').toLowerCase()).toContain('npx.cmd');
  });

  it('spawns .exe directly', () => {
    const plan = resolveSpawnPlan('node', ['a.js'], { platform: 'win32', env, exists: ci('C:\\tools\\node.exe') });
    expect(plan.file.toLowerCase()).toBe('c:\\tools\\node.exe');
    expect(plan.args).toEqual(['a.js']);
  });

  it('falls through unchanged when nothing resolves', () => {
    expect(resolveSpawnPlan('ghost', ['x'], { platform: 'win32', env, exists: () => false })).toEqual({ file: 'ghost', args: ['x'] });
  });
});

describe('quoteForCmd', () => {
  it('quotes only when needed and doubles embedded quotes', () => {
    expect(quoteForCmd('plain')).toBe('plain');
    expect(quoteForCmd('a b')).toBe('"a b"');
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
    expect(quoteForCmd('a&b')).toBe('"a&b"');
    expect(quoteForCmd('')).toBe('""');
  });
});
