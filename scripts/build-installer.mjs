#!/usr/bin/env node
/**
 * Builds the self-contained Windows installer: dist-installer/Astram-Setup.exe
 *
 *   node scripts/build-installer.mjs
 *
 * 1. esbuild-bundle the daemon, proxy and CLIs (workspace deps inlined; only the
 *    better-sqlite3 native module stays external).
 * 2. Stage:  app/*.mjs, app/ui (dashboard), app/node_modules (better-sqlite3 + bindings),
 *    runtime/node.exe  (so installed configs never depend on `node` being on PATH).
 * 3. Zip the stage and compile scripts/AstramSetup.cs with the zip embedded as a resource.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-installer');
const STAGE = path.join(OUT, 'stage');
const APP = path.join(STAGE, 'app');
const j = (...p) => path.join(ROOT, ...p);

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
};

// --- esbuild from the pnpm store (no new dependency) -------------------------
const pnpmDir = j('node_modules', '.pnpm');
const esbuildDir = fs.readdirSync(pnpmDir).filter((d) => d.startsWith('esbuild@')).sort().pop();
const esbuild = createRequire(import.meta.url)(path.join(pnpmDir, esbuildDir, 'node_modules', 'esbuild'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// --- 0. make sure the UI + workspace dists are fresh --------------------------
console.log('> building workspace');
run('pnpm', ['-r', 'run', 'build'], { shell: true });

// --- 1. bundle ------------------------------------------------------------------
const banner = {
  js: "import { createRequire as __astramCreateRequire } from 'node:module'; const require = __astramCreateRequire(import.meta.url);",
};
const entries = {
  daemon: 'packages/server-daemon/src/index.ts',
  'cli-proxy': 'packages/mcp-proxy/src/cli-proxy.ts',
  'cli-astram': 'packages/mcp-proxy/src/cli-astram.ts',
  'mcp-proxy-lib': 'packages/mcp-proxy/src/index.ts',
  'turboquant-worker-lib': 'packages/turboquant-worker/src/index.ts',
};
console.log('> bundling', Object.keys(entries).join(', '));
await esbuild.build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, j(v)])),
  outdir: APP,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner,
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  // Workspace packages resolve to SOURCE so the bundle never depends on stale dist/.
  alias: {
    '@astram/types': j('packages/shared-types/src/index.ts'),
    '@astram/db': j('packages/db-ledger/src/index.ts'),
    '@astram/gatekeeper': j('packages/gatekeeper/src/index.ts'),
    '@astram/mcp-proxy': j('packages/mcp-proxy/src/index.ts'),
    '@astram/turboquant': j('packages/turboquant-worker/src/index.ts'),
    '@astram/server': j('packages/server-daemon/src/index.ts'),
  },
  logLevel: 'warning',
  legalComments: 'none',
});

// --- 2. stage assets --------------------------------------------------------------
console.log('> staging ui, native module, node runtime');
fs.cpSync(j('packages/dashboard-ui/dist'), path.join(APP, 'ui'), { recursive: true });
fs.copyFileSync(j('packages/db-ledger/src/schema.sql'), path.join(APP, 'schema.sql')); // read at runtime by @astram/db
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: 'astram-app', type: 'module', version: '0.1.0' }));

const findPkg = (name) => {
  const d = fs.readdirSync(pnpmDir).filter((x) => x.startsWith(`${name}@`)).sort().pop();
  return path.join(pnpmDir, d, 'node_modules', name);
};
const nm = path.join(APP, 'node_modules');
for (const name of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
  const src = findPkg(name);
  fs.cpSync(src, path.join(nm, name), {
    recursive: true,
    filter: (p) => {
      const rel = path.relative(src, p).replaceAll('\\', '/');
      // drop sqlite source + build intermediates; keep lib/ and the prebuilt .node
      if (rel.startsWith('deps') || rel.startsWith('src') || rel.startsWith('docs')) return false;
      if (rel.startsWith('build') && rel !== 'build' && !rel.startsWith('build/Release')) return false;
      if (rel.startsWith('build/Release') && !/\.node$|build\/Release$/.test(rel)) return false;
      return true;
    },
  });
}
if (!fs.existsSync(path.join(nm, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))) {
  throw new Error('better_sqlite3.node prebuilt binary not found - cannot ship the installer');
}
fs.mkdirSync(path.join(STAGE, 'runtime'));
fs.copyFileSync(process.execPath, path.join(STAGE, 'runtime', 'node.exe'));
fs.writeFileSync(path.join(STAGE, 'VERSION'), `0.1.0\nnode ${process.version}\nbuilt ${new Date().toISOString()}\n`);

// --- 2b. tiny windowless launcher (shortcut + autostart target)
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
console.log('> compiling launcher');
run(csc, ['/nologo', '/target:winexe', `/out:${path.join(STAGE, 'Astram.exe')}`, j('scripts', 'AstramLauncher.cs')], { shell: false });

// --- 3. zip + compile installer ----------------------------------------------------
const zip = path.join(OUT, 'payload.zip');
console.log('> zipping payload');
run('C:/Windows/System32/tar.exe', ['-a', '-c', '-f', zip, '-C', STAGE, '.']);
const exe = path.join(OUT, 'Astram-Setup.exe');
console.log('> compiling installer');
run(csc, [
  '/nologo', '/target:winexe', `/out:${exe}`,
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
  `/resource:${zip},payload.zip`,
  j('scripts', 'AstramSetup.cs'),
], { shell: false });
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`\nOK  ${exe}  (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
