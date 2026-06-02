import type { InstalledPlugin } from '@devdigest/shared';

/** The persisted installed-plugin row shape used to build the DTO. */
export interface InstalledPluginRow {
  id: string;
  name: string;
  version: string | null;
  source: string | null;
  installedAt: Date;
  enabled: boolean;
}

/** Map a persisted installed-plugin row to the public `InstalledPlugin` DTO. */
export function toInstalledDto(r: InstalledPluginRow): InstalledPlugin {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    source: r.source,
    installed_at: r.installedAt.toISOString(),
    enabled: r.enabled,
  };
}
