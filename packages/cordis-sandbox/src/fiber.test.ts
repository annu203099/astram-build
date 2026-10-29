/**
 * Fiber lifecycle / promotion / exec-tracking / registry tests.
 * ALL git + filesystem work happens inside os.tmpdir() mkdtemp dirs — the
 * real repo, its worktrees and the real user profile are never touched.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fiber, listActiveFibers } from './fiber.js';

let tmpRoot = '';

function git(repo: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd: repo, shell: false, windowsHide: true, timeout: 30_000 });
}

/** Fresh tmp git repo with a committed file tree (+ node_modules/ ignored). */
function initGitRepo(name: string): string {
  const repo = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'committed.txt'), 'hello main\n');
  fs.writeFileSync(path.join(repo, 'sub', 'a.txt'), 'aaa\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  const steps: string[][] = [
    ['init', '-q'],
    ['config', 'user.email', 'agent-e@astram.local'],
    ['config', 'user.name', 'Agent E'],
    ['config', 'core.autocrlf', 'false'],
    ['add', '-A'],
    ['commit', '-qm', 'init'],
  ];
  for (const args of steps) {
    const r = git(repo, args);
    if (r.status !== 0) throw new Error(`initGitRepo: git ${args[0]} failed: ${r.stderr.toString()}`);
  }
  return repo;
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cordis-fiber-'));
});

afterAll(() => {
  if (tmpRoot !== '') fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Fiber — lifecycle (Invariant I2 rollback)', () => {
  it('begin() creates a worktree with HEAD content and a junction node_modules', async () => {
    const repo = initGitRepo('repo-life');
    // host deps marker — proves junction visibility AND junction-removal safety
    const markerAbs = path.join(repo, 'node_modules', 'dep', 'marker.txt');
    fs.mkdirSync(path.dirname(markerAbs), { recursive: true });
    fs.writeFileSync(markerAbs, 'HOST DEPS MARKER');

    const worktrees = path.join(tmpRoot, 'worktrees-life');
    const fiber = new Fiber({ repoRoot: repo, worktreesRoot: worktrees, fiberId: 'fiber-life' });
    await fiber.begin();

    const wt = fiber.worktreePath;
    expect(fs.existsSync(path.join(wt, 'committed.txt'))).toBe(true); // known committed file present
    expect(fs.existsSync(path.join(wt, 'sub', 'a.txt'))).toBe(true);
    // junction: host marker visible through the worktree link
    expect(fs.existsSync(path.join(wt, 'node_modules', 'dep', 'marker.txt'))).toBe(true);

    // registry lists the live fiber
    const entry = listActiveFibers(worktrees).find((f) => f.fiberId === 'fiber-life');
    expect(entry?.path).toBe(wt);
    expect(typeof entry?.startedAtMs).toBe('number');

    // tracked mutation + modifiedFiles + captureDiff include it
    await fiber.writeFile(path.join('notes', 'new.md'), 'hello fiber\n');
    expect(await fiber.modifiedFiles()).toContain('notes/new.md');
    const diff = await fiber.captureDiff();
    expect(diff).toContain('notes/new.md');
    expect(diff).toContain('+hello fiber');

    const res = await fiber.dispose('ROLLED_BACK');
    console.log(`[fiber-life] dispose elapsedMs=${res.elapsedMs}`);
    expect(res.disposition).toBe('ROLLED_BACK');
    expect(res.diff).toContain('notes/new.md'); // forensic diff captured on rollback
    expect(fs.existsSync(wt)).toBe(false); // worktree discarded
    expect(fs.existsSync(path.join(repo, 'notes'))).toBe(false); // main repo untouched
    expect(fs.existsSync(markerAbs)).toBe(true); // junction removal did NOT delete target contents
    expect(res.elapsedMs).toBeLessThan(500);
    expect(listActiveFibers(worktrees).some((f) => f.fiberId === 'fiber-life')).toBe(false);
  });

  it('writeFile rejects ../ escapes out of the worktree', async () => {
    const repo = initGitRepo('repo-escape');
    const worktrees = path.join(tmpRoot, 'worktrees-escape');
    const fiber = new Fiber({ repoRoot: repo, worktreesRoot: worktrees, fiberId: 'fiber-escape' });
    await fiber.begin();
    await expect(fiber.writeFile(path.join('..', 'escape.txt'), 'nope')).rejects.toThrow(/escapes worktree/);
    // absolute path pointing outside the worktree is also rejected
    await expect(fiber.writeFile(path.join(tmpRoot, 'escape-abs.txt'), 'nope')).rejects.toThrow(
      /escapes worktree/,
    );
    expect(fs.existsSync(path.join(tmpRoot, 'escape-abs.txt'))).toBe(false);
    await fiber.dispose('ROLLED_BACK');
  });
});

