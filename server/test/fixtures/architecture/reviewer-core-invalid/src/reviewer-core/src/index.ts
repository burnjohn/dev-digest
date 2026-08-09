import type { ReviewRecord } from '@devdigest/shared';
import type OpenAI from 'openai';

export interface ReviewerDependencies {
  openai: OpenAI;
  review: ReviewRecord;
}
