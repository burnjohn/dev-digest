import { describe, it, expect } from "vitest";
import { parseMultiFileDiff } from "./helpers";

describe("parseMultiFileDiff", () => {
  it("splits a valid multi-file unified diff into one record per file, with correct paths and patch bodies", () => {
    const raw = [
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 2;",
      " const b = 2;",
      "--- a/src/bar.ts",
      "+++ b/src/bar.ts",
      "@@ -1,1 +1,1 @@",
      "-old bar",
      "+new bar",
    ].join("\n");

    const files = parseMultiFileDiff(raw);

    expect(files).toHaveLength(2);
    expect(files[0]!.path).toBe("src/foo.ts");
    expect(files[0]!.patch).toBe(
      ["@@ -1,2 +1,2 @@", "-const a = 1;", "+const a = 2;", " const b = 2;"].join("\n"),
    );
    expect(files[1]!.path).toBe("src/bar.ts");
    expect(files[1]!.patch).toBe(["@@ -1,1 +1,1 @@", "-old bar", "+new bar"].join("\n"));
  });

  it("parses a single-file diff into exactly one record", () => {
    const raw = ["--- a/only.ts", "+++ b/only.ts", "@@ -1,1 +1,1 @@", "-x", "+y"].join("\n");

    const files = parseMultiFileDiff(raw);

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("only.ts");
  });

  it("treats /dev/null as the old path (new file) and takes the path from the +++ header", () => {
    const raw = ["--- /dev/null", "+++ b/src/new-file.ts", "@@ -0,0 +1,1 @@", "+brand new line"].join("\n");

    const files = parseMultiFileDiff(raw);

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/new-file.ts");
    expect(files[0]!.additions).toBe(1);
    expect(files[0]!.deletions).toBe(0);
  });

  it("treats /dev/null as the new path (deleted file) and takes the path from the --- header", () => {
    const raw = ["--- a/src/removed.ts", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-gone line"].join("\n");

    const files = parseMultiFileDiff(raw);

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/removed.ts");
    expect(files[0]!.additions).toBe(0);
    expect(files[0]!.deletions).toBe(1);
  });

  it("returns an empty array for input that has no --- /+++ header pair", () => {
    const raw = ["just some plain text", "no diff markers here", "@@ -1,1 +1,1 @@"].join("\n");

    expect(parseMultiFileDiff(raw)).toEqual([]);
  });

  it("counts additions and deletions per file, ignoring the header lines themselves", () => {
    const raw = [
      "--- a/multi.ts",
      "+++ b/multi.ts",
      "@@ -1,4 +1,5 @@",
      "+added one",
      "+added two",
      "-removed one",
      " context line",
      "+added three",
    ].join("\n");

    const files = parseMultiFileDiff(raw);

    expect(files).toHaveLength(1);
    expect(files[0]!.additions).toBe(3);
    expect(files[0]!.deletions).toBe(1);
  });
});
