import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * A6 — plugins data-access. Reads agents/skills/eval-cases/conventions (owned by
 * A1/A2/A4) for EXPORT, and writes them back on IMPORT, plus owns the
 * `installed_plugins` table (A6). All workspace-scoped. It re-uses the canonical
 * tables rather than denormalising anything (no schema change — rule #2).
 */
export class PluginsRepository {
  constructor(private db: Db) {}

  // ---- export reads -------------------------------------------------------

  async agents(workspaceId: string): Promise<(typeof t.agents.$inferSelect)[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async agentById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  async skills(workspaceId: string): Promise<(typeof t.skills.$inferSelect)[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async evalCases(workspaceId: string): Promise<(typeof t.evalCases.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));
  }

  async conventions(workspaceId: string): Promise<(typeof t.conventions.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.workspaceId, workspaceId));
  }

  /** Skill ids linked to an agent, in `order` ascending. */
  async agentSkillIds(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, order: t.agentSkills.order })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(t.agentSkills.order);
    return rows.map((r) => r.skillId);
  }

  // ---- import writes ------------------------------------------------------

  async findSkillByName(workspaceId: string, name: string) {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row;
  }

  async insertSkill(values: typeof t.skills.$inferInsert): Promise<typeof t.skills.$inferSelect> {
    const [row] = await this.db.insert(t.skills).values(values).returning();
    return row!;
  }

  async findAgentByName(workspaceId: string, name: string) {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, name)));
    return row;
  }

  async insertAgent(values: typeof t.agents.$inferInsert): Promise<typeof t.agents.$inferSelect> {
    const [row] = await this.db.insert(t.agents).values(values).returning();
    return row!;
  }

  async linkAgentSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async insertEvalCase(values: typeof t.evalCases.$inferInsert): Promise<void> {
    await this.db.insert(t.evalCases).values(values);
  }

  async insertConvention(values: typeof t.conventions.$inferInsert): Promise<void> {
    await this.db.insert(t.conventions).values(values);
  }

  // ---- installed_plugins (A6-owned table) ---------------------------------

  async recordInstall(values: {
    workspaceId: string;
    name: string;
    version: string | null;
    source: string | null;
  }): Promise<typeof t.installedPlugins.$inferSelect> {
    const [row] = await this.db
      .insert(t.installedPlugins)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        version: values.version,
        source: values.source,
      })
      .returning();
    return row!;
  }

  async listInstalled(workspaceId: string): Promise<(typeof t.installedPlugins.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.installedPlugins)
      .where(eq(t.installedPlugins.workspaceId, workspaceId))
      .orderBy(desc(t.installedPlugins.installedAt));
  }
}
