import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { type CourseKey, type KeyVendor, keyVendor } from "../shared/model";
import { UserError } from "./userError";

/** Encryption from the system's secure storage: Electron's safeStorage in the app, a stand-in in tests. */
export interface Cipher {
  /** False on Linux without a keyring, where nothing can be encrypted. */
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

/**
 * The course API key, encrypted in a file of its own. Only the main process reads the key itself; the interface gets
 * whose it is and its last four characters. Without secure storage the key is kept in memory only, until the app
 * closes, rather than written to disk as it is.
 */
export class KeyStore {
  private session: { key: string; vendor: KeyVendor } | null = null;

  constructor(
    private file: string,
    private cipher: Cipher,
  ) {}

  /** Whose key it is and how it ends, or null when there's none that can be used. */
  info(): CourseKey | null {
    const key = this.get();
    if (!key) return null;
    return this.session ? { ...describe(key), untilClosed: true } : describe(key);
  }

  /**
   * The key and whose it is, for a run. Null for a file that can't be read or decrypted (cut short, or a keychain
   * that was reset), so the interface offers to paste the key again instead of failing.
   */
  get(): { key: string; vendor: KeyVendor } | null {
    if (this.session) return this.session;
    const saved = this.read();
    if (!saved) return null;
    try {
      return { key: this.cipher.decrypt(Buffer.from(saved.data, "base64")), vendor: saved.vendor };
    } catch {
      return null;
    }
  }

  save(key: string): CourseKey {
    const vendor = keyVendor(key);
    if (!vendor) throw new UserError("error.notApiKey");
    if (!this.cipher.available()) {
      this.session = { key, vendor };
      rmSync(this.file, { force: true });
      return { vendor, last4: key.slice(-4), untilClosed: true };
    }
    this.session = null;
    const info = describe({ key, vendor });
    const data = this.cipher.encrypt(key).toString("base64");
    // A new file then a rename, so an interrupted save leaves the old key whole, and the file is never readable by
    // others even for a moment.
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ vendor, data }), { mode: 0o600, flag: "wx" });
    renameSync(temp, this.file);
    return info;
  }

  remove(): void {
    this.session = null;
    rmSync(this.file, { force: true });
  }

  private read(): { vendor: KeyVendor; data: string } | null {
    if (!existsSync(this.file)) return null;
    let saved: { vendor?: unknown; data?: unknown };
    try {
      saved = JSON.parse(readFileSync(this.file, "utf8")) as typeof saved;
    } catch {
      return null;
    }
    if ((saved.vendor !== "openai" && saved.vendor !== "anthropic") || typeof saved.data !== "string") return null;
    return { vendor: saved.vendor, data: saved.data };
  }
}

const describe = ({ key, vendor }: { key: string; vendor: KeyVendor }): CourseKey => ({ vendor, last4: key.slice(-4) });
