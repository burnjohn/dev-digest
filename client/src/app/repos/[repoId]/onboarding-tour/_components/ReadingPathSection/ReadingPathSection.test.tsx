import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { OnboardingTourSection } from "@devdigest/shared";
import { ReadingPathSection } from "./ReadingPathSection";

afterEach(cleanup);

function section(entries: OnboardingTourSection["entries"]): OnboardingTourSection {
  return {
    kind: "reading_path",
    title: "Guided reading path",
    body: "",
    diagram: null,
    entries,
    tasks: [],
    links: [],
  };
}

describe("ReadingPathSection — AC-7 server-owned ordering", () => {
  it("renders entries in the exact array order given (no client-side re-sort)", () => {
    // Deliberately NOT alphabetical — server-computed rank order.
    const entries: OnboardingTourSection["entries"] = [
      { path: "src/z-first.ts", rationale: "highest rank", rank: 3, github_link: null },
      { path: "src/a-second.ts", rationale: "second rank", rank: 2, github_link: null },
      { path: "src/m-third.ts", rationale: "third rank", rank: 1, github_link: null },
    ];
    render(<ReadingPathSection section={section(entries)} />);

    const paths = screen.getAllByText(/^src\//).map((el) => el.textContent);
    expect(paths).toEqual(["src/z-first.ts", "src/a-second.ts", "src/m-third.ts"]);
  });

  it("renders each entry's rationale beneath its path", () => {
    const entries: OnboardingTourSection["entries"] = [
      { path: "src/one.ts", rationale: "entry point", rank: 1, github_link: null },
    ];
    render(<ReadingPathSection section={section(entries)} />);
    expect(screen.getByText("entry point")).toBeInTheDocument();
  });
});
