import { and, eq } from 'drizzle-orm';
import {
  FEATURE_MODELS,
  FeatureModelChoice,
  type FeatureModelId,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';

/**
 * Per-feature model configuration.
 *
 * System LLM features (onboarding, intent, risk brief, conformance, conventions)
 * read their provider/model from the workspace's Settings instead of a hardcoded
 * module constant. When the workspace hasn't chosen one, we fall back to the
 * registry default in `FEATURE_MODELS` — which mirrors each module's old
 * constant, so behaviour is unchanged until a model is explicitly picked.
 *
 * Lives in `_shared/` rather than `modules/settings/` because more than one
 * feature module resolves its own model this way (conventions does), and a module
 * may not import another module. It reads the `settings` table directly — the
 * same sanctioned pattern as `skills/repository.ts` reading `agent_skills`: the
 * ban is on importing another MODULE, not on reading its table. It selects only
 * the `feature_models` row instead of collapsing every setting through
 * `settings/helpers.ts`, which is what previously made this file cross-module.
 */

const DEFAULTS = Object.fromEntries(
  FEATURE_MODELS.map((f) => [f.id, { provider: f.defaultProvider, model: f.defaultModel }]),
) as Record<FeatureModelId, FeatureModelChoice>;

/** The `settings` key the per-feature overrides live under (see `SettingsKnown`). */
const FEATURE_MODELS_KEY = 'feature_models';

/** The registry default (provider+model) for a feature — no DB read. */
export function defaultFeatureModel(id: FeatureModelId): FeatureModelChoice {
  return DEFAULTS[id];
}

/**
 * The workspace's override for `id`, or `undefined` when unset/invalid. Callers
 * that keep their own dynamic default (e.g. conventions) use this directly so
 * that default is preserved; callers with a static default use
 * `resolveFeatureModel` instead.
 *
 * `settings` is unique on `(workspace_id, user_id, key)`, so a multi-user
 * workspace can hold more than one row for this key. Last row wins — the same
 * resolution the flat `rowsToSettings` collapse gave.
 */
export async function getFeatureModelOverride(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice | undefined> {
  const rows = await container.db
    .select({ value: t.settings.value })
    .from(t.settings)
    .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, FEATURE_MODELS_KEY)));
  const last = rows.at(-1)?.value as Record<string, unknown> | undefined;
  const parsed = FeatureModelChoice.safeParse(last?.[id]);
  return parsed.success ? parsed.data : undefined;
}

/** Resolve `id` to a concrete provider+model: workspace override, else registry default. */
export async function resolveFeatureModel(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  return (await getFeatureModelOverride(container, workspaceId, id)) ?? DEFAULTS[id];
}
