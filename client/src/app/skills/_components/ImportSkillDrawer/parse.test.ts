// @vitest-environment node
//
// The parser is deliberately DOM-free so it can be tested here: jsdom has no
// full File/FileReader and no DecompressionStream, so anything touching them
// would be untestable. Archives are built with STORED (level 0) entries so the
// fixtures are deterministic and readable.
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  MAX_ARCHIVE_BYTES,
  SkillParseError,
  chooseMarkdownEntry,
  classifyEntries,
  parseSkillMarkdown,
  parseSkillUpload,
} from "./parse";

/** Build a STORED (uncompressed) zip and hand back a plain ArrayBuffer. */
function makeZip(files: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content);
  const zipped = zipSync(entries, { level: 0 });
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

function md(text: string): ArrayBuffer {
  const u8 = strToU8(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe("parseSkillMarkdown", () => {
  it("reads name and description from YAML front-matter", () => {
    const out = parseSkillMarkdown(
      "---\nname: zod\ndescription: Zod schema validation best practices\n---\n\n# Zod\n\nBody.",
    );
    expect(out.name).toBe("zod");
    expect(out.description).toBe("Zod schema validation best practices");
  });

  it("STRIPS front-matter from the body — it is metadata, not instructions", () => {
    const out = parseSkillMarkdown("---\nname: x\n---\n\n# Title\n\nReal content.");
    expect(out.body).not.toContain("name: x");
    expect(out.body).not.toContain("---");
    expect(out.body.startsWith("# Title")).toBe(true);
  });

  it("unquotes quoted front-matter values", () => {
    const out = parseSkillMarkdown('---\nname: "quoted-name"\n---\n\ntext');
    expect(out.name).toBe("quoted-name");
  });

  it("falls back to the first H1 and first paragraph", () => {
    const out = parseSkillMarkdown("# No Then Chains\n\nAlways use async/await.\n\nMore text.");
    expect(out.name).toBe("No Then Chains");
    expect(out.description).toBe("Always use async/await.");
  });

  it("skips lists, quotes and fences when picking a description", () => {
    const out = parseSkillMarkdown("# T\n\n- a bullet\n\n> a quote\n\n```\ncode\n```\n\nReal prose.");
    expect(out.description).toBe("Real prose.");
  });

  it("handles CRLF input", () => {
    const out = parseSkillMarkdown("---\r\nname: crlf\r\n---\r\n\r\n# T\r\n\r\nBody.");
    expect(out.name).toBe("crlf");
    expect(out.body).toContain("# T");
  });

  it("returns just a body when there is no heading or front-matter", () => {
    const out = parseSkillMarkdown("just some text");
    expect(out.name).toBeUndefined();
    expect(out.body).toBe("just some text");
  });

  it("ignores an unterminated front-matter fence", () => {
    const out = parseSkillMarkdown("---\nname: broken\n\n# Title");
    expect(out.name).toBe("Title");
    expect(out.body).toContain("---");
  });
});

describe("chooseMarkdownEntry", () => {
  it("prefers SKILL.md over other markdown", () => {
    expect(chooseMarkdownEntry(["docs/other.md", "SKILL.md"])).toBe("SKILL.md");
  });

  it("matches SKILL.md case-insensitively", () => {
    expect(chooseMarkdownEntry(["skill.md"])).toBe("skill.md");
  });

  it("prefers the shallowest SKILL.md", () => {
    expect(chooseMarkdownEntry(["a/b/SKILL.md", "a/SKILL.md"])).toBe("a/SKILL.md");
  });

  it("falls back to the shallowest .md", () => {
    expect(chooseMarkdownEntry(["deep/nested/x.md", "top.md"])).toBe("top.md");
  });

  it("ignores directory entries", () => {
    expect(chooseMarkdownEntry(["rules/", "rules/a.md"])).toBe("rules/a.md");
  });

  it("returns undefined when there is no markdown at all", () => {
    expect(chooseMarkdownEntry(["run.sh", "tile.json"])).toBeUndefined();
  });
});

describe("classifyEntries", () => {
  it("lists everything except the chosen file, dropping directories", () => {
    const { used, skipped } = classifyEntries(
      ["SKILL.md", "rules/", "rules/a.md", "scripts/run.sh", "tile.json"],
      "SKILL.md",
    );
    expect(used).toBe("SKILL.md");
    expect(skipped).toEqual(["rules/a.md", "scripts/run.sh", "tile.json"]);
    expect(skipped).not.toContain("rules/");
  });
});

describe("parseSkillUpload", () => {
  it("reads a bare .md file", () => {
    const out = parseSkillUpload(md("# Solo\n\nBody."), "solo.md");
    expect(out.name).toBe("Solo");
    expect(out.skipped).toEqual([]);
  });

  it("imports SKILL.md from a real-shaped skill archive and skips the rest", () => {
    // The exact shape of .claude/skills/fastify-best-practices: a SKILL.md, a
    // rules/ folder of extra markdown, a manifest, and an executable.
    const buf = makeZip({
      "SKILL.md": "---\nname: fastify-best-practices\ndescription: Fastify guidance\n---\n\n# Fastify\n\nRules.",
      "rules/routes.md": "# routes",
      "rules/hooks.md": "# hooks",
      "tile.json": "{}",
      "scripts/install.sh": "#!/bin/sh\nrm -rf /",
    });
    const out = parseSkillUpload(buf, "fastify-best-practices.zip");

    expect(out.name).toBe("fastify-best-practices");
    expect(out.description).toBe("Fastify guidance");
    expect(out.usedEntry).toBe("SKILL.md");
    expect(out.body).toContain("# Fastify");

    // Nothing executable is in the body; it is only listed as skipped.
    expect(out.body).not.toContain("rm -rf");
    expect(out.skipped).toContain("scripts/install.sh");
    expect(out.skipped).toContain("rules/routes.md");
    expect(out.skipped).toContain("tile.json");
    expect(out.skipped[0]).toBe("archive: fastify-best-practices.zip");
  });

  it("detects a zip by magic bytes even when named .md", () => {
    const buf = makeZip({ "SKILL.md": "# Zipped" });
    expect(parseSkillUpload(buf, "misnamed.md").usedEntry).toBe("SKILL.md");
  });

  it("throws no_markdown for an archive with no .md", () => {
    const buf = makeZip({ "run.sh": "echo hi", "tile.json": "{}" });
    expect(() => parseSkillUpload(buf, "x.zip")).toThrow(SkillParseError);
    try {
      parseSkillUpload(buf, "x.zip");
    } catch (e) {
      expect((e as SkillParseError).code).toBe("no_markdown");
    }
  });

  it("throws empty for a zero-byte file", () => {
    expect(() => parseSkillUpload(new ArrayBuffer(0), "empty.md")).toThrow(/empty/i);
  });

  it("throws empty for whitespace-only markdown", () => {
    expect(() => parseSkillUpload(md("   \n\n  "), "blank.md")).toThrow(/empty/i);
  });

  it("throws too_large past the archive cap before unzipping", () => {
    const big = new ArrayBuffer(MAX_ARCHIVE_BYTES + 1);
    try {
      parseSkillUpload(big, "big.zip");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SkillParseError).code).toBe("too_large");
    }
  });
});
