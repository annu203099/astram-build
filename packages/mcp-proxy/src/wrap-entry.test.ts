/**
 * Unit tests — wrapMcpServerEntry pure config transform per
 * docs/CONTRACTS.md §6 (Handbook §2 transformation example shape).
 */
import { describe, expect, it } from 'vitest';
import { wrapMcpServerEntry, type McpServerEntry, type WrapEntryInput } from './index.js';

const input: WrapEntryInput = {
  agentHost: 'antigravity',
  serverId: 'filesystem',
  proxyModulePath: 'C:/astram/packages/mcp-proxy/dist/cli-proxy.js',
  ledgerDbPath: 'C:/Users/Shashank/.astram/aegis_ledger.db',
  dashboardWsUrl: 'ws://127.0.0.1:3080/ws/telemetry',
};

describe('wrapMcpServerEntry', () => {
  it('wraps a stdio entry exactly per the Handbook example', () => {
    const entry: McpServerEntry = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Users/Shashank/Projects'],
    };
    expect(wrapMcpServerEntry(entry, input)).toEqual({
      command: 'node',
      args: [
        'C:/astram/packages/mcp-proxy/dist/cli-proxy.js',
        '--agent-host',
        'antigravity',
        '--server-id',
        'filesystem',
        '--target-cmd',
        'npx',
        '--target-args',
        '-y,@modelcontextprotocol/server-filesystem,C:/Users/Shashank/Projects',
      ],
      env: {
        AEGIS_LEDGER_DB: 'C:/Users/Shashank/.astram/aegis_ledger.db',
        AEGIS_DASHBOARD_WS: 'ws://127.0.0.1:3080/ws/telemetry',
        ASTRAM_ORIGINAL_JSON: JSON.stringify(entry),
      },
    });
  });

  it('wraps an http/url entry keeping the url in ASTRAM_TARGET_URL', () => {
    const entry: McpServerEntry = { url: 'https://mcp.example.com/s', env: { FOO: 'bar' } };
    const wrapped = wrapMcpServerEntry(entry, input);
    expect(wrapped.command).toBe('node');
    expect(wrapped.args).toEqual([
      'C:/astram/packages/mcp-proxy/dist/cli-proxy.js',
      '--agent-host',
      'antigravity',
      '--server-id',
      'filesystem',
    ]);
    expect(wrapped.env?.ASTRAM_TARGET_URL).toBe('https://mcp.example.com/s');
    expect(wrapped.env?.FOO).toBe('bar'); // original env merged
    expect(wrapped.env?.AEGIS_LEDGER_DB).toBe(input.ledgerDbPath);
    expect(wrapped.env?.AEGIS_DASHBOARD_WS).toBe(input.dashboardWsUrl);
  });

  it('treats a stdio entry without args as empty --target-args', () => {
    const wrapped = wrapMcpServerEntry({ command: 'node-server' }, input);
    expect(wrapped.args?.[wrapped.args.length - 1]).toBe('');
    expect(wrapped.args?.[wrapped.args.length - 2]).toBe('--target-args');
    expect(wrapped.args?.[wrapped.args.length - 4]).toBe('--target-cmd');
    expect(wrapped.args?.[wrapped.args.length - 3]).toBe('node-server');
  });

  it('preserves the redacted original entry in ASTRAM_ORIGINAL_JSON', () => {
    const entry: McpServerEntry = {
      command: 'npx',
      args: ['x'],
      env: { TOKEN: 'sk-ABCDEFGHIJKLMNOPQRSTUV' },
    };
    const wrapped = wrapMcpServerEntry(entry, input);
    const original = JSON.parse(wrapped.env?.ASTRAM_ORIGINAL_JSON as string) as McpServerEntry;
    expect(original.command).toBe('npx');
    expect(original.args).toEqual(['x']);
    expect(wrapped.env?.ASTRAM_ORIGINAL_JSON).toContain('[REDACTED:sk]');
    expect(wrapped.env?.ASTRAM_ORIGINAL_JSON).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUV');
  });

  it('is idempotent: an already-wrapped entry is returned unchanged', () => {
    const entry: McpServerEntry = { command: 'npx', args: ['-y', 'fs'] };
    const once = wrapMcpServerEntry(entry, input);
    const twice = wrapMcpServerEntry(once, input);
    expect(twice).toEqual(once);
    // marker-env-only detection also counts as already wrapped
    const markerOnly: McpServerEntry = {
      command: 'node',
      env: { ASTRAM_ORIGINAL_JSON: '{"command":"x"}' },
    };
    expect(wrapMcpServerEntry(markerOnly, input)).toBe(markerOnly);
  });
});
