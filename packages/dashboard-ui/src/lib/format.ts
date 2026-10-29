/** Small formatting helpers (pure, dependency-free). */

/** `RiskLevel` numeric -> name ('PASS' | 'WARN' | 'HOLD'), mirroring @astram/types. */
export const RISK_NAMES = ['PASS', 'WARN', 'HOLD'] as const;

export function riskName(level: number): string {
  return RISK_NAMES[level] ?? 'PASS';
}

/** Compact relative time: 'just now', '37s ago', '5m ago', '3h ago', '2d ago'. */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 5_000) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Local wall-clock HH:MM:SS for the live feed. */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

/** Signed delta label: +1 / 0 / -1. */
export function deltaLabel(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

/** Pretty-print a JSON string field; falls back to the raw text if unparseable. */
export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw || '—';
  }
}

/** Safe JSON.parse of a string[] field. */
export function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
