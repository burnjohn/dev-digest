import type { SkillCase } from "../../src/index.js";

// Experiment 2 · Step 2 — an own case for a previously-uncovered skill (`zod` had no eval).
//
// zod was chosen from the lab's candidates (zod / security / pr-self-review / drizzle-orm-patterns)
// because its conventions are objectively checkable: every rule maps to a concrete symbol a judge
// can quote verbatim from the fixture, so PASS is defensible and FAIL is diagnosable.
//
// The fixture is a single bad request handler that commits four CRITICAL/HIGH zod violations from
// the skill's rule catalog. It is a concrete input, not an abstract "write good zod" — the model
// has real code to point at.
//
// Curation — why each practice survived, and what was cut (this is the hand-work the lab asks for):
//
//   KEPT (specific rule + verbatim-quotable evidence in the fixture):
//     1. parse-use-safeparse   -> `.parse(parsed)` on an untrusted request body
//     2. type-use-z-infer      -> a hand-written `interface CreateUser` duplicating the schema
//     3. schema-use-unknown-not-any -> `metadata: z.any()`
//     4. schema-string-validations  -> `email: z.string()` with no `.email()` format check
//
//   CUT (would pass with or without the skill, or has no verbatim anchor — measures nothing):
//     - "produces correct, working zod code" — a raw model does this; not discriminating.
//     - "explains what zod is / why validation matters" — generic knowledge, no evidence quote.
//     - "the schema is well-structured" — subjective, no line to cite; the judge can't ground it.
//     - "suggests good error messages" — the fixture gives the judge nothing specific to quote,
//       so PASS would rest on paraphrase, which the LLM-judge rubric forbids.
//
// threshold 0.6 (per the lab): 3 of 4 practices must pass for the case to go green.

const CREATE_USER_HANDLER = `Review this request handler's use of Zod against the guidelines you were given. For each issue, name the specific rule and point at the exact line. Answer directly from the code — do not ask for more files.

// server/src/modules/users/create-user.ts
import { z } from "zod";

interface CreateUser {
  email: string;
  age: number;
  metadata: any;
}

const CreateUserSchema = z.object({
  email: z.string(),
  age: z.number(),
  metadata: z.any(),
});

export async function createUser(req: FastifyRequest) {
  const raw = req.body as string;
  const parsed = JSON.parse(raw);
  const user: CreateUser = CreateUserSchema.parse(parsed);
  return db.insert(users).values(user);
}`;

export const cases: SkillCase[] = [
  {
    name: "flags the four zod violations in the create-user handler with the correct rule per finding",
    kind: "quality",
    prompt: CREATE_USER_HANDLER,
    practices: [
      "flags that `CreateUserSchema.parse(parsed)` is called on untrusted request-body input and recommends `.safeParse()` so a validation failure returns a typed error result instead of throwing",
      "flags the hand-written `interface CreateUser` as duplicating the schema and recommends deriving the type with `z.infer<typeof CreateUserSchema>` instead of maintaining a parallel manual interface",
      "flags `metadata: z.any()` and recommends `z.unknown()` (or a concrete schema) because `z.any()` disables type safety",
      "flags that the `email` field is a bare `z.string()` with no format validation and recommends `.email()` so invalid emails are rejected at the boundary",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
