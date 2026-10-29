/**
 * Tier 2 unit tests — Windows multi-runtime eMudhra TLS truststore probe
 * (Handbook §6.3, contract docs/CONTRACTS.md §3 / §10 TEST-04).
 * No network, no cert generation beyond deterministic string literals; the
 * probe itself is exercised ONLY through injected contexts (plus one
 * default-mode smoke call that must never throw on a real machine).
 */
import { createHash } from 'node:crypto';
import { RiskLevel } from '@astram/types';
import { describe, expect, it } from 'vitest';
import {
  REVOKED_EMUDHRA_FINGERPRINTS,
  buildHardenedCaBundle,
  fingerprintPemCert,
  probeBoardingItems,
  probeWindowsTlsTruststores,
  tlsFactsFromResults,
} from './tls-windows-probe.js';

/** Deterministic mock cert PEM: a CERTIFICATE block around a fixed payload. */
function pemFor(payload: string): string {
  const b64 = Buffer.from(payload, 'utf8').toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function sha256Of(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload, 'utf8')).digest('hex');
}

describe('REVOKED_EMUDHRA_FINGERPRINTS', () => {
  it('is 8 deterministic lowercase 64-char sha256 hex constants', () => {
    expect(REVOKED_EMUDHRA_FINGERPRINTS).toHaveLength(8);
    expect(new Set(REVOKED_EMUDHRA_FINGERPRINTS).size).toBe(8);
    for (const fp of REVOKED_EMUDHRA_FINGERPRINTS) {
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('fingerprintPemCert', () => {
  it('returns the sha256 of the base64 DER payload (known-value test)', () => {
    const pem = pemFor('astram-tls-known-payload');
    expect(fingerprintPemCert(pem)).toBe(sha256Of('astram-tls-known-payload'));
  });

  it('tolerates arbitrary whitespace inside the base64 payload', () => {
    const b64 = Buffer.from('astram-tls-wrapped', 'utf8').toString('base64');
    const spaced = `-----BEGIN CERTIFICATE-----\r\n  ${b64.slice(0, 8)}\r\n ${b64.slice(8)} \r\n-----END CERTIFICATE-----`;
    expect(fingerprintPemCert(spaced)).toBe(sha256Of('astram-tls-wrapped'));
  });

  it('fingerprints the FIRST block when several are present', () => {
    const pem = pemFor('first-cert') + pemFor('second-cert');
    expect(fingerprintPemCert(pem)).toBe(sha256Of('first-cert'));
  });

  it('is deterministic on garbage base64 (sha256 of whatever decodes)', () => {
    const garbage = '!!!!not-valid-base64!!!!';
    const pem = `-----BEGIN CERTIFICATE-----\n${garbage}\n-----END CERTIFICATE-----`;
    const expected = createHash('sha256').update(Buffer.from(garbage, 'base64')).digest('hex');
    expect(fingerprintPemCert(pem)).toBe(expected);
  });

  it('throws on missing PEM markers', () => {
    expect(() => fingerprintPemCert('hello world')).toThrowError('no PEM certificate block');
    expect(() => fingerprintPemCert('')).toThrowError('no PEM certificate block');
  });
});

describe('buildHardenedCaBundle', () => {
  it('removes exactly the revoked middle cert; survivors keep order and whitespace', () => {
    const a = pemFor('unit-cert-a');
    const b = pemFor('unit-cert-b');
    const c = pemFor('unit-cert-c');
    const { pem, removed } = buildHardenedCaBundle(a + b + c, [sha256Of('unit-cert-b')]);
    expect(removed).toBe(1);
    expect(pem).toBe(a + c); // order and whitespace of survivors preserved exactly
  });

  it('removes multiple revoked blocks and keeps non-block content verbatim', () => {
    const a = pemFor('keep-one');
    const b = pemFor('drop-me');
    const c = pemFor('keep-two');
    const { pem, removed } = buildHardenedCaBundle(`# comment\n${a}${b}${c}\n`, [
      sha256Of('drop-me'),
      sha256Of('not-present'),
    ]);
    expect(removed).toBe(1);
    expect(pem).toBe(`# comment\n${a}${c}\n`);
  });

  it('empty input yields empty output', () => {
    expect(buildHardenedCaBundle('', [...REVOKED_EMUDHRA_FINGERPRINTS])).toEqual({ pem: '', removed: 0 });
  });

  it('no matches keeps the bundle verbatim', () => {
    const bundle = pemFor('all-clean');
    expect(buildHardenedCaBundle(bundle, [sha256Of('other')])).toEqual({ pem: bundle, removed: 0 });
  });
});

describe('probeWindowsTlsTruststores — injected context', () => {
  it('flags a mock runtime whose bundle still contains the revoked cert', async () => {
    const revokedPem = pemFor('astram-tls-unit-revoked');
    const cleanPem = pemFor('astram-tls-unit-clean');
    const results = await probeWindowsTlsTruststores({
      runtimes: [
        { name: 'mock-curl', certBundlePem: revokedPem + cleanPem },
        { name: 'mock-node', nodeRootCertsPem: cleanPem },
      ],
      revokedFingerprints: [sha256Of('astram-tls-unit-revoked')],
    });
    expect(results).toHaveLength(2);

    const mockCurl = results.find((r) => r.runtime === 'mock-curl');
    expect(mockCurl).toBeDefined();
    expect(mockCurl!.trustsRevokedEmudhra).toBe(true);
    expect(mockCurl!.evidence.length).toBeGreaterThan(0);
    expect(mockCurl!.evidence).toContain('revoked');

    const mockNode = results.find((r) => r.runtime === 'mock-node');
    expect(mockNode).toBeDefined();
    expect(mockNode!.trustsRevokedEmudhra).toBe(false);
    expect(mockNode!.evidence.length).toBeGreaterThan(0);
  });

  it('honors extra.versionInfo and defaults the revoked list to the published constants', async () => {
    const results = await probeWindowsTlsTruststores({
      runtimes: [{ name: 'mock-pip', certBundlePem: pemFor('totally-unrelated'), extra: { versionInfo: 'pip 24.0' } }],
    });
    const r = results[0]!;
    expect(r.versionInfo).toBe('pip 24.0');
    expect(r.trustsRevokedEmudhra).toBe(false);
  });

  it('runtime without certificate data reports no certificate data, never throws', async () => {
    const results = await probeWindowsTlsTruststores({ runtimes: [{ name: 'mock-bare' }] });
    expect(results[0]!.trustsRevokedEmudhra).toBe(false);
    expect(results[0]!.evidence).toBe('no certificate data provided for injected runtime');
  });
});

describe('probeWindowsTlsTruststores — default mode (real machine, read-only)', () => {
  it('must not throw; every result is well-formed (whatever is installed)', async () => {
    const results = await probeWindowsTlsTruststores();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(typeof r.runtime).toBe('string');
      expect(r.runtime.length).toBeGreaterThan(0);
      expect(typeof r.trustsRevokedEmudhra).toBe('boolean');
      expect(typeof r.evidence).toBe('string');
      expect(r.evidence.length).toBeGreaterThan(0);
    }
    // node runtime is always probeable (tls.rootCertificates is in-process)
    const node = results.find((r) => r.runtime === 'node');
    expect(node).toBeDefined();
    expect(node!.versionInfo).toBe(process.version);
    expect(node!.evidence).toContain('tls.rootCertificates');
  });
});

describe('tlsFactsFromResults / probeBoardingItems — shape', () => {
  const results = [
    { runtime: 'mock-curl', versionInfo: 'curl 8.x', trustsRevokedEmudhra: true, evidence: 'bundle contains revoked cert' },
    { runtime: 'mock-node', trustsRevokedEmudhra: false, evidence: 'inspected 1 certificate(s); revoked eMudhra fingerprint matches: none' },
    { runtime: 'mock-uv', trustsRevokedEmudhra: false, evidence: 'runtime not present' },
  ];

  it('tlsFactsFromResults: HOLD for revoked trust, PASS for verified clean, WARN for unverifiable', () => {
    const facts = tlsFactsFromResults(results);
    expect(facts).toHaveLength(3);
    expect(facts.every((f) => f.ruleId === 'TLS_REVOKED_CA_TRUSTED')).toBe(true);
    expect(facts.every((f) => f.category === 'NET_EGRESS')).toBe(true);
    expect(facts.every((f) => f.line === 1)).toBe(true);
    const hold = facts.find((f) => f.file === 'tls:mock-curl')!;
    expect(hold.deterministicRisk).toBe(RiskLevel.HOLD);
    const pass = facts.find((f) => f.file === 'tls:mock-node')!;
    expect(pass.deterministicRisk).toBe(RiskLevel.PASS);
    const warn = facts.find((f) => f.file === 'tls:mock-uv')!;
    expect(warn.deterministicRisk).toBe(RiskLevel.WARN);
  });

  it('probeBoardingItems: TLS_TRUSTSTORE items with stable ids and HOLD for revoked trust', () => {
    const items = probeBoardingItems(results);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.category).toBe('TLS_TRUSTSTORE');
      expect(item.astFactsJson).toBe('[]');
      expect(item.ed25519Sig).toBeNull();
      expect(item.jevApiAdjustment).toBe(0);
      expect(typeof item.updatedAtMs).toBe('number');
      expect(item.evidenceSummary.length).toBeGreaterThan(0);
    }
    const revoked = items.find((i) => i.itemId === 'tls:mock-curl')!;
    expect(revoked.targetName).toBe('Windows mock-curl truststore');
    expect(revoked.deterministicStatus).toBe('HOLD');
    expect(revoked.finalStatus).toBe('HOLD');
    const clean = items.find((i) => i.itemId === 'tls:mock-node')!;
    expect(clean.finalStatus).toBe('PASS');
    const missing = items.find((i) => i.itemId === 'tls:mock-uv')!;
    expect(missing.finalStatus).toBe('WARN');
  });
});
