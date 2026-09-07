"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, TextInput, Textarea, SelectInput, Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { EvalExpectationType } from "@devdigest/shared/contracts/knowledge";
import { DiffInputField, EXPECTATION_TYPES } from "@/components/eval-case-editor";
import { useCreateEvalCase } from "@/lib/hooks/eval";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { s } from "./styles";

/**
 * The agent-owned mirror of `skills/.../EvalsTab/NewSkillCaseModal.tsx` — the
 * hand-authored case path (`POST /agents/:id/eval/cases`), same 422 surfacing
 * for AC-9 (diff too large) / AC-10 (expectation ungrounded).
 */
export function NewAgentCaseModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const create = useCreateEvalCase();
  const [inputTab, setInputTab] = React.useState<"diff" | "prMeta">("diff");

  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [diff, setDiff] = React.useState("");
  const [files, setFiles] = React.useState("");
  const [prTitle, setPrTitle] = React.useState("");
  const [prBody, setPrBody] = React.useState("");
  const [expType, setExpType] = React.useState<EvalExpectationType>("must_find");
  const [expFile, setExpFile] = React.useState("");
  const [expStart, setExpStart] = React.useState(1);
  const [expEnd, setExpEnd] = React.useState(1);
  const [expSeverity, setExpSeverity] = React.useState("");
  const [expCategory, setExpCategory] = React.useState("");

  const submit = () => {
    create.mutate(
      {
        agentId: agent.id,
        input: {
          name,
          notes: notes || null,
          input_diff: diff,
          input_files: files
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean),
          input_meta: { pr_number: null, title: prTitle, body: prBody || null },
          expectation: {
            type: expType,
            file: expFile,
            start_line: expStart,
            end_line: expEnd,
            severity: expSeverity || null,
            category: expCategory || null,
            title: null,
          },
        },
      },
      {
        onSuccess: () => {
          toast.success(t("caseEditor.save"));
          onClose();
        },
        onError: (err) => {
          toast.error(err instanceof ApiError ? err.message : t("caseEditor.save"));
        },
      },
    );
  };

  return (
    <Modal title={t("caseEditor.newCase")} onClose={onClose} width={720}>
      <div style={s.form}>
        <div style={s.formField}>
          <label style={s.label} htmlFor="agent-new-case-name">
            {t("caseEditor.nameLabel")}
          </label>
          <TextInput
            id="agent-new-case-name"
            value={name}
            onChange={setName}
            placeholder={t("caseEditor.namePlaceholder")}
          />
        </div>

        <div style={s.formField}>
          <span style={s.label}>{t("caseEditor.inputLabel")}</span>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={inputTab}
            onChange={(k) => setInputTab(k as "diff" | "prMeta")}
            pad="0"
          />
          {inputTab === "diff" ? (
            <DiffInputField
              diff={diff}
              onDiffChange={setDiff}
              files={files}
              onFilesChange={setFiles}
              filesId="agent-new-case-files"
              diffPlaceholder={t("caseEditor.diffPlaceholder")}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={s.formField}>
                <label style={s.label} htmlFor="agent-new-case-pr-title">
                  {t("caseEditorPanel.prTitleLabel")}
                </label>
                <TextInput
                  id="agent-new-case-pr-title"
                  value={prTitle}
                  onChange={setPrTitle}
                  placeholder={t("caseEditor.titlePlaceholder")}
                />
              </div>
              <div style={s.formField}>
                <label style={s.label} htmlFor="agent-new-case-pr-body">
                  {t("caseEditorPanel.prBodyLabel")}
                </label>
                <Textarea
                  value={prBody}
                  onChange={setPrBody}
                  rows={4}
                  placeholder={t("caseEditor.bodyPlaceholder")}
                />
              </div>
            </div>
          )}
        </div>

        <div style={s.formField}>
          <span style={s.label}>{t("caseEditorPanel.expectationTitle")}</span>
          <div style={s.formRow}>
            <div style={s.formField}>
              <label style={s.label} htmlFor="agent-new-case-exp-type">
                {t("caseEditorPanel.expectationType")}
              </label>
              <SelectInput
                value={expType}
                onChange={(v) => setExpType(v as EvalExpectationType)}
                options={EXPECTATION_TYPES.map((v) => ({
                  value: v,
                  label: v === "must_find" ? t("expectation.mustFind") : t("expectation.mustNotFlag"),
                }))}
              />
            </div>
            <div style={s.formField}>
              <label style={s.label} htmlFor="agent-new-case-exp-file">
                {t("caseEditorPanel.expectationFile")}
              </label>
              <TextInput id="agent-new-case-exp-file" value={expFile} onChange={setExpFile} mono />
            </div>
          </div>
          <div style={s.formRow}>
            <div style={s.formField}>
              <label style={s.label} htmlFor="agent-new-case-exp-start">
                {t("caseEditorPanel.expectationStartLine")}
              </label>
              <TextInput
                id="agent-new-case-exp-start"
                type="number"
                value={String(expStart)}
                onChange={(v) => setExpStart(Number(v) || 0)}
              />
            </div>
            <div style={s.formField}>
              <label style={s.label} htmlFor="agent-new-case-exp-end">
                {t("caseEditorPanel.expectationEndLine")}
              </label>
              <TextInput
                id="agent-new-case-exp-end"
                type="number"
                value={String(expEnd)}
                onChange={(v) => setExpEnd(Number(v) || 0)}
              />
            </div>
          </div>
          <div style={s.formRow}>
            <div style={s.formField}>
              <label style={s.label} htmlFor="agent-new-case-exp-severity">
                {t("caseEditorPanel.expectationSeverity")}
              </label>
              <TextInput id="agent-new-case-exp-severity" value={expSeverity} onChange={setExpSeverity} />
            </div>
            <div style={s.formField}>
              <label style={s.label} htmlFor="agent-new-case-exp-category">
                {t("caseEditorPanel.expectationCategory")}
              </label>
              <TextInput id="agent-new-case-exp-category" value={expCategory} onChange={setExpCategory} />
            </div>
          </div>
        </div>

        <div style={s.formField}>
          <label style={s.label} htmlFor="agent-new-case-notes">
            {t("caseEditorPanel.notesLabel")}
          </label>
          <Textarea value={notes} onChange={setNotes} rows={2} />
        </div>

        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditorPanel.close")}
          </Button>
          <Button kind="primary" onClick={submit} loading={create.isPending}>
            {create.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
