import { describe, expect, it } from "vitest";
import { messageHtml } from "./AgentMessage";

describe("messageHtml", () => {
  it("keeps paragraphs, line breaks, lists and bold", () => {
    const html = messageHtml("Ecco la scaletta.\nPrima riga\n\n1. **Perché** il corso\n2. Chi partecipa");
    expect(html).toContain("<p>Ecco la scaletta.<br>Prima riga</p>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<strong>Perché</strong>");
  });

  it("drops scripts, images and link targets", () => {
    const html = messageHtml("<script>alert(1)</script>Vedi [qui](https://example.com) ![x](https://e.com/a.png)");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("href");
    expect(html).not.toContain("<img");
    expect(html).toContain("qui");
  });

  it("keeps out every tag that could load something, such as a video poster", () => {
    const html = messageHtml(
      '<video poster="https://e.com/p.png" src="https://e.com/v.mp4"></video><audio src="x"></audio>Testo',
    );
    expect(html).not.toMatch(/video|audio|poster|src=/);
    expect(html).toContain("Testo");
  });
});
