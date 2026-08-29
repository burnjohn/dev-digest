import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Webhooks data-access layer. The ONLY place that touches the
 * `webhook_subscriptions` table.
 */

export type WebhookSubscriptionRow = typeof t.webhookSubscriptions.$inferSelect;

export class WebhookRepository {
  constructor(private db: Db) {}

  async listActive(workspaceId: string): Promise<WebhookSubscriptionRow[]> {
    return this.db
      .select()
      .from(t.webhookSubscriptions)
      .where(and(eq(t.webhookSubscriptions.workspaceId, workspaceId), eq(t.webhookSubscriptions.active, true)));
  }

  async recordDelivery(subscriptionId: string, status: 'ok' | 'failed'): Promise<void> {
    await this.db
      .update(t.webhookSubscriptions)
      .set({ lastDeliveryStatus: status, lastDeliveredAt: new Date() })
      .where(eq(t.webhookSubscriptions.id, subscriptionId));
  }
}
