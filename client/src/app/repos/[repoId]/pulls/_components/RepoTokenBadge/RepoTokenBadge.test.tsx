import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import messages from "../../../../../../../messages/en/github-tokens.json";
import { RepoTokenBadge } from "./RepoTokenBadge";

function renderBadge(githubTokenId: string | null, githubTokenConfigured = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ "github-tokens": messages }}>
      <RepoTokenBadge
        repoId="r1"
        githubTokenId={githubTokenId}
        githubTokenConfigured={githubTokenConfigured}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("RepoTokenBadge", () => {
  it("renders the 'no token' badge when the repo has no assigned token", () => {
    renderBadge(null, false);
    expect(screen.getByText(/no token/i)).toBeInTheDocument();
  });

  it("renders nothing once a token is assigned AND its value is configured", () => {
    renderBadge("t1", true);
    expect(screen.queryByText(/no token/i)).not.toBeInTheDocument();
  });

  /** The seeded `demo` token's exact shape: assigned, but no stored PAT. */
  it("renders the badge when a token IS assigned but not configured (e.g. no stored value)", () => {
    renderBadge("t1", false);
    expect(screen.getByText(/no token/i)).toBeInTheDocument();
  });

  it("links to the repo's settings page", () => {
    renderBadge(null, false);
    const link = screen.getByText(/no token/i).closest("a");
    expect(link).toHaveAttribute("href", "/repos/r1/settings");
  });
});
