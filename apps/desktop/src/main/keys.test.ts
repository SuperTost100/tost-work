/** @vitest-environment node */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyVendor } from "../shared/model";
import { KeyStore } from "./keys";

// A reversible stand-in for safeStorage, so the test can see the key isn't written as it is.
const cipher = {
  available: () => true,
  encrypt: (text: string) => Buffer.from([...text].reverse().join("")),
  decrypt: (data: Buffer) => [...data.toString()].reverse().join(""),
};

describe("KeyStore", () => {
  it("keeps the key encrypted and shows only whose it is and how it ends", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "tw-keys-")), "key.json");
    const store = new KeyStore(file, cipher);
    expect(store.info()).toBeNull();

    const key = "sk-ant-api03-abcdefghijklmnopWXYZ";
    expect(store.save(key)).toEqual({ vendor: "anthropic", last4: "WXYZ" });
    expect(await readFile(file, "utf8")).not.toContain(key);
    expect(store.get()).toEqual({ key, vendor: "anthropic" });
    expect(store.info()).toEqual({ vendor: "anthropic", last4: "WXYZ" });

    store.remove();
    expect(store.get()).toBeNull();
  });

  it("keeps the key in memory only when there is no secure storage", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "tw-keys-")), "key.json");
    const store = new KeyStore(file, { ...cipher, available: () => false });
    const key = "sk-proj-abcdefghijklmnop1234";
    expect(store.save(key)).toEqual({ vendor: "openai", last4: "1234", untilClosed: true });
    await expect(readFile(file, "utf8")).rejects.toThrow();
    expect(store.get()).toEqual({ key, vendor: "openai" });
    // A new store, as after a restart, has no key.
    expect(new KeyStore(file, cipher).info()).toBeNull();
    store.remove();
    expect(store.info()).toBeNull();
  });

  it("offers to paste the key again when the file is cut short or can't be decrypted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tw-keys-"));
    const file = join(dir, "key.json");
    const store = new KeyStore(file, cipher);
    store.save("sk-proj-abcdefghijklmnop1234");
    expect(await readdir(dir)).toEqual(["key.json"]);

    await writeFile(file, '{"vendor":"openai","da');
    expect(store.info()).toBeNull();
    expect(store.get()).toBeNull();

    store.save("sk-proj-abcdefghijklmnop1234");
    const reset = new KeyStore(file, {
      ...cipher,
      decrypt: () => {
        throw new Error("Error while decrypting the ciphertext");
      },
    });
    expect(reset.info()).toBeNull();
    expect(reset.get()).toBeNull();
  });

  it("refuses what isn't an API key", async () => {
    const store = new KeyStore(join(await mkdtemp(join(tmpdir(), "tw-keys-")), "key.json"), cipher);
    expect(() => store.save("my password")).toThrow(/OpenAI or Anthropic/);
    expect(store.info()).toBeNull();
  });
});

describe("keyVendor", () => {
  it("tells OpenAI and Anthropic keys apart by how they start", () => {
    expect(keyVendor("sk-proj-Abc_def-1234567890xyz")).toBe("openai");
    expect(keyVendor("sk-ant-api03-Abc_def-1234567890")).toBe("anthropic");
    expect(keyVendor("sk-short")).toBeNull();
    expect(keyVendor("AIzaSyD-1234567890abcdefghij")).toBeNull();
  });
});
