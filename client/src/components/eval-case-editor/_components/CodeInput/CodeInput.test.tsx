/**
 * CodeInput — `fireEvent` throughout (`@testing-library/user-event` is not a
 * client/ dependency, per T14's verified note). `Textarea` (`vendor/ui/kit`)
 * forwards no `id`/`aria-label`, so Before/After can only be queried
 * positionally — mirrors T14's `EvalCaseEditor.test.tsx` precedent.
 *
 * FIX-2: `CodeInput` is now controlled (`value` + `onChange`), so tests
 * render it behind a small stateful wrapper that owns the value the way
 * `EvalCaseEditor` does in production — real state updates via `fireEvent`,
 * not a fake.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../../../messages/en/eval.json";
import { CodeInput } from "./CodeInput";
import type { CodeInputValue } from "./CodeInput";

afterEach(cleanup);

function renderCodeInput(overrides: Partial<CodeInputValue> = {}) {
  function Wrapper() {
    const [value, setValue] = React.useState<CodeInputValue>({
      kind: "new_file",
      filename: "",
      before: "",
      after: "",
      ...overrides,
    });
    return <CodeInput value={value} onChange={setValue} />;
  }
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <Wrapper />
    </NextIntlClientProvider>,
  );
}

function textareas(): HTMLTextAreaElement[] {
  return Array.from(document.querySelectorAll("textarea"));
}

describe("CodeInput", () => {
  it("REQ-53/54: shows Code (enabled) and PR meta (disabled, reason in its accessible name), no Diff tab, and both New file / Modified file sub-tabs", () => {
    renderCodeInput();
    expect(screen.getByRole("tab", { name: "Code" })).toBeEnabled();
    expect(screen.queryByRole("tab", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /PR metadata is not fed to the reviewer/i })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "New file" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Modified file" })).toBeInTheDocument();
  });

  it("New file shows a single After editor; Modified file adds a Before editor above it", () => {
    renderCodeInput();
    expect(textareas()).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Modified file" }));
    expect(textareas()).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "New file" }));
    expect(textareas()).toHaveLength(1);
  });

  it("warns (without blocking) when After is empty, and the warning clears once text is entered", () => {
    renderCodeInput();
    expect(screen.getByText(/After is empty/i)).toBeInTheDocument();

    fireEvent.change(textareas()[0]!, { target: { value: "export const x = 1;" } });
    expect(screen.queryByText(/After is empty/i)).not.toBeInTheDocument();
  });

  it("owns no diff preview: REQ-60's disclosure moved to the modal's pinned zone", () => {
    renderCodeInput();
    // Mutation this kills: re-adding the toggle here — as a sibling of the
    // editor region it gets painted over the Before box whenever that region
    // is squeezed. `EvalCaseEditor.test.tsx` covers the disclosure itself.
    expect(screen.queryByRole("button", { name: /Preview generated diff/i })).not.toBeInTheDocument();
  });

  it("FIX-2: filename, and both Before/After, are reflected via onChange — the write path has state to read", () => {
    renderCodeInput();
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "src/index.ts" } });
    expect(screen.getByLabelText("Filename")).toHaveValue("src/index.ts");

    fireEvent.click(screen.getByRole("tab", { name: "Modified file" }));
    fireEvent.change(textareas()[0]!, { target: { value: "const x = 1;" } });
    fireEvent.change(textareas()[1]!, { target: { value: "const x = 2;" } });
    expect(textareas()[0]).toHaveValue("const x = 1;");
    expect(textareas()[1]).toHaveValue("const x = 2;");
  });
});
