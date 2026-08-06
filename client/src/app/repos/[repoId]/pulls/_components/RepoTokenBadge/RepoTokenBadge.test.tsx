import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import messages from "../../../../../../../messages/en/github-tokens.json";
import { RepoTokenBadge } from "./RepoTokenBadge";

function renderBadge(githubTokenId: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ "github-tokens": messages }}>
      <RepoTokenBadge repoId="r1" githubTokenId={githubTokenId} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("RepoTokenBadge", () => {
  it("renders the 'no token' badge when the repo has no assigned token", () => {
    renderBadge(null);
    expect(screen.getByText(/no token/i)).toBeInTheDocument();
  });

  it("renders nothing once a token is assigned", () => {
    renderBadge("t1");
    expect(screen.queryByText(/no token/i)).not.toBeInTheDocument();
  });

  it("links to the repo's settings page", () => {
    renderBadge(null);
    const link = screen.getByText(/no token/i).closest("a");
    expect(link).toHaveAttribute("href", "/repos/r1/settings");
  });
});
