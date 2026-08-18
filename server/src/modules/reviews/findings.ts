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

  switch (action) {
    case 'accept': {
      // The row can disappear between the findingContext lookup above and this
      // update; that is a 404, not a 500.
      const row = await repo.setFindingAccepted(findingId, new Date());
      if (!row) throw new NotFoundError('Finding not found');
      return { finding: findingRowToDto(row) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      if (!row) throw new NotFoundError('Finding not found');
      return { finding: findingRowToDto(row) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
