import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { load } from "./Preview";

describe("preview loading", () => {
  it("keeps empty cells so values stay in their columns", async () => {
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ["Fase", "Giorni", "Tariffa", "Totale"],
        ["Analisi", 4, 600, 2400],
        ["Totale", null, null, 9450],
      ]),
      "Prezzi",
    );
    const bytes = new Uint8Array(write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const loaded = await load({ name: "prezzi.xlsx", ext: "xlsx", bytes });
    if (loaded.kind !== "table") throw new Error(`expected a table, got ${loaded.kind}`);
    expect(loaded.rows[2]?.cells.map((c) => c.text)).toEqual(["Totale", "", "", "9450"]);
  });

  it("reads only the rows it shows from a long sheet, and counts the rest", async () => {
    const book = utils.book_new();
    const rows = Array.from({ length: 1000 }, (_, i) => [`Row ${i + 1}`, i]);
    utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Long");
    const bytes = new Uint8Array(write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const loaded = await load({ name: "long.xlsx", ext: "xlsx", bytes });
    if (loaded.kind !== "table") throw new Error(`expected a table, got ${loaded.kind}`);
    expect(loaded.rows).toHaveLength(200);
    expect(loaded.rows.at(-1)?.cells[0]?.text).toBe("Row 200");
    expect(loaded.more).toBe(800);
  });

  it("sanitises Markdown written by an agent", async () => {
    const bytes = new TextEncoder().encode('# Title\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>');
    const loaded = await load({ name: "x.md", ext: "md", bytes });
    if (loaded.kind !== "html") throw new Error("expected html");
    expect(loaded.html).toContain("<h1");
    expect(loaded.html).not.toMatch(/onerror|<script/);
  });

  it("says there's no preview for unknown kinds", async () => {
    expect((await load({ name: "deck.pptx", ext: "pptx", bytes: new Uint8Array() })).kind).toBe("none");
  });
});
