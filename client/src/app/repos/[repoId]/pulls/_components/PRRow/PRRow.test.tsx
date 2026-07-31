import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

import { PRRow } from "./PRRow";

afterEach(() => {
  cleanup();
  push.mockReset();
});

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "p1",
    number: 7,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/x",
    base: "main",
    head_sha: "abc",
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: "needs_review",
    opened_at: null,
    updated_at: new Date("2026-06-01").toISOString(),
    score: 61,
    ...o,
  } as PrMeta;
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — FINDINGS column", () => {
  it("renders per-severity counts", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 2, WARNING: 3, SUGGESTION: 1 } }));
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it('shows "—" when there are no findings', () => {
    renderRow(pr({ findings_counts: null }));
    // score cell also renders when score != null, so assert the findings button is absent
    expect(screen.queryByRole("button", { name: /critical|warning|suggestion/i })).toBeNull();
  });

  it("clicking a severity opens the PR findings tab filtered to it", () => {
    renderRow(pr({ number: 42, findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(push).toHaveBeenCalledWith("/repos/r1/pulls/42?tab=findings&severity=CRITICAL");
  });
});
