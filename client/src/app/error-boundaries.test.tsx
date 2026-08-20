import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import ErrorBoundaryPage from "./error";
import NotFoundPage from "./not-found";

afterEach(cleanup);

describe("app/error.tsx (route error boundary)", () => {
  it("renders the error and retries via reset()", () => {
    // The boundary logs the caught error on purpose — keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<ErrorBoundaryPage error={new Error("boom")} reset={reset} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("app/not-found.tsx", () => {
  it("renders a not-found state with a way home", () => {
    render(<NotFoundPage />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
