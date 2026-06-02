import { getRequestConfig } from "next-intl/server";
import type { AbstractIntlMessages } from "next-intl";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * i18n config (next-intl, single locale `en`, no locale routing).
 *
 * Messages are split per feature namespace under `messages/<locale>/<ns>.json`
 * and merged here into `{ [ns]: {...} }`. Feature agents add their own
 * `messages/en/<feature>.json` without touching shared code — no contention.
 * Use it via `useTranslations("<ns>")` (client) or `getTranslations("<ns>")`.
 */
export const LOCALE = "en";

export function loadMessages(locale: string): AbstractIntlMessages {
  const dir = join(process.cwd(), "messages", locale);
  const messages: Record<string, AbstractIntlMessages> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const ns = file.replace(/\.json$/, "");
    messages[ns] = JSON.parse(readFileSync(join(dir, file), "utf8")) as AbstractIntlMessages;
  }
  return messages;
}

export default getRequestConfig(async () => ({
  locale: LOCALE,
  messages: loadMessages(LOCALE),
}));
