# Backend API Conventions

Apply when the diff touches server/ files.

## Routes
- Every handler that needs workspace context MUST call getContext().
- Route handlers must not contain business logic - delegate to the service.
- Business errors must be thrown as AppError, never plain Error.

## Repository
- Every query MUST filter by workspace_id - no exceptions.
- Never return raw DB rows - map to DTO in the service layer.

## Secrets
- Never read from process.env directly - use SecretsProvider.

## Report
Flag each violation with file:line and the exact rule broken.