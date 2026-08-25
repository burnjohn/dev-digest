/**
 * ErrorBoundary — containment of a render-time throw.
 *
 * React logs every caught error to `console.error` unconditionally, on top of
 * what `componentDidCatch` writes, so each throwing case silences it. Without
 * that the suite passes but buries the real output in stack traces.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error("payload was not the shape it claimed");
  return <div>recovered content</div>;
}

const fallback = (reset: () => void) => (
  <div>
    <span>card unavailable</span>
    <button type="button" onClick={reset}>
      retry
    </button>
  </div>
);

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <div>healthy content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("healthy content")).toBeTruthy();
    expect(screen.queryByText("card unavailable")).toBeNull();
  });

  it("renders the fallback instead of propagating a render throw", () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("card unavailable")).toBeTruthy();
  });

  it("contains the failure — a sibling outside the boundary stays mounted", () => {
    // The whole point of the component. Without a boundary here, this throw
    // unwinds to the route-level `app/error.tsx` and the sibling goes with it.
    render(
      <div>
        <ErrorBoundary fallback={fallback}>
          <Boom />
        </ErrorBoundary>
        <div>sibling card</div>
      </div>,
    );

    expect(screen.getByText("card unavailable")).toBeTruthy();
    expect(screen.getByText("sibling card")).toBeTruthy();
  });

  it("re-renders the children when the fallback's reset is invoked", () => {
    // The "will it throw" flag is flipped by the TEST, not by a render
    // counter. React re-invokes a failing component in development to build
    // the component stack, so any fixture that counts its own renders is
    // asserting on React's internals rather than on this boundary.
    let broken = true;
    function Flaky() {
      if (broken) throw new Error("payload was not the shape it claimed");
      return <div>recovered content</div>;
    }

    render(
      <ErrorBoundary fallback={fallback}>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText("card unavailable")).toBeTruthy();

    // The retry succeeds — i.e. the second attempt gets fresh data.
    broken = false;
    fireEvent.click(screen.getByText("retry"));
    expect(screen.getByText("recovered content")).toBeTruthy();
  });

  it("clears a tripped boundary when resetKeys change", () => {
    // `prId` changing = the user navigated to another PR. A boundary tripped
    // by the previous PR's payload must not follow them there.
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKeys={["pr-1"]}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("card unavailable")).toBeTruthy();

    rerender(
      <ErrorBoundary fallback={fallback} resetKeys={["pr-2"]}>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered content")).toBeTruthy();
  });

  it("keeps showing the fallback while resetKeys are unchanged", () => {
    // The negative of the case above: a re-render for any other reason must
    // NOT silently retry a component that is still broken, or the boundary
    // becomes an infinite throw/render loop.
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKeys={["pr-1"]}>
        <Boom />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary fallback={fallback} resetKeys={["pr-1"]}>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("card unavailable")).toBeTruthy();
    expect(screen.queryByText("recovered content")).toBeNull();
  });
});
