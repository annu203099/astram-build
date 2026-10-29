/**
 * @astram/gatekeeper — Tier 2 dynamic byte-path taint analyzer (Handbook §6.2).
 *
 * Regex / lightweight-AST hybrid. Every exported function is PURE and fast:
 * no execution, no filesystem, no network, no spawns. Attack classes covered:
 *
 *   BROTLI             Node.js zlib brotli decompression RCE sink
 *                      (CVE-2026-111497): req / socket 'message' frame /
 *                      BullMQ job payload / process.stdin flowing into
 *                      zlib.createBrotliDecompress / brotliDecompress(Sync),
 *                      directly as an argument or via .pipe().
 *   RUBY_REGEXP        non-literal first argument reaching Regexp.new /
 *                      Regexp.compile / Regexp.union (CVE-2026-110264).
 *                      Regexp.timeout does NOT suppress (compiler overflow
 *                      happens pre-timeout) — its presence is only recorded.
 *   PTH_STARTUP        .pth-style content executing dangerous calls at
 *                      interpreter import time (LiteLLM 1.107.0 shape).
 *   CRED_EXFIL_BYTEPATH one-file multi-step chain: env / .env read taints an
 *                      identifier, a later egress call passes it (or an
 *                      f-string containing it) to urlopen / requests /
 *                      socket.create_connection / httpx — joined as ONE sink.
 *   PHP_SESSION        session.upload_progress.enabled=1 COMBINED WITH a
 *                      session.serialize_handler transition to a non-default
 *                      handler or variable (CVE-2026-109618/109619/115560).
 *
 * taintFactsFromSinks maps sinks to AstCapabilityFact (BYTEPATH_SINK category,
 * ruleId BYTEPATH_<KIND>, HOLD for everything except PHP_SESSION=WARN).
 */
import { parse } from 'acorn';
import { RiskLevel, type AstCapabilityFact } from '@astram/types';
import { snippetFor } from './util.js';

export type BytePathSinkKind =
  | 'BROTLI'
  | 'RUBY_REGEXP'
  | 'PTH_STARTUP'
  | 'PHP_SESSION'
  | 'CRED_EXFIL_BYTEPATH';

