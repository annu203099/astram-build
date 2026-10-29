import { describe, expect, it } from 'vitest';
import { RiskLevel } from '@astram/types';
import { scanShellSnippet } from './scan-shell.js';

const F = 'install.sh';

describe('scanShellSnippet — SHELL_PIPE_DOWNLOAD (PROC_EXEC WARN)', () => {
  it('flags curl piped into sh/bash', () => {
    for (const cmd of [
      'curl -sSL https://127.0.0.1/install.sh | bash',
      'wget -qO- http://127.0.0.1/i | sh',
      'curl -fsSL https://127.0.0.1/x | sudo zsh',
    ]) {
      const facts = scanShellSnippet(cmd, F);
      const fact = facts.find((f) => f.ruleId === 'SHELL_PIPE_DOWNLOAD');
      expect(fact, cmd).toBeDefined();
      expect(fact!.category).toBe('PROC_EXEC');
      expect(fact!.deterministicRisk).toBe(RiskLevel.WARN);
      expect(fact!.line).toBe(1);
    }
  });

  it('flags PowerShell iex(...) and Invoke-Expression', () => {
    const iexFacts = scanShellSnippet(
      "iex (New-Object Net.WebClient).DownloadString('http://127.0.0.1:1/x')",
      F
    );
    expect(iexFacts.some((f) => f.ruleId === 'SHELL_PIPE_DOWNLOAD')).toBe(true);

    const invokeFacts = scanShellSnippet('Invoke-Expression $userCmd', F);
    expect(invokeFacts.some((f) => f.ruleId === 'SHELL_PIPE_DOWNLOAD')).toBe(true);
  });

  it('negative: plain curl downloads and echo are not flagged', () => {
    expect(scanShellSnippet('curl -s http://127.0.0.1/data -o out.json', F)).toEqual([]);
    expect(scanShellSnippet('echo hello world', F)).toEqual([]);
    expect(scanShellSnippet('ls -la | grep foo', F)).toEqual([]);
  });
});

describe('scanShellSnippet — JS_SHELL_CRED_READ (CRED_ACCESS HOLD)', () => {
  it('flags any protected path token in the command string', () => {
    const facts = scanShellSnippet('type "%USERPROFILE%\\.gemini\\antigravity\\mcp_oauth_tokens.json"', F);
    const fact = facts.find((f) => f.ruleId === 'JS_SHELL_CRED_READ');
    expect(fact).toBeDefined();
    expect(fact!.category).toBe('CRED_ACCESS');
    expect(fact!.deterministicRisk).toBe(RiskLevel.HOLD);
  });

  it('flags .env, .ssh, .aws targets and reports the right line', () => {
    const multi = ['echo start', 'cat ~/.ssh/id_rsa', 'type .env; cat ~/.aws/credentials'].join('\n');
    const facts = scanShellSnippet(multi, F).filter((f) => f.ruleId === 'JS_SHELL_CRED_READ');
    expect(facts.map((f) => f.line)).toEqual([2, 3]);
  });

  it('negative: ordinary paths are not flagged', () => {
    expect(scanShellSnippet('cat package.json && npm run build', F)).toEqual([]);
    expect(scanShellSnippet('cp .env.example .env.example.bak', F)).toEqual([]);
  });
});
