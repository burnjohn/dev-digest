/**
 * SeverityChip — icon + count + 12-slot dot indicator.
 * Tests: zero guard, correct count text, correct dot counts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Severity } from "@devdigest/shared";
import { SeverityChip } from "./SeverityChip";

afterEach(cleanup);

describe("SeverityChip", () => {
  it("renders nothing for count=0", () => {
    const { container } = render(
      <SeverityChip sev={Severity.enum.CRITICAL} count={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it.each([
    [Severity.enum.CRITICAL, 3],
    [Severity.enum.WARNING, 7],
    [Severity.enum.SUGGESTION, 1],
  ])("renders count %s for sev=%s", (sev, count) => {
    render(<SeverityChip sev={sev} count={count} />);
    expect(screen.getByText(String(count))).toBeInTheDocument();
  });

  it("renders 12-N faded dots for count=3 (9 faded)", () => {
    const { container } = render(
      <SeverityChip sev={Severity.enum.CRITICAL} count={3} />,
    );
    // The dots row is the last child of the outer column div.
    // Faded dots have opacity:0.2 — count should be 12-3=9.
    const fadedDots = container.querySelectorAll('[style*="opacity: 0.2"]');
    expect(fadedDots).toHaveLength(9);
  });

  it("renders 0 faded dots when count >= 12 (all filled)", () => {
    const { container } = render(
      <SeverityChip sev={Severity.enum.WARNING} count={12} />,
    );
    const fadedDots = container.querySelectorAll('[style*="opacity: 0.2"]');
    expect(fadedDots).toHaveLength(0);
  });

  it("caps at 12 — count=15 behaves like count=12", () => {
    const { container: c15 } = render(
      <SeverityChip sev={Severity.enum.SUGGESTION} count={15} />,
    );
    const { container: c12 } = render(
      <SeverityChip sev={Severity.enum.SUGGESTION} count={12} />,
    );
    const faded15 = c15.querySelectorAll('[style*="opacity: 0.2"]');
    const faded12 = c12.querySelectorAll('[style*="opacity: 0.2"]');
    expect(faded15).toHaveLength(0);
    expect(faded12).toHaveLength(0);
  });
});
