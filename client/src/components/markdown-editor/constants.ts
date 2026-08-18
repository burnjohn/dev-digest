/**
 * Mirrors MAX_SKILL_BODY_CHARS in the server's skills module. The server schema is
 * the real gate — this only drives the editor's over-budget styling, so the user
 * sees the limit before a 422 does.
 */
export const MAX_SKILL_BODY_CHARS = 8_000;
