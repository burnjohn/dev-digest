import { EXPORT_FILENAME, JSON_MIME } from "./constants";

/** Trigger a browser download of `data` serialized as pretty JSON. */
export function downloadJson(data: unknown, filename: string = EXPORT_FILENAME): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: JSON_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
