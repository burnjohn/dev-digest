/* ExportWizard — A4 Export-to-CI wizard (4 steps: Target / Preview / Configure
   / Install), ported from screen_export.jsx. Uses ExportWizardSteps from
   @devdigest/ui. On install it POSTs /agents/:id/export-ci. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Chip,
  ExportWizardSteps,
  FormField,
  Icon,
  Modal,
  Toggle,
} from "@devdigest/ui";
import type { CiExport, CiFile, CiTarget } from "@devdigest/shared/contracts/eval-ci";
import { useExportToCi } from "../../../../lib/hooks/ci";
import {
  FALLBACK_FILE_COUNT,
  OPENAI_KEY,
  POST_AS_OPTIONS,
  STEP_LABEL_KEYS,
  TARGETS,
  TOTAL_STEPS,
  TRIGGERS,
} from "./constants";
import { s } from "./styles";

export function ExportWizard({
  agentId,
  agentName,
  defaultRepo = "",
  onClose,
  onInstalled,
}: {
  agentId: string;
  agentName?: string;
  defaultRepo?: string;
  onClose: () => void;
  onInstalled?: (res: CiExport) => void;
}) {
  const t = useTranslations("ci");
  const [step, setStep] = React.useState(0);
  const [target, setTarget] = React.useState<CiTarget>("gha");
  const [repo, setRepo] = React.useState(defaultRepo);
  const [postAs, setPostAs] = React.useState<"github_review" | "pr_comment" | "none">("github_review");
  const [files, setFiles] = React.useState<CiFile[] | null>(null);
  const [selFile, setSelFile] = React.useState<string | null>(null);
  const exportCi = useExportToCi();

  // Preview the generated files (no side effect) when entering step 2.
  React.useEffect(() => {
    if (step === 1 && !files) {
      exportCi
        .mutateAsync({ agentId, input: { repo: repo || "owner/repo", target, action: "files", post_as: postAs } })
        .then((res) => {
          setFiles(res.files);
          setSelFile(res.files.find((f) => f.path.includes("workflows"))?.path ?? res.files[0]?.path ?? null);
        })
        .catch(() => setFiles([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const install = async () => {
    const res = await exportCi.mutateAsync({
      agentId,
      input: { repo, target, action: "open_pr", post_as: postAs },
    });
    onInstalled?.(res);
    onClose();
  };

  const selected = files?.find((f) => f.path === selFile);
  const stepLabels = STEP_LABEL_KEYS.map((k) => t(k));

  const footer = (
    <div style={s.footer}>
      {step > 0 && (
        <Button kind="ghost" icon="ChevronLeft" onClick={() => setStep((p) => p - 1)}>
          {t("exportWizard.back")}
        </Button>
      )}
      <div style={s.footerRight}>
        {step < TOTAL_STEPS - 1 ? (
          <Button
            kind="primary"
            iconRight="ArrowRight"
            onClick={() => setStep((p) => p + 1)}
            disabled={step === 0 && !repo.trim()}
          >
            {t("exportWizard.continue")}
          </Button>
        ) : (
          <Button kind="primary" icon="Check" onClick={install}>
            {exportCi.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      width={720}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agentName ?? t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.stepsBar}>
        <ExportWizardSteps step={step} labels={stepLabels} />
      </div>
      <div style={s.body}>
        {/* Step 1 — Target + repo */}
        {step === 0 && (
          <>
            <FormField label={t("exportWizard.repoLabel")} required hint={t("exportWizard.repoHint")}>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder={t("exportWizard.repoPlaceholder")}
                style={s.input}
              />
            </FormField>
            <div style={s.targetGrid}>
              {TARGETS.map((target_) => (
                <button key={target_.key} onClick={() => setTarget(target_.key)} style={s.targetCard(target === target_.key)}>
                  <div style={s.targetHead}>
                    <div style={s.targetIconWrap(target === target_.key)}>
                      {React.createElement(Icon[target_.icon], { size: 18 })}
                    </div>
                    <span style={s.targetName}>{t(target_.nameKey)}</span>
                    {target_.rec && (
                      <Badge color="var(--accent-text)" bg="var(--accent-bg)" style={s.targetBadge}>
                        {t("exportWizard.recommended")}
                      </Badge>
                    )}
                  </div>
                  <p style={s.targetDesc}>{t(target_.descKey)}</p>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2 — Preview files */}
        {step === 1 && (
          <div style={s.previewGrid}>
            <div style={s.fileList}>
              <div style={s.fileListLabel}>{t("exportWizard.filesToCreate")}</div>
              {(files ?? []).map((f) => (
                <div key={f.path} onClick={() => setSelFile(f.path)} style={s.fileRow(selFile === f.path)}>
                  <Icon.FileText size={13} style={s.fileIcon(selFile === f.path)} />
                  <span className="mono" style={s.fileName(selFile === f.path)}>
                    {f.path}
                  </span>
                </div>
              ))}
              {files == null && <div style={s.generating}>{t("exportWizard.generating")}</div>}
            </div>
            <div style={s.fileViewer}>
              <div style={s.fileViewerHead}>
                <span className="mono" style={s.fileViewerPath}>{selFile ?? "—"}</span>
                <Badge color="var(--text-muted)" icon="Edit">
                  {t("exportWizard.editable")}
                </Badge>
              </div>
              <pre className="mono" style={s.fileViewerPre}>
                {selected?.contents ?? ""}
              </pre>
            </div>
          </div>
        )}

        {/* Step 3 — Configure */}
        {step === 2 && (
          <div style={s.configWrap}>
            <FormField label={t("exportWizard.triggerLabel")}>
              <div style={s.triggerChips}>
                {TRIGGERS.map((trigger) => (
                  <Chip key={trigger} active icon="Check">
                    {trigger}
                  </Chip>
                ))}
              </div>
            </FormField>
            <FormField label={t("exportWizard.postResultsLabel")}>
              <div style={s.postAsList}>
                {POST_AS_OPTIONS.map((opt) => (
                  <label key={opt.key} onClick={() => setPostAs(opt.key)} style={s.postAsLabel}>
                    <span style={s.radio(postAs === opt.key)}>
                      {postAs === opt.key && <span style={s.radioDot} />}
                    </span>
                    {t(opt.labelKey)}
                    {opt.recommended && (
                      <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                        {t("exportWizard.recommended")}
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            </FormField>
            <div style={s.blockMerge}>
              <Toggle on={false} onChange={() => {}} size={16} />
              <div>
                <div style={s.blockMergeTitle}>{t("exportWizard.blockMergeTitle")}</div>
                <div style={s.blockMergeDesc}>{t("exportWizard.blockMergeDesc")}</div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4 — Install */}
        {step === 3 && (
          <div style={s.installWrap}>
            <div style={s.installCard}>
              <div style={s.installCardHead}>
                <Icon.GitPullRequest size={18} style={s.installCardIcon} />
                <span style={s.installCardTitle}>{t("exportWizard.installCardTitle")}</span>
                <Badge color="var(--accent-text)" bg="var(--bg-elevated)" style={s.installCardBadge}>
                  {t("exportWizard.recommended")}
                </Badge>
              </div>
              <p style={s.installCardBody}>
                {t("exportWizard.installCardBody", {
                  repo: repo || t("exportWizard.ownerRepo"),
                  count: files?.length ?? FALLBACK_FILE_COUNT,
                })}
              </p>
            </div>
            <p style={s.secretNote}>{t("exportWizard.secretNote", { key: OPENAI_KEY })}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ExportWizard;
