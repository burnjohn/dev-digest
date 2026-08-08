import { readFile } from 'node:fs/promises';
import type OpenAI from 'openai';
import { githubClient } from '../../adapters/github/client.js';
import type { Container } from '../../platform/container.js';
import { reviewRepository } from './repository.js';

export interface RouteDependencies {
  container: Container;
  openai: OpenAI;
}

export const loadReviewRoute = [
  readFile,
  githubClient,
  reviewRepository,
];
