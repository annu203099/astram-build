/**
 * Cordis Fiber — the Windows-native "spatiotemporal" sandbox unit
 * (docs/CONTRACTS.md §7, Handbook §6.1, Invariant I2).
 *
 * A Fiber binds an agent turn / plugin execution to:
 *  - a detached git worktree (space isolation, shared object store),
 *  - a junction-linked host node_modules (zero-copy dependencies),
 *  - a tracked process tree (taskkill /F /T on unload),
 * so a policy violation can be reverted in milliseconds without touching the
 * developer's main repository (`dispose('ROLLED_BACK')`), while a clean turn
 * promotes its diff with `commitToMain()`.
 *
 * All git/child processes are spawned with shell:false argv arrays.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAstramHome } from '@astram/types';
import { killTree, runCapture, TIMEOUT_EXIT_CODE } from './spawn-util.js';

// ---------------------------------------------------------------------------
// Types — exact names per docs/CONTRACTS.md §7
// ---------------------------------------------------------------------------

export interface FiberOptions {
  /** Must be a git repo (the host repository to sandbox). */
  repoRoot: string;
  /** Default resolveAstramHome()/worktrees (or <homeDir>/.astram/worktrees when homeDir is given). */
  worktreesRoot?: string;
  /** Default random. */
  fiberId?: string;
  /** Default true: junction host node_modules into the worktree. */
  linkNodeModules?: boolean;
  /** For tests; default os.homedir(). */
  homeDir?: string;
}

export interface FiberResult {
  fiberId: string;
  worktreePath: string | null;
  disposition: 'COMMITTED' | 'ROLLED_BACK';
  diff: string;
  killedPids: number[];
  elapsedMs: number;
}

export interface FiberRegistryEntry {
  fiberId: string;
  path: string;
  startedAtMs: number;
}

export interface FiberExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface FiberExecResult {
  code: number;
  stdout: string;
  stderr: string;
  pid: number;
}

// ---------------------------------------------------------------------------
// Fiber registry — worktreesRoot/fibers.json
// ---------------------------------------------------------------------------

const REGISTRY_FILE = 'fibers.json';

function registryFile(worktreesRoot: string): string {
  return path.join(worktreesRoot, REGISTRY_FILE);
}

/** Active fibers from <worktreesRoot>/fibers.json (default resolveAstramHome()/worktrees). */
export function listActiveFibers(worktreesRoot?: string): FiberRegistryEntry[] {
  const root = worktreesRoot ?? path.join(resolveAstramHome(), 'worktrees');
  try {
    const raw = fs.readFileSync(registryFile(root), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as FiberRegistryEntry[];
    if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { fibers?: unknown }).fibers)) {
      return (parsed as { fibers: FiberRegistryEntry[] }).fibers;
    }
    return [];
  } catch {
    return []; // missing/corrupt registry reads as "no active fibers"
  }
}

function registryUpsert(worktreesRoot: string, entry: FiberRegistryEntry): void {
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const fibers = listActiveFibers(worktreesRoot).filter((f) => f.fiberId !== entry.fiberId);
  fibers.push(entry);
  fs.writeFileSync(registryFile(worktreesRoot), JSON.stringify({ fibers }, null, 2), 'utf8');
}

