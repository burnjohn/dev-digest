import type { Finding } from '@devdigest/shared';

/** A4 hook-detector rule tables (Secret-Leakage + Phantom-API). */

export interface SecretRule {
  id: string;
  label: string;
  re: RegExp;
}

export const SECRET_RULES: SecretRule[] = [
  { id: 'stripe_live', label: 'Stripe live secret key', re: /\bsk_live_[0-9a-zA-Z]{10,}\b/ },
  { id: 'stripe_test', label: 'Stripe test secret key', re: /\bsk_test_[0-9a-zA-Z]{10,}\b/ },
  { id: 'aws_akid', label: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github_pat', label: 'GitHub personal access token', re: /\bghp_[0-9a-zA-Z]{36}\b/ },
  { id: 'github_fine', label: 'GitHub fine-grained token', re: /\bgithub_pat_[0-9a-zA-Z_]{40,}\b/ },
  { id: 'openai', label: 'OpenAI API key', re: /\bsk-(?:proj-)?[0-9a-zA-Z]{20,}\b/ },
  { id: 'google', label: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { id: 'slack', label: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'private_key', label: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    id: 'generic_secret',
    label: 'Hardcoded secret assignment',
    re: /(?:secret|password|passwd|api[_-]?key|token|access[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  },
];

/** Lines that look like placeholders/examples — avoid false positives. */
export const SECRET_ALLOW = /(example|placeholder|your[_-]?key|xxx+|<[^>]+>|process\.env|getenv|\$\{)/i;

/** High-confidence provider-prefixed keys still flagged even inside allow-listed lines. */
export const SECRET_FORCE = /\b(sk_live_|AKIA|ghp_|-----BEGIN)/;

/** Heuristics for "phantom" API usage — fabricated calls or unfilled stubs. */
export const PHANTOM_RULES: { id: string; label: string; re: RegExp; severity: Finding['severity'] }[] = [
  {
    id: 'not_implemented',
    label: 'throws NotImplemented / TODO stub',
    re: /throw new (?:Error\(\s*['"](?:not implemented|todo|unimplemented)|NotImplementedError)/i,
    severity: 'WARNING',
  },
  {
    id: 'todo_call',
    label: 'call to a TODO/FIXME placeholder API',
    re: /\b(?:TODO|FIXME)\b.*\b\w+\s*\(/,
    severity: 'SUGGESTION',
  },
  {
    id: 'fictional_sdk',
    label: 'call to a non-existent SDK method',
    // e.g. octokit.rest.magic.doThing(...) / openai.chat.completions.dream(...)
    re: /\b(?:octokit\.rest\.\w+\.(?:magic|dream|teleport|autoFix)|openai\.[\w.]*\.(?:dream|imagine|hallucinate))\s*\(/,
    severity: 'WARNING',
  },
  {
    id: 'placeholder_url',
    label: 'placeholder API endpoint',
    re: /https?:\/\/(?:example\.(?:com|org)|api\.todo|placeholder)\/[\w/-]*/i,
    severity: 'SUGGESTION',
  },
];

/**
 * Imports of packages that look invented; restricted to clearly-marked fakes
 * (a full manifest check would be too noisy).
 */
export const PHANTOM_IMPORT = /\b(?:import .* from|require\()\s*['"](?:fake-|mock-only-|nonexistent-)[\w-]+['"]/;