describe('Fiber — commitToMain promotion', () => {
  it('happy path: promotes a clean diff into the main repo, worktree torn down', async () => {
    const repo = initGitRepo('repo-commit');
    const worktrees = path.join(tmpRoot, 'worktrees-commit');

    const runOnce = async (suffix: string): Promise<boolean> => {
      const fiber = new Fiber({
        repoRoot: repo,
        worktreesRoot: worktrees,
        fiberId: `fiber-commit-${suffix}`,
      });
      await fiber.begin();
      await fiber.writeFile('committed.txt', 'hello main PROMOTED\n');
      const r = await fiber.commitToMain();
      expect(r.diff).toContain('committed.txt');
      expect(r.files).toContain('committed.txt');
      if (!r.promoted) await fiber.dispose('ROLLED_BACK');
      return r.promoted;
    };

    // retry-once (TEST ONLY): git on AV-scanned Windows disks can flake
    let promoted = await runOnce('a');
    if (!promoted && !fs.readFileSync(path.join(repo, 'committed.txt'), 'utf8').includes('PROMOTED')) {
      promoted = await runOnce('b');
    }
    expect(promoted).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'committed.txt'), 'utf8')).toBe('hello main PROMOTED\n');
    for (const id of ['fiber-commit-a', 'fiber-commit-b']) {
      expect(fs.existsSync(path.join(worktrees, id))).toBe(false); // worktree gone after commit path
    }
  });

  it('conflict path: dirty main on the same file → promoted:false, no throw, cleanup anyway', async () => {
    const repo = initGitRepo('repo-conflict');
    const worktrees = path.join(tmpRoot, 'worktrees-conflict');
    const fiber = new Fiber({ repoRoot: repo, worktreesRoot: worktrees, fiberId: 'fiber-conflict' });
    await fiber.begin();
    await fiber.writeFile('committed.txt', 'fiber change\n');
    // dirty the MAIN repo on the same file after the worktree was created
    fs.writeFileSync(path.join(repo, 'committed.txt'), 'DIRTY MAIN\n');

    const r = await fiber.commitToMain();
    expect(r.promoted).toBe(false);
    expect(r.diff).toContain('committed.txt'); // diff travels back so nothing is lost
    expect(r.files).toContain('committed.txt');
    expect(fs.readFileSync(path.join(repo, 'committed.txt'), 'utf8')).toBe('DIRTY MAIN\n'); // main kept its own state
    expect(fs.existsSync(path.join(worktrees, 'fiber-conflict'))).toBe(false); // cleanup either way
    expect(listActiveFibers(worktrees).some((f) => f.fiberId === 'fiber-conflict')).toBe(false);
  });
});

describe('Fiber — exec process-tree tracking', () => {
  it('tracks a long child; dispose kills it (taskkill /F /T on win32) and the pid is gone', async () => {
    const repo = initGitRepo('repo-exec');
    const worktrees = path.join(tmpRoot, 'worktrees-exec');
    const fiber = new Fiber({ repoRoot: repo, worktreesRoot: worktrees, fiberId: 'fiber-exec' });
    await fiber.begin();

    const r = await fiber.exec('node', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 800 });
    expect(r.pid).toBeGreaterThan(0);
    expect(r.code).toBe(124); // timed out and was tree-killed

    const res = await fiber.dispose('ROLLED_BACK');
    expect(res.killedPids).toContain(r.pid); // taskkill ran (or the pid was already confirmed dead)

    // the process is really gone: signal-0 probe must fail (brief retry for teardown races)
    let dead = false;
    for (let i = 0; i < 20 && !dead; i++) {
      try {
        process.kill(r.pid, 0);
      } catch {
        dead = true;
        break;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    expect(dead).toBe(true);
  });
});

describe('Fiber — registry', () => {
  it('listActiveFibers reflects begin/dispose and returns [] for unknown roots', async () => {
    const repo = initGitRepo('repo-registry');
    const worktrees = path.join(tmpRoot, 'worktrees-registry');
    expect(listActiveFibers(path.join(tmpRoot, 'no-such-worktrees'))).toEqual([]);

    const fiber = new Fiber({ repoRoot: repo, worktreesRoot: worktrees, fiberId: 'fiber-reg' });
    await fiber.begin();
    const active = listActiveFibers(worktrees);
    const entry = active.find((f) => f.fiberId === 'fiber-reg');
    expect(entry?.path).toBe(fiber.worktreePath);
    expect(entry?.startedAtMs).toBeGreaterThan(0);

    await fiber.dispose('ROLLED_BACK');
    expect(listActiveFibers(worktrees).some((f) => f.fiberId === 'fiber-reg')).toBe(false);
  });

  it('dispose before begin is a no-op returning zeros', async () => {
    const repo = initGitRepo('repo-nobegin');
    const worktrees = path.join(tmpRoot, 'worktrees-nobegin');
    const fiber = new Fiber({ repoRoot: repo, worktreesRoot: worktrees, fiberId: 'fiber-nobegin' });
    const res = await fiber.dispose('ROLLED_BACK');
    expect(res).toEqual({
      fiberId: 'fiber-nobegin',
      worktreePath: null,
      disposition: 'ROLLED_BACK',
      diff: '',
      killedPids: [],
      elapsedMs: 0,
    });
  });
});
