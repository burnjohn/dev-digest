/* context.test.tsx — the autosave replace-set write (REQ-13, REQ-14, REQ-41,
   REQ-35) plus a payload-validation smoke test for the read hooks.

   Mocks the `api` module (the hook boundary), never global `fetch`, per
   `client/INSIGHTS.md` 2026-08-09. Uses Vitest's fake timers to control the
   400ms debounce deterministically. */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import React from "react";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../api";
import { useContextAttachment, useContextAutosave, useContextDocuments } from "./context";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  API_BASE: "http://localhost:3001",
}));

const getMock = api.get as unknown as Mock;
const postMock = api.post as unknown as Mock;

const REPO_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "agent-1";

function renderWithClient(node: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // `qc` is returned so a test can assert on the cache the NEXT mount seeds
  // itself from — which is the whole subject of the coherence tests below.
  return { ...render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>), qc };
}

/** Exposes `save`/`flush`/`isSaving` as DOM so a test can drive them via
    `act()` without reaching into React internals, and records every
    `onError` call so a test can assert on the (message, revertTo) pair. */
function AutosaveHarness({
  initialAcknowledged,
  onSave,
}: {
  initialAcknowledged: string[];
  onSave?: (api: ReturnType<typeof useContextAutosave>) => void;
}) {
  const errors = React.useRef<Array<{ message: string; revertTo: string[] }>>([]);
  const autosave = useContextAutosave({
    ownerType: "agent",
    ownerId: AGENT_ID,
    repoId: REPO_ID,
    initialAcknowledged,
    onError: (message, revertTo) => {
      errors.current.push({ message, revertTo });
    },
  });
  onSave?.(autosave);
  return (
    <div>
      <div data-testid="saving">{String(autosave.isSaving)}</div>
      <div data-testid="error-count">{errors.current.length}</div>
      <div data-testid="last-error">{JSON.stringify(errors.current.at(-1) ?? null)}</div>
    </div>
  );
}

