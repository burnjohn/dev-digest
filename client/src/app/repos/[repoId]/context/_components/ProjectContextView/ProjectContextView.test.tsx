import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  ContextDocument,
  ContextDocumentList,
  ContextPreviewResponse,
} from "@devdigest/shared";
import { ApiError } from "../../../../../../lib/api";
import messages from "../../../../../../../messages/en/context.json";
import commonMessages from "../../../../../../../messages/en/common.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

const refetchMock = vi.fn();
const previewRefetchMock = vi.fn();
const uploadMutateAsync = vi.fn().mockResolvedValue({});
const toastError = vi.fn();

// Five minutes ago, so `relativeTime` yields "5m" deterministically and the
// footer renders the elapsed-span phrasing rather than "refreshed just now".
const FIVE_MIN_AGO = () => Date.now() - 5 * 60_000;

let docsState: {
  data?: ContextDocumentList;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  dataUpdatedAt: number;
} = {
  data: { documents: [], total: 0, bounded: false, bound: 0 },
  isLoading: false,
  isError: false,
  dataUpdatedAt: 0,
};

let previewState: {
  data?: ContextPreviewResponse;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
} = { data: undefined, isLoading: false, isError: false };

// The hook boundary is the mock point, never global fetch (client/INSIGHTS.md).
vi.mock("../../../../../../lib/hooks/context", () => ({
  useContextDocuments: () => ({ ...docsState, refetch: refetchMock }),
  useContextPreview: () => ({ ...previewState, refetch: previewRefetchMock }),
  useUploadContextDocument: () => ({ mutateAsync: uploadMutateAsync, isPending: false }),
}));

vi.mock("../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: toastError }),
}));

import { ProjectContextView } from "./ProjectContextView";

const doc = (over: Partial<ContextDocument> = {}): ContextDocument => ({
  path: "docs/readme-notes.md",
  content: null,
  size: 1200,
  updated_at: "2026-08-01T00:00:00.000Z",
  type: "docs",
  token_estimate: 30,
  oversized: false,
  source: "repo",
  used_by_agents: 0,
  used_by_disabled_skill_only: 0,
  ...over,
});

afterEach(() => {
  cleanup();
  refetchMock.mockClear();
  previewRefetchMock.mockClear();
  uploadMutateAsync.mockClear();
  toastError.mockClear();
  docsState = {
    data: { documents: [], total: 0, bounded: false, bound: 0 },
    isLoading: false,
    isError: false,
    dataUpdatedAt: 0,
  };
  previewState = { data: undefined, isLoading: false, isError: false };
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages, common: commonMessages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("shows a loading indicator that ends with an ellipsis while the list loads", () => {
    docsState = { data: undefined, isLoading: true, isError: false, dataUpdatedAt: 0 };
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent(/…$/);
  });

  it("shows the empty state, and never renders it as a populated list", () => {
    docsState = {
      data: { documents: [], total: 0, bounded: false, bound: 0 },
      isLoading: false,
      isError: false,
      dataUpdatedAt: 0,
    };
    renderView();
    expect(screen.getByText("No project context documents yet")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("surfaces a load failure naming the failure and offering a retry", async () => {
    docsState = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Network down", 0),
      dataUpdatedAt: 0,
    };
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent(
      messages.error.replace("{message}", "Network down"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it(
    "lists bare paths on the left and moves type/tokens/used-by/oversized into the preview header "
      + "on selection; the footer carries count, summed estimate and freshness; none of REQ-46's "
      + "forbidden legacy affordances appear",
    async () => {
      docsState = {
        data: {
          documents: [
            doc({
              path: "specs/security-baseline.md",
              type: "specs",
              token_estimate: 42,
              used_by_agents: 3,
              used_by_disabled_skill_only: 1,
            }),
            doc({ path: "docs/readme-notes.md", type: "docs", token_estimate: 900, oversized: true }),
          ],
          total: 2,
          bounded: true,
          bound: 5000,
        },
        isLoading: false,
        isError: false,
        dataUpdatedAt: FIVE_MIN_AGO(),
      };
      previewState = {
        data: {
          path: "specs/security-baseline.md",
          content: "Always sanitize input.",
          size: 100,
          updated_at: null,
        },
        isLoading: false,
        isError: false,
      };
      renderView();

      // Left pane: the whole repository-relative path, one string per row, and
      // nothing else. The filename/dimmed-directory split is gone with it.
      expect(screen.getByText("specs/security-baseline.md")).toBeInTheDocument();
      expect(screen.getByText("docs/readme-notes.md")).toBeInTheDocument();
      expect(screen.queryByText("security-baseline.md")).not.toBeInTheDocument();
      expect(screen.queryByText("specs/")).not.toBeInTheDocument();

      // The four metadata affordances belong to the SELECTED document now, so
      // none of them is on screen before a selection is made.
      expect(screen.queryByText("specs")).not.toBeInTheDocument();
      expect(screen.queryByText("42t")).not.toBeInTheDocument();
      expect(screen.queryByText("Used by 3 agents (1 via a disabled skill)")).not.toBeInTheDocument();
      expect(screen.queryByText("Oversized")).not.toBeInTheDocument();
      expect(screen.getByText("Nothing here yet")).toBeInTheDocument();

      // Footer: count, the estimate summed over the WHOLE listing (42 + 900),
      // and how long ago the list was refreshed.
      expect(screen.getByText(/2 documents/)).toBeInTheDocument();
      expect(screen.getByText(/942t/)).toBeInTheDocument();
      expect(screen.getByText(/refreshed 5m ago/)).toBeInTheDocument();
      expect(screen.getByText("Showing the first 5,000 files — the walk was bounded.")).toBeInTheDocument();

      // The row itself is the preview control — there is no second click on a
      // separate Preview button.
      fireEvent.click(screen.getByRole("button", { name: "Preview specs/security-baseline.md" }));
      expect(screen.getByText("Always sanitize input.")).toBeInTheDocument();
      expect(screen.getByText("specs")).toBeInTheDocument();
      expect(screen.getByText("42t")).toBeInTheDocument();
      expect(screen.getByText("Used by 3 agents (1 via a disabled skill)")).toBeInTheDocument();

      // The oversized marker follows the selection too (AC-8's "visibly
      // marked" half, now in the preview header).
      expect(screen.queryByText("Oversized")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Preview docs/readme-notes.md" }));
      expect(screen.getByText("Oversized")).toBeInTheDocument();

      // REQ-46: none of the five forbidden legacy affordances.
      expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
      expect(screen.queryByText("+")).not.toBeInTheDocument();
      expect(screen.queryByText(/new folder/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/coverage/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();
    },
  );

  it("gives the toolbar's icon-only controls accessible names, and refresh refetches", async () => {
    renderView();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("never renders a fixture document's script/onerror/javascript:/data: content as live HTML", async () => {
    const fixture = [
      "<script>alert(1)</script>",
      "",
      '<img src="x" onerror="alert(1)">',
      "",
      "[click](javascript:alert(1))",
      "",
      "![img](data:image/png;base64,AAAA)",
    ].join("\n");
    docsState = {
      data: { documents: [doc({ path: "docs/unsafe.md" })], total: 1, bounded: false, bound: 0 },
      isLoading: false,
      isError: false,
      dataUpdatedAt: FIVE_MIN_AGO(),
    };
    previewState = {
      data: { path: "docs/unsafe.md", content: fixture, size: 10, updated_at: null },
      isLoading: false,
      isError: false,
    };
    const { container } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Preview docs/unsafe.md" }));

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('img[src^="data:"]')).toBeNull();
  });
});