function registryRemove(worktreesRoot: string, fiberId: string): void {
  const fibers = listActiveFibers(worktreesRoot).filter((f) => f.fiberId !== fiberId);
  fs.writeFileSync(registryFile(worktreesRoot), JSON.stringify({ fibers }, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 60_000;

/** Parse one `git status --porcelain` line to its (new-side) relative path. */
function parsePorcelainLine(line: string): string | null {
  if (line.length < 4) return null;
  const body = line.slice(3);
  let p = body.includes(' -> ') ? (body.split(' -> ').pop() ?? '') : body;
  p = p.trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1);
  }
  return p === '' ? null : p;
}

/** The node_modules junction is transport, never fiber content. */
function isNodeModulesPath(rel: string): boolean {
  return rel === 'node_modules' || rel.startsWith('node_modules/');
}

function toPosixRel(base: string, abs: string): string {
  return path.relative(base, abs).split(path.sep).join('/');
}

/** pid no longer alive? (signal 0 probes existence; on Windows too). */
function pidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Fiber
// ---------------------------------------------------------------------------

export class Fiber {
  readonly id: string;
  readonly worktreePath: string;

  private readonly repoRoot: string;
  private readonly worktreesRoot: string;
  private readonly linkNodeModules: boolean;
  private startedAtMs = 0;
  private begun = false;
  private tornDown = false;
  private readonly trackedPids = new Set<number>();
  private readonly trackedWrites = new Set<string>(); // posix-style relative paths

  constructor(opts: FiberOptions) {
    this.repoRoot = path.resolve(opts.repoRoot);
    if (opts.worktreesRoot !== undefined) {
      this.worktreesRoot = path.resolve(opts.worktreesRoot);
    } else if (opts.homeDir !== undefined) {
      // test-friendly override that keeps the contract default untouched
      this.worktreesRoot = path.resolve(opts.homeDir, '.astram', 'worktrees');
    } else {
      this.worktreesRoot = path.resolve(path.join(resolveAstramHome(), 'worktrees'));
    }
    this.linkNodeModules = opts.linkNodeModules ?? true;
    this.id = opts.fiberId ?? `fiber-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    this.worktreePath = path.join(this.worktreesRoot, this.id);
  }

  /** git worktree add --detach <wt> HEAD ; junction node_modules ; registry insert. */
  async begin(): Promise<void> {
    fs.mkdirSync(this.worktreesRoot, { recursive: true });
    const r = await runCapture(
      'git',
      ['worktree', 'add', '--detach', this.worktreePath, 'HEAD'],
      { cwd: this.repoRoot, timeoutMs: GIT_TIMEOUT_MS },
    );
    if (r.code !== 0) {
      throw new Error(`Fiber.begin: git worktree add failed (exit ${r.code}): ${r.stderr.trim()}`);
    }
    this.begun = true;
    this.startedAtMs = Date.now();

    if (this.linkNodeModules) {
      const hostNm = path.join(this.repoRoot, 'node_modules');
      const wtNm = path.join(this.worktreePath, 'node_modules');
      try {
        if (fs.existsSync(hostNm) && !fs.existsSync(wtNm)) {
          // Windows directory junction: no privilege needed, zero disk copy.
          fs.symlinkSync(hostNm, wtNm, 'junction');
        }
      } catch {
        /* junction is an optimization — begin() must not fail because of it */
      }
    }

    registryUpsert(this.worktreesRoot, {
      fiberId: this.id,
      path: this.worktreePath,
      startedAtMs: this.startedAtMs,
    });
  }

  /**
   * Tracked child process. cwd defaults to the worktree; the pid stays
   * registered until the child exits (or is confirmed killed) so dispose()
   * can taskkill /F /T any still-running tree. Resolves code 124 on timeout.
   */
  async exec(cmd: string, args: string[], opts: FiberExecOptions = {}): Promise<FiberExecResult> {
    const cwd = opts.cwd ?? this.worktreePath;
    return new Promise<FiberExecResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(cmd, args, { cwd, shell: false, windowsHide: true });
      } catch (err) {
        resolve({ code: -1, stdout: '', stderr: String(err), pid: -1 });
        return;
      }
      const pid = child.pid ?? -1;
      if (pid > 0) this.trackedPids.add(pid);

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (code: number): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve({ code: timedOut ? TIMEOUT_EXIT_CODE : code, stdout, stderr, pid });
      };

      if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          // Kill the tree now, but KEEP the pid tracked: dispose() is the
          // authoritative reaper and re-kills (idempotent) anything that
          // survived — a timed-out child never escapes the fiber.
          void killTree(pid);
        }, opts.timeoutMs);
      }

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.stdin?.on('error', () => {
        /* EPIPE when the child exits without reading stdin */
      });
      child.stdin?.end();
      child.on('error', (err: Error) => {
        stderr += String(err);
        finish(-1);
      });
      child.on('close', (code) => {
        if (!timedOut) this.trackedPids.delete(pid); // exited on its own
        finish(code ?? -1);
      });
    });
  }

  /** Tracked mutation inside the worktree; rejects ../ escapes. */
  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.resolve(this.worktreePath, relPath);
    const inside = abs === this.worktreePath || abs.startsWith(this.worktreePath + path.sep);
    if (!inside) {
      throw new Error(`Fiber.writeFile: path escapes worktree: ${relPath}`);
    }
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content, 'utf8');
    this.trackedWrites.add(toPosixRel(this.worktreePath, abs));
  }

  /** Relative paths changed vs HEAD (git status --porcelain ∪ tracked writes). */
  async modifiedFiles(): Promise<string[]> {
    const out = new Set<string>(this.trackedWrites);
    if (this.worktreeExists()) {
      const r = await runCapture(
        'git',
        ['-C', this.worktreePath, 'status', '--porcelain'],
        { cwd: this.worktreePath, timeoutMs: GIT_TIMEOUT_MS },
      );
      if (r.code === 0) {
        for (const line of r.stdout.split(/\r?\n/)) {
          const p = parsePorcelainLine(line);
          if (p !== null && !isNodeModulesPath(p)) out.add(p);
        }
      }
    }
    return [...out].sort();
  }

  /** git -C wt diff HEAD after staging untracked files as intent-to-add. */
  async captureDiff(): Promise<string> {
    if (!this.worktreeExists()) return '';
    await this.stageIntentToAdd();
    const r = await runCapture(
      'git',
      ['-C', this.worktreePath, 'diff', 'HEAD'],
      { cwd: this.worktreePath, timeoutMs: GIT_TIMEOUT_MS },
    );
    return r.code === 0 ? r.stdout : '';
  }

  /**
   * Promote the worktree diff into the main repo (binary-safe):
   * `git -C repoRoot apply --binary -` fed the diff on stdin. On a dirty main
   * or patch conflict returns { promoted: false } WITHOUT throwing; the
   * worktree is torn down either way (the full diff travels in the result).
   */
  async commitToMain(): Promise<{ promoted: boolean; diff: string; files: string[] }> {
    const files = await this.modifiedFiles();
    let diff = '';
    let promoted = false;
    if (this.worktreeExists()) {
      await this.stageIntentToAdd();
      const d = await runCapture(
        'git',
        ['-C', this.worktreePath, 'diff', 'HEAD', '--binary'],
        { cwd: this.worktreePath, timeoutMs: GIT_TIMEOUT_MS },
      );
      diff = d.code === 0 ? d.stdout : '';
      if (diff.trim() === '') {
        promoted = true; // nothing to promote — main already matches HEAD
      } else {
        const check = await runCapture(
          'git',
          ['-C', this.repoRoot, 'apply', '--binary', '--check', '-'],
          { cwd: this.repoRoot, timeoutMs: GIT_TIMEOUT_MS, input: Buffer.from(diff, 'utf8') },
        );
        if (check.code === 0) {
          const apply = await runCapture(
            'git',
            ['-C', this.repoRoot, 'apply', '--binary', '-'],
            { cwd: this.repoRoot, timeoutMs: GIT_TIMEOUT_MS, input: Buffer.from(diff, 'utf8') },
          );
          promoted = apply.code === 0;
        }
      }
    } else {
      promoted = true; // nothing left to promote
    }
    // Contract commit path: teardown either way (kill pids, unlink junction,
    // remove worktree, prune, registry cleanup). Never throws.
    await this.teardown();
    return { promoted, diff, files };
  }

  /**
   * Unload the fiber. Never throws; every step is individually guarded.
   * 1. kill every tracked pid (taskkill /F /T on win32, SIGKILL+descendants posix)
   * 2. ROLLED_BACK → capture the forensic diff first
   * 3. unlink the node_modules junction (removes the LINK only — see test)
   * 4. git worktree remove --force + git worktree prune
   * 5. registry cleanup
   * If begin() never ran (or the fiber was already torn down) this is a no-op
   * returning zeros.
   */
  async dispose(reason: 'ROLLED_BACK' | 'COMMITTED'): Promise<FiberResult> {
    if (!this.begun || this.tornDown) {
      return {
        fiberId: this.id,
        worktreePath: null,
        disposition: reason,
        diff: '',
        killedPids: [],
        elapsedMs: 0,
      };
    }
    const t0 = Date.now();

    // 1. kill tracked process trees
    const killedPids: number[] = [];
    for (const pid of [...this.trackedPids]) {
      const killed = await killTree(pid);
      let dead = killed || pidDead(pid);
      if (!dead) {
        // tiny grace for kill->exit races; bounded so dispose stays fast
        for (let i = 0; i < 3 && !dead; i++) {
          await new Promise((res) => {
            setTimeout(res, 50);
          });
          dead = pidDead(pid);
        }
      }
      if (dead) killedPids.push(pid); // confirmed dead by this fiber
    }
    this.trackedPids.clear();

    // 2. forensic diff (rollback only)
    let diff = '';
    if (reason === 'ROLLED_BACK') {
      try {
        diff = await this.captureDiff();
      } catch {
        diff = '';
      }
    }

    // 3. junction unlink — fs.rmSync on a junction removes the link itself,
    //    never recursing into the host node_modules (verified by unit test).
    try {
      const wtNm = path.join(this.worktreePath, 'node_modules');
      if (fs.existsSync(wtNm) && fs.lstatSync(wtNm).isSymbolicLink()) {
        fs.rmSync(wtNm, { force: true, recursive: false });
      }
    } catch {
      /* guarded */
    }

    // 4. discard the worktree
    try {
      const rmRes = await runCapture(
        'git',
        ['-C', this.repoRoot, 'worktree', 'remove', '--force', this.worktreePath],
        { cwd: this.repoRoot, timeoutMs: GIT_TIMEOUT_MS },
      );
      if (rmRes.code !== 0) {
        await runCapture('git', ['-C', this.repoRoot, 'worktree', 'prune'], {
          cwd: this.repoRoot,
          timeoutMs: GIT_TIMEOUT_MS,
        });
      }
    } catch {
      /* guarded */
    }

    // 5. registry cleanup
    try {
      registryRemove(this.worktreesRoot, this.id);
    } catch {
      /* guarded */
    }

    this.tornDown = true;
    return {
      fiberId: this.id,
      worktreePath: fs.existsSync(this.worktreePath) ? this.worktreePath : null,
      disposition: reason,
      diff,
      killedPids,
      elapsedMs: Date.now() - t0,
    };
  }

  // ------------------------------------------------------------------ private

  private worktreeExists(): boolean {
    try {
      return fs.existsSync(this.worktreePath);
    } catch {
      return false;
    }
  }

  /** git add --intent-to-add --all (so untracked files show in `diff HEAD`), excluding the junction. */
  private async stageIntentToAdd(): Promise<void> {
    await runCapture(
      'git',
      ['-C', this.worktreePath, 'add', '--intent-to-add', '--all', '--', '.', ':(exclude)node_modules'],
      { cwd: this.worktreePath, timeoutMs: GIT_TIMEOUT_MS },
    );
  }

  /** Shared teardown for dispose() and commitToMain(). */
  private async teardown(): Promise<void> {
    if (!this.begun || this.tornDown) return;
    for (const pid of [...this.trackedPids]) {
      await killTree(pid);
    }
    this.trackedPids.clear();
    try {
      const wtNm = path.join(this.worktreePath, 'node_modules');
      if (fs.existsSync(wtNm) && fs.lstatSync(wtNm).isSymbolicLink()) {
        fs.rmSync(wtNm, { force: true, recursive: false });
      }
    } catch {
      /* guarded */
    }
    try {
      await runCapture(
        'git',
        ['-C', this.repoRoot, 'worktree', 'remove', '--force', this.worktreePath],
        { cwd: this.repoRoot, timeoutMs: GIT_TIMEOUT_MS },
      );
      await runCapture('git', ['-C', this.repoRoot, 'worktree', 'prune'], {
        cwd: this.repoRoot,
        timeoutMs: GIT_TIMEOUT_MS,
      });
    } catch {
      /* guarded */
    }
    try {
      registryRemove(this.worktreesRoot, this.id);
    } catch {
      /* guarded */
    }
    this.tornDown = true;
  }
}
