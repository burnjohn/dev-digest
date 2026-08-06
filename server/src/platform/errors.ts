/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}

/**
 * No usable GitHub token for this repo — covers BOTH `github_token_id: null`
 * (nothing assigned) AND a repo assigned to a token whose stored value is
 * absent/tombstoned (deleted, or never given a PAT — e.g. the seeded `demo`
 * token). The default message must stay true in both states: it must not say
 * "no token is assigned" when one plainly is, just unusable. 422, not
 * ConfigError's 500: this is user-fixable state, and the client renders an
 * "assign a token" CTA off the code.
 */
export class MissingTokenError extends AppError {
  constructor(
    message = 'No usable GitHub token for this repository — assign or replace one in repo settings',
    details?: unknown,
  ) {
    super('token_missing', message, 422, details);
  }
}
