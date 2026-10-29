/**
 * Deterministic offline heal-candidate generators (Handbook §6.5 step 2/3,
 * docs/CONTRACTS.md §9). Pure functions over in-memory file content — no fs,
 * no network, no git. One candidate per vulnerable file + detected sink kind:
 *
 *  - Ruby (`Regexp.new/compile/union` on a non-literal first arg):
 *      wrap the arg in `Regexp.escape(...)` (CVE-2026-110264 shape).
 *  - Node brotli (`zlib.createBrotliDecompress()` zero-arg pipelines):
 *      size-capped decompress call + an `isSafePayload` comment-guard wrapper
 *      inserted after the zlib require (CVE-2026-111497 decompression-bomb shape).
 *  - Python `.pth` startup hooks: neutralize by prefixing every executable
 *      line with '#' (imports stay present but commented — a .pth import line
 *      IS executed at interpreter startup, so it must be commented too).
 */
import type { HealCandidate, HealPatchOp } from './types.js';

// ---------------------------------------------------------------------------
// Literal find/replace application (the verifier decides fitness, not us)
// ---------------------------------------------------------------------------

/**
 * Applies patch ops left-to-right with LITERAL first-occurrence replacement.
 * The function form of String.replace is used so `$&`/`$1` sequences inside a
 * (possibly Jev-generated) replacement text can never reinterpret the patch.
 * Returns ok:false (content untouched) when any `find` anchor is missing.
 */
export function applyPatch(
  content: string,
  ops: { find: string; replace: string }[]
): { ok: boolean; content: string } {
  let out = content;
  for (const op of ops) {
    if (op.find === '' || !out.includes(op.find)) return { ok: false, content };
    out = out.replace(op.find, () => op.replace);
  }
  return { ok: true, content: out };
}

// ---------------------------------------------------------------------------
// Ruby: Regexp.new / compile / union on non-literal input
// ---------------------------------------------------------------------------

const RUBY_CALL_RE = /Regexp\.(new|compile|union)\s*\(/g;

/** Literal string (or symbol / numeric / already-escaped) args are safe. */
function isRubyLiteralArg(arg: string): boolean {
  const t = arg.trim();
  return (
    t === '' ||
    t.startsWith("'") ||
    t.startsWith('"') ||
    t.startsWith('Regexp.escape') ||
    t.startsWith(':') ||
    /^\d/.test(t)
  );
}

/**
 * Extracts each `Regexp.<fn>( ... )` call: the exact call text (find anchor),
 * its first argument, and any `, rest` tail. Paren depth counting skips
 * string literals so `Regexp.new("(")` cannot desynchronize the scan.
 */
function extractRubyRegexpCalls(content: string): { find: string; firstArg: string; rest: string }[] {
  const out: { find: string; firstArg: string; rest: string }[] = [];
  RUBY_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUBY_CALL_RE.exec(content)) !== null) {
    const openIdx = m.index + m[0].length - 1; // index of '('
    let depth = 0;
    let inStr: string | null = null;
    let closeIdx = -1;
    for (let i = openIdx; i < content.length; i++) {
      const ch = content[i];
      if (inStr !== null) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        inStr = ch;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx < 0) continue; // unbalanced — skip rather than guess
    const inner = content.slice(openIdx + 1, closeIdx);

    // Split the first argument at the top-level comma (nesting- and string-aware).
    let nest = 0;
    let str: string | null = null;
    let cut = -1;
    for (let j = 0; j < inner.length; j++) {
      const ch = inner[j];
      if (str !== null) {
        if (ch === '\\') {
          j++;
          continue;
        }
        if (ch === str) str = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        str = ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') nest++;
      else if (ch === ')' || ch === ']' || ch === '}') nest--;
      else if (ch === ',' && nest === 0) {
        cut = j;
        break;
      }
    }
    const firstArg = (cut >= 0 ? inner.slice(0, cut) : inner).trim();
    const rest = cut >= 0 ? inner.slice(cut) : '';
    out.push({ find: m[0] + inner + ')', firstArg, rest });
  }
  return out;
}

