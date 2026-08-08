import type OpenAI from 'openai';
import { githubClient } from '../../adapters/github/client.js';
import type { Container } from '../../platform/container.js';
import { reviewRepository } from './repository.js';

export interface ServiceDependencies {
  container: Container;
  openai: OpenAI;
}

export const reviewService = [githubClient, reviewRepository];
