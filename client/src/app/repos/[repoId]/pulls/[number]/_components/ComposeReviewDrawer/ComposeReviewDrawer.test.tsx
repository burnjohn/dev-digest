import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/compose.json";

vi.mock("../../../../../../../lib/hooks/compose", () => ({
  useComposePreview: () => ({ mutateAsync: vi.fn().mockResolvedValue({ body: "## DevDigest Review\n\n" }) }),
  usePostComposeReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ComposeReviewDrawer } from "./ComposeReviewDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ compose: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ComposeReviewDrawer (smoke)", () => {
  it("renders the drawer title + verdict options", () => {
    renderWithIntl(<ComposeReviewDrawer prId="pr1" onClose={() => {}} />);
    expect(screen.getByText("Compose Review")).toBeInTheDocument();
    expect(screen.getByText("Verdict")).toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
  });
});
