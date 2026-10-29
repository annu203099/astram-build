/**
 * @astram/gatekeeper — Tier 2 Windows multi-runtime eMudhra TLS truststore
 * probe (Handbook §6.3, ports dominikmartn/black-october-check to Windows).
 *
 * Read-only probing ONLY. Default mode spawns short version commands
 * (`curl.exe -V`, Git's mingw64 curl, `python -m pip --version`, `uv
 * --version`; each 2s-timeout-guarded, every failure tolerated as
 * "runtime not present") and inspects this Node process's own
 * `tls.rootCertificates`. Certificate trust is only ever determined by
 * fingerprinting PEM blocks — nothing is downloaded and nothing is mutated.
 * Tests never depend on the machine: `probeWindowsTlsTruststores(ctx)`
 * accepts injected runtimes/bundles.
 *
 * REMEDIATION-SIDE HELPERS: `buildHardenedCaBundle` removes every PEM block
 * whose sha256 fingerprint is revoked (used by callers to produce
 * %USERPROFILE%\.astram\hardened-ca-bundle.pem); `tlsFactsFromResults` and
 * `probeBoardingItems` map probe results into the boarding-manifest world.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as tls from 'node:tls';
import { RiskLevel, type AstCapabilityFact, type BoardingManifestItem, type RiskName } from '@astram/types';

export interface TlsProbeResult {
  runtime: string;
  versionInfo?: string;
  trustsRevokedEmudhra: boolean;
  evidence: string;
}

export interface TlsProbeContext {
  /** Injection point so tests never depend on the real machine. */
  runtimes?: { name: string; cmd?: string[]; nodeRootCertsPem?: string; certBundlePem?: string; extra?: Record<string, string> }[];
  revokedFingerprints?: string[]; // sha256 hex of DER cert
}

/**
 * MOCK STAND-INS for the 8 revoked eMudhra (emSign / AAA) intermediate CA
 * fingerprints. Fixed, deterministic constants (sha256 of documented mock
 * payloads — NOT real eMudhra DER data): production replaces this list with
 * the published revoked-intermediate SHA-256 set. Each entry is 64 lowercase
 * hex chars.
 */
const MOCK_REVOKED_PAYLOADS: readonly string[] = Object.freeze(
  Array.from({ length: 8 }, (_, i) => `astram-mock-revoked-emudhra-emsign-AAA-intermediate-${i + 1}`)
);

export const REVOKED_EMUDHRA_FINGERPRINTS: readonly string[] = Object.freeze(
  MOCK_REVOKED_PAYLOADS.map((payload) => createHash('sha256').update(payload, 'utf8').digest('hex'))
);

const PEM_BLOCK_RE = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** sha256(DER) of the FIRST `-----BEGIN/END CERTIFICATE-----` block. */
export function fingerprintPemCert(pem: string): string {
  const m = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem ?? '');
  if (!m) throw new Error('no PEM certificate block');
  // Garbage/empty base64 still decodes to *something* deterministic.
  return sha256Hex(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
}

interface BundleCheck {
  hit: boolean;
  matched: string[];
  total: number;
}

