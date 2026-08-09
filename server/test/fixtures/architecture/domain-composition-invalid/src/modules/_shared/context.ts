import type { FastifyRequest } from 'fastify';
import type { Container } from '../../platform/container.js';

export interface RequestContext {
  request: FastifyRequest;
  container: Container;
}
