/**
 * IntentCard tests — design conformance:
 * scope column headers (✓ IN SCOPE / ✕ OUT OF SCOPE), middot bullets per item,
 * optional RISK AREAS section (rendered only when risks are provided) with
 * an accordion whose open item's detail renders in a shared panel below the
 * grid (only one open at a time, accent-color border on the open card,
 * inline `code` chips in the explanation), and clickable `path:line` nav.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Intent, Risks } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const navigateMock = vi.fn();
vi.mock("@/lib/diff-nav", () => ({
  useDiffNavigate: () => navigateMock,
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
});

const INTENT: Intent = {
  intent: "Add rate limiting to public API endpoints to prevent abuse.",
  in_scope: ["Add middleware for rate limiting", "Apply to /api/public/* routes"],
  out_of_scope: ["Authentication changes"],
};

const RISKS: Risks = {
  risks: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "Middleware runs before auth.",
      severity: "high",
      file_refs: [],
    },
    {
      kind: "dependency",
      title: "New dependency: ioredis",
      explanation: "Adds a runtime dependency.",
      severity: "medium",
      file_refs: [],
    },
  ],
};

function renderCard(risks?: Risks | null, changedPaths?: Set<string>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <IntentCard intent={INTENT} risks={risks} changedPaths={changedPaths} />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders the quote and scope column headers", () => {
    renderCard();
    expect(screen.getByText(/Add rate limiting to public API endpoints/)).toBeTruthy();
    expect(screen.getByText("In scope")).toBeTruthy();
    expect(screen.getByText("Out of scope")).toBeTruthy();
  });

  it("renders scope items with middot bullets, not per-item icons", () => {
    renderCard();
    expect(screen.getByText("Add middleware for rate limiting")).toBeTruthy();
    expect(screen.getByText("Authentication changes")).toBeTruthy();
    // one middot bullet per scope item (2 in-scope + 1 out-of-scope)
    expect(screen.getAllByText("·")).toHaveLength(3);
  });

  it("renders RISK AREAS rows when risks are provided", () => {
    renderCard(RISKS);
    expect(screen.getByText("Risk areas")).toBeTruthy();
    expect(screen.getByText("Auth surface touched")).toBeTruthy();
    expect(screen.getByText("New dependency: ioredis")).toBeTruthy();
  });

  it("hides the RISK AREAS section when risks are absent or empty", () => {
    renderCard(null);
    expect(screen.queryByText("Risk areas")).toBeNull();

    cleanup();
    renderCard({ risks: [] });
    expect(screen.queryByText("Risk areas")).toBeNull();
  });

  it("clicking a risk's path:line calls diff-nav with the changed-file flag and github_link", () => {
    renderCard(
      {
        risks: [
          {
            kind: "security",
            title: "Auth surface touched",
            explanation: "Middleware runs before auth.",
            severity: "high",
            file_refs: [],
            file: "src/middleware/rateLimit.ts",
            line: 42,
            github_link: "https://github.com/acme/repo/blob/abc123/src/middleware/rateLimit.ts#L42",
          },
        ],
      },
      new Set(["src/middleware/rateLimit.ts"]),
    );
    const pathBtn = screen.getByText("src/middleware/rateLimit.ts:42");
    fireEvent.click(pathBtn);
    expect(navigateMock).toHaveBeenCalledWith(
      "src/middleware/rateLimit.ts",
      42,
      "https://github.com/acme/repo/blob/abc123/src/middleware/rateLimit.ts#L42",
      true,
    );
  });

  it("clicking a risk's path:line does not toggle the accordion open (stopPropagation)", () => {
    renderCard({
      risks: [
        {
          kind: "security",
          title: "Auth surface touched",
          explanation: "Middleware runs before auth.",
          severity: "high",
          file_refs: [],
          file: "src/middleware/rateLimit.ts",
          line: 42,
          github_link: "https://github.com/acme/repo/blob/abc123/src/middleware/rateLimit.ts#L42",
        },
      ],
    });
    fireEvent.click(screen.getByText("src/middleware/rateLimit.ts:42"));
    // Detail panel should NOT open just from clicking the path link
    expect(screen.queryByText("Middleware runs before auth.")).toBeNull();
  });

  it("renders no path:line element when file is absent (pre-existing deterministic risk, backward-compat)", () => {
    renderCard(RISKS);
    expect(screen.queryByText(/\.ts(:\d+)?$/)).toBeNull();
  });

  it("opens the detail panel with the explanation when a card is clicked; only one open at a time", () => {
    renderCard(RISKS);
    expect(screen.queryByText("Middleware runs before auth.")).toBeNull();
    expect(screen.queryByText("Adds a runtime dependency.")).toBeNull();

    fireEvent.click(screen.getByText("Auth surface touched"));
    expect(screen.getByText("Middleware runs before auth.")).toBeTruthy();
    expect(screen.queryByText("Adds a runtime dependency.")).toBeNull();

    // Opening the second risk closes the first — only one panel open at a time
    fireEvent.click(screen.getByText("New dependency: ioredis"));
    expect(screen.queryByText("Middleware runs before auth.")).toBeNull();
    expect(screen.getByText("Adds a runtime dependency.")).toBeTruthy();

    // Clicking the same (already open) card toggles it closed
    fireEvent.click(screen.getByText("New dependency: ioredis"));
    expect(screen.queryByText("Adds a runtime dependency.")).toBeNull();
  });

  it("renders an inline code chip for a backtick span in the open explanation", () => {
    renderCard({
      risks: [
        {
          kind: "security",
          title: "Auth surface touched",
          explanation: "Middleware runs before `INCR` executes.",
          severity: "high",
          file_refs: [],
        },
      ],
    });
    fireEvent.click(screen.getByText("Auth surface touched"));
    const code = screen.getByText("INCR");
    expect(code.tagName).toBe("CODE");
  });

  it("the open card carries an accent-color border matching its risk kind", () => {
    renderCard(RISKS);
    const authCard = screen.getByText("Auth surface touched").closest('[role="button"]') as HTMLElement;
    expect(authCard.style.border).not.toContain("var(--crit)");

    fireEvent.click(authCard);
    expect(authCard.style.border).toContain("var(--crit)");
  });

  it("colors the risk icon per kind: security is red (--crit), dependency is amber (--warn)", () => {
    renderCard(RISKS);
    const chips = screen.getAllByTestId("risk-icon-chip");
    expect(chips).toHaveLength(2);

    // lucide-react forwards the `color` prop as the SVG `stroke` attribute.
    // First risk is "security" kind → Shield icon colored with the crit token.
    const securityIcon = chips[0]?.querySelector("svg");
    expect(securityIcon).toBeTruthy();
    expect(securityIcon?.getAttribute("stroke")).toBe("var(--crit)");

    // Second risk is "dependency" kind → Boxes icon colored with the warn token.
    const dependencyIcon = chips[1]?.querySelector("svg");
    expect(dependencyIcon).toBeTruthy();
    expect(dependencyIcon?.getAttribute("stroke")).toBe("var(--warn)");
  });
});
