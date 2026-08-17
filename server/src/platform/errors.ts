/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

/**
 * Strip credentials out of any URL userinfo in a message before it is persisted
 * or logged.
 *
 * Why this exists: private clones authenticate by embedding the GitHub PAT in the
 * remote URL (`https://x-access-token:<PAT>@github.com/...`, see
 * modules/repos/helpers.ts). git echoes the remote verbatim in its failure text
 * ("repository '...' not found"), so the plain "wrong repo / revoked token" path
 * would otherwise write a live credential into the `jobs.error` column and stderr.
 */
export function redactCredentials(message: string): string {
  return message.replace(/\/\/[^@/\s]+@/g, '//***@');
}

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

/**
 * The request is well-formed but the resource is not in a state that allows it —
 * e.g. extracting conventions from a repo that has not been indexed yet. Distinct
 * from 422 (the input is wrong) and 404 (the resource is absent): the caller's fix
 * is to do something else first, not to change the payload.
 */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('conflict', message, 409, details);
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
