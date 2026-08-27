import { useTranslations } from "next-intl";
import { s } from "./styles";

/** The compact `t`-suffixed token estimate (AC-2, AC-6) — shared by a document's own
    row (per-row estimate) and a tab's footer (the summed, attached-only
    estimate); the caller decides which count to pass. */
export function TokenEstimate({ count }: { count: number }) {
  const t = useTranslations("context");
  return <span style={s.tokenEstimate}>{t("tokenEstimate", { count })}</span>;
}