export interface TaintSink {
  kind: BytePathSinkKind;
  file: string;
  line: number; // 1-based
  snippet: string; // <= 200 chars
  source: string; // 'HTTP_REQUEST' | 'WEBSOCKET_FRAME' | 'WORKER_PAYLOAD' | 'STDIN' | 'USER_INPUT' | 'IMPORT_TIME' | 'ENV_OR_FILE' | 'INI'
  detail: string;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

interface SinkCtx {
  file: string;
  lines: string[];
  sinks: TaintSink[];
  seen: Set<string>;
}

function emit(ctx: SinkCtx, kind: BytePathSinkKind, line: number, source: string, detail: string): void {
  const key = `${kind}|${ctx.file}|${line}|${source}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.sinks.push({ kind, file: ctx.file, line, snippet: snippetFor(ctx.lines, line), source, detail });
}

// ---------------------------------------------------------------------------
// analyzeBytePathJs — source -> zlib brotli sink (acorn AST, scope-chain lite)
// ---------------------------------------------------------------------------

type AnyNode = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

const BROTLI_SINK_CALLS = new Set(['createBrotliDecompress', 'brotliDecompress', 'brotliDecompressSync']);
const DECOMPRESSOR_FACTORY = 'createBrotliDecompress';
const HTTP_PARAM_NAMES = new Set(['req', 'request']);
const EVENT_REG_PROPS = new Set(['on', 'once', 'addEventListener']);
const WORKER_OBJECT_NAMES = new Set(['job']);
const WORKER_PAYLOAD_PROPS = new Set(['data', 'payload']);

interface EnvEntry {
  taint: string | null; // 'HTTP_REQUEST' | 'WEBSOCKET_FRAME' | ... when tainted
  decompressorLine: number | null; // set when the var holds a brotli decompress stream
}

/** Lexical-scope chain, lite: one Map per function/program scope. */
class Env {
  private readonly vars = new Map<string, EnvEntry>();
  constructor(private readonly parent: Env | null) {}
  lookup(name: string): EnvEntry | null {
    let e: Env | null = this;
    while (e) {
      const v = e.vars.get(name);
      if (v) return v;
      e = e.parent;
    }
    return null;
  }
  set(name: string, entry: EnvEntry): void {
    this.vars.set(name, entry);
  }
}

function parseMaybeJs(code: string): AnyNode | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return parse(code, { ecmaVersion: 'latest', locations: true, sourceType, allowHashBang: true }) as unknown as AnyNode;
    } catch {
      // try the next sourceType
    }
  }
  return null;
}

function propertyNameOf(member: AnyNode): string | null {
  const prop = member.property as AnyNode | undefined;
  if (!prop) return null;
  if (prop.type === 'Identifier' && typeof prop.name === 'string') return prop.name;
  if (prop.type === 'Literal' && typeof prop.value === 'string') return prop.value;
  return null;
}

function calleeNameOf(callee: AnyNode | undefined): string | null {
  if (!callee) return null;
  if (callee.type === 'Identifier' && typeof callee.name === 'string') return callee.name;
  if (callee.type === 'MemberExpression') return propertyNameOf(callee);
  return null;
}

function isCall(node: AnyNode | undefined | null): node is AnyNode {
  return !!node && node.type === 'CallExpression';
}

function isDecompressorCreation(node: AnyNode | undefined | null): boolean {
  return isCall(node) && calleeNameOf(node.callee as AnyNode) === DECOMPRESSOR_FACTORY;
}

function isFuncNode(node: AnyNode | undefined): boolean {
  return !!node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration');
}

const META_KEYS = new Set(['type', 'loc', 'range', 'start', 'end']);

/** Taint source carried by an expression, or null when clean. */
function taintOfNode(node: AnyNode | undefined | null, env: Env): string | null {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return null;
  switch (node.type) {
    case 'Literal':
      return null;
    case 'Identifier': {
      if (typeof node.name !== 'string') return null;
      return env.lookup(node.name)?.taint ?? null;
    }
    case 'MemberExpression': {
      const obj = node.object as AnyNode | undefined;
      const prop = propertyNameOf(node);
      if (obj?.type === 'Identifier' && typeof obj.name === 'string' && prop) {
        if (WORKER_OBJECT_NAMES.has(obj.name) && WORKER_PAYLOAD_PROPS.has(prop)) return 'WORKER_PAYLOAD';
        if (obj.name === 'process' && prop === 'stdin') return 'STDIN';
      }
      return taintOfNode(obj, env);
    }
    case 'CallExpression': {
      // taint flows through the receiver (req.body.toString()) and through
      // call arguments (Buffer.from(data)) alike
      const viaCallee = taintOfNode(node.callee as AnyNode | undefined, env);
      if (viaCallee) return viaCallee;
      const args = (Array.isArray(node.arguments) ? node.arguments : []) as AnyNode[];
      for (const a of args) {
        const t = taintOfNode(a, env);
        if (t) return t;
      }
      return null;
    }
    default: {
      // TemplateLiteral / Binary / Conditional / Object / Array / Spread /
      // await: taint propagates if any CHILD expression is tainted.
      for (const key of Object.keys(node)) {
        if (META_KEYS.has(key)) continue;
        const t = taintScan((node as Record<string, unknown>)[key], env);
        if (t) return t;
      }
      return null;
    }
  }
}

/** Taint of an arbitrary raw child value (array / untyped record / AST node). */
function taintScan(v: unknown, env: Env): string | null {
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = taintScan(item, env);
      if (t) return t;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    const n = v as AnyNode;
    if (typeof n.type === 'string') return taintOfNode(n, env);
    for (const key of Object.keys(n)) {
      const t = taintScan((n as Record<string, unknown>)[key], env);
      if (t) return t;
    }
  }
  return null;
}

function registerBinding(name: string, init: AnyNode | undefined | null, env: Env): void {
  if (isDecompressorCreation(init)) {
    env.set(name, { taint: null, decompressorLine: init!.loc?.start.line ?? 0 });
    return;
  }
  env.set(name, { taint: init ? taintOfNode(init, env) : null, decompressorLine: null });
}

function walkFunction(fn: AnyNode, env: Env, ctx: SinkCtx, forcedFirstParamTaint: string | null): void {
  const child = new Env(env);
  const params = (Array.isArray(fn.params) ? fn.params : []) as AnyNode[];
  params.forEach((p, idx) => {
    if (p.type === 'Identifier' && typeof p.name === 'string') {
      let t: string | null = null;
      if (forcedFirstParamTaint && idx === 0) t = forcedFirstParamTaint;
      else if (HTTP_PARAM_NAMES.has(p.name)) t = 'HTTP_REQUEST'; // express/HTTP request handler param
      child.set(p.name, { taint: t, decompressorLine: null });
    }
    // destructured/default params: walked generically below for nested handlers
  });
  if (Array.isArray(fn.body)) {
    for (const stmt of fn.body) walk(stmt, child, ctx);
  } else {
    walk(fn.body as AnyNode | undefined, child, ctx);
  }
}

function walk(node: unknown, env: Env, ctx: SinkCtx): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, env, ctx);
    return;
  }
  const n = node as AnyNode;
  if (typeof n.type !== 'string') {
    for (const key of Object.keys(n)) walk((n as Record<string, unknown>)[key], env, ctx);
    return;
  }

  switch (n.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      walkFunction(n, env, ctx, null);
      return;

    case 'VariableDeclarator': {
      const init = n.init as AnyNode | undefined;
      walk(init, env, ctx);
      const id = n.id as AnyNode | undefined;
      if (id?.type === 'Identifier' && typeof id.name === 'string') {
        registerBinding(id.name, init, env);
      } else {
        walk(id, env, ctx);
      }
      return;
    }

    case 'AssignmentExpression': {
      const right = n.right as AnyNode | undefined;
      walk(right, env, ctx);
      const left = n.left as AnyNode | undefined;
      if (left?.type === 'Identifier' && typeof left.name === 'string') {
        registerBinding(left.name, right, env);
      } else {
        walk(left, env, ctx);
      }
      return;
    }

    case 'CallExpression': {
      const callee = n.callee as AnyNode | undefined;
      const args = (Array.isArray(n.arguments) ? n.arguments : []) as AnyNode[];
      const calleeName = calleeNameOf(callee);
      const line = n.loc?.start.line ?? 1;

      // WebSocket / socket frame source: <emitter>.on('message', (frame) => ...)
      if (callee?.type === 'MemberExpression' && calleeName && EVENT_REG_PROPS.has(calleeName)) {
        const evt = args[0];
        if (evt?.type === 'Literal' && typeof evt.value === 'string' && evt.value === 'message' && isFuncNode(args[1])) {
          walk(callee, env, ctx);
          walkFunction(args[1], env, ctx, 'WEBSOCKET_FRAME');
          for (let i = 2; i < args.length; i++) walk(args[i], env, ctx);
          return;
        }
      }

      // Direct-argument flow: <tainted> passed straight into a brotli call.
      if (calleeName && BROTLI_SINK_CALLS.has(calleeName)) {
        for (const a of args) {
          const t = taintOfNode(a, env);
          if (t) {
            const hasOptions =
              calleeName === DECOMPRESSOR_FACTORY
                ? args[0]?.type === 'ObjectExpression'
                : args.length >= 2 && args[1]?.type === 'ObjectExpression';
            const optsNote = hasOptions
              ? 'decompression options object present — Node brotli options expose no maxOutLength cap, so the flow still flags'
              : 'no options object passed';
            emit(
              ctx,
              'BROTLI',
              line,
              t,
              `${t} argument flows directly into ${calleeName}() (Node.js Brotli decompression sink, CVE-2026-111497 shape); ${optsNote}`
            );
            break;
          }
        }
      }

      // Pipe flow: <tainted>.pipe(<decompressor>) — target may be a variable
      // bound to createBrotliDecompress() in this or an enclosing scope, or an
      // inline createBrotliDecompress() call.
      if (callee?.type === 'MemberExpression' && calleeName === 'pipe') {
        const objTaint = taintOfNode(callee.object as AnyNode | undefined, env);
        const target = args[0];
        if (objTaint && target) {
          let decompressorLine: number | null = null;
          let label = '';
          if (target.type === 'Identifier' && typeof target.name === 'string') {
            const entry = env.lookup(target.name);
            decompressorLine = entry?.decompressorLine ?? null;
            label = `'${target.name}'`;
          } else if (isDecompressorCreation(target)) {
            decompressorLine = target.loc?.start.line ?? line;
            label = 'inline createBrotliDecompress()';
          }
          if (decompressorLine !== null) {
            emit(
              ctx,
              'BROTLI',
              line,
              objTaint,
              `${objTaint} stream piped via .pipe() into brotli decompressor stream ${label} (created at line ${decompressorLine}); Node brotli options expose no maxOutLength cap`
            );
          }
        }
      }

      walk(callee, env, ctx);
      for (const a of args) walk(a, env, ctx);
      return;
    }

    default: {
      for (const key of Object.keys(n)) {
        if (key === 'type' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        walk((n as Record<string, unknown>)[key], env, ctx);
      }
    }
  }
}

// Regex fallback for sources that do not parse (e.g. TS-flavored snippets).
const FALLBACK_SINK_CALL = /\b(?:zlib\s*\.\s*)?(?:createBrotliDecompress|brotliDecompress(?:Sync)?)\s*\(/;
const FALLBACK_SOURCE_HINTS: readonly [RegExp, string][] = [
  [/\b(?:req|request)\b/, 'HTTP_REQUEST'],
  [/job\s*\.\s*(?:data|payload)/, 'WORKER_PAYLOAD'],
  [/process\s*\.\s*stdin/, 'STDIN'],
  [/on\s*\(\s*['"]message['"]/, 'WEBSOCKET_FRAME'],
];

function analyzeBytePathJsFallback(code: string, file: string, lines: string[]): TaintSink[] {
  const sinks: TaintSink[] = [];
  const decompressorVars = new Set<string>();
  for (const line of lines) {
    const m = /(\w+)\s*=\s*[\w.]*\s*createBrotliDecompress\s*\(/.exec(line);
    if (m) decompressorVars.add(m[1]);
  }
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const hint = FALLBACK_SOURCE_HINTS.find(([re]) => re.test(line));
    if (!hint) return;
    if (FALLBACK_SINK_CALL.test(line)) {
      sinks.push({
        kind: 'BROTLI',
        file,
        line: lineNo,
        snippet: snippetFor(lines, lineNo),
        source: hint[1],
        detail: 'regex fallback (source did not parse as JS): taint hint and brotli sink call share a line',
      });
      return;
    }
    const pipe = /\.pipe\s*\(\s*(\w+)\s*\)/.exec(line);
    if (pipe && decompressorVars.has(pipe[1])) {
      sinks.push({
        kind: 'BROTLI',
        file,
        line: lineNo,
        snippet: snippetFor(lines, lineNo),
        source: hint[1],
        detail: `regex fallback (source did not parse as JS): '${pipe[1]}' holds a brotli decompressor and is piped a tainted stream`,
      });
    }
  });
  return sinks;
}

export function analyzeBytePathJs(code: string, file: string): TaintSink[] {
  const lines = code.split('\n');
  const program = parseMaybeJs(code);
  if (!program) return analyzeBytePathJsFallback(code, file, lines);
  const ctx: SinkCtx = { file, lines, sinks: [], seen: new Set() };
  walk(program, new Env(null), ctx);
  return ctx.sinks;
}

// ---------------------------------------------------------------------------
// analyzeBytePathRuby — non-literal -> Regexp.new/compile/union
// ---------------------------------------------------------------------------

const RUBY_REGEXP_CALL = /\bRegexp\s*\.\s*(?:new|compile|union)\s*\(/g;
const RUBY_TIMEOUT_GUARD = /Regexp\s*\.\s*timeout/;

/** First argument text of a call whose open paren sits at `openParen` (single line). */
function rubyFirstArg(line: string, openParen: number): string {
  let depth = 1;
  let i = openParen + 1;
  let out = '';
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i++;
      while (i < line.length) {
        out += line[i];
        if (line[i] === quote && line[i - 1] !== '\\') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) break;
    } else if (ch === ',' && depth === 1) break;
    out += ch;
    i++;
  }
  return out.trim();
}

/** Constant expressions that cannot carry user interpolation. */
function isRubyLiteralConstant(arg: string): boolean {
  if (/^'[^']*'$/.test(arg)) return true; // single-quoted: no interpolation in Ruby
  if (/^"[^"]*"$/.test(arg) && !/#{/.test(arg)) return true; // double-quoted WITHOUT #{...}
  if (/^\/.*\/[a-z]*$/.test(arg)) return true; // regexp literal
  if (/^%r\{/.test(arg)) return true; // %r{} literal
  if (/^:[A-Za-z_]/.test(arg) || /^-?\d+(?:\.\d+)?$/.test(arg)) return true; // symbol / number
  if (/^(?:true|false|nil)$/.test(arg)) return true;
  return false;
}

export function analyzeBytePathRuby(code: string, file: string): TaintSink[] {
  const lines = code.split('\n');
  const sinks: TaintSink[] = [];
  const seen = new Set<string>();
  const hasTimeoutGuard = RUBY_TIMEOUT_GUARD.test(code);

  lines.forEach((line, i) => {
    RUBY_REGEXP_CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUBY_REGEXP_CALL.exec(line)) !== null) {
      const openParen = m.index + m[0].length - 1;
      const arg = rubyFirstArg(line, openParen);
      const lineNo = i + 1;
      if (!arg || isRubyLiteralConstant(arg)) continue;
      const key = `${lineNo}|${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sinks.push({
        kind: 'RUBY_REGEXP',
        file,
        line: lineNo,
        snippet: snippetFor(lines, lineNo),
        source: 'USER_INPUT',
        detail:
          `first argument '${arg.slice(0, 80)}' is non-literal (GitLab-style regex compiler overflow sink, CVE-2026-110264)` +
          (hasTimeoutGuard
            ? '; Regexp.timeout guard present but the compiler integer overflow happens BEFORE the timeout can fire — not suppressive'
            : ''),
      });
    }
  });
  return sinks;
}

