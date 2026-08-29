/** How many batches the cross-agent feed shows. A DISPLAY cap only: the
    server sends each agent's FULL history on `GET /evals/dashboard`
    (`service.ts` `recentBatches: history`, no LIMIT), so slicing here shortens
    the table, never the payload. */
export const RECENT_RUNS_LIMIT = 10;
