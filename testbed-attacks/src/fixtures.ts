/**
 * testbed-attacks — shared fixture resolver.
 *
 * Fixtures are STATIC DATA (AGENTS.md rule 5): tests read them as text and
 * never execute them. Paths are derived from this module's URL so the suite
 * works regardless of the vitest cwd.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Absolute path of a fixture, e.g. fixturePath('attack-1-litellm-pth', 'evil_init.pth'). */
export function fixturePath(attackDir: string, fileName: string): string {
  return fileURLToPath(new URL(`../${attackDir}/fixtures/${fileName}`, import.meta.url));
}

/** Read one fixture as UTF-8 text. Fails the test loudly if it is missing. */
export function readFixture(attackDir: string, fileName: string): string {
  return readFileSync(fixturePath(attackDir, fileName), 'utf8');
}
