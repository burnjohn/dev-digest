/* ErrorBoundary — contains a render-time throw to ONE subtree instead of
   letting it take the whole route segment down.

   Why this exists, given `app/error.tsx` already exists: that file is a
   ROUTE-level boundary. It catches the throw, but Next replaces the entire
   failing segment with it — one broken card blanks the page it sits on, along
   with every sibling that was rendering fine. This boundary sits between, so
   the blast radius of a bad payload is the component that read it.

   The exposure is real and not hypothetical: `lib/api.ts` returns
   `api.get<T>()` as a plain TypeScript cast with no runtime parse, so a
   partial or malformed response reaches a component as an object that
   type-checked but does not exist. Destructuring it throws. A hook's
   `isError` branch does NOT cover this — TanStack Query resolved the promise
   successfully; the failure is downstream, during render.

   WHAT THIS DOES NOT CATCH, because React error boundaries never do: errors
   thrown in event handlers, in `setTimeout`, in async callbacks, or during
   SSR. Those need their own handling. This is for render, and render is
   exactly where the failure above lands. */
"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Render prop rather than a plain node so the caller owns the visuals AND
      gets a `reset` to wire to its own retry control. Keeping the fallback out
      of this file is what stops a cross-cutting component from importing one
      feature's styles and quietly becoming that feature's. */
  fallback: (reset: () => void) => React.ReactNode;
  /** Values that, when changed, clear a tripped boundary. Pass the identity of
      whatever the subtree is rendering (a `prId`, say): without this, one bad
      payload leaves the fallback showing until a full remount, so navigating
      to a healthy PR would still look broken. Compared shallowly, element by
      element. */
  resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
  /** The `resetKeys` the current `error` was recorded under, so
      `getDerivedStateFromProps` can tell "the keys changed" from "we are
      re-rendering with the same keys and the error still stands". */
  keys: readonly unknown[];
}

function keysChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, keys: [] };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    const next = props.resetKeys ?? [];
    if (state.error !== null && keysChanged(state.keys, next)) {
      return { error: null, keys: next };
    }
    // Track the keys even with no error standing, so the comparison above is
    // against the keys at THROW time rather than against whatever they were
    // when this boundary first mounted.
    return keysChanged(state.keys, next) ? { keys: next } : null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Same channel `app/error.tsx` uses — the browser console is the only
    // place this surfaces in the starter. `componentStack` is what turns
    // "something threw" into a named component.
    console.error("ErrorBoundary caught a render error", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error !== null) return this.props.fallback(this.reset);
    return this.props.children;
  }
}

export default ErrorBoundary;
