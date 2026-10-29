/**
 * TEST-04 — eMudhra (emSign / AAA) split TLS truststore probe (Tier 2 — ACTIVE).
 *
 * docs/CONTRACTS.md §10: a mock "revoked eMudhra intermediate" PEM with a
 * deterministic base64 payload is generated AT TEST TIME (no certs are
 * committed — see fixtures/README.md). fingerprintPemCert derives its sha-256;
 * probeWindowsTlsTruststores with an injected context (runtime 'mock-curl'
 * whose certBundlePem still contains the revoked cert) must report
 * trustsRevokedEmudhra true → boarding TLS_TRUSTSTORE HOLD;
 * buildHardenedCaBundle must remove exactly that one cert.
 */
import { createHash } from 'node:crypto';
import { RiskLevel } from '@astram/types';
import {
  buildHardenedCaBundle,
  fingerprintPemCert,
  probeBoardingItems,
  probeWindowsTlsTruststores,
  tlsFactsFromResults,
} from '@astram/gatekeeper';
import { describe, expect, it } from 'vitest';

/** Deterministic mock cert PEM (CERTIFICATE block, base64 of a fixed payload). */
function mockCertPem(payload: string): string {
  const der = Buffer.from(payload, 'utf8');
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

const REVOKED_PAYLOAD = 'astram-mock-revoked-emudhra-intermediate-v1';

function mockRevokedCertPem(): string {
  return mockCertPem(REVOKED_PAYLOAD);
}

function revokedFingerprint(): string {
  return createHash('sha256').update(Buffer.from(REVOKED_PAYLOAD, 'utf8')).digest('hex');
}

describe('TEST-04 eMudhra split TLS truststore probe', () => {
  it('fingerprintPemCert returns the sha256 of the DER payload', () => {
    const pem = mockRevokedCertPem();
    expect(fingerprintPemCert(pem)).toBe(revokedFingerprint());
  });

  it('probe with an injected context flags the mock runtime as trusting the revoked cert', async () => {
    const pem = mockRevokedCertPem();
    const results = await probeWindowsTlsTruststores({
      runtimes: [{ name: 'mock-curl', certBundlePem: pem }],
      revokedFingerprints: [revokedFingerprint()],
    });
    const mock = results.find((r) => r.runtime === 'mock-curl');
    expect(mock).toBeDefined();
    expect(mock?.trustsRevokedEmudhra).toBe(true);
    expect(mock?.evidence.length).toBeGreaterThan(0);
  });

  it('buildHardenedCaBundle removes exactly the revoked cert', () => {
    // NOTE (reality fix): the original placeholder built the keeper PEM with
    // `.replace('revoked-emudhra', 'healthy-ca')` — impossible inside base64
    // (hyphens are not in the base64 alphabet), so keeper === revoked and both
    // would be removed. Distinct payloads instead; assertion spirit unchanged.
    const revoked = mockRevokedCertPem();
    const keeper = mockCertPem('astram-mock-healthy-ca-intermediate-v1');
    const bundle = revoked + keeper;
    const { pem, removed } = buildHardenedCaBundle(bundle, [revokedFingerprint()]);
    expect(removed).toBe(1);
    expect(pem).not.toContain(Buffer.from(REVOKED_PAYLOAD, 'utf8').toString('base64'));
    expect(pem).toBe(keeper); // survivors verbatim
  });

  it('a revoked truststore yields a TLS_TRUSTSTORE HOLD boarding item and a HOLD fact', async () => {
    const pem = mockRevokedCertPem();
    const results = await probeWindowsTlsTruststores({
      runtimes: [{ name: 'mock-curl', certBundlePem: pem }],
      revokedFingerprints: [revokedFingerprint()],
    });

    const items = probeBoardingItems(results);
    const item = items.find((i) => i.itemId === 'tls:mock-curl');
    expect(item).toBeDefined();
    expect(item?.category).toBe('TLS_TRUSTSTORE');
    expect(item?.targetName).toBe('Windows mock-curl truststore');
    expect(item?.deterministicStatus).toBe('HOLD');
    expect(item?.finalStatus).toBe('HOLD');
    expect(item?.astFactsJson).toBe('[]');
    expect(item?.ed25519Sig).toBeNull();
    expect(item?.jevApiAdjustment).toBe(0);

    const facts = tlsFactsFromResults(results);
    expect(facts.some((f) => f.ruleId === 'TLS_REVOKED_CA_TRUSTED' && f.deterministicRisk === RiskLevel.HOLD)).toBe(
      true
    );
  });
});
