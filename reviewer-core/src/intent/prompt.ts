import type { ChatMessage } from '@devdigest/shared';

export interface IntentPromptParams {
  title: string;
  body: string;           // PR body/description (may be empty)
  filesSummary: string;   // compact: path (+N/-M)\n  @@ -a,b +c,d @@ per hunk
  linkedIssueBody?: string; // issue/spec body if linked
}

/**
 * Build the messages array for the intent classification LLM call.
 *
 * The system message instructs the model to act as a PR intent classifier and
 * output a JSON object with `intent`, `in_scope`, and `out_of_scope` fields.
 *
 * The user message contains PR metadata only — no diff body lines (no + / -
 * code lines). Only file paths, addition/deletion counts, and @@ hunk headers
 * are included in `filesSummary`, keeping token cost low and preventing the
 * classifier from being distracted by code details.
 */
export function buildIntentMessages(params: IntentPromptParams): ChatMessage[] {
  const system =
    'You are a PR intent classifier. You read PR metadata and infer the author\'s goal.\n\n' +
    'Return a JSON object with exactly these fields:\n' +
    '  "intent": one sentence summarising the PR\'s purpose.\n' +
    '  "in_scope": an array of short strings (max ~8 words each) for what this PR changes.\n' +
    '  "out_of_scope": an array of short strings (max ~8 words each) for what it deliberately does NOT touch.\n\n' +
    'Rules:\n' +
    '- If the PR body is empty, infer intent from the title and changed file paths.\n' +
    '- If the body contains a specification or plan (verbatim or via linked_issue), extract intent from it.\n' +
    '- Keep each in_scope/out_of_scope item to 1 short phrase (max ~8 words).\n' +
    '- Output ONLY the JSON object — no prose, no markdown fences.';

  const bodyText =
    params.body && params.body.trim().length > 0 ? params.body : '(no description provided)';

  let userContent =
    `<title>${params.title}</title>\n` +
    `<body>${bodyText}</body>\n` +
    `<changed_files>\n${params.filesSummary}\n</changed_files>`;

  if (params.linkedIssueBody) {
    userContent += `\n<linked_issue>\n${params.linkedIssueBody}\n</linked_issue>`;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ];

  return messages;
}
