import { z } from 'zod';
import { Repo, RepoInput } from './platform.js';

/**
 * Per-repo GitHub tokens. The token VALUE is never part of any response
 * contract — it lives only in the SecretsProvider. `configured` reports
 * whether a value resolves, which is all a client needs to know.
 */
export const GitHubToken = z.object({
  id: z.string(),
  workspace_id: z.string(),
  label: z.string(),
  github_login: z.string().nullable(),
  configured: z.boolean(),
  repo_count: z.number().int(),
  created_at: z.string(),
  last_validated_at: z.string().nullable(),
});
export type GitHubToken = z.infer<typeof GitHubToken>;

export const GitHubTokenInput = z.object({
  label: z.string().min(1).max(60),
  token: z.string().min(1),
});
export type GitHubTokenInput = z.infer<typeof GitHubTokenInput>;

/** Rename, replace the value, or both. */
export const GitHubTokenPatch = z
  .object({
    label: z.string().min(1).max(60).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((v) => v.label !== undefined || v.token !== undefined, {
    message: 'Provide label, token, or both',
  });
export type GitHubTokenPatch = z.infer<typeof GitHubTokenPatch>;

export const GitHubTokenTestInput = z.object({
  token: z.string().min(1),
  /** Optional `owner/name` — when given, also proves the token can read that repo. */
  full_name: z.string().optional(),
});
export type GitHubTokenTestInput = z.infer<typeof GitHubTokenTestInput>;

export const GitHubTokenTestResult = z.object({
  ok: z.boolean(),
  login: z.string().nullable(),
  message: z.string(),
});
export type GitHubTokenTestResult = z.infer<typeof GitHubTokenTestResult>;

/** `POST /repos` body. `github_token_id` is optional: omitted → no token. */
export const RepoCreate = RepoInput.extend({
  github_token_id: z.string().optional(),
});
export type RepoCreate = z.infer<typeof RepoCreate>;

export const AssignRepoTokenInput = z.object({
  github_token_id: z.string().nullable(),
});
export type AssignRepoTokenInput = z.infer<typeof AssignRepoTokenInput>;

export const RepoWithToken = Repo.extend({
  github_token_id: z.string().nullable(),
  github_token_label: z.string().nullable(),
  /**
   * True iff `github_token_id` is set AND its stored value resolves — i.e.
   * `resolveGitHubToken` would succeed. A repo can be ASSIGNED to a token with
   * no stored value (deleted, or never given a PAT — e.g. the seeded `demo`
   * token), which is a distinct broken state from `github_token_id: null`:
   * both need to gate the same "no token" UI signals, so both need a single
   * boolean rather than making every consumer re-derive it from two fields.
   */
  github_token_configured: z.boolean(),
});
export type RepoWithToken = z.infer<typeof RepoWithToken>;
