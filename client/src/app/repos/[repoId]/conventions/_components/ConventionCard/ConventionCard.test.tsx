import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

const patchMutateAsync = vi.fn().mockResolvedValue({});

// Mocked at the HOOK boundary, not global fetch (see client/INSIGHTS.md).
vi.mock("../../../../../../lib/hooks/conventions", () => ({
  useUpdateConvention: () => ({ mutateAsync: patchMutateAsync, isPending: false }),
}));

import { ConventionCard, evidenceRef } from "./ConventionCard";

const candidate = (over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  category: "async",
  rule: "Always use async/await instead of .then() chains",
  rationale: "Every sampled handler awaits its data-access calls.",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  evidence_start_line: 23,
  evidence_end_line: 31,
  support_count: 6,
  support_files: ["src/api/users.ts"],
  confidence: 0.91,
  status: "pending",
  skill_id: null,
  ...over,
});

afterEach(() => {
  cleanup();
  patchMutateAsync.mockClear();
});

function renderCard(
  c: ConventionCandidate,
  opts: {
    onAccept?: () => void;
    onReject?: () => void;
    repoFullName?: string | null;
    gitRef?: string | null;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={c}
        repoId="r1"
        repoFullName={opts.repoFullName}
        gitRef={opts.gitRef}
        onAccept={opts.onAccept ?? vi.fn()}
        onReject={opts.onReject ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

/** The repo coordinates the blob link is built from. */
const repo = { repoFullName: "acme/api", gitRef: "main" };

describe("evidenceRef", () => {
  it("renders a range, and collapses a single-line one", () => {
    expect(evidenceRef(candidate())).toBe("src/api/users.ts:23-31");
    expect(evidenceRef(candidate({ evidence_end_line: 23 }))).toBe("src/api/users.ts:23");
    expect(
      evidenceRef(candidate({ evidence_start_line: null, evidence_end_line: null })),
    ).toBe("src/api/users.ts");
  });
});

describe("ConventionCard", () => {
  it("shows the rule, its grounded citation, the snippet and the confidence", () => {
    renderCard(candidate());
    expect(screen.getByText(/Always use async\/await/)).toBeInTheDocument();
    // The citation is the auditable part of the card — it must be on screen.
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("6 files follow this")).toBeInTheDocument();
  });

  it("links the citation to the file on GitHub at the cited line range", () => {
    renderCard(candidate(), repo);
    const link = screen.getByRole("link", { name: "src/api/users.ts:23-31" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/api/users.ts#L23-L31",
    );
    // The citation opens beside the triage list, not on top of it.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("collapses a single-line citation to one anchor, and omits it when unlined", () => {
    renderCard(candidate({ evidence_end_line: 23 }), repo);
    expect(screen.getByRole("link", { name: "src/api/users.ts:23" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/api/users.ts#L23",
    );

    cleanup();
    renderCard(candidate({ evidence_start_line: null, evidence_end_line: null }), repo);
    expect(screen.getByRole("link", { name: "src/api/users.ts" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/api/users.ts",
    );
  });

  // Matches the form github.com's own file-tree anchors use for these segments.
  it("percent-encodes bracketed path segments, which this repo's own routes use", () => {
    renderCard(
      candidate({ evidence_path: "client/src/app/repos/[repoId]/page.tsx" }),
      repo,
    );
    expect(screen.getByRole("link", { name: /page\.tsx:23-31$/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/client/src/app/repos/%5BrepoId%5D/page.tsx#L23-L31",
    );
  });

  it("still escapes what genuinely must be escaped in a path segment", () => {
    renderCard(candidate({ evidence_path: "src/my file #1.ts" }), repo);
    expect(screen.getByRole("link", { name: /#1\.ts:23-31$/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/my%20file%20%231.ts#L23-L31",
    );
  });

  // A half-known repo would build a URL that 404s — worse than the text it replaces.
  it("stays plain text when the repo coordinates are unknown", () => {
    renderCard(candidate(), { gitRef: "main" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
  });

  it("accepting and rejecting call their handlers, not each other", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard(candidate(), { onAccept, onReject });

    fireEvent.click(screen.getByRole("button", { name: /^Accept — / }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Reject — / }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("labels the accepted state on the button rather than hiding the control", () => {
    renderCard(candidate({ status: "accepted" }));
    expect(screen.getByRole("button", { name: /^Accept — / })).toHaveTextContent("Accepted");
    // Reject stays available — accepting is not a one-way door.
    expect(screen.getByRole("button", { name: /^Reject — / })).toBeInTheDocument();
  });

  it("edits the rule and the snippet inline, saving both in one patch", async () => {
    renderCard(candidate());
    fireEvent.click(screen.getByRole("button", { name: "Edit this rule" }));

    const ruleInput = screen.getByLabelText("Rule");
    fireEvent.change(ruleInput, { target: { value: "Awaited calls only" } });
    fireEvent.change(screen.getByLabelText("Evidence snippet"), {
      target: { value: "await db.users.find(id)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(patchMutateAsync).toHaveBeenCalledWith({
      id: "c1",
      patch: { rule: "Awaited calls only", evidence_snippet: "await db.users.find(id)" },
    });
    // The form closes only after the patch resolves, so the row the user sees is
    // never the optimistic one.
    await waitFor(() => expect(screen.queryByLabelText("Rule")).not.toBeInTheDocument());
  });

  it("cannot save an empty rule", () => {
    renderCard(candidate());
    fireEvent.click(screen.getByRole("button", { name: "Edit this rule" }));
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  it("discards an abandoned draft instead of resuming it on reopen", () => {
    renderCard(candidate());
    fireEvent.click(screen.getByRole("button", { name: "Edit this rule" }));
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "half-written" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit this rule" }));
    expect(screen.getByLabelText("Rule")).toHaveValue(
      "Always use async/await instead of .then() chains",
    );
  });

  it("keeps the accept/reject buttons out of any enclosing interactive element", () => {
    // client/INSIGHTS.md: a card holding buttons must be a plain container, or
    // the parser breaks it apart and the inner controls drop out of tab order.
    renderCard(candidate());
    const accept = screen.getByRole("button", { name: /^Accept — / });
    expect(accept.closest("a")).toBeNull();
    expect(accept.parentElement?.closest("button")).toBeNull();
  });
});
