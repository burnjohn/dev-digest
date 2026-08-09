import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ReviewRecord } from '@devdigest/shared';
import { reviewService } from './service.js';

export function registerReviewRoutes(
  _app: FastifyInstance,
): ReviewRecord | undefined {
  z.string().parse(reviewService());
  return undefined;
}
