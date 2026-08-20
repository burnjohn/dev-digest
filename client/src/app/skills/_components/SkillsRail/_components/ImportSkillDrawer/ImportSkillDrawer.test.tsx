import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillImportPreview } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const parsePreview = vi.fn();
const createSkill = vi.fn();

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useImportSkillPreview: () => ({ mutateAsync: parsePreview, isPending: false }),
  useCreateSkill: () => ({ mutateAsync: createSkill, isPending: false }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

const PREVIEW: SkillImportPreview = {
  name: "archived-skill",
  description: "When reviewing an archive, take only its markdown.",
  type: "security",
  source: "imported_url",
  body: "# Archived skill\n\nThe body.",
  ignored_entries: ["assets/logo.png", "scripts/install.sh"],
  warnings: ["1 executable-looking file(s) in the archive were NOT imported and never run: scripts/install.sh"],
};

function renderDrawer(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ImportSkillDrawer onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
}

/** Drop a file on the picker the way a user would. */
function upload(name: string, content: string) {
  const input = screen.getByLabelText("Skill file") as HTMLInputElement;
  const file = new File([content], name, { type: "text/markdown" });
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(cleanup);
beforeEach(() => {
  parsePreview.mockReset().mockResolvedValue(PREVIEW);
  createSkill.mockReset().mockResolvedValue({ id: "s9" });
});

describe("ImportSkillDrawer", () => {
  it("says up front that an imported skill becomes prompt instructions", () => {
    renderDrawer();
    expect(screen.getByText(/becomes instructions inside your agent's prompt/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing from the file is executed/i)).toBeInTheDocument();
  });

  it("parses the upload and shows what would be stored, without creating anything", async () => {
    renderDrawer();
    upload("bundle.zip", "irrelevant, the server parses it");

    await waitFor(() => expect(screen.getByDisplayValue("archived-skill")).toBeInTheDocument());
    expect(screen.getByText("The body.")).toBeInTheDocument();
    // The preview is a parse, never a write.
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("lists the archive members that were not imported, and warns about executables", async () => {
    renderDrawer();
    upload("bundle.zip", "x");

    await waitFor(() => expect(screen.getByText("Not imported (2)")).toBeInTheDocument());
    expect(screen.getByText("scripts/install.sh")).toBeInTheDocument();
    expect(screen.getByText("assets/logo.png")).toBeInTheDocument();
    expect(screen.getByText(/never run/i)).toBeInTheDocument();
  });

  it("persists only on confirm, and stores the skill switched off", async () => {
    const onClose = renderDrawer();
    upload("rule.md", "# Archived skill");
    await waitFor(() => expect(screen.getByDisplayValue("archived-skill")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save skill"));

    await waitFor(() => expect(createSkill).toHaveBeenCalledTimes(1));
    expect(createSkill.mock.calls[0]![0]).toEqual({
      name: "archived-skill",
      description: "When reviewing an archive, take only its markdown.",
      type: "security",
      body: "# Archived skill\n\nThe body.",
      source: "imported_url",
      enabled: false,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the confirm button disabled until a file has been parsed", () => {
    renderDrawer();
    expect(screen.getByText("Save skill").closest("button")).toBeDisabled();
  });

  it("surfaces a parse failure instead of a preview", async () => {
    parsePreview.mockRejectedValue(new Error("boom"));
    renderDrawer();
    upload("bad.zip", "x");

    await waitFor(() => expect(screen.getByText("Import failed")).toBeInTheDocument());
    expect(screen.queryByText("Not imported (2)")).not.toBeInTheDocument();
  });
});
