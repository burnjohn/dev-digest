import type {
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseRunResult,
  EvalExpectedFinding,
  EvalForbiddenRegion,
  EvalOwnerKind,
} from "@devdigest/shared";

/**
 * The shared eval-case editor modal — three consumers, all landing in later
 * waves: the agent `Evals` tab (T12, wave 2 sibling), the finding card's
 * "Turn into eval case" (T15, wave 3), and the skill `Evals` tab (T19, wave
 * 5). This wave wires the AGENT arm only (`ownerKind === "agent"`); the skill
 * arm's Input tab set + Actual output rendering is a seam T20 (wave 5) adds
 * by editing `getInputTabs` / `ActualOutputRegion` in `EvalCaseEditor.tsx` —
 * never by touching this file's shape or any call site.
 */
export interface EvalCaseEditorProps {
  /** Which kind of owner this editor is attached to. Only "agent" is wired
   * this wave — kept on the props (and here on `types.ts`) so T20 never has
   * to widen the public surface, only the two `ownerKind`-branching spots
   * inside the component body. */
  ownerKind: EvalOwnerKind;
  ownerId: string;
  /**
   * The case being edited (has `id`), a draft to seed a brand-new one (from
   * "Turn into eval case" — no `id`, no `expectation_kind`), or omitted/null
   * for a blank new case.
   */
  initialCase?: EvalCaseRecord | EvalCaseDraft | null;
  /** The seeded case's most recently persisted run, if any — feeds REQ-49's
   * "Actual output" region and the last-run summary strip. Ignored for a
   * brand-new case (there is nothing to have run yet). */
  initialRun?: EvalCaseRunResult | null;
  onClose: () => void;
  /** Fired after a successful create/update. The editor deliberately never
   * closes itself on save (REQ-11: the user stays put to see the run
   * result) — a caller that wants to close on save does so from here. */
  onSaved?: (record: EvalCaseRecord) => void;
}

/** The three Input sub-tabs an eval case's source can be authored/read from.
 * `pr_meta` (not `prMeta`) matches the wire/contract naming convention used
 * throughout this feature's other snake_case identifiers. */
export type InputTabKey = "diff" | "files" | "pr_meta";

/** One Input tab's rendering data — deliberately data, not JSX, so
 * `getInputTabs` (the seam `getInputTabs` in `helpers.ts` T20 extends) stays
 * a plain function, testable without a renderer. */
export interface InputTabConfig {
  key: InputTabKey;
  /** `messages/en/eval.json`'s `caseEditor.tabs` key for this tab's label. */
  labelKey: string;
  disabled: boolean;
  /** `caseEditor.tabs` key for the disabled reason, shown as this tab's
   * `title` and folded into its accessible name. Only meaningful when
   * `disabled` is true. */
  disabledReasonKey?: string;
}

export type { EvalCaseDraft, EvalCaseRecord, EvalCaseRunResult, EvalExpectedFinding, EvalForbiddenRegion, EvalOwnerKind };