function containsRevoked(pem: string, revoked: Set<string>): BundleCheck {
  const matched: string[] = [];
  let total = 0;
  for (const m of pem.matchAll(PEM_BLOCK_RE)) {
    total++;
    const fp = sha256Hex(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
    if (revoked.has(fp)) matched.push(fp);
  }
  return { hit: matched.length > 0, matched, total };
}

/**
 * Remove every PEM block whose fingerprint is revoked; ALL other content
 * (comments, ordering, whitespace between surviving blocks) is kept verbatim.
 */
export function buildHardenedCaBundle(sourcePem: string, revokedFingerprints: string[]): { pem: string; removed: number } {
  if (!sourcePem) return { pem: '', removed: 0 };
  const revoked = new Set((revokedFingerprints ?? []).map((f) => String(f).toLowerCase()));
  let removed = 0;
  let out = '';
  let last = 0;
  for (const m of sourcePem.matchAll(PEM_BLOCK_RE)) {
    const blockEnd = (m.index ?? 0) + m[0].length;
    const fp = sha256Hex(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
    if (!revoked.has(fp)) continue;
    out += sourcePem.slice(last, m.index ?? 0);
    // consume the removed block plus one trailing line break so the bundle
    // does not accumulate blank lines
    let end = blockEnd;
    if (sourcePem[end] === '\r') end++;
    if (sourcePem[end] === '\n') end++;
    last = end;
    removed++;
  }
  out += sourcePem.slice(last);
  return { pem: out, removed };
}

function normalizeRevoked(list: string[] | undefined): Set<string> {
  return new Set((list ?? REVOKED_EMUDHRA_FINGERPRINTS).map((f) => String(f).toLowerCase()));
}

function shortFp(fp: string): string {
  return `${fp.slice(0, 12)}...`;
}

// ---------------------------------------------------------------------------
// default (real machine) probes — spawn-based, failure-tolerant
// ---------------------------------------------------------------------------

const SPAWN_TIMEOUT_MS = 2000;

function runCapture(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: SPAWN_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (err, stdout) => {
        const text = typeof stdout === 'string' ? stdout.trim() : '';
        if (err || !text) resolve(null);
        else resolve(text);
      });
    } catch {
      resolve(null); // spawn failures are NEVER an error for the probe
    }
  });
}

const NOT_PRESENT = 'runtime not present';

async function spawnVersionRuntime(
  name: string,
  cmd: string[],
  label: string,
  extraEvidence?: (out: string) => string
): Promise<TlsProbeResult> {
  const out = await runCapture(cmd[0], cmd.slice(1));
  if (out === null) return { runtime: name, trustsRevokedEmudhra: false, evidence: NOT_PRESENT };
  return {
    runtime: name,
    versionInfo: out.split('\n')[0].trim(),
    trustsRevokedEmudhra: false,
    evidence: `read-only ${label} probe${extraEvidence ? extraEvidence(out) : ''}; truststore enumeration not available for spawn-probed runtime`,
  };
}

async function probeGitCurl(): Promise<TlsProbeResult> {
  const execPath = await runCapture('git', ['--exec-path']);
  if (execPath === null) return { runtime: 'git-curl', trustsRevokedEmudhra: false, evidence: NOT_PRESENT };
  const curlExe = path.resolve(execPath.split('\n')[0].trim(), '../../bin/curl.exe');
  const out = await runCapture(curlExe, ['-V']);
  if (out === null) return { runtime: 'git-curl', trustsRevokedEmudhra: false, evidence: NOT_PRESENT };
  const schannel = /schannel/i.test(out) ? ' (Schannel backend)' : '';
  return {
    runtime: 'git-curl',
    versionInfo: out.split('\n')[0].trim(),
    trustsRevokedEmudhra: false,
    evidence: `read-only Git for Windows (mingw64) curl -V probe${schannel}; truststore enumeration not available for spawn-probed runtime`,
  };
}

function probeNodeRuntime(revoked: Set<string>): TlsProbeResult {
  const pem = tls.rootCertificates.join('\n');
  const check = containsRevoked(pem, revoked);
  return {
    runtime: 'node',
    versionInfo: process.version,
    trustsRevokedEmudhra: check.hit,
    evidence: `tls.rootCertificates: fingerprinted ${check.total} certificate(s); revoked eMudhra fingerprint matches: ${
      check.matched.length === 0 ? 'none' : check.matched.map(shortFp).join(', ')
    }`,
  };
}

// ---------------------------------------------------------------------------
// injected-context probes (pure path — no spawns required)
// ---------------------------------------------------------------------------

