/** Pure helpers for the Eval Case Editor. */

/** Whether the given string parses as JSON. */
export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
