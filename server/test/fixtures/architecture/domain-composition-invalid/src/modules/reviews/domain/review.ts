import { appName } from '../../../app.js';
import type { RequestContext } from '../../_shared/context.js';
import { reviewService } from '../service.js';

export function describeReview(_context: RequestContext) {
  return `${appName}:${reviewService()}`;
}
