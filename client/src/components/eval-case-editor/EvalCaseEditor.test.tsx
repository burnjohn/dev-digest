/**
 * EvalCaseEditor — the shared eval-case editor modal. `@testing-library/
 * user-event` is not a client/ dependency (verified this run, absent from
 * package.json/lockfile/node_modules) — every interaction below uses
 * `fireEvent`, matching the rest of this package's `*.test.tsx` files.
 *
 * Two of `Textarea`'s consumers here (Diff, Expected output) can only be
 * queried positionally: the vendored `Textarea` primitive (`vendor/ui/kit`,
 * outside this task's owned paths) forwards neither `id` nor `aria-label`,
 * so no accessible query reaches it — flagged in the implementer report.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseRecord } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";
import commonMessages from "../../../messages/en/common.json";
import { ApiError } from "@/lib/api";

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const runMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: runMutateAsync, isPending: false }),
  useDeleteEvalCase: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(() => {
  cleanup();
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
  runMutateAsync.mockReset();
  deleteMutateAsync.mockReset();
});

function caseRecord(over: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "stripe-key-leak",
    expectation_kind: "must_find",
    input_diff: "--- a/x\n+++ b/x",
    input_files: null,
    input_meta: null,
    expected_output: [
      {
        severity: "CRITICAL",
        category: "security",
        title: "Hardcoded Stripe secret key",
        start_line: 12,
        end_line: 12,
        file: "src/config.ts",
      },
    ],
    forbidden_regions: null,
    filename: null,
    notes: null,
    ...over,
  };
}

function renderEditor(props: Partial<React.ComponentProps<typeof EvalCaseEditor>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <EvalCaseEditor ownerKind="agent" ownerId="agent-1" onClose={onClose} {...props} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

/** DOM order: the Input column (Diff) renders before the Expected output column. */
function textareas(): HTMLTextAreaElement[] {
  return Array.from(document.querySelectorAll("textarea"));
}

