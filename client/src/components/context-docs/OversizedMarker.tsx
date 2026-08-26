import { useTranslations } from "next-intl";
import { s } from "./styles";

/** Marks a document over the 400 KB bound (AC-8) — visible on the Project
    Context page and both `Context` tabs alike; the attach-affordance
    disabling behaviour itself is each surface's own concern. */
export function OversizedMarker() {
  const t = useTranslations("context");
  return <span style={s.oversized}>{t("oversized")}</span>;
}
