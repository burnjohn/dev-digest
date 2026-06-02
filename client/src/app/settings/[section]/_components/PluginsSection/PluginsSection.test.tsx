import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/settings.json";

vi.mock("../../../../../lib/hooks/plugins", () => ({
  useInstalledPlugins: () => ({ data: [] }),
  useExportPlugin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPlugin: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../lib/hooks/digest", () => ({
  useDigests: () => ({ data: [] }),
  useRunDigest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { SettingsPlugins } from "./PluginsSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ settings: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SettingsPlugins (smoke)", () => {
  it("renders the bundle, installed and digest sections", () => {
    renderWithIntl(<SettingsPlugins />);
    expect(screen.getByText("Plugin bundle")).toBeInTheDocument();
    expect(screen.getByText("Export bundle")).toBeInTheDocument();
    expect(screen.getByText("No plugins installed")).toBeInTheDocument();
    expect(screen.getByText("No digests yet")).toBeInTheDocument();
  });
});