/** Let a query resolve AND its observers re-render. TanStack batches observer
    notifications onto a timer, so with fake timers installed a microtask flush
    alone never delivers the data into the component. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      vi.advanceTimersByTime(1);
    }
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useContextAutosave — debounced replace-set write (REQ-13, REQ-41, NFR-5)", () => {
  it("coalesces writes fired 100ms apart into exactly one, and a write 500ms later opens a second", async () => {
    postMock.mockResolvedValue({ repo_id: REPO_ID, paths: [] });
    let hook!: ReturnType<typeof useContextAutosave>;
    renderWithClient(
      <AutosaveHarness initialAcknowledged={[]} onSave={(a) => (hook = a)} />,
    );

    act(() => hook.save(["a.md"]));
    act(() => vi.advanceTimersByTime(100));
    act(() => hook.save(["a.md", "b.md"]));
    act(() => vi.advanceTimersByTime(100));
    act(() => hook.save(["a.md", "b.md", "c.md"]));
    act(() => vi.advanceTimersByTime(100));

    // 300ms have elapsed since the FIRST call, but only 100ms since the last
    // one — still inside the 400ms trailing window, so nothing has fired yet.
    expect(postMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Exactly one write, carrying the FINAL complete ordered list.
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(`/agents/${AGENT_ID}/context`, {
      repo_id: REPO_ID,
      paths: ["a.md", "b.md", "c.md"],
    });

    // A fourth toggle 500ms later is a new debounce window.
    act(() => hook.save(["a.md", "b.md", "c.md", "d.md"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock).toHaveBeenLastCalledWith(`/agents/${AGENT_ID}/context`, {
      repo_id: REPO_ID,
      paths: ["a.md", "b.md", "c.md", "d.md"],
    });
  });

  it("resolves concurrent writes by ISSUE order — a stale response is discarded even when it settles last", async () => {
    let resolveWrite1!: (v: unknown) => void;
    let rejectWrite1!: (e: unknown) => void;
    const write1 = new Promise((resolve, reject) => {
      resolveWrite1 = resolve;
      rejectWrite1 = reject;
    });
    let resolveWrite2!: (v: unknown) => void;
    const write2 = new Promise((resolve) => {
      resolveWrite2 = resolve;
    });
    postMock.mockImplementationOnce(() => write1).mockImplementationOnce(() => write2);

    let hook!: ReturnType<typeof useContextAutosave>;
    const { getByTestId, qc } = renderWithClient(
      <AutosaveHarness initialAcknowledged={[]} onSave={(a) => (hook = a)} />,
    );

    // Two writes in flight for the same owner: write1 issued first, write2
    // second (`flush()` bypasses the debounce so both are in flight at once).
    act(() => {
      hook.save(["a.md"]);
      hook.flush();
    });
    act(() => {
      hook.save(["a.md", "b.md"]);
      hook.flush();
    });
    expect(postMock).toHaveBeenCalledTimes(2);

    // The LATER-issued write (write2) resolves first, successfully.
    await act(async () => {
      resolveWrite2({ repo_id: REPO_ID, paths: ["a.md", "b.md"] });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The EARLIER-issued write (write1) resolves after — as a FAILURE. Per
    // AC-13 this must be discarded outright: no error surfaced, and it must
    // not resurrect write1's paths as the acknowledged baseline.
    await act(async () => {
      rejectWrite1(new Error("stale write failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // write1's late failure must never have been surfaced.
    expect(getByTestId("error-count").textContent).toBe("0");

    // A third write that itself fails reveals what the hook currently
    // believes the last-acknowledged state is, via the revert target: if
    // write1's stale rejection had wrongly won, this would revert to `[]`
    // (the initial value) instead of write2's `["a.md", "b.md"]`.
    postMock.mockRejectedValueOnce(new Error("third write failed"));
    act(() => {
      hook.save(["a.md", "b.md", "c.md"]);
      hook.flush();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByTestId("error-count").textContent).toBe("1");
    const last = JSON.parse(getByTestId("last-error").textContent ?? "null");
    expect(last.revertTo).toEqual(["a.md", "b.md"]);

    // The same ISSUE-order rule governs the cache: write1's late settlement
    // must not have written its own paths there either. Had it won, the next
    // mount of this owner's tab would seed itself from `["a.md"]`.
    expect(qc.getQueryData(["context-attachment", "agent", AGENT_ID, REPO_ID])).toEqual({
      repo_id: REPO_ID,
      paths: ["a.md", "b.md"],
    });
  });

  it(
    "keeps the attachment cache current after a write — without refetching it — so the next " +
      "mount of the tab seeds itself from what was actually saved",
    async () => {
      getMock.mockResolvedValueOnce({ repo_id: REPO_ID, paths: ["a.md"] });
      postMock.mockResolvedValue({ repo_id: REPO_ID, paths: ["a.md", "b.md"] });

      let hook!: ReturnType<typeof useContextAutosave>;
      function Harness() {
        useContextAttachment("agent", AGENT_ID, REPO_ID);
        hook = useContextAutosave({
          ownerType: "agent",
          ownerId: AGENT_ID,
          repoId: REPO_ID,
          initialAcknowledged: ["a.md"],
        });
        return null;
      }
      const { qc } = renderWithClient(<Harness />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(getMock).toHaveBeenCalledTimes(1);

      act(() => {
        hook.save(["a.md", "b.md"]);
        hook.flush();
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // No REFETCH: `listForRepo` re-walks the clone on every GET, so a write
      // must not trigger one. The cache is written directly instead.
      expect(getMock).toHaveBeenCalledTimes(1);
      expect(qc.getQueryData(["context-attachment", "agent", AGENT_ID, REPO_ID])).toEqual({
        repo_id: REPO_ID,
        paths: ["a.md", "b.md"],
      });
    },
  );

  it("a detach is cached the same way — an unticked document does not come back", async () => {
    getMock.mockResolvedValueOnce({ repo_id: REPO_ID, paths: ["a.md"] });
    postMock.mockResolvedValue({ repo_id: REPO_ID, paths: [] });

    let hook!: ReturnType<typeof useContextAutosave>;
    function Harness() {
      useContextAttachment("agent", AGENT_ID, REPO_ID);
      hook = useContextAutosave({
        ownerType: "agent",
        ownerId: AGENT_ID,
        repoId: REPO_ID,
        initialAcknowledged: ["a.md"],
      });
      return null;
    }
    const { qc } = renderWithClient(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      hook.save([]);
      hook.flush();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // An empty replace-set is a real value, not "no data" — a cache left
    // holding `["a.md"]` is exactly the reported symptom in reverse.
    expect(qc.getQueryData(["context-attachment", "agent", AGENT_ID, REPO_ID])).toEqual({
      repo_id: REPO_ID,
      paths: [],
    });
  });

  it(
    "REGRESSION — unmounting the tab and mounting it again reads the SAVED set, with no second GET " +
      "(switching agents and back used to revert the checkbox)",
    async () => {
      getMock.mockResolvedValue({ repo_id: REPO_ID, paths: ["a.md"] });
      postMock.mockResolvedValue({ repo_id: REPO_ID, paths: ["a.md", "b.md"] });

      let hook!: ReturnType<typeof useContextAutosave>;
      let seen: string[] | undefined;
      function Harness() {
        seen = useContextAttachment("agent", AGENT_ID, REPO_ID).data?.paths;
        hook = useContextAutosave({
          ownerType: "agent",
          ownerId: AGENT_ID,
          repoId: REPO_ID,
          initialAcknowledged: ["a.md"],
        });
        return null;
      }

      // `staleTime` matches `lib/providers.tsx` — this test is about what the
      // real app does inside that window, which is where the bug lived: the
      // remount does not refetch, so whatever the cache holds IS the checkbox.
      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000 },
          mutations: { retry: false },
        },
      });
      const first = render(
        <QueryClientProvider client={qc}>
          <Harness />
        </QueryClientProvider>,
      );
      await settle();
      expect(seen).toEqual(["a.md"]);

      act(() => {
        hook.save(["a.md", "b.md"]);
        hook.flush();
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Leave the agent…
      first.unmount();
      seen = undefined;

      // …and come back. Same QueryClient, exactly as navigating within the app.
      render(
        <QueryClientProvider client={qc}>
          <Harness />
        </QueryClientProvider>,
      );
      await settle();

      // Within the 30s staleTime nothing refetches, so this is served entirely
      // from cache — which is why the cache had to be right.
      expect(getMock).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(["a.md", "b.md"]);
    },
  );

  it("marks the document list stale after a write, without refetching it", async () => {
    getMock.mockResolvedValue({ documents: [], total: 0, bounded: false, bound: 5000 });
    postMock.mockResolvedValue({ repo_id: REPO_ID, paths: ["a.md"] });

    let hook!: ReturnType<typeof useContextAutosave>;
    function Harness() {
      useContextDocuments(REPO_ID);
      hook = useContextAutosave({
        ownerType: "agent",
        ownerId: AGENT_ID,
        repoId: REPO_ID,
        initialAcknowledged: [],
      });
      return null;
    }
    const { qc } = renderWithClient(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(getMock).toHaveBeenCalledTimes(1);

    act(() => {
      hook.save(["a.md"]);
      hook.flush();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // `Used by N agents` changed, so the listing is stale — but it must NOT be
    // refetched here: it is an active query while the tab is open, and each GET
    // re-walks the repository checkout.
    expect(getMock).toHaveBeenCalledTimes(1);
    const state = qc.getQueryState(["context-documents", REPO_ID]);
    expect(state?.isInvalidated).toBe(true);
  });

  it("flushes a pending debounced write on unmount instead of dropping it", () => {
    postMock.mockResolvedValue({ repo_id: REPO_ID, paths: [] });
    let hook!: ReturnType<typeof useContextAutosave>;
    const { unmount } = renderWithClient(
      <AutosaveHarness initialAcknowledged={[]} onSave={(a) => (hook = a)} />,
    );

    act(() => hook.save(["last-toggle.md"]));
    // No timer advance — the write is still purely pending.
    expect(postMock).not.toHaveBeenCalled();

    act(() => unmount());

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(`/agents/${AGENT_ID}/context`, {
      repo_id: REPO_ID,
      paths: ["last-toggle.md"],
    });
  });

  it("surfaces an error naming the failure and reverts to the last server-acknowledged state (AC-35)", async () => {
    postMock.mockRejectedValueOnce(new Error("network down"));
    let hook!: ReturnType<typeof useContextAutosave>;
    const { getByTestId } = renderWithClient(
      <AutosaveHarness initialAcknowledged={["orig.md"]} onSave={(a) => (hook = a)} />,
    );

    act(() => {
      hook.save(["orig.md", "new.md"]);
      hook.flush();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByTestId("error-count").textContent).toBe("1");
    const last = JSON.parse(getByTestId("last-error").textContent ?? "null");
    expect(last.message).toContain("network down");
    expect(last.revertTo).toEqual(["orig.md"]);
  });
});

describe("read hooks validate their payload (client/INSIGHTS.md 2026-08-25)", () => {
  // `waitFor`'s internal polling uses real timers — the fake ones the autosave
  // suite above installs would otherwise make it spin until the test timeout.
  beforeEach(() => vi.useRealTimers());

  it("useContextDocuments surfaces a malformed payload as isError, not a render-time throw", async () => {
    getMock.mockResolvedValueOnce({ documents: "not-an-array" });

    let result: ReturnType<typeof useContextDocuments> | undefined;
    function Harness() {
      result = useContextDocuments(REPO_ID);
      return null;
    }
    renderWithClient(<Harness />);

    await waitFor(() => expect(result?.isError).toBe(true));
  });

  it("useContextDocuments resolves a well-formed payload", async () => {
    getMock.mockResolvedValueOnce({
      documents: [
        {
          path: "specs/a.md",
          content: null,
          size: 120,
          updated_at: "2026-08-25T00:00:00.000Z",
          type: "specs",
          token_estimate: 30,
          oversized: false,
          source: "repo",
          used_by_agents: 1,
          used_by_disabled_skill_only: 0,
        },
      ],
      total: 1,
      bounded: false,
      bound: 5000,
    });

    let result: ReturnType<typeof useContextDocuments> | undefined;
    function Harness() {
      result = useContextDocuments(REPO_ID);
      return null;
    }
    renderWithClient(<Harness />);

    await waitFor(() => expect(result?.isSuccess).toBe(true));
    expect(result?.data?.total).toBe(1);
    expect(result?.data?.documents[0]?.path).toBe("specs/a.md");
  });
});
