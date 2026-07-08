import { describe, it, expect } from "vitest";
import { diffWords } from "./diffWords";

describe("diffWords", () => {
  it("identical strings produce a single equal token", () => {
    const tokens = diffWords("You are a helpful reviewer.", "You are a helpful reviewer.");
    expect(tokens.every((t) => t.type === "equal")).toBe(true);
    expect(tokens.map((t) => t.text).join("")).toBe("You are a helpful reviewer.");
  });

  it("fully different strings produce only removed and added content", () => {
    const tokens = diffWords("alpha beta gamma", "one two three");
    // No shared WORD survives the diff (whitespace separators may still
    // legitimately coincide across unrelated words — only content matters here).
    const equalWords = tokens.filter((t) => t.type === "equal").map((t) => t.text.trim()).filter(Boolean);
    expect(equalWords).toEqual([]);
    const removed = tokens.filter((t) => t.type !== "added").map((t) => t.text).join("");
    const added = tokens.filter((t) => t.type !== "removed").map((t) => t.text).join("");
    expect(removed).toBe("alpha beta gamma");
    expect(added).toBe("one two three");
  });

  it("a single middle-word change preserves surrounding equal tokens", () => {
    const tokens = diffWords("You are a strict reviewer today.", "You are a lenient reviewer today.");

    const removed = tokens.filter((t) => t.type === "removed").map((t) => t.text.trim());
    const added = tokens.filter((t) => t.type === "added").map((t) => t.text.trim());
    expect(removed).toEqual(["strict"]);
    expect(added).toEqual(["lenient"]);

    // Surrounding equal runs on both sides of the change are intact (the
    // changed word itself never appears in an equal token).
    const equalText = tokens.filter((t) => t.type === "equal").map((t) => t.text).join("");
    expect(equalText).not.toContain("strict");
    expect(equalText).not.toContain("lenient");
    expect(equalText.replace(/\s+/g, " ").trim()).toBe("You are a reviewer today.");

    // Full reconstruction still reproduces each original string exactly.
    const oldReconstructed = tokens.filter((t) => t.type !== "added").map((t) => t.text).join("");
    const newReconstructed = tokens.filter((t) => t.type !== "removed").map((t) => t.text).join("");
    expect(oldReconstructed).toBe("You are a strict reviewer today.");
    expect(newReconstructed).toBe("You are a lenient reviewer today.");
  });

  it("whitespace-only differences don't misalign surrounding equal tokens", () => {
    const tokens = diffWords("one  two three", "one two  three");

    // Content words are unchanged — none of "one"/"two"/"three" is split
    // into a removed+added pair just because the whitespace around them
    // differs between the two strings.
    const removedWords = tokens.filter((t) => t.type === "removed").map((t) => t.text.trim()).filter(Boolean);
    const addedWords = tokens.filter((t) => t.type === "added").map((t) => t.text.trim()).filter(Boolean);
    expect(removedWords).toEqual([]);
    expect(addedWords).toEqual([]);

    // The three words themselves are all `equal` tokens, in order — only
    // the whitespace RUNS between them (which genuinely differ) are
    // removed/added, never the words.
    const equalWords = tokens.filter((t) => t.type === "equal").map((t) => t.text);
    expect(equalWords).toEqual(["one", "two", "three"]);

    // Reconstructing old/new from the token stream must reproduce each
    // original string exactly.
    const oldReconstructed = tokens
      .filter((t) => t.type !== "added")
      .map((t) => t.text)
      .join("");
    const newReconstructed = tokens
      .filter((t) => t.type !== "removed")
      .map((t) => t.text)
      .join("");
    expect(oldReconstructed).toBe("one  two three");
    expect(newReconstructed).toBe("one two  three");
  });
});
