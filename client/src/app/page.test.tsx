import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const { useReposMock, refetchMock } = vi.hoisted(() => ({
  useReposMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("../lib/hooks", () => ({ useRepos: useReposMock }));
// AppShell pulls nav, intl and repo context — irrelevant to error-vs-empty.
vi.mock("../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import HomePage from "./page";

afterEach(() => {
  cleanup();
  useReposMock.mockReset();
  refetchMock.mockReset();
});

describe("HomePage (root)", () => {
  it("shows the empty state when there are simply no repos", () => {
    useReposMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: refetchMock });
    render(<HomePage />);
    expect(screen.getByText("No repositories yet")).toBeInTheDocument();
  });

  it("renders a distinct error state (not the empty state) when the API call fails", () => {
    useReposMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
    });
    render(<HomePage />);
    expect(screen.queryByText("No repositories yet")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    screen.getByText("Retry").click();
    expect(refetchMock).toHaveBeenCalled();
  });
});
