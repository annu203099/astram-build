/**
 * FileSnapshot tests — track / modifiedSinceTrack / restoreAll, including
 * the null-marker case (file CREATED after snapshot is deleted on restore).
 * All filesystem work in os.tmpdir().
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSnapshot } from './file-snapshot.js';

describe('FileSnapshot', () => {
  it('tracks 2 files, detects modification + creation, restores originals and removes the extra', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordis-snap-'));
    try {
      const a = path.join(dir, 'a.txt');
      const b = path.join(dir, 'nested', 'b.txt');
      const extra = path.join(dir, 'extra.txt'); // does not exist yet → null marker
      fs.writeFileSync(a, 'A1');
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.writeFileSync(b, 'B1');

      const snap = new FileSnapshot(dir);
      await snap.track(a);
      await snap.track(b);
      await snap.track(extra);

      // mutate tracked files and create the tracked-as-missing file
      fs.writeFileSync(a, 'A2-mutated');
      fs.writeFileSync(b, 'B2-mutated');
      fs.writeFileSync(extra, 'EXTRA-CREATED');

      const modified = await snap.modifiedSinceTrack();
      expect(modified.sort()).toEqual([a, b, extra].sort());

      const res = await snap.restoreAll();
      console.log(`[file-snapshot] restoreAll elapsedMs=${res.elapsedMs}`);
      expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(res.restored.sort()).toEqual([a, b, extra].sort());
      expect(fs.readFileSync(a, 'utf8')).toBe('A1'); // original bytes restored
      expect(fs.readFileSync(b, 'utf8')).toBe('B1');
      expect(fs.existsSync(extra)).toBe(false); // null-marker case: created file removed

      // post-restore state is clean relative to the snapshot
      expect(await snap.modifiedSinceTrack()).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restoreAll recreates a tracked file that was deleted after tracking', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordis-snap-del-'));
    try {
      const a = path.join(dir, 'gone.txt');
      fs.writeFileSync(a, 'still recoverable');
      const snap = new FileSnapshot(dir);
      await snap.track(a);
      fs.rmSync(a);
      expect(await snap.modifiedSinceTrack()).toEqual([a]);
      const res = await snap.restoreAll();
      expect(res.restored).toEqual([a]);
      expect(fs.readFileSync(a, 'utf8')).toBe('still recoverable');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
