import { describe, expect, it } from 'vitest';
import { RiskLevel } from '@astram/types';
import { scanJavascript } from './scan-javascript.js';

const F = 'plugin.js';

describe('scanJavascript — JS_CHILD_PROCESS (PROC_EXEC HOLD)', () => {
  it('flags require(child_process) + exec call', () => {
    const facts = scanJavascript(`const { exec } = require('child_process');\nexec('ls');`, F);
    const fact = facts.find((f) => f.ruleId === 'JS_CHILD_PROCESS');
    expect(fact).toBeDefined();
    expect(fact!.category).toBe('PROC_EXEC');
    expect(fact!.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(fact!.line).toBe(2);
    expect(fact!.file).toBe(F);
  });

  it('flags import from child_process + spawnSync call, and cp.exec member calls', () => {
    const facts = scanJavascript(
      `import { spawnSync } from 'node:child_process';\nspawnSync('node', ['-v']);`,
      F
    );
    expect(facts.some((f) => f.ruleId === 'JS_CHILD_PROCESS' && f.line === 2)).toBe(true);

    const memberFacts = scanJavascript(
      `const cp = require('child_process');\ncp.execFile('x');\ncp.exec('x');`,
      F
    );
    const execFact = memberFacts.find((f) => f.ruleId === 'JS_CHILD_PROCESS');
    expect(execFact).toBeDefined();
    expect(execFact!.line).toBe(3); // cp.exec — execFile is not in the trigger set
  });

  it('negative: exec-like names without any child_process reference stay silent', () => {
    const facts = scanJavascript(`const exec = (c) => c;\nexec('ls');`, F);
    expect(facts.filter((f) => f.ruleId === 'JS_CHILD_PROCESS')).toHaveLength(0);
  });
});

describe('scanJavascript — JS_DYNAMIC_EVAL (DYNAMIC_EVAL WARN)', () => {
  it('flags eval(), new Function(), vm.runIn*()', () => {
    const facts = scanJavascript(
      [
        `const vm = require('vm');`,
        `eval('1+1');`,
        `const f = new Function('return 1');`,
        `vm.runInThisContext('x');`,
        `vm.runInNewContext('y');`,
      ].join('\n'),
      F
    );
    const evals = facts.filter((f) => f.ruleId === 'JS_DYNAMIC_EVAL');
    expect(evals.map((f) => f.line).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    for (const f of evals) {
      expect(f.category).toBe('DYNAMIC_EVAL');
      expect(f.deterministicRisk).toBe(RiskLevel.WARN);
    }
  });

  it('negative: regular calls are not dynamic eval', () => {
    const facts = scanJavascript(
      `const out = evaluate(model);\nconst g = Functional.map([1]);\nconst ev = evaluator();`,
      F
    );
    expect(facts.filter((f) => f.ruleId === 'JS_DYNAMIC_EVAL')).toHaveLength(0);
  });
});

describe('scanJavascript — JS_FS_CRED_READ (CRED_ACCESS WARN)', () => {
  it('flags fs read calls whose first-arg literal is a protected path', () => {
    const facts = scanJavascript(
      [
        `const fs = require('fs');`,
        `fs.readFileSync('.env');`,
        `fs.readFile('C:/Users/dev/.env.local', cb);`,
        `fs.createReadStream('%USERPROFILE%\\\\.ssh\\\\id_rsa');`,
      ].join('\n'),
      F
    );
    const reads = facts.filter((f) => f.ruleId === 'JS_FS_CRED_READ');
    expect(reads.map((f) => f.line)).toEqual([2, 3, 4]);
    expect(reads[0]!.deterministicRisk).toBe(RiskLevel.WARN);
    expect(reads[0]!.category).toBe('CRED_ACCESS');
  });

  it('flags protected path inside a template literal', () => {
    const facts = scanJavascript('const s = fs.readFileSync(`${base}/.aws/credentials`);', F);
    // quasis carry "/.aws/credentials" — protected dir segment
    expect(facts.some((f) => f.ruleId === 'JS_FS_CRED_READ')).toBe(true);
  });

  it('negative: fs read of ordinary files is not flagged', () => {
    const facts = scanJavascript(`const fs = require('fs');\nfs.readFileSync('package.json');`, F);
    expect(facts.filter((f) => f.ruleId === 'JS_FS_CRED_READ')).toHaveLength(0);
  });
});

describe('scanJavascript — JS_SHELL_CRED_READ via exec argument (CRED_ACCESS HOLD)', () => {
  it('flags exec whose command string contains a protected path', () => {
    const facts = scanJavascript(
      [
        `const { exec } = require('child_process');`,
        `exec('type "%USERPROFILE%\\\\.gemini\\\\antigravity\\\\mcp_oauth_tokens.json"', cb);`,
      ].join('\n'),
      F
    );
    const cred = facts.find((f) => f.ruleId === 'JS_SHELL_CRED_READ');
    expect(cred).toBeDefined();
    expect(cred!.category).toBe('CRED_ACCESS');
    expect(cred!.deterministicRisk).toBe(RiskLevel.HOLD);
    expect(cred!.line).toBe(2);
    // the exec call itself is also flagged
    expect(facts.some((f) => f.ruleId === 'JS_CHILD_PROCESS' && f.line === 2)).toBe(true);
  });

  it('negative: exec with a benign command has no CRED_ACCESS fact', () => {
    const facts = scanJavascript(`const { exec } = require('child_process');\nexec('ls -la');`, F);
    expect(facts.filter((f) => f.ruleId === 'JS_SHELL_CRED_READ')).toHaveLength(0);
  });
});

describe('scanJavascript — JS_NET_EGRESS (NET_EGRESS WARN)', () => {
  it('flags fetch, http.request, https.request, net.connect, axios, urllib', () => {
    const facts = scanJavascript(
      [
        `const http = require('http'); const https = require('https'); const net = require('net');`,
        `fetch('http://127.0.0.1:1/x');`,
        `http.request({ host: '127.0.0.1' });`,
        `https.request({ host: '127.0.0.1' });`,
        `net.connect(1234, '127.0.0.1');`,
        `axios.get('http://127.0.0.1:1/y');`,
        `const urllib = require('urllib');`,
      ].join('\n'),
      F
    );
    const net2 = facts.filter((f) => f.ruleId === 'JS_NET_EGRESS');
    expect(net2.map((f) => f.line).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(net2[0]!.category).toBe('NET_EGRESS');
    expect(net2[0]!.deterministicRisk).toBe(RiskLevel.WARN);
  });

  it('negative: ordinary code has no net egress facts', () => {
    const facts = scanJavascript(`const http = 'just a string';\nconst fetcher = 1;\nmodule.exports = {};`, F);
    expect(facts.filter((f) => f.ruleId === 'JS_NET_EGRESS')).toHaveLength(0);
  });
});

describe('scanJavascript — robustness', () => {
  it('never throws on parse errors and returns []', () => {
    expect(scanJavascript('this is {{{ not javascript', F)).toEqual([]);
    expect(scanJavascript('', F)).toEqual([]);
  });

  it('known limitation: TypeScript-specific syntax does not parse (returns [])', () => {
    expect(scanJavascript('const x: number = 1;', F)).toEqual([]);
  });

  it('snippets are the offending source line trimmed to 200 chars', () => {
    const longArg = 'x'.repeat(300);
    const facts = scanJavascript(`fetch('${longArg}');`, F);
    const fact = facts.find((f) => f.ruleId === 'JS_NET_EGRESS');
    expect(fact).toBeDefined();
    expect(fact!.snippet.length).toBeLessThanOrEqual(200);
    expect(fact!.snippet.startsWith("fetch('")).toBe(true);
  });
});
