import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dropSent, useUnsent } from "./useUnsent";

let set: (value: string) => void = () => {};
function Box({ id }: { id: string }) {
  const [value, setValue] = useUnsent(`${id}:message`, "");
  set = setValue;
  return <p>{value}</p>;
}

describe("unsent text kept per task", () => {
  it("comes back when the task opens again, and goes once it is sent, even with the task closed", () => {
    const first = render(<Box id="t1" />);
    act(() => set("Shorter"));
    first.unmount();
    expect(render(<Box id="t1" />).container.textContent).toBe("Shorter");
    // The send finished after the task was closed: what was sent is dropped.
    dropSent("t1:message", "Shorter");
    expect(render(<Box id="t1" />).container.textContent).toBe("");
  });

  it("keeps text changed since the send", () => {
    const box = render(<Box id="t2" />);
    act(() => set("Shorter, please"));
    box.unmount();
    dropSent("t2:message", "Shorter");
    expect(render(<Box id="t2" />).container.textContent).toBe("Shorter, please");
  });
});
