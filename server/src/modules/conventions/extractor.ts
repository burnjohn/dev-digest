import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import type { LLMProvider } from "@devdigest/shared";

// Zod схема для відповіді LLM
const ExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      rule: z.string(),
      evidence_path: z.string(),
      evidence_snippet: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/** Читає файл з диску. Повертає null якщо файл не знайдено. Обрізає до 2000 символів. */
async function readSample(
  clonePath: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const content = await readFile(join(clonePath, relativePath), "utf-8");
    return content.slice(0, 2_000);
  } catch {
    return null;
  }
}

/**
 * Верифікація доказів після LLM.
 * Перевіряємо що файл реально існує і перший рядок сніппета є у файлі.
 */
async function verifyEvidence(
  clonePath: string,
  evidencePath: string,
  evidenceSnippet: string,
): Promise<boolean> {
  try {
    const fullPath = join(clonePath, evidencePath);
    const content = await readFile(fullPath, "utf-8");
    const firstLine = evidenceSnippet.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 0 && content.includes(firstLine);
  } catch {
    return false;
  }
}

export interface ExtractedCandidate {
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  confidence: number;
}

/**
 * Основна функція екстракції:
 * 1. Читає конфіги (eslint, tsconfig, prettier) — без LLM
 * 2. Читає топ-12 файлів репо
 * 3. Викликає gpt-4.1-mini для аналізу
 * 4. Верифікує докази кодом
 * 5. Повертає тільки валідні кандидати
 */
export async function extractConventions(opts: {
  clonePath: string;
  samplePaths: string[];
  repoName: string;
  llm: LLMProvider;
  /** Model id understood by the injected provider (e.g. 'openai/gpt-4.1-mini' on OpenRouter). */
  model: string;
}): Promise<ExtractedCandidate[]> {
  const { clonePath, samplePaths, repoName, llm, model } = opts;

  const configFiles = [
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc",
    ".eslintrc.cjs",
    "tsconfig.json",
    "tsconfig.base.json",
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    "biome.json",
    ".editorconfig",
  ];

  const configContents: string[] = [];
  for (const cfg of configFiles) {
    const content = await readSample(clonePath, cfg);
    if (content) {
      configContents.push(`--- ${cfg} ---\n${content}`);
    }
  }

  const sampleContents: string[] = [];
  for (const path of samplePaths.slice(0, 12)) {
    const content = await readSample(clonePath, path);
    if (content) {
      sampleContents.push(`--- ${path} ---\n${content}`);
    }
  }

  const allSamples = [...configContents, ...sampleContents].join("\n\n");

  if (allSamples.trim().length === 0) {
    return [];
  }

  const result = await llm.completeStructured({
    model,
    schema: ExtractionSchema,
    schemaName: "ConventionsExtraction",
    messages: [
      {
        role: "system",
        content: `You are a code-convention analyst. Analyze the provided code samples and extract concrete coding conventions that are consistently followed in this repository.

Return ONLY conventions that:
1. Have clear evidence in the provided files
2. Can be formulated as a specific, actionable rule (start with "Always...", "Never...", "Use X instead of Y...")
3. Appear in at least 2 places or are configured explicitly
4. Would be useful for a code reviewer to enforce

Do NOT include:
- Generic best practices obvious to any TypeScript developer
- Things with only 1 example unless it's in a config file
- Framework defaults`,
      },
      {
        role: "user",
        content: `Repository: ${repoName}

Analyze these files and extract coding conventions:

${allSamples}

Return JSON with a "candidates" array. Each candidate:
- rule: specific actionable rule in imperative form
- evidence_path: relative file path where you found this convention
- evidence_snippet: exact code snippet (2–5 lines) demonstrating the rule
- confidence: 0.0–1.0

Only include conventions with confidence > 0.6.`,
      },
    ],
    temperature: 0.2,
    maxTokens: 2048,
  });

  const verified: ExtractedCandidate[] = [];
  for (const c of result.data.candidates) {
    const valid = await verifyEvidence(
      clonePath,
      c.evidence_path,
      c.evidence_snippet,
    );
    if (valid) {
      verified.push({
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      });
    }
  }

  return verified;
}
