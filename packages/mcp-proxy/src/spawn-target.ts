/**
 * @astram/mcp-proxy — Windows-safe command resolution for the proxied target.
 *
 * `spawn('npx', args, { shell: false })` fails with ENOENT on Windows because
 * `npx` is really `npx.cmd`, and Node refuses to spawn .cmd/.bat directly
 * (EINVAL since 20.12). Nearly every published MCP server is launched through
 * npx/uvx/pnpm shims, so the proxy must resolve PATHEXT itself and route
 * batch files through cmd.exe.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export interface SpawnPlan {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface ResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
}

const isFile = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
};

/** cmd.exe quoting: wrap args containing whitespace/metachars, double embedded quotes. */
export function quoteForCmd(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function resolveSpawnPlan(cmd: string, args: string[], opts: ResolveOptions = {}): SpawnPlan {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return { file: cmd, args };

  const env = opts.env ?? process.env;
  const exists = opts.exists ?? isFile;
  const pathext = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasDir = /[\\/]/.test(cmd);
  const dirs = hasDir ? [''] : (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  const hasExt = path.win32.extname(cmd) !== '';

  let found: string | null = null;
  for (const dir of dirs) {
    const base = dir ? path.win32.join(dir, cmd) : cmd;
    const candidates = hasExt ? [base] : [base, ...pathext.map((e) => base + e)];
    // Prefer an extension match over a bare file of the same name (npx vs npx.cmd).
    const ordered = hasExt ? candidates : [...candidates.slice(1), candidates[0]];
    const hit = ordered.find((c) => exists(c));
    if (hit) {
      found = hit;
      break;
    }
  }
  if (!found) return { file: cmd, args }; // let spawn report ENOENT naturally

  if (/\.(cmd|bat)$/i.test(found)) {
    const line = [found, ...args].map(quoteForCmd).join(' ');
    return {
      file: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { file: found, args };
}
