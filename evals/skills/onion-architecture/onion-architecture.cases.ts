import type { SkillCase } from "../../src/index.js";

// Experiment 2 · Step 1 — the "ready-made case" to break and revert.
//
// A skillTask quality case runs with NO tools (tasks.ts): the SKILL.md content is injected as
// the system prompt and the model must reason over the fixture already in the prompt. So the
// fixture below is a small synthetic backend module inlined directly — a payments feature that
// commits four textbook onion-architecture violations, each quotable verbatim.
//
// The break/revert demo (Step 1): the FIRST practice ("di-composition-root") is the one tied to
// the SKILL.md "Composition Root — The Wiring Point" section + the "Direct Adapter Instantiation
// in Service" anti-pattern. Cut those from SKILL.md and re-run — with the rule gone the model
// stops reliably naming the `new DrizzlePaymentRepository(db)` line as a DI violation, so that one
// practice flips PASS→FAIL in the judge verdict while the other three (which map to rules still
// present) stay green. Revert the cut → green again.
//
// Curation notes (why each practice survives — Step 1 has the same discipline as Step 2):
//   - Each practice targets ONE documented onion rule and points at a specific line/symbol in the
//     fixture, so the judge can attach a verbatim evidence quote (`new DrizzlePaymentRepository`,
//     `PaymentRow`, `FastifyRequest`, the route body). No "reviews it well" vacuities.
//   - The four practices map to four DIFFERENT SKILL.md sections, so cutting one rule moves exactly
//     one practice — that is what makes the break diagnosable.

const PAYMENTS_MODULE = `Review this backend feature module against the architecture rules you were given. Report each violation with the offending line and the rule it breaks. Answer directly from the code below — do not ask for more files.

// server/src/modules/payments/service.ts  (Ring 2 — Application Service)
import { FastifyRequest } from "fastify";
import { db } from "../../db/client";
import { payments } from "../../db/schema";
import { DrizzlePaymentRepository } from "./repository";

type PaymentRow = typeof payments.$inferSelect;

export class PaymentService {
  // wires its own concrete adapter instead of receiving a port interface
  private repo = new DrizzlePaymentRepository(db);

  async getPayment(req: FastifyRequest, id: string): Promise<PaymentRow> {
    return this.repo.findById(id);
  }
}

// server/src/modules/payments/routes.ts  (Ring 4 — Presentation)
app.post("/payments", async (req, reply) => {
  const { amount, userId } = req.body as any;
  if (amount <= 0) return reply.code(400).send({ error: "amount must be positive" });
  const status = amount > 1000 ? "needs_review" : "approved";
  const row = await db.insert(payments).values({ amount, userId, status }).returning();
  return reply.send(row[0]);
});`;

export const cases: SkillCase[] = [
  {
    name: "flags the four onion violations in the payments module with the correct rule per finding",
    kind: "quality",
    prompt: PAYMENTS_MODULE,
    practices: [
      // --- Step-1 break target: this practice depends on the Composition Root / DI rule ---
      "flags that PaymentService constructs its own concrete repository with `new DrizzlePaymentRepository(db)` inside the service, instead of receiving the repository port interface through constructor injection wired in the composition root",
      // --- these three map to OTHER rules and should stay green when the DI rule is cut ---
      "flags that the service returns the raw Drizzle row type `PaymentRow` (`typeof payments.$inferSelect`), an infrastructure/ORM type leaking out of Ring 2 instead of an application DTO",
      "flags that the application service method accepts a `FastifyRequest` parameter — a framework/presentation type crossing inward into Ring 2",
      "flags that the route handler contains business logic and a direct `db.insert(...)` call (the amount check, the status branching, the DB write) instead of delegating to the service — a fat Ring 4 handler doing infrastructure work",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
