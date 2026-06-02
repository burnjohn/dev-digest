import { ApiError } from "../../../../../../lib/api";

/** A 404 means the tour simply hasn't been generated yet (not a hard error). */
export function isNotGenerated(isError: boolean, error: unknown): boolean {
  return isError && error instanceof ApiError && error.status === 404;
}
