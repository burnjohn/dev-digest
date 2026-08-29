import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions available in the starter: accept / dismiss / revert. These
 * decisions are the dataset later lessons build on (eval cases from
 * accept/dismiss, the `learn → memory` action, etc.).
 *
 * `revert` clears both timestamps and puts the finding back to undecided. The
 * client never sends accept on an already-dismissed finding (or vice versa) —
 * it disables the opposite control until the decision is reverted — but this
 * function stays permissive about that ordering on purpose: it is the audit
 * trail's writer, not its policy, and both setters already clear their sibling.
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
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'revert': {
      const row = await repo.clearFindingDecision(findingId);
      return { finding: findingRowToDto(row!) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
