import { describe, expect, it } from "vitest";
import { feedbackUrl, REPO_URL } from "./feedback";

describe("feedbackUrl", () => {
  const url = (platform: "darwin" | "win32" | "linux", language: "en" | "it") =>
    new URL(feedbackUrl({ version: "0.0.20", build: "ab12cd3", platform, language }));

  it("opens a new issue in the repository, with no title", () => {
    const u = url("darwin", "it");
    expect(`${u.origin}${u.pathname}`).toBe(`${REPO_URL}/issues/new`);
    expect(u.searchParams.get("title")).toBe("");
  });

  it("starts the body with the version, build, system and language", () => {
    expect(url("darwin", "it").searchParams.get("body")).toBe(
      "Tost Work 0.0.20 (build ab12cd3)\nOS: macOS\nLanguage: Italian\n\n",
    );
    expect(url("win32", "en").searchParams.get("body")).toContain("OS: Windows\nLanguage: English");
    expect(url("linux", "en").searchParams.get("body")).toContain("OS: Linux");
  });
});
