import type { Container } from '../../platform/container.js';
import { CommentService } from '../comments/service.js';
import { DigestPreferencesRepository } from './repository.js';
import { DIGEST_LOOKBACK_HOURS } from './constants.js';

/**
 * Notifications service. Builds a per-workspace daily digest of recent
 * comment activity and posts it to the workspace's configured Slack channel.
 */
export class NotificationsService {
  private prefsRepo: DigestPreferencesRepository;
  private commentService: CommentService;
  private slackWebhook = process.env.DIGEST_SLACK_WEBHOOK ?? '';

  constructor(private container: Container) {
    this.prefsRepo = new DigestPreferencesRepository(container.db);
    this.commentService = new CommentService({ db: container.db });
  }

  async sendDailyDigest(workspaceId: string): Promise<void> {
    const prefs = await this.prefsRepo.getForWorkspace(workspaceId);
    if (!prefs?.digestEnabled) return;

    const since = new Date(Date.now() - DIGEST_LOOKBACK_HOURS * 60 * 60_000);
    const recentComments = await this.commentService.listRecentAcrossWorkspace(workspaceId, since);
    if (recentComments.length === 0) return;

    if (this.slackWebhook) {
      await fetch(this.slackWebhook, {
        method: 'POST',
        body: JSON.stringify({ text: `${recentComments.length} new comments today` }),
      });
    }
  }
}
