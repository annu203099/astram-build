/**
 * CredentialVault — DeepSeek Harness hardening, DSH-BUG-02 & DSH-BUG-03
 * (Handbook §6.1 "Built-In Fixes for DeepSeek Harness").
 *
 * - Relocates the dsh home to <homeDir>/astram/dsh_home so desktop app
 *   updates never wipe user sessions (DSH-BUG-02/03).
 * - API keys are encrypted with AES-256-GCM (random 12-byte IV, 32-byte key).
 *   The AES key itself is wrapped via Windows DPAPI (CurrentUser scope,
 *   powershell ProtectedData::Protect). On ANY powershell failure the vault
 *   degrades to storing the wrapped key in dsh_home/.vault-key (0o600) and
 *   LOGS the downgrade — it never crashes (fail-open storage, fail-closed
 *   secrets: without the key the ciphertext stays unreadable).
 *
 * Entries persist as JSON { iv, tag, ciphertext, wrappedKey } in
 * dsh_home/vault.json. All spawns use shell:false argv arrays.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runCapture } from './spawn-util.js';

export type VaultWrapMode = 'dpapi' | 'keyfile';

export interface CredentialVaultOptions {
  /** Try DPAPI key wrapping (default: true on win32, false elsewhere). */
  dpapiEnabled?: boolean;
}

interface WrappedKey {
  mode: VaultWrapMode;
  /** base64 DPAPI blob (mode 'dpapi'); empty for keyfile mode. */
  data: string;
}

interface VaultEntry {
  iv: string; // base64, 12 bytes
  tag: string; // base64 GCM auth tag
  ciphertext: string; // base64
  wrappedKey: WrappedKey;
}

interface VaultFile {
  meta: { wrapMode: VaultWrapMode; dpapiDowngraded: boolean };
  entries: Record<string, VaultEntry>;
}

const DPAPI_TIMEOUT_MS = 15_000;

export class CredentialVault {
  /** Relocated $DSH_HOME: <homeDir>/astram/dsh_home. */
  readonly dshHome: string;

  private readonly vaultPath: string;
  private readonly keyPath: string;
  private readonly dpapiEnabled: boolean;
  private masterKey: Buffer | null = null;
  private wrappedKey: WrappedKey | null = null;
  private downgraded = false;
  private downgradeLogged = false;

  constructor(homeDir: string, opts: CredentialVaultOptions = {}) {
    this.dshHome = path.join(path.resolve(homeDir), 'astram', 'dsh_home');
    this.vaultPath = path.join(this.dshHome, 'vault.json');
    this.keyPath = path.join(this.dshHome, '.vault-key');
    this.dpapiEnabled = opts.dpapiEnabled ?? process.platform === 'win32';
    fs.mkdirSync(this.dshHome, { recursive: true });
  }

  /** Current key-wrap mode ('dpapi' when usable, else 'keyfile'). */
  get wrapMode(): VaultWrapMode {
    return this.wrappedKey?.mode ?? (this.dpapiEnabled ? 'dpapi' : 'keyfile');
  }

  /** True when DPAPI was attempted but unavailable and .vault-key is in use. */
  get dpapiDowngraded(): boolean {
    return this.downgraded;
  }

  /** Encrypt and persist a named secret. */
  async protectKey(name: string, plaintext: string): Promise<void> {
    const { key, wrapped } = await this.ensureKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const entry: VaultEntry = {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      wrappedKey: wrapped,
    };
    const vault = this.readVault();
    vault.entries[name] = entry;
    vault.meta = { wrapMode: wrapped.mode, dpapiDowngraded: this.downgraded };
    fs.writeFileSync(this.vaultPath, JSON.stringify(vault, null, 2), 'utf8');
  }

