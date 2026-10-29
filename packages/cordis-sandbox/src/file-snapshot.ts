/**
 * FileSnapshot — Tier 1 rollback fallback (docs/CONTRACTS.md §7).
 *
 * Hash + copy snapshot of files before modification; restore on violation.
 * Missing files are tracked as a null marker so files CREATED after the
 * snapshot get deleted by restoreAll() (the null-marker case).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface TrackedFile {
  absPath: string;
  /** sha256 of the snapshotted content, or null when the file did not exist. */
  sha256: string | null;
  /** Original bytes (files only), or null when the file did not exist. */
  content: Buffer | null;
}

export interface FileSnapshotRestoreResult {
  restored: string[];
  elapsedMs: number;
}

export class FileSnapshot {
  private readonly rootDir: string;
  private readonly tracked = new Map<string, TrackedFile>();

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  /** Snapshot the current content of a file (missing file → null marker). */
  async track(absPath: string): Promise<void> {
    const p = path.resolve(absPath);
    let content: Buffer | null = null;
    try {
      content = await fs.promises.readFile(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        content = null; // tracked as "did not exist"
      } else if (code === 'EISDIR') {
        throw new Error(`FileSnapshot.track: not a file: ${p}`);
      } else {
        throw err;
      }
    }
    const sha256 = content !== null ? createHash('sha256').update(content).digest('hex') : null;
    this.tracked.set(p, { absPath: p, sha256, content });
  }

  /** Absolute paths whose current sha256 differs from the tracked one. */
  async modifiedSinceTrack(): Promise<string[]> {
    const modified: string[] = [];
    for (const t of this.tracked.values()) {
      let cur: Buffer | null = null;
      try {
        cur = await fs.promises.readFile(t.absPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') cur = null;
        else throw err;
      }
      const curSha = cur !== null ? createHash('sha256').update(cur).digest('hex') : null;
      if (curSha !== t.sha256) modified.push(t.absPath);
    }
    return modified;
  }

  /**
   * Write back every original; files tracked as null that now exist are
   * deleted (they were created after the snapshot). Never throws on
   * individual restore failures? — no: restore failures are real rollback
   * failures and MUST surface (the caller turns them into alerts).
   */
  async restoreAll(): Promise<FileSnapshotRestoreResult> {
    const t0 = Date.now();
    const restored: string[] = [];
    for (const t of this.tracked.values()) {
      if (t.content === null) {
        if (fs.existsSync(t.absPath)) {
          fs.rmSync(t.absPath, { force: true });
          restored.push(t.absPath);
        }
      } else {
        await fs.promises.mkdir(path.dirname(t.absPath), { recursive: true });
        await fs.promises.writeFile(t.absPath, t.content);
        restored.push(t.absPath);
      }
    }
    return { restored, elapsedMs: Date.now() - t0 };
  }
}
