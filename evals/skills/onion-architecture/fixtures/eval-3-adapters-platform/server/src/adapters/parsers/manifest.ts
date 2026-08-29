/**
 * manifest adapter — reads a repo's package manifest (package.json,
 * pyproject.toml, go.mod) off disk and normalises it to a small summary used
 * by the "tech stack" panel.
 *
 * Robustness: a missing or unparseable manifest degrades to `null` rather
 * than throwing, matching the rest of the adapter layer.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_FILENAMES } from '../../modules/repo-intel/constants.js';

export interface ManifestSummary {
  name?: string;
  version?: string;
  dependencies: string[];
}

export interface ManifestReader {
  read(root: string): Promise<ManifestSummary | null>;
}

export class FsManifestReader implements ManifestReader {
  async read(root: string): Promise<ManifestSummary | null> {
    for (const filename of MANIFEST_FILENAMES) {
      try {
        const raw = await readFile(join(root, filename), 'utf8');
        const parsed = JSON.parse(raw);
        return {
          name: parsed.name,
          version: parsed.version,
          dependencies: Object.keys(parsed.dependencies ?? {}),
        };
      } catch {
        continue;
      }
    }
    return null;
  }
}