// ---------------------------------------------------------------------------
// analyzeBytePathPython — PTH_STARTUP + CRED_EXFIL_BYTEPATH
// ---------------------------------------------------------------------------

const PY_IMPORT_LINE = /^\s*(?:import|from)\b/;
const PY_DANGEROUS_CALL =
  /\b(?:exec|eval|open|compile|__import__|urlopen)\s*\(|\b(?:subprocess|socket|urllib|requests|httpx)\b/;
const PY_ENV_SOURCE = /\bos\.environ\b|\bos\.getenv\s*\(/;
const PY_DOTENV_OPEN = /\bopen\s*\([^)]*['"][^'"]*\.env/i;
const PY_DOTENV_PATH = /\bPath\s*\(\s*['"][^'"]*\.env/i;
const PY_EGRESS =
  /\burllib\.request\.urlopen\s*\(|\burlopen\s*\(|\brequests\.(?:post|get|put|head|delete|patch|request)\s*\(|\bsocket\.create_connection\s*\(|\bhttpx\.[\w.]*?(?:post|get|request)\s*\(/;
const PY_ASSIGN = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*(.+?)\s*$/;

export function analyzeBytePathPython(code: string, file: string): TaintSink[] {
  const lines = code.split('\n');
  const ctx: SinkCtx = { file, lines, sinks: [], seen: new Set() };

  // (a) PTH_STARTUP — top-level dangerous call executing at import time.
  // Plain `import` / `from ... import` statements are exempt: importing a
  // module alone does not execute attacker-shaped logic (interpretation
  // documented in docs/error-log/gatekeeper-tier2.md).
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!PY_IMPORT_LINE.test(trimmed) && PY_DANGEROUS_CALL.test(trimmed)) {
      emit(
        ctx,
        'PTH_STARTUP',
        i + 1,
        'IMPORT_TIME',
        `top-level '${trimmed.slice(0, 80)}' executes at interpreter import/startup time (.pth code-execution shape, LiteLLM 1.107.0 / MalSkillBench chain)`
      );
    }
  }

  // (b) CRED_EXFIL_BYTEPATH — env/.env read taints identifiers; a LATER
  // egress call passing a tainted identifier (or an f-string containing one)
  // joins both steps into ONE sink.
  const tainted = new Map<string, { line: number; origin: string }>();
  const assigns: { name: string; rhs: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const am = PY_ASSIGN.exec(lines[i]);
    if (!am) continue;
    const name = am[1];
    const rhs = am[2];
    const origin = PY_ENV_SOURCE.test(rhs)
      ? 'os.environ/os.getenv'
      : PY_DOTENV_OPEN.test(rhs)
        ? "open('.env'...)"
        : PY_DOTENV_PATH.test(rhs)
          ? "Path('.env'...)"
          : null;
    if (origin) {
      if (!tainted.has(name)) tainted.set(name, { line: i + 1, origin });
    } else {
      assigns.push({ name, rhs });
    }
  }
  // simple intra-file propagation: X = <expr referencing a tainted var>
  for (let round = 0; round < 2; round++) {
    for (const a of assigns) {
      if (tainted.has(a.name)) continue;
      for (const [name, info] of tainted) {
        if (name !== a.name && new RegExp(`\\b${name}\\b`).test(a.rhs)) {
          tainted.set(a.name, info);
          break;
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (!PY_EGRESS.test(lines[i])) continue;
    const lineNo = i + 1;
    let via: { name: string; info: { line: number; origin: string } } | null = null;
    for (const [name, info] of tainted) {
      if (lineNo > info.line && new RegExp(`\\b${name}\\b`).test(lines[i])) {
        via = { name, info };
        break;
      }
    }
    const direct =
      PY_ENV_SOURCE.test(lines[i]) || PY_DOTENV_OPEN.test(lines[i]) || PY_DOTENV_PATH.test(lines[i]);
    if (via || direct) {
      emit(
        ctx,
        'CRED_EXFIL_BYTEPATH',
        lineNo,
        'ENV_OR_FILE',
        via
          ? `tainted identifier '${via.name}' (from ${via.info.origin} read at line ${via.info.line}) flows into the network egress call — joined byte-path exfil edge`
          : 'credential source read inline inside the network egress call — joined byte-path exfil edge'
      );
      break; // ONE joined sink per file (contract §3)
    }
  }

  return ctx.sinks;
}

// ---------------------------------------------------------------------------
// analyzeBytePathPhp — session.upload_progress + serialize_handler pair
// ---------------------------------------------------------------------------

const PHP_UPLOAD_ENABLED =
  /ini_set\s*\(\s*['"]session\.upload_progress\.enabled['"]\s*,\s*['"]?(?:1|on|true)['"]?\s*\)|session\.upload_progress\.enabled\s*=\s*(?:1|on|true)\b|php_(?:value|admin_value)\s+session\.upload_progress\.enabled\s+(?:1|on|true)\b/i;
const PHP_SERIALIZE_INISET = /ini_set\s*\(\s*['"]session\.serialize_handler['"]\s*,\s*([^)]*?)\s*\)/i;
const PHP_SERIALIZE_HTACCESS = /php_(?:value|admin_value)\s+session\.serialize_handler\s+(\S+)/i;
const PHP_SERIALIZE_INI = /^\s*session\.serialize_handler\s*=\s*(\S+)/;

export function analyzeBytePathPhp(code: string, file: string): TaintSink[] {
  const lines = code.split('\n');
  let uploadLine = 0;
  let serializeLine = 0;
  let serializeValue = '';
  let serializeWhere = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!uploadLine && PHP_UPLOAD_ENABLED.test(line)) uploadLine = i + 1;
    if (serializeLine) continue;
    let m = PHP_SERIALIZE_INISET.exec(line);
    if (m) {
      const arg = m[1].trim();
      if (!/^['"]?php['"]?$/i.test(arg)) {
        serializeLine = i + 1;
        serializeValue = arg;
        serializeWhere = "ini_set('session.serialize_handler', ...)";
      }
      continue;
    }
    m = PHP_SERIALIZE_HTACCESS.exec(line);
    if (m) {
      const v = m[1].replace(/^['"]|['"]$/g, '');
      if (v.toLowerCase() !== 'php') {
        serializeLine = i + 1;
        serializeValue = v;
        serializeWhere = '.htaccess php_value session.serialize_handler';
      }
      continue;
    }
    m = PHP_SERIALIZE_INI.exec(line);
    if (m) {
      const v = m[1].replace(/^['"]|['"]$/g, '').replace(/;$/, '');
      if (v.toLowerCase() !== 'php') {
        serializeLine = i + 1;
        serializeValue = v;
        serializeWhere = 'ini session.serialize_handler';
      }
    }
  }

  if (!uploadLine || !serializeLine) return []; // each alone is not the chain

  return [
    {
      kind: 'PHP_SESSION',
      file,
      line: serializeLine,
      snippet: snippetFor(lines, serializeLine),
      source: 'INI',
      detail: `session.upload_progress.enabled=1 (line ${uploadLine}) COMBINED WITH ${serializeWhere} transition to '${serializeValue.slice(0, 40)}' (line ${serializeLine}) — PHP2Shell serializer/OOM chain shape (CVE-2026-109618 / CVE-2026-109619 / CVE-2026-115560)`,
    },
  ];
}

// ---------------------------------------------------------------------------
// taintFactsFromSinks
// ---------------------------------------------------------------------------

export function taintFactsFromSinks(sinks: TaintSink[], file: string): AstCapabilityFact[] {
  const out: AstCapabilityFact[] = [];
  const seen = new Set<string>();
  for (const s of sinks) {
    const key = `BYTEPATH_${s.kind}|${s.file || file}|${s.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ruleId: `BYTEPATH_${s.kind}`,
      category: 'BYTEPATH_SINK',
      file: s.file || file,
      line: s.line,
      snippet: s.snippet,
      deterministicRisk: s.kind === 'PHP_SESSION' ? RiskLevel.WARN : RiskLevel.HOLD,
    });
  }
  return out;
}