  /** Decrypt a named secret; throws a clean Error on missing entry or auth failure. */
  async retrieve(name: string): Promise<string> {
    const vault = this.readVault();
    const entry = vault.entries[name];
    if (entry === undefined) {
      throw new Error(`CredentialVault: no such entry '${name}'`);
    }
    try {
      const key = await this.unwrapKey(entry.wrappedKey);
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch (err) {
      throw new Error(`CredentialVault: failed to decrypt entry '${name}': ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ private

  private readVault(): VaultFile {
    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<VaultFile>;
      return {
        meta: parsed.meta ?? { wrapMode: 'keyfile', dpapiDowngraded: false },
        entries: parsed.entries ?? {},
      };
    } catch {
      return { meta: { wrapMode: 'keyfile', dpapiDowngraded: false }, entries: {} };
    }
  }

  /**
   * One master key per vault instance, wrapped DPAPI-style; falls back to a
   * 0o600 keyfile on any powershell failure (downgrade is logged once).
   */
  private async ensureKey(): Promise<{ key: Buffer; wrapped: WrappedKey }> {
    if (this.masterKey !== null && this.wrappedKey !== null) {
      return { key: this.masterKey, wrapped: this.wrappedKey };
    }
    // Reuse an existing keyfile (written by an earlier downgraded session).
    if (fs.existsSync(this.keyPath)) {
      const key = Buffer.from(fs.readFileSync(this.keyPath, 'utf8').trim(), 'base64');
      this.masterKey = key;
      this.wrappedKey = { mode: 'keyfile', data: '' };
      return { key, wrapped: this.wrappedKey };
    }
    const key = randomBytes(32);
    if (this.dpapiEnabled) {
      try {
        const data = await this.dpapiProtect(key);
        this.masterKey = key;
        this.wrappedKey = { mode: 'dpapi', data };
        return { key, wrapped: this.wrappedKey };
      } catch (err) {
        this.logDowngrade(err);
      }
    }
    fs.writeFileSync(this.keyPath, key.toString('base64'), { mode: 0o600 });
    this.masterKey = key;
    this.wrappedKey = { mode: 'keyfile', data: '' };
    return { key, wrapped: this.wrappedKey };
  }

  private async unwrapKey(wrapped: WrappedKey): Promise<Buffer> {
    if (wrapped.mode === 'dpapi') {
      return this.dpapiUnprotect(wrapped.data);
    }
    const raw = fs.readFileSync(this.keyPath, 'utf8').trim();
    return Buffer.from(raw, 'base64');
  }

  private async dpapiProtect(plain: Buffer): Promise<string> {
    const b64 = plain.toString('base64');
    const cmd =
      'Add-Type -AssemblyName System.Security; ' +
      "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect(" +
      `[Convert]::FromBase64String('${b64}'), $null, ` +
      '[System.Security.Cryptography.DataProtectionScope]::CurrentUser))';
    const r = await runCapture('powershell', ['-NoProfile', '-Command', cmd], { timeoutMs: DPAPI_TIMEOUT_MS });
    const out = r.stdout.trim();
    if (r.code !== 0 || out === '') {
      throw new Error(`DPAPI Protect failed (exit ${r.code}): ${(r.stderr || '').trim()}`);
    }
    return out;
  }

  private async dpapiUnprotect(wrappedB64: string): Promise<Buffer> {
    const cmd =
      'Add-Type -AssemblyName System.Security; ' +
      "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect(" +
      `[Convert]::FromBase64String('${wrappedB64}'), $null, ` +
      '[System.Security.Cryptography.DataProtectionScope]::CurrentUser))';
    const r = await runCapture('powershell', ['-NoProfile', '-Command', cmd], { timeoutMs: DPAPI_TIMEOUT_MS });
    const out = r.stdout.trim();
    if (r.code !== 0 || out === '') {
      throw new Error(`DPAPI Unprotect failed (exit ${r.code}): ${(r.stderr || '').trim()}`);
    }
    return Buffer.from(out, 'base64');
  }

  private logDowngrade(err: unknown): void {
    this.downgraded = true;
    if (!this.downgradeLogged) {
      this.downgradeLogged = true;
      // Logged downgrade — never a crash (Handbook: the harness must keep running).
      console.warn(
        `[astram] CredentialVault: DPAPI key wrap unavailable (${String(
          err instanceof Error ? err.message : err,
        )}); downgraded to .vault-key file encryption`,
      );
    }
  }
}
