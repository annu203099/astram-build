/**
 * @astram/gatekeeper — Acorn-based JS/TS capability scan.
 *
 * Rules (contract docs/CONTRACTS.md §2 deterministic rule table):
 *   JS_CHILD_PROCESS  PROC_EXEC    HOLD  child_process import/require + exec/
 *                                           execSync/spawn/spawnSync call
 *   JS_DYNAMIC_EVAL   DYNAMIC_EVAL WARN  eval( / new Function( / vm.runIn*
 *   JS_FS_CRED_READ   CRED_ACCESS  WARN  fs read call (readFile/readFileSync/
 *                                           createReadStream) whose first-arg
 *                                           string literal/template is a
 *                                           protected path (isProtectedPath)
 *   JS_SHELL_CRED_READ CRED_ACCESS HOLD  shell command string (child_process
 *                                           exec* argument) containing a
 *                                           protected path
 *   JS_NET_EGRESS     NET_EGRESS   WARN  fetch / http.request / https.request /
 *                                           net.connect / axios / urllib
 *
 * Parse errors are tolerated: scanJavascript never throws, returns [] instead.
 * (Known limitation, recorded in docs/error-log/gatekeeper.md: acorn is an
 * ECMAScript parser, so TypeScript-specific syntax in ts/tsx fences fails to
 * parse and yields no facts. Plain-JS-compatible TS still scans fine.)
 */
import { parse } from 'acorn';
import { isProtectedPath, RiskLevel, type AstCapabilityFact, type CapabilityCategory } from '@astram/types';
import { protectedPathIn, snippetFor } from './util.js';

type AnyNode = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};

const EXEC_METHODS = new Set(['exec', 'execSync', 'spawn', 'spawnSync']);
const FS_READ_METHODS = new Set(['readFile', 'readFileSync', 'createReadStream']);
const VM_RUN_METHODS = new Set(['runInContext', 'runInNewContext', 'runInThisContext']);
const CHILD_PROCESS_SOURCES = new Set(['child_process', 'node:child_process']);
const NET_PKG_SOURCES = new Set(['axios', 'urllib']);

/** String values carried by a Literal or the cooked quasis of a TemplateLiteral. */
function stringValuesOf(node: AnyNode | undefined | null): string[] {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
    const out: string[] = [];
    for (const q of node.quasis as Array<{ value?: { cooked?: string; raw?: string } }>) {
      out.push(q?.value?.cooked ?? q?.value?.raw ?? '');
    }
    return out;
  }
  return [];
}

/** Try ESM first (import statements), then script; null if neither parses. */
function parseMaybe(code: string): AnyNode | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return parse(code, {
        ecmaVersion: 'latest',
        locations: true,
        sourceType,
        allowHashBang: true,
      }) as unknown as AnyNode;
    } catch {
      // fall through to the next sourceType
    }
  }
  return null;
}

