import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/eval.json";
import shellMessages from "../../../../../../../../../messages/en/shell.json";
import { ApiError } from "@/lib/api";

const createMutate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useCreateSkillEvalCase: () => ({ mutate: createMutate, isPending: false }),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), toast: vi.fn() }),
}));

import { NewSkillCaseModal } from "./NewSkillCaseModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SKILL: Skill = {
  id: "skill-1",
  name: "secret-leakage-gate",
  description: "Flags hardcoded secrets.",
  type: "security",
  source: "manual",
  body: "# Secret leakage gate\nFlag any `sk_live_` prefixed literal.",
  enabled: true,
  version: 1,
};

function renderModal(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages, shell: shellMessages }}>
      <NewSkillCaseModal skill={SKILL} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("NewSkillCaseModal", () => {
  it("submits the diff-tab fields as a hand-authored case, then toasts success and closes on a clean create", () => {
    const onClose = renderModal();

    fireEvent.change(screen.getByLabelText(messages.caseEditor.nameLabel), {
      target: { value: "stripe-key-leak" },
    });
    // The diff placeholder is multi-line; RTL's whitespace normalizer
    // collapses the DOM text but doesn't normalize the matcher string for an
    // exact-string match, so match on a distinctive substring instead.
    fireEvent.change(screen.getByPlaceholderText(/stripeKey/), {
      target: { value: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b" },
    });
    fireEvent.change(screen.getByLabelText(messages.caseEditorPanel.filesLabel), {
      target: { value: "src/x.ts" },
    });
    fireEvent.change(screen.getByLabelText(messages.caseEditorPanel.expectationFile), {
      target: { value: "src/x.ts" },
    });

    fireEvent.click(screen.getByRole("button", { name: messages.caseEditor.save }));

    expect(createMutate).toHaveBeenCalledWith(
      {
        skillId: "skill-1",
        input: expect.objectContaining({
          name: "stripe-key-leak",
          input_diff: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b",
          input_files: ["src/x.ts"],
          input_meta: { pr_number: null, title: "", body: null },
          expectation: expect.objectContaining({ type: "must_find", file: "src/x.ts", start_line: 1, end_line: 1 }),
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    // Simulate the mutation resolving.
    const { onSuccess } = createMutate.mock.calls[0]![1] as { onSuccess: () => void };
    onSuccess();
    expect(toastSuccess).toHaveBeenCalledWith(messages.caseEditor.save);
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to the PR-meta tab to submit input_meta from title/body, and surfaces a 422's own message on error without closing", () => {
    const onClose = renderModal();

    fireEvent.click(screen.getByRole("button", { name: messages.caseEditor.tabs.prMeta }));
    fireEvent.change(screen.getByLabelText(messages.caseEditorPanel.prTitleLabel), {
      target: { value: "Fix auth" },
    });
    fireEvent.change(screen.getByLabelText(messages.caseEditorPanel.prBodyLabel), {
      target: { value: "Rotates the leaked key." },
    });
    fireEvent.change(screen.getByLabelText(messages.caseEditorPanel.expectationFile), {
      target: { value: "src/x.ts" },
    });

    fireEvent.click(screen.getByRole("button", { name: messages.caseEditor.save }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          input_meta: { pr_number: null, title: "Fix auth", body: "Rotates the leaked key." },
        }),
      }),
      expect.anything(),
    );

    const { onError } = createMutate.mock.calls[0]![1] as { onError: (err: unknown) => void };
    onError(new ApiError("Diff too large", 422, "diff_too_large"));
    expect(toastError).toHaveBeenCalledWith("Diff too large");
    expect(onClose).not.toHaveBeenCalled();
  });
});
