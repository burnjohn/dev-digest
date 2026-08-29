import { createHmac } from 'node:crypto';
import type { WebhookPayload } from './types.js';

export function signPayload(payload: WebhookPayload, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}