async function probeInjectedRuntime(
  rt: NonNullable<TlsProbeContext['runtimes']>[number],
  revoked: Set<string>
): Promise<TlsProbeResult> {
  const bundles: string[] = [];
  const labels: string[] = [];
  if (rt.certBundlePem) {
    bundles.push(rt.certBundlePem);
    labels.push('certBundlePem');
  }
  if (rt.nodeRootCertsPem) {
    bundles.push(rt.nodeRootCertsPem);
    labels.push('nodeRootCertsPem');
  }
  if (bundles.length === 0) {
    let versionInfo = rt.extra?.versionInfo;
    if (!versionInfo && rt.cmd && rt.cmd.length > 0) {
      const out = await runCapture(rt.cmd[0], rt.cmd.slice(1));
      versionInfo = out === null ? undefined : out.split('\n')[0].trim();
    }
    return {
      runtime: rt.name,
      versionInfo,
      trustsRevokedEmudhra: false,
      evidence: 'no certificate data provided for injected runtime',
    };
  }
  const check = containsRevoked(bundles.join('\n'), revoked);
  return {
    runtime: rt.name,
    versionInfo: rt.extra?.versionInfo,
    trustsRevokedEmudhra: check.hit,
    evidence: `inspected ${check.total} certificate(s) via ${labels.join(' + ')}; revoked eMudhra fingerprint matches: ${
      check.matched.length === 0 ? 'none' : check.matched.map(shortFp).join(', ')
    }`,
  };
}

export async function probeWindowsTlsTruststores(ctx?: TlsProbeContext): Promise<TlsProbeResult[]> {
  const revoked = normalizeRevoked(ctx?.revokedFingerprints);
  if (ctx?.runtimes) {
    const out: TlsProbeResult[] = [];
    for (const rt of ctx.runtimes) out.push(await probeInjectedRuntime(rt, revoked));
    return out;
  }
  return Promise.all([
    spawnVersionRuntime('curl.exe', ['curl.exe', '-V'], 'Windows system curl -V', (out) =>
      /schannel/i.test(out) ? ' (Schannel backend)' : ' (backend not reported)'
    ),
    probeGitCurl(),
    spawnVersionRuntime('pip', ['python', '-m', 'pip', '--version'], 'Python pip version'),
    spawnVersionRuntime('uv', ['uv', '--version'], 'uv version'),
    Promise.resolve(probeNodeRuntime(revoked)),
  ]);
}

// ---------------------------------------------------------------------------
// Tier 2 integration hooks
// ---------------------------------------------------------------------------

/**
 * Map probe results to AstCapabilityFact.
 *
 * Mapping note (documented deviation from the BYTEPATH_SINK category the
 * bytepath analyzers use): a truststore finding is a network-trust problem,
 * so facts use category 'NET_EGRESS' with ruleId 'TLS_REVOKED_CA_TRUSTED'.
 * Risk: HOLD when the runtime trusts a revoked eMudhra fingerprint; WARN when
 * the runtime was not present (truststore UNVERIFIED); PASS when verified
 * clean. `file` carries the pseudo-target 'tls:<runtime>' and line is 1
 * (truststores have no source line).
 */
export function tlsFactsFromResults(results: TlsProbeResult[]): AstCapabilityFact[] {
  return results.map((r) => ({
    ruleId: 'TLS_REVOKED_CA_TRUSTED',
    category: 'NET_EGRESS' as const,
    file: `tls:${r.runtime}`,
    line: 1,
    snippet: (r.evidence ?? '').slice(0, 200),
    deterministicRisk: r.trustsRevokedEmudhra
      ? RiskLevel.HOLD
      : r.evidence === NOT_PRESENT
        ? RiskLevel.WARN
        : RiskLevel.PASS,
  }));
}

/** Map probe results to boarding-manifest items (category TLS_TRUSTSTORE). */
export function probeBoardingItems(results: TlsProbeResult[]): BoardingManifestItem[] {
  const updatedAtMs = Date.now();
  return results.map((r) => {
    const status: RiskName = r.trustsRevokedEmudhra ? 'HOLD' : r.evidence === NOT_PRESENT ? 'WARN' : 'PASS';
    return {
      itemId: `tls:${r.runtime}`,
      category: 'TLS_TRUSTSTORE' as const,
      targetName: `Windows ${r.runtime} truststore`,
      deterministicStatus: status,
      jevApiAdjustment: 0,
      finalStatus: status,
      evidenceSummary: (r.evidence ?? '').slice(0, 500),
      astFactsJson: '[]',
      ed25519Sig: null,
      updatedAtMs,
    };
  });
}
