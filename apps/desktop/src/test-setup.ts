import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { forgetModelChoices } from "@/lib/lastModelChoices";
import { clearUnsent } from "@/lib/useUnsent";

// Testing Library only cleans up on its own when Vitest globals are on, which they aren't here.
afterEach(() => {
  cleanup();
  clearUnsent();
  forgetModelChoices();
});
