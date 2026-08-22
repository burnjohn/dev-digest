import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, Finding } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

let seq = 0;
const FINDING = (over: Partial<Finding>): Finding => ({
  id: `f${seq++}`,
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A live key is committed.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  ...over,
});

const PR = (over: Partial<PrMeta>): PrMeta => ({
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc1234",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: null,
  updated_at: new Date().toISOString(),
  score: 61,
  cost_usd: 0.014,
  findings: null,
  ...over,
});

function renderRow(pr: PrMeta, repoFullName?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr} repoId="r1" repoFullName={repoFullName ?? null} />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — FINDINGS cell", () => {
  it("shows per-severity count chips when the PR has findings", () => {
    renderRow(
      PR({
        findings: [
          FINDING({ severity: "CRITICAL" }),
          FINDING({ severity: "CRITICAL" }),
          FINDING({ severity: "WARNING" }),
        ],
      }),
    );
    // Two chips (CRITICAL=2, WARNING=1); SUGGESTION omitted (zero).
    expect(screen.getByTitle("2 critical")).toBeInTheDocument();
    expect(screen.getByTitle("1 warning")).toBeInTheDocument();
    expect(screen.queryByTitle(/suggestion/)).not.toBeInTheDocument();
  });

  it("reveals the findings popover on hover", () => {
    renderRow(
      PR({ findings: [FINDING({ title: "Hardcoded Stripe secret key" })] }),
      "acme/payments-api",
    );
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
    // Hover the FindingsHoverCard wrapper (chip → chips group → wrapper).
    const chip = screen.getByTitle("1 critical");
    const wrapper = chip.parentElement!.parentElement!;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText("1 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("renders '—' in the findings cell when the PR is reviewed but clean", () => {
    renderRow(PR({ score: 95, findings: [] }));
    // No severity chips; score (95) still renders, so the only em dash is the
    // findings cell.
    expect(screen.queryByTitle(/critical|warning|suggestion/)).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
