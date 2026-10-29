/**
 * TEST-03 — Node.js Brotli (CVE-2026-111497) & Ruby Regexp (CVE-2026-110264)
 * byte-path taint sinks (Tier 2 — ACTIVE).
 *
 * docs/CONTRACTS.md §10: analyzeBytePathJs must find the BROTLI sink with
 * source 'HTTP_REQUEST' in app.js, analyzeBytePathRuby the RUBY_REGEXP sink in
 * leak.rb, and taintFactsFromSinks must yield HOLD facts (BYTEPATH_SINK).
 *
 * Fixtures are STATIC DATA (AGENTS.md rule 5): read as text, never executed.
 */
import { RiskLevel } from '@astram/types';
import { analyzeBytePathJs, analyzeBytePathRuby, taintFactsFromSinks } from '@astram/gatekeeper';
import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.js';

describe('TEST-03 bytepath taint sinks (Node Brotli + Ruby Regexp)', () => {
  it('analyzeBytePathJs finds the BROTLI sink sourced from HTTP_REQUEST', () => {
    const sinks = analyzeBytePathJs(readFixture('attack-3-bytepath-sinks', 'app.js'), 'app.js');
    const brotli = sinks.find((s) => s.kind === 'BROTLI');
    expect(brotli).toBeDefined();
    expect(brotli?.source).toBe('HTTP_REQUEST');
    expect(brotli?.line).toBeGreaterThan(0);
    expect(brotli?.snippet).toContain('createBrotliDecompress');
    expect(brotli?.detail).toContain('.pipe()');
  });

  it('analyzeBytePathRuby finds the RUBY_REGEXP sink on params[:q]', () => {
    const sinks = analyzeBytePathRuby(readFixture('attack-3-bytepath-sinks', 'leak.rb'), 'leak.rb');
    const rx = sinks.find((s) => s.kind === 'RUBY_REGEXP');
    expect(rx).toBeDefined();
    expect(rx?.source).toBe('USER_INPUT');
    expect(rx?.snippet).toContain('Regexp.compile');
  });

  it('taintFactsFromSinks turns the sinks into HOLD BYTEPATH_SINK facts', () => {
    const sinks = [
      ...analyzeBytePathJs(readFixture('attack-3-bytepath-sinks', 'app.js'), 'app.js'),
      ...analyzeBytePathRuby(readFixture('attack-3-bytepath-sinks', 'leak.rb'), 'leak.rb'),
    ];
    const facts = taintFactsFromSinks(sinks, 'bytepath');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.deterministicRisk === RiskLevel.HOLD)).toBe(true);
    expect(facts.every((f) => f.category === 'BYTEPATH_SINK')).toBe(true);
    expect(facts.some((f) => f.ruleId === 'BYTEPATH_BROTLI')).toBe(true);
    expect(facts.some((f) => f.ruleId === 'BYTEPATH_RUBY_REGEXP')).toBe(true);
  });

  it('guarded-by-nothing negatives: literal regexp and static buffers stay silent', () => {
    // sanity guard against the fixture scanners firing on everything
    expect(analyzeBytePathRuby(["x = Regexp.compile('constant')"].join('\n'), 'clean.rb')).toHaveLength(0);
    expect(
      analyzeBytePathJs("const zlib = require('zlib'); zlib.brotliDecompressSync(Buffer.from('static'));", 'clean.js')
    ).toHaveLength(0);
  });
});
