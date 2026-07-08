/**
 * useRunEvents — SSE subscription lifecycle.
 *
 * Tests that:
 * 1. EventSource is opened per runId
 * 2. Parsed RunEvents accumulate in `events`
 * 3. `running` flips to false when all streams close (onerror)
 * 4. Sources are closed and running resets when runIds changes
 * 5. Sources are closed on unmount
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---- EventSource mock -------------------------------------------------------

type ESListener = (ev: MessageEvent | Event) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset() { FakeEventSource.instances = []; }

  url: string;
  onmessage: ESListener | null = null;
  onerror: ESListener | null = null;
  private listeners: Record<string, ESListener[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: ESListener) {
    (this.listeners[type] ??= []).push(fn);
  }

  close() { this.closed = true; }

  /** Test helper — emit an event.
   *  "message" fires onmessage (default SSE event).
   *  Named types (info/tool/result/error) fire named listeners only. */
  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    if (type === "message") {
      if (this.onmessage) this.onmessage(ev);
    } else {
      for (const fn of this.listeners[type] ?? []) fn(ev);
    }
  }

  /** Test helper — trigger the error/close path. */
  triggerError() {
    if (this.onerror) this.onerror(new Event("error"));
  }
}

vi.stubGlobal("EventSource", FakeEventSource);

// ---- Tests ------------------------------------------------------------------

import { useRunEvents } from "./reviews";

beforeEach(() => { FakeEventSource.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useRunEvents", () => {
  it("opens one EventSource per runId", () => {
    renderHook(() => useRunEvents(["run-1", "run-2"]));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0]!.url).toContain("/runs/run-1/events");
    expect(FakeEventSource.instances[1]!.url).toContain("/runs/run-2/events");
  });

  it("starts with running=true and empty events when runIds is non-empty", () => {
    const { result } = renderHook(() => useRunEvents(["run-1"]));
    expect(result.current.running).toBe(true);
    expect(result.current.events).toHaveLength(0);
  });

  it("accumulates parsed RunEvents from onmessage", () => {
    const { result } = renderHook(() => useRunEvents(["run-1"]));
    const es = FakeEventSource.instances[0]!;
    act(() => {
      es.emit("message", { kind: "info", msg: "Starting…", ts: 1 });
      es.emit("message", { kind: "result", msg: "Done", ts: 2 });
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0]).toMatchObject({ kind: "info", msg: "Starting…" });
  });

  it("sets running=false when the single stream errors/closes", () => {
    const { result } = renderHook(() => useRunEvents(["run-1"]));
    act(() => { FakeEventSource.instances[0]!.triggerError(); });
    expect(result.current.running).toBe(false);
  });

  it("stays running=true until ALL streams close", () => {
    const { result } = renderHook(() => useRunEvents(["run-1", "run-2"]));
    act(() => { FakeEventSource.instances[0]!.triggerError(); });
    expect(result.current.running).toBe(true);
    act(() => { FakeEventSource.instances[1]!.triggerError(); });
    expect(result.current.running).toBe(false);
  });

  it("closes all sources and resets on unmount", () => {
    const { unmount } = renderHook(() => useRunEvents(["run-1"]));
    unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("opens no EventSource and stays running=false for empty runIds", () => {
    const { result } = renderHook(() => useRunEvents([]));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.running).toBe(false);
  });

  it("closes old sources and opens new ones when runIds key changes", () => {
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useRunEvents(ids), {
      initialProps: { ids: ["run-1"] },
    });
    const first = FakeEventSource.instances[0]!;
    rerender({ ids: ["run-2"] });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain("/runs/run-2/events");
  });
});
