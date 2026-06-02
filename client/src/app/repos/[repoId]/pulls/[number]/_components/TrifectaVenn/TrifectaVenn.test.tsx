import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { TrifectaComponent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { TrifectaVenn } from "./TrifectaVenn";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("TrifectaVenn (smoke)", () => {
  it("shows the lethal heading when all three components are present", () => {
    const all: TrifectaComponent[] = ["private_data_access", "untrusted_input", "exfil_path"];
    renderWithIntl(<TrifectaVenn components={all} />);
    expect(screen.getByText("LETHAL TRIFECTA — ALL 3 PRESENT")).toBeInTheDocument();
    expect(screen.getByText("Private data")).toBeInTheDocument();
  });

  it("shows the neutral heading when not all are present", () => {
    renderWithIntl(<TrifectaVenn components={["untrusted_input"]} />);
    expect(screen.getByText("TRIFECTA COMPONENTS")).toBeInTheDocument();
  });
});
