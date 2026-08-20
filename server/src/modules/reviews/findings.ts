import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions available in the starter: accept / dismiss. These decisions
 * are the dataset later lessons build on (eval cases from accept/dismiss, the
 * `learn → memory` action, etc.).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  // The UPDATEs below carry the workspace predicate themselves, so the lookup
  // above is UX (a clean 404), not the security boundary. A zero-row update
  // means the finding vanished or moved out of scope between the two calls.
  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(workspaceId, findingId, new Date());
      if (!row) throw new NotFoundError('Finding not found');
      return { finding: findingRowToDto(row) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(workspaceId, findingId, new Date());
      if (!row) throw new NotFoundError('Finding not found');
      return { finding: findingRowToDto(row) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
