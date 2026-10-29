/**
 * Internal spawn helpers shared by Fiber + CredentialVault.
 *
 * Repo rules: every spawn uses `shell: false` with an argv array — shell
 * strings are NEVER used (Windows injection safety). All paths flow through
 * node:path. Node builtins are imported with the `node:` prefix.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  /** Kill the whole child tree and resolve code 124 when exceeded. */
  timeoutMs?: number;
  /** Bytes piped to the child's stdin (e.g. a git patch for `git apply -`). */
  input?: Buffer;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  pid: number;
  timedOut: boolean;
}

/** Timeout exit code (mirrors GNU `timeout`). */
export const TIMEOUT_EXIT_CODE = 124;

const isWin32 = process.platform === 'win32';

/**
 * Spawn `cmd args` with shell:false and capture utf8 stdout/stderr.
 * Never rejects — spawn errors and timeouts resolve as { code: -1 | 124 }.
 */
export function runCapture(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, shell: false, windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err), pid: -1, timedOut: false });
      return;
    }
    const pid = child.pid ?? -1;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code: timedOut ? TIMEOUT_EXIT_CODE : code, stdout, stderr, pid, timedOut });
    };

    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
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
    child.on('error', (err: Error) => {
      stderr += String(err);
      finish(-1);
    });
    // stdin: feed optional input, always close so children reading stdin terminate.
    child.stdin?.on('error', () => {
      /* EPIPE if the child exits early — surfaced via close/error */
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
    child.on('close', (code) => {
      finish(code ?? -1);
    });
  });
}

/**
 * Kill an entire process tree, best-effort, never throws.
 * - win32: `taskkill /F /T /PID <pid>`
 * - posix: SIGKILL the pid plus best-effort `pkill -KILL -P` for descendants
 * Returns true when the kill was reported successful.
 */
export async function killTree(pid: number): Promise<boolean> {
  if (pid <= 0) return false;
  if (isWin32) {
    const r = await runCapture('taskkill', ['/F', '/T', '/PID', String(pid)], { timeoutMs: 15_000 });
    return r.code === 0;
  }
  let killed = false;
  try {
    process.kill(pid, 'SIGKILL');
    killed = true;
  } catch {
    killed = false;
  }
  try {
    await runCapture('pkill', ['-KILL', '-P', String(pid)], { timeoutMs: 5_000 });
  } catch {
    /* best effort */
  }
  return killed;
}
