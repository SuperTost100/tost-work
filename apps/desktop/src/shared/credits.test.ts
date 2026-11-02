import { describe, expect, it } from "vitest";
import { BUNDLED_ASSETS } from "./credits";

describe("BUNDLED_ASSETS", () => {
  const find = (name: string) => BUNDLED_ASSETS.find((c) => c.name === name);

  it("names the fonts and the icons with their licences", () => {
    expect(find("Schibsted Grotesk")?.license).toBe("SIL OFL 1.1");
    expect(find("IBM Plex Mono")?.license).toBe("SIL OFL 1.1");
    expect(find("MingCute icons")?.license).toBe("Apache-2.0");
  });

  it("covers the Carlito and Caladea fonts that come with their own licence files", () => {
    expect(find("Carlito")?.license).toBe("SIL OFL 1.1");
    expect(find("Caladea")?.license).toBe("SIL OFL 1.1");
  });

  it("links only to https pages", () => {
    for (const c of BUNDLED_ASSETS) expect(c.url, c.name).toMatch(/^https:\/\//);
  });
});
