/**
 * DeepSeek Harness hardening tests (Handbook §6.1):
 *  - CredentialVault: AES-256-GCM round-trip via DPAPI when available, else
 *    the logged keyfile fallback; ciphertext never plaintext; tamper fails
 *    cleanly.
 *  - ToolSchemaHotReload: tail-append keeps the serialized prefix identical
 *    (DSH-BUG-04 KV-cache preservation).
 *  - dshPluginMount: composes vault + hot-reload onto a Cordis-like ctx.
 * All filesystem work in os.tmpdir().
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CredentialVault } from './dsh-vault.js';
import { dshPluginMount, ToolSchemaHotReload, type Json } from './dsh-plugin.js';

const SECRET = 'AEGIS_CANARY_SECRET_999';

function tmpHome(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('CredentialVault (DSH-BUG-02/03)', () => {
  it('round-trips via DPAPI when present, else via the logged keyfile fallback; never stores plaintext', async () => {
    const home = tmpHome('cordis-vault-');
    try {
      const vault = new CredentialVault(home); // win32 → tries DPAPI once
      await vault.protectKey('dsk-api-key', SECRET);

      expect(await vault.retrieve('dsk-api-key')).toBe(SECRET);

      // relocated $DSH_HOME: <homeDir>/astram/dsh_home, desktop updates can't wipe it
      expect(vault.dshHome).toBe(path.join(home, 'astram', 'dsh_home'));
      const vaultJson = fs.readFileSync(path.join(vault.dshHome, 'vault.json'), 'utf8');
      expect(vaultJson).not.toContain(SECRET); // stored value is AES-256-GCM ciphertext
      expect(vaultJson).toContain('ciphertext');
      expect(vaultJson).toContain('wrappedKey');

      if (vault.dpapiDowngraded) {
        // DPAPI unavailable here: keyfile fallback must be in place (and logged)
        expect(vault.wrapMode).toBe('keyfile');
        expect(fs.existsSync(path.join(vault.dshHome, '.vault-key'))).toBe(true);
      } else {
        expect(vault.wrapMode).toBe('dpapi');
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('explicit keyfile fallback round-trips; key file holds no plaintext secret', async () => {
    const home = tmpHome('cordis-vault-fb-');
    try {
      const vault = new CredentialVault(home, { dpapiEnabled: false });
      await vault.protectKey('dsk-key', SECRET);
      expect(vault.wrapMode).toBe('keyfile');
      expect(vault.dpapiDowngraded).toBe(false); // DPAPI never attempted → no downgrade flag
      const keyRaw = fs.readFileSync(path.join(vault.dshHome, '.vault-key'), 'utf8');
      expect(keyRaw).not.toContain(SECRET);
      expect(await vault.retrieve('dsk-key')).toBe(SECRET);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails cleanly on tampered ciphertext (wrong-key) and on missing entries', async () => {
    const home = tmpHome('cordis-vault-tamper-');
    try {
      const vault = new CredentialVault(home, { dpapiEnabled: false });
      await vault.protectKey('dsk-key', SECRET);

      // tamper: flip the first ciphertext byte in vault.json
      const vp = path.join(vault.dshHome, 'vault.json');
      const parsed = JSON.parse(fs.readFileSync(vp, 'utf8')) as {
        entries: Record<string, { ciphertext: string }>;
      };
      const ct = Buffer.from(parsed.entries['dsk-key']!.ciphertext, 'base64');
      ct[0] = (ct[0] ?? 0) ^ 0xff;
      parsed.entries['dsk-key']!.ciphertext = ct.toString('base64');
      fs.writeFileSync(vp, JSON.stringify(parsed));

      await expect(vault.retrieve('dsk-key')).rejects.toThrow(/failed to decrypt entry 'dsk-key'/);
      await expect(vault.retrieve('never-protected')).rejects.toThrow(/no such entry 'never-protected'/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('ToolSchemaHotReload (DSH-BUG-04)', () => {
  const existing: Json[] = [
    { type: 'function', function: { name: 'core.read', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'core.write', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'core.list', parameters: { type: 'object' } } },
  ];
  const additions: Json[] = [
    { type: 'function', function: { name: 'aegis.status', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'aegis.vault', parameters: { type: 'object' } } },
  ];

  it('appends at the tail: prefix indices, references and serialization unchanged', () => {
    const hr = new ToolSchemaHotReload();
    const prefixBefore = JSON.stringify(existing);
    const seen: Json[][] = [];
    hr.onToolsUpdated((tools) => {
      seen.push(tools);
    });

    const next = hr.appendToolDefinitions(existing, additions);
    expect(next).toHaveLength(existing.length + additions.length);
    // exact serialized prefix → the prompt/KV-cache prefix stays valid
    expect(JSON.stringify(next.slice(0, existing.length))).toBe(prefixBefore);
    for (let i = 0; i < existing.length; i++) {
      expect(next[i]).toBe(existing[i]); // identity, not a copy
    }
    // tools-updated fired once with the new list
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(next);
    // a second append keeps the earlier tail stable as well
    const next2 = hr.appendToolDefinitions(next, [
      { type: 'function', function: { name: 'x.y', parameters: { type: 'object' } } },
    ]);
    expect(JSON.stringify(next2.slice(0, next.length))).toBe(JSON.stringify(next));
    expect(hr.revisionCount).toBe(2);
  });

  it('unsubscribe stops events; listener errors never break the reload', () => {
    const hr = new ToolSchemaHotReload();
    let fired = 0;
    const off = hr.onToolsUpdated(() => {
      fired += 1;
    });
    hr.onToolsUpdated(() => {
      throw new Error('broken listener');
    });
    const next = hr.appendToolDefinitions([], [{ type: 'function', function: { name: 'a.b' } }]);
    expect(next).toHaveLength(1);
    expect(fired).toBe(1);
    off();
    hr.appendToolDefinitions(next, []);
    expect(fired).toBe(1);
  });
});

describe('dshPluginMount', () => {
  it('mounts aegis.status at the tail via hot-reload, self-heals on tools-updated, vault works', async () => {
    const home = tmpHome('cordis-dsh-mount-');
    try {
      let handler: ((payload?: unknown) => void) | undefined;
      const ctx = {
        tools: [{ type: 'function', function: { name: 'core.read' } }],
        on: (_event: string, cb: (payload?: unknown) => void): void => {
          handler = cb;
        },
      };
      const res = dshPluginMount(ctx, { homeDir: home });

      expect(res.mounted).toEqual(['aegis.status']);
      expect(res.tools).toHaveLength(2);
      const mounted = res.tools[1] as { function: { name: string } };
      expect(mounted.function.name).toBe('aegis.status');
      expect(res.tools[0]).toBe(ctx.tools[0]); // prefix preserved

      // harness reset drops astram tools → tools-updated self-heal re-appends
      const coreOnly: Json[] = [{ type: 'function', function: { name: 'core.read' } }];
      const before = res.hotReload.revisionCount;
      handler?.({ tools: coreOnly });
      expect(res.hotReload.revisionCount).toBe(before + 1);

      // the mounted vault round-trips a secret into the relocated dsh home
      await res.vault.protectKey('dsk', SECRET);
      expect(await res.vault.retrieve('dsk')).toBe(SECRET);

      // idempotent re-mount appends nothing new
      const again = dshPluginMount({ tools: res.tools, on: () => {} }, { homeDir: home });
      expect(again.mounted).toEqual([]);
      expect(again.tools).toHaveLength(2);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
