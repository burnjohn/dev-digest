import { describe, it, expect } from 'vitest';
import { GitHubToken, GitHubTokenInput, RepoCreate, RepoWithToken } from '@devdigest/shared';

describe('github token contracts', () => {
  it('GitHubToken never carries the token value', () => {
    const parsed = GitHubToken.parse({
      id: 'a3f',
      workspace_id: 'ws',
      label: 'work',
      github_login: 'octocat',
      configured: true,
      repo_count: 2,
      created_at: '2026-08-05T00:00:00Z',
      last_validated_at: null,
      token: 'ghp_leak',
    });
    expect('token' in parsed).toBe(false);
  });

  it('GitHubTokenInput requires a non-empty label and token', () => {
    expect(GitHubTokenInput.safeParse({ label: '', token: 'ghp_x' }).success).toBe(false);
    expect(GitHubTokenInput.safeParse({ label: 'work', token: '' }).success).toBe(false);
    expect(GitHubTokenInput.safeParse({ label: 'work', token: 'ghp_x' }).success).toBe(true);
  });

  it('RepoCreate keeps github_token_id optional so {url} alone still parses', () => {
    expect(RepoCreate.safeParse({ url: 'https://github.com/acme/api' }).success).toBe(true);
    const withToken = RepoCreate.parse({
      url: 'https://github.com/acme/api',
      github_token_id: 'a3f',
    });
    expect(withToken.github_token_id).toBe('a3f');
  });

  it('RepoWithToken allows a null token id and label (the broken state)', () => {
    const r = RepoWithToken.parse({
      id: 'r1',
      workspace_id: 'ws',
      owner: 'acme',
      name: 'api',
      full_name: 'acme/api',
      default_branch: 'main',
      clone_path: null,
      last_polled_at: null,
      created_by: null,
      github_token_id: null,
      github_token_label: null,
    });
    expect(r.github_token_id).toBeNull();
  });
});
