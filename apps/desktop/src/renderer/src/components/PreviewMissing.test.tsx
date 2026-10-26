import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Preview } from "./Preview";

describe("a file the preview can't find", () => {
  const api = createMemoryApi();
  api.files.read = async () => null;

  it("says it's being written while the task works", async () => {
    render(<Preview api={api} taskId="t1" path="/w/Scaletta.docx" version="1" writing />);
    expect(await screen.findByText(/being written/)).toBeTruthy();
  });

  it("says it's gone once the task has stopped, without the raw error", async () => {
    render(<Preview api={api} taskId="t1" path="/w/Scaletta.docx" version="1" />);
    expect(await screen.findByText(/isn't there any more/)).toBeTruthy();
    expect(screen.queryByText(/ENOENT|remote method/)).toBeNull();
  });

  it("doesn't keep another file's preview when the newly picked one is missing", async () => {
    const reads = createMemoryApi();
    const { rerender } = render(<Preview api={reads} taskId="t1" path="/w/a.md" version="1" writing />);
    expect(await screen.findByText(/Alpi Logistica/)).toBeTruthy();
    reads.files.read = async () => null;
    rerender(<Preview api={reads} taskId="t1" path="/w/b.md" version="1" writing />);
    expect(await screen.findByText(/being written/)).toBeTruthy();
    expect(screen.queryByText(/Alpi Logistica/)).toBeNull();
  });

  it("shows the newly picked file as loading, not the last file's preview under its name", async () => {
    const reads = createMemoryApi();
    const { rerender } = render(<Preview api={reads} taskId="t1" path="/w/a.md" version="1" />);
    expect(await screen.findByText(/Alpi Logistica/)).toBeTruthy();
    reads.files.read = () => new Promise(() => {});
    rerender(<Preview api={reads} taskId="t1" path="/w/b.md" version="1" />);
    expect(screen.getByText("Opening the file…")).toBeTruthy();
    expect(screen.queryByText(/Alpi Logistica/)).toBeNull();
  });

  it("ignores a read from before, even for the same file, once a newer one started", async () => {
    const reads = createMemoryApi();
    const real = reads.files.read;
    const answers: ((v: Awaited<ReturnType<typeof real>>) => void)[] = [];
    reads.files.read = () => new Promise((resolve) => answers.push(resolve));
    const { rerender } = render(<Preview api={reads} taskId="t1" path="/w/a.md" version="1" />);
    rerender(<Preview api={reads} taskId="t1" path="/w/b.md" version="1" />);
    rerender(<Preview api={reads} taskId="t1" path="/w/a.md" version="1" />);
    // The newest read finds the file; the first one, answered last, found it missing.
    answers[2]?.(await real("t1", "/w/a.md"));
    expect(await screen.findByText(/Alpi Logistica/)).toBeTruthy();
    await act(async () => answers[0]?.(null));
    expect(screen.queryByText(/isn't there any more/)).toBeNull();
    expect(screen.getByText(/Alpi Logistica/)).toBeTruthy();
  });
});
