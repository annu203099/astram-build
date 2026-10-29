/**
 * Unit tests — compactMcpResult (redaction classes, ANSI stripping,
 * UTF-8-safe truncation) per docs/CONTRACTS.md §6.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { compactMcpResult, redactSecrets } from './index.js';

describe('compactMcpResult — secret redaction classes', () => {
  it('redacts OpenAI-style sk- tokens', () => {
    const r = compactMcpResult({ key: 'sk-ABCDEFGHIJKLMNOPQRSTUV' });
    expect(r.output).toContain('[REDACTED:sk]');
    expect(r.output).not.toContain('sk-ABCDEF');
    expect(r.redactedCount).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('redacts GitHub tokens (ghp_/gho_/ghr_/ghs_)', () => {
    const payload = {
      a: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12',
      b: 'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ34',
      c: 'ghr_ABCDEFGHIJKLMNOPQRSTUVWXYZ56',
      d: 'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ78',
    };
    const r = compactMcpResult(payload);
    expect(r.output).toContain('[REDACTED:ghp]');
    expect(r.output).toContain('[REDACTED:gho]');
    expect(r.output).toContain('[REDACTED:ghr]');
    expect(r.output).toContain('[REDACTED:ghs]');
    expect(r.redactedCount).toBe(4);
    expect(r.output).not.toContain('ghp_ABCDEFGHIJ');
  });

  it('redacts AWS AKIA access key ids', () => {
    const r = compactMcpResult({ aws: 'AKIAIOSFODNN7EXAMPLE' });
    expect(r.output).toContain('[REDACTED:AKIA]');
    expect(r.output).not.toContain('AKIAIOSFODNN7');
  });

  it('redacts Slack xox* tokens', () => {
    const r = compactMcpResult({ slack: 'xoxb-123456789-abcdefghijk' });
    expect(r.output).toContain('[REDACTED:slack]');
    expect(r.output).not.toContain('xoxb-123456789');
  });

  it('redacts Bearer tokens', () => {
    const r = compactMcpResult({ auth: 'Bearer eyJhbGciOi.abc-_12345' });
    expect(r.output).toContain('[REDACTED:bearer]');
    expect(r.output).not.toContain('eyJhbGciOi');
  });

  it('redacts astram canary secrets', () => {
    const r = compactMcpResult({ canary: 'AEGIS_CANARY_SECRET_999' });
    expect(r.output).toContain('[REDACTED:canary]');
    expect(r.output).not.toContain('AEGIS_CANARY_SECRET_999');
  });

  it('redacts generic api_key/token/secret/password assignments', () => {
    const r = compactMcpResult({
      api_key: 'abcdefghij1234567890',
      token: 't'.repeat(20),
      secret: 's'.repeat(20),
      password: 'p'.repeat(20),
    });
    expect(r.output).toContain('[REDACTED:secret]');
    expect(r.output).not.toContain('abcdefghij1234567890');
    expect(r.output.match(/\[REDACTED:secret\]/g)?.length).toBe(4);
    expect(r.redactedCount).toBe(4);
  });

  it('does not redact short innocent values', () => {
    const r = compactMcpResult({ secret: 'short', token: 42, note: 'token: too short value' });
    expect(r.redactedCount).toBe(0);
    expect(r.truncated).toBe(false);
  });
});

describe('compactMcpResult — ANSI stripping', () => {
  it('strips SGR sequences in both raw and JSON-escaped form', () => {
    const r = compactMcpResult({ log: 'before \u001b[31mRED\u001b[0m after' });
    expect(r.output).not.toContain('\u001b');
    expect(r.output).not.toContain('001b'); // escaped \\u001b form gone too
    expect(r.output).toContain('before');
    expect(r.output).toContain('after');
  });
});

describe('compactMcpResult — UTF-8-safe truncation', () => {
  it('caps byte length and never splits a multi-byte CJK character', () => {
    // Each CJK char is 3 UTF-8 bytes; stringified payload is 3*N+~12 bytes.
    const r = compactMcpResult({ t: '你好世界'.repeat(20) }, 60);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.output, 'utf8')).toBeLessThanOrEqual(60);
    expect(r.output).not.toContain('\uFFFD'); // no replacement char => no split
    expect(r.output).toMatch(/…\[astram: truncated \d+ bytes\]$/);
  });

  it('leaves small payloads untouched', () => {
    const r = compactMcpResult({ a: 1, b: 'x' });
    expect(r.output).toBe(JSON.stringify({ a: 1, b: 'x' }));
    expect(r.truncated).toBe(false);
  });
});

describe('redactSecrets (shared with redactedArgumentsJson / ASTRAM_ORIGINAL_JSON)', () => {
  it('masks the same classes when applied to raw strings', () => {
    const { output, redactedCount } = redactSecrets(
      'token=sk-ABCDEFGHIJKLMNOPQRSTUV&password=supersecret12345678'
    );
    // NOTE: the generic pattern consumes the key name too ("password=..."
    // is part of the match), per the contract regex.
    expect(output).toBe('token=[REDACTED:sk]&[REDACTED:secret]');
    expect(redactedCount).toBe(2);
  });
});
