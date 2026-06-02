/* EvalCaseEditor — A4 Eval Case Editor (ported from EvalCaseEditor in
   screen_cizruns.jsx). Left = inputs (Diff / PR meta); right = expected JSON +
   last-run result. Save / Run case. Owner is the agent in the route. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, Tabs, TextInput } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import type { EvalRunResult } from "@devdigest/shared/contracts/eval-ci";
import {
  useEvalCase,
  useCreateEvalCase,
  useUpdateEvalCase,
  useRunEvalCase,
} from "../../../../../../../lib/hooks/eval";
import { DiffView } from "./_components/DiffView";
import { NEW_CASE, TABS, UNTITLED_CASE } from "./constants";
import { isValidJson } from "./helpers";
import { s } from "./styles";

export function EvalCaseEditor({
  agentId,
  caseId,
  onSaved,
}: {
  agentId: string;
  caseId: string; // "new" to create
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations("eval");
  const isNew = caseId === NEW_CASE;
  const existing = useEvalCase(isNew ? null : caseId);
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const run = useRunEvalCase();

  const [tab, setTab] = React.useState<string>(TABS[0]);
  const [name, setName] = React.useState("");
  const [diff, setDiff] = React.useState("");
  const [expected, setExpected] = React.useState("[]");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [lastRun, setLastRun] = React.useState<EvalRunResult | null>(null);

  React.useEffect(() => {
    const ec = existing.data as EvalCase | undefined;
    if (ec) {
      setName(ec.name);
      setDiff(ec.input_diff ?? "");
      setExpected(JSON.stringify(ec.expected_output ?? [], null, 2));
      const meta = (ec.input_meta ?? {}) as { title?: string; body?: string };
      setTitle(meta.title ?? "");
      setBody(meta.body ?? "");
    }
  }, [existing.data]);

  const expectedValid = React.useMemo(() => isValidJson(expected), [expected]);

  const buildInput = () => ({
    owner_kind: "agent" as const,
    owner_id: agentId,
    name: name || UNTITLED_CASE,
    input_diff: diff,
    input_meta: { title, body },
    expected_output: expectedValid ? JSON.parse(expected) : [],
  });

  const save = async () => {
    if (isNew) {
      const created = await create.mutateAsync(buildInput());
      onSaved?.(created.id);
    } else {
      await update.mutateAsync({ id: caseId, patch: buildInput() });
      onSaved?.(caseId);
    }
  };

  const doRun = async () => {
    let id = caseId;
    if (isNew) {
      const created = await create.mutateAsync(buildInput());
      id = created.id;
      onSaved?.(created.id);
    } else {
      await update.mutateAsync({ id: caseId, patch: buildInput() });
    }
    const result = await run.mutateAsync(id);
    setLastRun(result);
  };

  const r = lastRun?.result;

  return (
    <div style={s.root}>
      <div style={s.topbar}>
        <Icon.FlaskConical size={16} style={s.topIcon} />
        <span style={s.topTitle}>
          {isNew ? t("caseEditor.newCase") : t("caseEditor.caseTitle", { name })}
        </span>
        <div style={s.topActions}>
          <Button kind="secondary" size="sm" icon="Play" onClick={doRun}>
            {run.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
          </Button>
          <Button kind="primary" size="sm" icon="Check" onClick={save}>
            {create.isPending || update.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      </div>

      <div style={s.grid}>
        {/* left: inputs */}
        <div style={s.left}>
          <div style={s.nameField}>
            <FormField label={t("caseEditor.nameLabel")} required>
              <TextInput value={name} onChange={setName} mono placeholder={t("caseEditor.namePlaceholder")} />
            </FormField>
          </div>
          <div style={s.inputLabelWrap}>
            <div style={s.inputLabel}>{t("caseEditor.inputLabel")}</div>
          </div>
          <Tabs
            tabs={[t("caseEditor.tabs.diff"), t("caseEditor.tabs.prMeta")]}
            value={tab === TABS[0] ? t("caseEditor.tabs.diff") : t("caseEditor.tabs.prMeta")}
            onChange={(v) => setTab(v === t("caseEditor.tabs.diff") ? TABS[0] : TABS[1])}
            pad="0 16px"
          />
          <div style={s.tabBody}>
            {tab === TABS[0] && (
              <textarea
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
                spellCheck={false}
                style={s.diffArea}
                placeholder={t("caseEditor.diffPlaceholder")}
              />
            )}
            {tab === TABS[1] && (
              <div>
                <FormField label={t("caseEditor.titleLabel")}>
                  <TextInput value={title} onChange={setTitle} placeholder={t("caseEditor.titlePlaceholder")} />
                </FormField>
                <FormField label={t("caseEditor.bodyLabel")}>
                  <TextInput value={body} onChange={setBody} placeholder={t("caseEditor.bodyPlaceholder")} />
                </FormField>
              </div>
            )}
            {diff.trim() && tab === TABS[0] && (
              <div style={s.previewWrap}>
                <div style={s.previewLabel}>{t("caseEditor.preview")}</div>
                <DiffView text={diff} />
              </div>
            )}
          </div>
        </div>

        {/* right: expected + result */}
        <div style={s.right}>
          <div style={s.expectedHead}>
            <span style={s.expectedLabel}>{t("caseEditor.expectedOutput")}</span>
            <Badge
              color={expectedValid ? "var(--ok)" : "var(--crit)"}
              bg={expectedValid ? "var(--ok-bg)" : "var(--crit-bg)"}
              icon={expectedValid ? "Check" : "X"}
            >
              {expectedValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </Badge>
          </div>
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            spellCheck={false}
            style={s.expectedArea}
          />
          {r && (
            <div style={s.result(Boolean(r.per_trace[0]?.pass))}>
              <Icon.CheckCircle size={16} style={s.resultIcon(Boolean(r.per_trace[0]?.pass))} />
              <span style={s.resultText}>
                <b style={s.resultStrong}>
                  {r.per_trace[0]?.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
                </b>{" "}
                ·{" "}
                {t("caseEditor.resultSummary", {
                  recall: Math.round(r.recall * 100),
                  precision: Math.round(r.precision * 100),
                  citation: Math.round(r.citation_accuracy * 100),
                  duration: (r.duration_ms / 1000).toFixed(1),
                })}
                {r.cost_usd != null ? ` · $${r.cost_usd.toFixed(2)}` : ""}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EvalCaseEditor;