/** Dependency-free AST walk: calls cb on every node with a string `type`. */
function visit(node: unknown, cb: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) visit(item, cb);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.type !== 'string') return;
  cb(n as AnyNode);
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    visit(n[key], cb);
  }
}

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const TS_SYNTAX_PATTERNS = [
  /:\s*(?:string|number|boolean|any|unknown|never|void|object|Record|Array|Promise|[A-Z]\w*)\b/,
  /\b(?:interface|type)\s+[A-Za-z0-9_$]+/,
  /\b(?:public|private|protected|readonly|declare|override)\s+\w+/,
  /\bas\s+(?:const|string|number|any|[A-Z]\w*)/,
  /\benum\s+\w+/,
  /\bnamespace\s+\w+/,
  /<[A-Za-z0-9_$]+>\s*\(/,
];

export function isTypeScript(code: string, file: string = ''): boolean {
  if (file && typeof file === 'string' && file.includes('.')) {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (TS_EXTENSIONS.has(ext)) return true;
  }
  return TS_SYNTAX_PATTERNS.some((p) => p.test(code));
}

/** Strips TypeScript types and annotations while preserving exact line positions. */
export function stripTypeScriptTypes(code: string): string {
  let s = code;
  // 1. Remove interfaces: interface Foo { ... }
  s = s.replace(/\binterface\s+[A-Za-z0-9_$]+(?:\s*<[^>]*>)?(?:\s+extends\s+[^{]+)?\s*\{[\s\S]*?\}/g, (m) =>
    m.replace(/[^\r\n]/g, ' ')
  );
  // 2. Remove type aliases: type Foo = ...;
  s = s.replace(/\btype\s+[A-Za-z0-9_$]+(?:\s*<[^>]*>)?\s*=[\s\S]*?;/g, (m) =>
    m.replace(/[^\r\n]/g, ' ')
  );
  // 3. Remove access modifiers: public, private, protected, readonly, override, declare
  s = s.replace(/\b(public|private|protected|readonly|override|declare)\s+/g, (m) =>
    ' '.repeat(m.length)
  );
  // 4. Remove type assertions: as const, as any, as Type, as unknown as Type
  s = s.replace(/\bas\s+([A-Za-z0-9_$]+(?:\s*<[^>]*>)?(?:\s*\[\s*\])?)/g, (m) =>
    ' '.repeat(m.length)
  );
  // 5. Remove variable / parameter / return type annotations: ': Type' before =, ;, ), ,, {, =>, or newline
  s = s.replace(/:\s*[A-Za-z0-9_$]+(?:\s*<[^>]*>)?(?:\s*\[\s*\])?(?=\s*(=|;|\)|,|\{|=>|\n|\r|$))/g, (m) =>
    ' '.repeat(m.length)
  );
  return s;
}

function scanJavascriptFallback(code: string, file: string, lines: string[]): AstCapabilityFact[] {
  const facts: AstCapabilityFact[] = [];
  const pushFallback = (ruleId: string, category: CapabilityCategory, risk: RiskLevel, lineNo: number) => {
    facts.push({
      ruleId,
      category,
      file,
      line: lineNo,
      snippet: snippetFor(lines, lineNo),
      deterministicRisk: risk,
    });
  };

  const hasChildProcess = /\b(?:require\s*\(\s*['"](?:node:)?child_process['"]\s*\)|from\s+['"](?:node:)?child_process['"]|import\s+['"](?:node:)?child_process['"])/.test(code);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // JS_DYNAMIC_EVAL
    if (/\beval\s*\(|\bnew\s+Function\s*\(|\bvm\.(?:runInContext|runInNewContext|runInThisContext)\s*\(/.test(line)) {
      pushFallback('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, lineNo);
    }

    // JS_NET_EGRESS
    if (
      /\b(?:fetch|axios)\s*\(|\b(?:http|https)\.(?:request|get)\s*\(|\brequire\s*\(\s*['"](?:node:)?(?:http|https)['"]\s*\)\.(?:request|get)\s*\(|\bnet\.connect\s*\(|\b(?:require|from)\s*\(?.*['"](?:axios|urllib)['"]/.test(
        line
      )
    ) {
      pushFallback('JS_NET_EGRESS', 'NET_EGRESS', RiskLevel.WARN, lineNo);
    }

    // JS_FS_CRED_READ
    const fsMatch = /\b(?:readFile|readFileSync|createReadStream)\s*\(\s*[`'"]([^`'"]+)[`'"]/.exec(line);
    if (fsMatch && fsMatch[1] && isProtectedPath(fsMatch[1]).protected) {
      pushFallback('JS_FS_CRED_READ', 'CRED_ACCESS', RiskLevel.WARN, lineNo);
    }

    // JS_CHILD_PROCESS & JS_SHELL_CRED_READ
    if (hasChildProcess && /\b(?:exec|execSync|spawn|spawnSync)\s*\(/.test(line)) {
      pushFallback('JS_CHILD_PROCESS', 'PROC_EXEC', RiskLevel.HOLD, lineNo);
      if (protectedPathIn(line).protected) {
        pushFallback('JS_SHELL_CRED_READ', 'CRED_ACCESS', RiskLevel.HOLD, lineNo);
      }
    }
  }

  return facts;
}

export function scanJavascript(code: string, file: string): AstCapabilityFact[] {
  const lines = code.split('\n');
  let program = parseMaybe(code);
  let parseFailed = false;

  if (!program) {
    if (isTypeScript(code, file)) {
      const stripped = stripTypeScriptTypes(code);
      program = parseMaybe(stripped);
      if (!program) {
        parseFailed = true;
      }
    } else {
      return [];
    }
  }

  if (parseFailed) {
    const facts: AstCapabilityFact[] = [
      {
        ruleId: 'TS_PARSE_WARN',
        category: 'DYNAMIC_EVAL',
        file,
        line: 1,
        snippet: snippetFor(lines, 1),
        deterministicRisk: RiskLevel.WARN,
      },
    ];
    facts.push(...scanJavascriptFallback(code, file, lines));
    return facts;
  }

  const facts: AstCapabilityFact[] = [];
  const push = (ruleId: string, category: CapabilityCategory, risk: RiskLevel, node: AnyNode): void => {
    const line = node.loc?.start.line ?? 1;
    facts.push({ ruleId, category, file, line, snippet: snippetFor(lines, line), deterministicRisk: risk });
  };

  let childProcessRef = false;
  const execCallNodes: AnyNode[] = [];
  const netUsageNodes: AnyNode[] = [];

  visit(program, (n) => {
    switch (n.type) {
      case 'ImportDeclaration': {
        const src = (n.source as AnyNode | undefined)?.value;
        if (typeof src === 'string') {
          if (CHILD_PROCESS_SOURCES.has(src)) childProcessRef = true;
          else if (NET_PKG_SOURCES.has(src)) netUsageNodes.push(n);
        }
        break;
      }
      case 'ImportExpression': {
        const src = (n.source as AnyNode | undefined)?.value;
        if (typeof src === 'string' && CHILD_PROCESS_SOURCES.has(src)) childProcessRef = true;
        break;
      }
      case 'NewExpression': {
        const callee = n.callee as AnyNode | undefined;
        if (callee?.type === 'Identifier' && callee.name === 'Function') {
          push('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, n);
        }
        break;
      }
      case 'CallExpression': {
        const callee = n.callee as AnyNode | undefined;
        const args = Array.isArray(n.arguments) ? (n.arguments as AnyNode[]) : [];

        if (callee?.type === 'Identifier' && callee.name === 'require') {
          const src = stringValuesOf(args[0])[0];
          if (typeof src === 'string') {
            if (CHILD_PROCESS_SOURCES.has(src)) childProcessRef = true;
            else if (NET_PKG_SOURCES.has(src)) netUsageNodes.push(n);
          }
          break; // require(...) itself matches no other rule
        }

        const calleeName =
          callee?.type === 'Identifier'
            ? callee.name
            : callee?.type === 'MemberExpression'
              ? memberPropertyName(callee)
              : null;

        if (callee?.type === 'Identifier') {
          if (callee.name === 'eval') push('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, n);
          else if (callee.name === 'fetch' || callee.name === 'axios') {
            push('JS_NET_EGRESS', 'NET_EGRESS', RiskLevel.WARN, n);
          }
        } else if (callee?.type === 'MemberExpression') {
          const prop = memberPropertyName(callee);
          let objName: string | null =
            (callee.object as AnyNode | undefined)?.type === 'Identifier'
              ? ((callee.object as { name: string }).name)
              : null;
          if (
            !objName &&
            (callee.object as AnyNode | undefined)?.type === 'CallExpression' &&
            ((callee.object as AnyNode).callee as AnyNode | undefined)?.name === 'require'
          ) {
            const reqArg = stringValuesOf(((callee.object as AnyNode).arguments as AnyNode[])?.[0])[0];
            if (reqArg) objName = reqArg.replace(/^node:/, '');
          }
          if (prop === 'eval') push('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, n);
          else if (prop !== null && VM_RUN_METHODS.has(prop)) {
            push('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, n);
          } else if (
            objName !== null &&
            prop !== null &&
            (((objName === 'http' || objName === 'https') && (prop === 'request' || prop === 'get')) ||
              (objName === 'net' && prop === 'connect') ||
              objName === 'axios' ||
              objName === 'urllib')
          ) {
            push('JS_NET_EGRESS', 'NET_EGRESS', RiskLevel.WARN, n);
          }
        }

        if (typeof calleeName === 'string' && EXEC_METHODS.has(calleeName)) execCallNodes.push(n);

        if (typeof calleeName === 'string' && FS_READ_METHODS.has(calleeName)) {
          for (const s of stringValuesOf(args[0])) {
            if (isProtectedPath(s).protected) {
              push('JS_FS_CRED_READ', 'CRED_ACCESS', RiskLevel.WARN, n);
              break;
            }
          }
        }
        break;
      }
      default:
        break;
    }
  });

  for (const n of netUsageNodes) push('JS_NET_EGRESS', 'NET_EGRESS', RiskLevel.WARN, n);

  // JS_CHILD_PROCESS requires BOTH a child_process reference AND an exec*
  // call site in the same unit (contract trigger wording).
  if (childProcessRef) {
    for (const n of execCallNodes) {
      push('JS_CHILD_PROCESS', 'PROC_EXEC', RiskLevel.HOLD, n);
      // The exec argument is a shell command string: run it through the
      // JS_SHELL_CRED_READ protected-path tokenization.
      for (const s of stringValuesOf((n.arguments as AnyNode[] | undefined)?.[0])) {
        if (protectedPathIn(s).protected) {
          push('JS_SHELL_CRED_READ', 'CRED_ACCESS', RiskLevel.HOLD, n);
        }
      }
    }
  }

  return facts;
}

function memberPropertyName(member: AnyNode): string | null {
  const prop = member.property as AnyNode | undefined;
  if (!prop) return null;
  if (prop.type === 'Identifier' && typeof prop.name === 'string') return prop.name;
  if (prop.type === 'Literal' && typeof prop.value === 'string') return prop.value;
  return null;
}
