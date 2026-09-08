"use client";

import { useTranslations } from "next-intl";
import { Modal, Button, Skeleton, ErrorState } from "@devdigest/ui";
import { useSkillEvalCompare } from "@/lib/hooks/eval";
import { formatMetricDeltaPct } from "@/lib/eval-format";
import { s } from "./styles";

/**
 * AC-32, AC-33, AC-51 — metric deltas AND lift deltas old→new over the
 * intersection, the case-set/carrier difference stated (never a bare delta
 * over two different things), and `skill_body_diff` rendered as plain
 * `<pre>` TEXT lines (client/LEARNINGS.md 2026-08-13 — `Markdown` does not
 * constrain link/image targets, so untrusted skill-body text never goes
 * through it) with added/removed distinguished by BOTH a prefix glyph and
 * colour (AC-47).
 */
export function SkillCompareModal({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data: compare, isLoading, isError } = useSkillEvalCompare(a, b);
  const na = t("notApplicable");

  return (
    <Modal title={t("skill.compare.title")} onClose={onClose} width={720}>
      <div style={s.modalBody}>
        {isLoading && <Skeleton height={200} />}
        {isError && <ErrorState body={t("compare.selectTwo")} />}
        {compare && (
          <>
            <div style={s.tiles}>
              <DeltaTile label={t("dashboard.metrics.recall")} value={formatMetricDeltaPct(compare.deltas.recall, na)} />
              <DeltaTile
                label={t("dashboard.metrics.precision")}
                value={formatMetricDeltaPct(compare.deltas.precision, na)}
              />
              <DeltaTile
                label={t("dashboard.metrics.citationAccuracy")}
                value={formatMetricDeltaPct(compare.deltas.citation_accuracy, na)}
              />
            </div>

            <div style={s.section}>
              <h3 style={s.h2}>{t("skill.compare.liftDeltaTitle")}</h3>
              <div style={s.tiles}>
                <DeltaTile
                  label={t("dashboard.metrics.recall")}
                  value={formatMetricDeltaPct(compare.lift_deltas.recall, na)}
                />
                <DeltaTile
                  label={t("dashboard.metrics.precision")}
                  value={formatMetricDeltaPct(compare.lift_deltas.precision, na)}
                />
                <DeltaTile
                  label={t("dashboard.metrics.citationAccuracy")}
                  value={formatMetricDeltaPct(compare.lift_deltas.citation_accuracy, na)}
                />
              </div>
            </div>

            {compare.carrier_differs && <p style={s.callout}>{t("skill.compare.carrierDiffers")}</p>}

            {(compare.only_in_old.length > 0 || compare.only_in_new.length > 0) && (
              <p style={s.callout}>
                {t("compare.caseSetChanged", {
                  onlyOld: compare.only_in_old.length,
                  onlyNew: compare.only_in_new.length,
                  common: compare.common_case_ids.length,
                })}
              </p>
            )}

            <div style={s.section}>
              <h3 style={s.h2}>{t("skill.compare.bodyDiff")}</h3>
              {compare.skill_body_diff.length === 0 ? (
                <p>{t("compare.noPromptDiff")}</p>
              ) : (
                <pre style={s.pre}>
                  {compare.skill_body_diff.map((line, i) => (
                    <div key={i} style={s.diffLine(line.kind)}>
                      {(line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  ") + line.text}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </>
        )}

        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeltaTile({ label, value }: { label: string; value: string }) {
  const up = value.startsWith("+");
  const down = value.startsWith("-");
  const color = up ? "var(--ok, var(--text-secondary))" : down ? "var(--crit)" : "var(--text-muted)";
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileDelta(color)}>{value}</div>
    </div>
  );
}