describe("EvalCaseEditor", () => {
  it("REQ-43/44/48: reads must_not_flag/NEGATIVE on a blank case, flips to must_find/POSITIVE the moment expected_output is filled, and back when emptied — no control sets the kind", () => {
    renderEditor();
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(screen.getByText("MUST NOT flag")).toBeInTheDocument();

    const expectedOutput = textareas()[1]!;
    fireEvent.change(expectedOutput, {
      target: {
        value: JSON.stringify([
          {
            severity: "CRITICAL",
            category: "security",
            title: "Missing auth check",
            start_line: 9,
            end_line: 12,
            file: "client/src/lib/api.ts",
          },
        ]),
      },
    });

    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(screen.getByText('MUST find "Missing auth check" at client/src/lib/api.ts:9')).toBeInTheDocument();

    const banner = screen.getByText("POSITIVE CASE").closest("div")!;
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(within(banner).queryByRole("switch")).toBeNull();

    fireEvent.change(expectedOutput, { target: { value: "[]" } });
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
  });

  it("REQ-53/54: Diff is enabled; Files/PR meta are disabled, and PR meta's accessible name states metadata is not fed to the reviewer", () => {
    renderEditor();
    expect(screen.getByRole("tab", { name: "Diff" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Files" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /PR metadata is not fed to the reviewer/i })).toBeDisabled();
  });

  it("REQ-49/11/50: shows 'Never run yet' on a fresh case, and Run on save + Save runs once, rendering pass/duration/cost with no second action", async () => {
    createMutateAsync.mockResolvedValue(caseRecord({ id: "new-case" }));
    runMutateAsync.mockResolvedValue({
      run_id: "run-1",
      case_id: "new-case",
      ran_at: "2026-08-28T00:00:00Z",
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      actual_output: { findings: [] },
      ablation: null,
      duration_ms: 1800,
      cost_usd: 0.02,
    });

    renderEditor();
    expect(screen.getByText("Never run yet")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.click(screen.getByRole("switch", { name: "Run on save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Last run passed");
    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    expect(runMutateAsync).toHaveBeenCalledWith("new-case");
    // The strip reads tally · duration · cost — not recall/precision/citation,
    // which are the dashboard's job.
    expect(screen.getByText("1/1 passed · 1.8s · $0.02")).toBeInTheDocument();
  });

  it("REQ-50: a failed run reads 'Last run failed' with a 0/1 tally, its duration and its cost", async () => {
    createMutateAsync.mockResolvedValue(caseRecord({ id: "new-case" }));
    runMutateAsync.mockResolvedValue({
      run_id: "run-2",
      case_id: "new-case",
      ran_at: "2026-08-28T00:00:00Z",
      pass: false,
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      actual_output: { findings: [] },
      ablation: null,
      duration_ms: 8200,
      cost_usd: 0,
    });

    renderEditor();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "Run case" }));

    await screen.findByText("Last run failed");
    expect(screen.getByText("0/1 passed · 8.2s · $0.00")).toBeInTheDocument();
  });

  it("REQ-10: a server rejection surfaces its field-level message and keeps the modal open with the user's input intact", async () => {
    createMutateAsync.mockRejectedValue(
      new ApiError("expected_output[0].severity: Invalid enum value", 422, "validation_error"),
    );

    renderEditor();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.change(textareas()[1]!, {
      target: {
        value: JSON.stringify([
          { severity: "NOT_REAL", category: "security", title: "x", start_line: 1, end_line: 1, file: "a.ts" },
        ]),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("expected_output[0].severity: Invalid enum value");
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("stripe-key-leak");
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("Delete is an EDIT-only control: a new case never shows it, not even after a run has persisted it", async () => {
    createMutateAsync.mockResolvedValue(caseRecord({ id: "case-new" }));
    runMutateAsync.mockResolvedValue({
      case_id: "case-new",
      pass: false,
      actual_output: [],
      duration_ms: 23800,
      cost_usd: 0.0001,
    });
    renderEditor();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "from-finding" } });
    fireEvent.click(screen.getByRole("button", { name: "Run case" }));
    // The run persists the draft (mockup 7/8), so `savedCaseId` is now set —
    // that must NOT be what surfaces a destructive control.
    await screen.findByText(/Last run failed/);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("REQ-12: deleting from the editor requires a confirmation step — it is never immediate", async () => {
    deleteMutateAsync.mockResolvedValue({ ok: true });
    const { onClose } = renderEditor({ initialCase: caseRecord() });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteMutateAsync).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole("button", { name: "Delete" });
    expect(confirmButtons.length).toBeGreaterThan(1);
    fireEvent.click(confirmButtons.at(-1)!);
    expect(deleteMutateAsync).toHaveBeenCalledWith("case-1");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Escape closes the modal (composed via T3's Modal trap/restore)", () => {
    const { onClose } = renderEditor();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("FIX-2: an agent-owned save's payload carries no input_files/filename key at all — unchanged by the skill-arm write path", async () => {
    createMutateAsync.mockResolvedValue(caseRecord({ id: "agent-case-1" }));
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const payload = createMutateAsync.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("input_files");
    expect(payload).not.toHaveProperty("filename");
  });

  /* Save persists but the modal stays open by design (REQ-11) and no call site
     passes `onSaved`, so with `Run on save` off the screen used to be
     identical before and after — the action read as a no-op. These two cover
     the confirmation and, just as importantly, its withdrawal. */
  it("a successful Save with Run on save OFF confirms itself: a 'Saved' status plus the retitled dialog", async () => {
    createMutateAsync.mockResolvedValue(caseRecord({ id: "new-case" }));
    renderEditor();
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Mutation this kills: dropping the `isSaved` render — the save would be
    // silent again, which is the whole defect.
    const saved = await screen.findByText("Saved");
    expect(saved).toHaveAttribute("role", "status");
    expect(screen.getByText("Eval case · stripe-key-leak")).toBeInTheDocument();
    expect(screen.queryByText("New eval case")).toBeNull();
    // The confirmation is a separate element, not a relabelled button.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(runMutateAsync).not.toHaveBeenCalled();
  });

  it("editing after a save withdraws the confirmation — 'Saved' never stands over edited-since content", async () => {
    createMutateAsync.mockResolvedValue(caseRecord({ id: "new-case" }));
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");

    // Mutation this kills: storing a boolean `saved` flag instead of comparing
    // the payload — the note would stay put over content that is now unsaved.
    fireEvent.change(textareas()[0]!, { target: { value: "--- a/edited\n+++ b/edited" } });
    expect(screen.queryByText("Saved")).toBeNull();
    expect(createMutateAsync).toHaveBeenCalledTimes(1);

    // Saving the edit brings it back — via PUT, since the case already has an id.
    updateMutateAsync.mockResolvedValue(caseRecord({ id: "new-case" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
  });

  describe("skill-owned case (T20)", () => {
    it("REQ-53/54: renders CodeInput (Code | PR meta, no Diff tab) instead of the agent Input tab set", () => {
      renderEditor({ ownerKind: "skill", ownerId: "skill-1" });
      expect(screen.getByRole("tab", { name: "Code" })).toBeEnabled();
      expect(screen.queryByRole("tab", { name: "Diff" })).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /PR metadata is not fed to the reviewer/i })).toBeDisabled();
      expect(screen.getByRole("tab", { name: "New file" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Modified file" })).toBeInTheDocument();
    });

    it("REQ-55: the 'Finding skeleton' action appends a finding with no `file` key on a skill case", () => {
      renderEditor({ ownerKind: "skill", ownerId: "skill-1" });
      fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
      // DOM order: CodeInput's own "After" textarea (New file, the default
      // sub-tab) renders before the Expected output textarea.
      const raw = textareas()[1]!.value;
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(1);
      expect("file" in parsed[0]).toBe(false);
    });

    it("FIX-2/REQ-56/57/59: a skill-owned save transmits the authored before/after source and filename in the request body", async () => {
      createMutateAsync.mockResolvedValue(caseRecord({ owner_kind: "skill", id: "skill-case-1" }));

      renderEditor({ ownerKind: "skill", ownerId: "skill-1" });

      fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "leaked-secret" } });
      fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "src/index.ts" } });
      fireEvent.click(screen.getByRole("tab", { name: "Modified file" }));

      // DOM order once "Modified file" is active: CodeInput's Before, then
      // After (the Expected output textarea comes after both — see the
      // REQ-55 test above for that positional convention).
      const codeTextareas = textareas();
      fireEvent.change(codeTextareas[0]!, { target: { value: "const x = 1;" } });
      fireEvent.change(codeTextareas[1]!, { target: { value: "const x = 2;" } });

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await vi.waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
      const payload = createMutateAsync.mock.calls[0]![0];
      expect(payload.input_files).toEqual({
        kind: "modified_file",
        filename: "src/index.ts",
        before: "const x = 1;",
        after: "const x = 2;",
      });
      expect(payload.filename).toBe("src/index.ts");
    });

    it("REQ-60: Preview generated diff still renders the case's STORED input_diff verbatim on a skill case", () => {
      renderEditor({
        ownerKind: "skill",
        ownerId: "skill-1",
        initialCase: caseRecord({ owner_kind: "skill", input_diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new" }),
      });
      expect(screen.queryByText(/--- a\/x/)).not.toBeInTheDocument();
      // The literal "› " prefix is gone — the chevron is an icon that rotates
      // on `aria-expanded`, so the button is queried by its accessible name.
      fireEvent.click(screen.getByRole("button", { name: /Preview generated diff/i }));
      expect(screen.getByText(/--- a\/x/)).toBeInTheDocument();
      expect(screen.getByText(/-old/)).toBeInTheDocument();
    });

    /* Layout regression guard. The Before/After editors are the pane's only
       flexible region, so "Modified file" must render TWO of them and "New
       file" exactly one — a redesign that collapsed the split back to a single
       editor, or left Before mounted on the New-file tab, would still satisfy
       every other test in this file. */
    it("the code region holds two editors on Modified file and one on New file", () => {
      renderEditor({ ownerKind: "skill", ownerId: "skill-1" });
      expect(screen.getByText("After")).toBeInTheDocument();
      expect(screen.queryByText("Before")).not.toBeInTheDocument();
      // New file: After + Expected output, nothing else.
      expect(textareas()).toHaveLength(2);

      fireEvent.click(screen.getByRole("tab", { name: "Modified file" }));
      expect(screen.getByText("Before")).toBeInTheDocument();
      expect(screen.getByText("After")).toBeInTheDocument();
      expect(textareas()).toHaveLength(3);
    });

    it("a skill case's Actual output is ONE block whose JSON still carries both arms — no per-arm panels, no lift row", async () => {
      updateMutateAsync.mockResolvedValue(caseRecord({ owner_kind: "skill", id: "case-1" }));
      runMutateAsync.mockResolvedValue({
        run_id: "run-1",
        case_id: "case-1",
        ran_at: "2026-08-28T00:00:00Z",
        pass: true,
        recall: 0.8,
        precision: 0.9,
        citation_accuracy: 1,
        actual_output: {
          with: { recall: 0.8, precision: 0.9, citation_accuracy: 1, findings: [] },
          without: { recall: 0.6, findings: [] },
        },
        ablation: {
          with: { recall: 0.8, precision: 0.9, citation_accuracy: 1, findings: [] },
          without: { recall: 0.6, findings: [] },
        },
        duration_ms: 1000,
        cost_usd: 0.02,
      });

      renderEditor({ ownerKind: "skill", ownerId: "skill-1", initialCase: caseRecord({ owner_kind: "skill" }) });

      fireEvent.click(screen.getByRole("button", { name: "Run case" }));
      expect(await screen.findByText(/recall 80% · precision 90% · citation 100%/)).toBeInTheDocument();
      expect(screen.getByText(/"with"/)).toBeInTheDocument();
      expect(screen.getByText(/"without"/)).toBeInTheDocument();
      // Owner call 2026-08-29: both arms stay in the JSON, but the two-panel
      // chrome and the lift row belong to the case list and the dashboard.
      expect(screen.queryByText("With skill")).not.toBeInTheDocument();
      expect(screen.queryByText("Without skill")).not.toBeInTheDocument();
      expect(screen.queryByText("+20%")).not.toBeInTheDocument();
    });
  });
});
