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

export function scanJavascript(code: string, file: string): AstCapabilityFact[] {
  const program = parseMaybe(code);
  if (!program) return [];

  const lines = code.split('\n');
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
          const objName =
            (callee.object as AnyNode | undefined)?.type === 'Identifier'
              ? ((callee.object as { name: string }).name)
              : null;
          if (prop === 'eval') push('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, n);
          else if (prop !== null && VM_RUN_METHODS.has(prop)) {
            push('JS_DYNAMIC_EVAL', 'DYNAMIC_EVAL', RiskLevel.WARN, n);
          } else if (
            objName !== null &&
            prop !== null &&
            (((objName === 'http' || objName === 'https') && prop === 'request') ||
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
