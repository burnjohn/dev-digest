import type { ContextDocType } from "@/lib/types";
import { useTranslations } from "next-intl";
import { s, TYPE_COLOR } from "./styles";

/** The `specs` / `docs` / `insights` source badge (AC-1) — the name of the
    nearest ancestor directory a document was found under. */
export function TypeBadge({ type }: { type: ContextDocType }) {
  const t = useTranslations("context");
  return <span style={s.typeBadge(TYPE_COLOR[type])}>{t(`type.${type}`)}</span>;
}
