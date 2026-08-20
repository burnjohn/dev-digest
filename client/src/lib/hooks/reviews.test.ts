import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRunEvents, parseRunEventFrame } from "./reviews";
import type { RunEvent } from "@devdigest/shared";

/** Minimal controllable EventSource double (jsdom has no native EventSource). */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Set<EventListener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }
  close() {
    this.closed = true;
  }
  /** Deliver one named SSE frame (server tags events with kind as event name). */
  emit(kind: string, data: string) {
    if (this.closed) return;
    const ev = { data } as MessageEvent;
    if (kind === "message") this.onmessage?.(ev);
    this.listeners.get(kind)?.forEach((l) => l(ev as unknown as Event));
  }
  /** Simulate a transport error (network blip / server closed the stream). */
  error() {
    if (this.closed) return;
    this.onerror?.(new Event("error"));
  }
}

function frame(seq: number, kind: RunEvent["kind"] = "info", runId = "r1"): string {
  return JSON.stringify({ runId, seq, kind, msg: `event ${seq}`, t: "00:00:0" + seq });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useRunEvents", () => {
  it("keeps the stream open and running across a transient onerror", () => {
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;

    act(() => es.emit("info", frame(1)));
    act(() => es.error()); // network blip mid-run

    // The run is NOT terminally finished: native EventSource auto-reconnects.
    expect(result.current.running).toBe(true);
    expect(es.closed).toBe(false);

    // Events arriving after the blip still land.
    act(() => es.emit("info", frame(2)));
    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("dedupes replayed events after a reconnect (replay-first stream)", () => {
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;

    act(() => es.emit("info", frame(1)));
    act(() => es.emit("tool", frame(2, "tool")));
    act(() => es.error()); // reconnect → server replays the whole buffer
    act(() => es.emit("info", frame(1)));
    act(() => es.emit("tool", frame(2, "tool")));
    act(() => es.emit("result", frame(3, "result")));

    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("skips schema-invalid frames without dropping valid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;

    act(() => es.emit("info", "not json {{"));
    act(() => es.emit("info", JSON.stringify({ foo: 1 }))); // valid JSON, not a RunEvent
    act(() => es.emit("info", frame(1)));

    expect(result.current.events.map((e) => e.seq)).toEqual([1]);
    expect(warn).toHaveBeenCalled();
  });

  it("closes every stream on unmount (the terminal path)", () => {
    const { unmount } = renderHook(() => useRunEvents(["r1", "r2"]));
    expect(FakeEventSource.instances).toHaveLength(2);
    unmount();
    expect(FakeEventSource.instances.every((es) => es.closed)).toBe(true);
  });
});

describe("parseRunEventFrame", () => {
  it("returns the parsed RunEvent for a valid frame", () => {
    const parsed = parseRunEventFrame(frame(7, "result"));
    expect(parsed).toMatchObject({ runId: "r1", seq: 7, kind: "result" });
  });

  it("returns null and warns for non-JSON data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseRunEventFrame("not json")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns null and warns for JSON that is not a RunEvent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseRunEventFrame(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("silently ignores empty/dataless frames (keepalives)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseRunEventFrame("")).toBeNull();
    expect(parseRunEventFrame(undefined)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
