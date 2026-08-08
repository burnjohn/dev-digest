import type { Review } from '../domain/review.js';
import type { PullContract } from '../../pulls/index.js';

export function completeReview(review: Review, _pull?: PullContract): Review {
  return review;
}
