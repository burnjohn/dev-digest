export interface WebhookPayload {
  event: string;
  workspaceId: string;
  data: Record<string, unknown>;
}
