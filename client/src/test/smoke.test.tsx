import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Gallery } from "../components/showcase";
import { DiffViewer } from "../components/diff-viewer";
import type { PrFile } from "../lib/types";
import shellMessages from "../../messages/en/shell.json";

afterEach(cleanup);

const themes: ("dark" | "light")[] = ["dark", "light"];

describe("web smoke (both themes)", () => {
  themes.forEach((theme) => {
    it(`component gallery renders in ${theme}`, () => {
      render(
        <div data-theme={theme}>
          <Gallery />
        </div>
      );
      // a few representative components are present
      expect(screen.getAllByText("Primary").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Critical").length).toBeGreaterThan(0);
    });
  });

  it("diff viewer parses a unified patch", () => {
    const files: PrFile[] = [
      {
        path: "src/config.ts",
        additions: 2,
        deletions: 1,
        patch: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
      },
    ];
    render(
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
        <div data-theme="dark">
          <DiffViewer files={files} />
        </div>
      </NextIntlClientProvider>
    );
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();
  });
});
