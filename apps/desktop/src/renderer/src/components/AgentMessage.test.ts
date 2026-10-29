import { describe, expect, it } from "vitest";
import { messageHtml, messagePlain, typingRate } from "./AgentMessage";

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

describe("messagePlain", () => {
  it("keeps paragraphs apart and list items on their lines, without Markdown marks", () => {
    const html = messageHtml(
      "Ecco la scaletta.\nPrima riga\n\n1. **Perché** il corso\n2. Chi partecipa\n\n- uno\n- due",
    );
    expect(messagePlain(html)).toBe(
      "Ecco la scaletta.\nPrima riga\n\n1. Perché il corso\n2. Chi partecipa\n\n- uno\n- due",
    );
  });

  it("keeps nested lists, quoted paragraphs, code indentation and loose text apart", () => {
    const nested = messageHtml("- Prezzi\n  - manodopera\n  - materiali\n- Date");
    expect(messagePlain(nested)).toBe("- Prezzi\n   - manodopera\n   - materiali\n- Date");
    expect(messagePlain(messageHtml("> Prima.\n>\n> Seconda."))).toBe("Prima.\n\nSeconda.");
    expect(messagePlain(messageHtml("```\n  indented\nnot\n```"))).toBe("  indented\nnot");
    expect(messagePlain("loose <strong>text</strong><p>Then a paragraph.</p>")).toBe("loose text\n\nThen a paragraph.");
  });
});

describe("typingRate", () => {
  it("types an answer that came all at once at about the pace an AI writes, not in a flash", () => {
    // Shows a 1,500-character recap the way the window does, a tenth of a second at a time.
    let shown = 0;
    let seconds = 0;
    while (shown < 1500) {
      shown += typingRate(1500 - shown) / 10;
      seconds += 0.1;
    }
    expect(seconds).toBeGreaterThan(5);
    expect(typingRate(20)).toBe(120);
    expect(typingRate(100_000)).toBe(300);
  });
});