function rubyEscapeCandidates(path: string, content: string): HealPatchOp[] | null {
  const ops: HealPatchOp[] = [];
  for (const call of extractRubyRegexpCalls(content)) {
    if (isRubyLiteralArg(call.firstArg)) continue;
    // The guarded call keeps its original function name and argument list,
    // with the untrusted first arg wrapped: Regexp.compile(Regexp.escape(x), rest)
    const head = call.find.slice(0, call.find.indexOf('(') + 1); // 'Regexp.compile('
    ops.push({
      file: path,
      find: call.find,
      replace: `${head}Regexp.escape(${call.firstArg})${call.rest})`,
    });
  }
  return ops.length > 0 ? ops : null;
}

// ---------------------------------------------------------------------------
// Node brotli: unguarded createBrotliDecompress() pipelines
// ---------------------------------------------------------------------------

const BROTLI_INPUT_CAP = 1_048_576; // 1 MiB — decompression input cap

const BROTLI_GUARD_SNIPPET = [
  '// astram-canary: brotli decompression-bomb guard — gate every payload',
  '// before it enters the decompress pipeline. Reject non-Buffers and inputs',
  '// above the size cap; combine with maxOutputLength on the stream itself.',
  `const ASTRAM_MAX_BROTLI_INPUT = ${BROTLI_INPUT_CAP};`,
  'function isSafePayload(chunk) {',
  '  return Buffer.isBuffer(chunk) && chunk.length <= ASTRAM_MAX_BROTLI_INPUT;',
  '}',
].join('\n');

function brotliGuardCandidates(path: string, content: string): HealPatchOp[] | null {
  if (!/createBrotliDecompress\s*\(\s*\)/.test(content)) return null;
  const ops: HealPatchOp[] = [
    {
      file: path,
      find: 'createBrotliDecompress()',
      replace:
        'createBrotliDecompress({ maxOutputLength: 1048576 }) /* astram-canary: size-capped brotli guard (pair with isSafePayload input gate) */',
    },
  ];
  // Insert the isSafePayload helper right after the zlib require when present.
  const req = content.match(
    /(?:const|var|let)\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*['"](?:node:)?zlib['"]\s*\)\s*;?/
  );
  if (req) {
    ops.push({ file: path, find: req[0], replace: `${req[0]}\n\n${BROTLI_GUARD_SNIPPET}` });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Python .pth: startup code execution
// ---------------------------------------------------------------------------

function pthNeutralizeCandidates(path: string, content: string): HealPatchOp[] | null {
  let hasCode = false;
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (t !== '' && !t.startsWith('#')) {
      hasCode = true;
      break;
    }
  }
  if (!hasCode) return null;
  const neutralized = content.replace(/[^\r\n]+/g, (line) => {
    const t = line.trim();
    return t === '' || t.startsWith('#') ? line : `#${line}`;
  });
  return [{ file: path, find: content, replace: neutralized }];
}

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

/**
 * Pure, deterministic candidates for the given vulnerable files. Candidate
 * ids are sequential and stable for a given input order (det-1, det-2, ...).
 */
export function generateDeterministicCandidates(
  vulnerableFiles: { path: string; content: string }[]
): HealCandidate[] {
  const candidates: HealCandidate[] = [];
  for (const vf of vulnerableFiles) {
    const lower = vf.path.toLowerCase();
    const push = (kind: string, ops: HealPatchOp[] | null): void => {
      if (!ops) return;
      candidates.push({
        id: `det-${candidates.length + 1}`,
        description: `deterministic ${kind} heal for ${vf.path}`,
        patch: ops,
        source: 'deterministic',
      });
    };

    if (lower.endsWith('.pth')) {
      push('.pth startup-hook neutralization', pthNeutralizeCandidates(vf.path, vf.content));
      continue;
    }
    if (lower.endsWith('.rb') || /Regexp\.(new|compile|union)\s*\(/.test(vf.content)) {
      push('ruby Regexp.escape', rubyEscapeCandidates(vf.path, vf.content));
    }
    if (
      /\.(js|mjs|cjs|jsx|ts)$/.test(lower) ||
      /createBrotliDecompress\s*\(/.test(vf.content)
    ) {
      push('brotli max-size guard', brotliGuardCandidates(vf.path, vf.content));
    }
  }
  return candidates;
}
