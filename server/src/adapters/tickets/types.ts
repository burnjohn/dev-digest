/**
 * TicketFetcher — best-effort fetch of an external ticket/plan/spec URL
 * referenced in a PR's title/body (Jira, Linear, a GitHub issue in another
 * repo, a plain doc link, …). Used only by the Intent Layer's classifier to
 * gather one more signal; never authenticated in this iteration, and never
 * allowed to fail the classification — callers get `null` on any error, a
 * non-2xx status, or a non-text response.
 */
export interface TicketFetcher {
  /** `ref` is a fully-qualified URL. Returns `null` on any failure — never throws. */
  resolve(ref: string): Promise<{ content: string } | null>;
}
