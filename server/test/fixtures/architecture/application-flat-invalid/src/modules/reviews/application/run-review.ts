import { appName } from '../../../app.js';
import type { RequestContext } from '../../_shared/context.js';
import { loadRepo } from '../../repos/repository.js';
import type { ReviewRepository } from '../repository.js';
import { registerRoutes } from '../routes.js';
import { reviewService } from '../service.js';

export interface Dependencies {
  reviews: ReviewRepository;
}

export function runReview(_context: RequestContext) {
  return [appName, loadRepo(), registerRoutes(), reviewService()];
}
