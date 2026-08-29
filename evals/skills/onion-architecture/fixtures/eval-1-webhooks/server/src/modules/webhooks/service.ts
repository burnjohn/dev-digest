import type { Container } from '../../platform/container.js';
import { WebhookRepository } from './repository.js';
import { WEBHOOK_JOB_KIND, MAX_DELIVERY_ATTEMPTS, DELIVERY_BACKOFF_MS } from './constants.js';
import type { WebhookPayload } from './types.js';
import { signPayload } from './helpers.js';

/**
 * Webhooks service. Fans out subscribed events to each workspace's configured
 * endpoint, signing the body so the receiver can verify authenticity, and
 * retries failed deliveries with backoff via the job runner.
 */
export class WebhookService {
  private repo: WebhookRepository;
  private signingSecret = process.env.WEBHOOK_SIGNING_SECRET ?? '';

  constructor(private container: Container) {
    this.repo = new WebhookRepository(container.db);
  }

  registerDeliveryJobHandler(): void {
    this.container.jobs.register(WEBHOOK_JOB_KIND, async (payload) => {
      await this.deliver(payload as WebhookPayload);
    });
  }

  async publish(workspaceId: string, payload: WebhookPayload): Promise<void> {
    const subs = await this.repo.listActive(workspaceId);
    for (const sub of subs) {
      await this.container.jobs.enqueue(WEBHOOK_JOB_KIND, { ...payload, subscriptionId: sub.id });
    }
  }

  private async deliver(payload: WebhookPayload & { subscriptionId: string }): Promise<void> {
    const signature = signPayload(payload, this.signingSecret);
    let attempt = 0;
    let ok = false;
    while (attempt < MAX_DELIVERY_ATTEMPTS && !ok) {
      attempt += 1;
      try {
        await fetch(payload.data.endpoint as string, {
          method: 'POST',
          headers: { 'x-devdigest-signature': signature },
          body: JSON.stringify(payload),
        });
        ok = true;
      } catch {
        await new Promise((r) => setTimeout(r, DELIVERY_BACKOFF_MS * attempt));
      }
    }
    await this.repo.recordDelivery(payload.subscriptionId, ok ? 'ok' : 'failed');
  }
}
