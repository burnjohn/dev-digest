import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';

/**
 * Load an agent from the `.devdigest/` layout the studio exports: the manifest
 * YAML (validated against the SHARED AgentManifest schema, so studio↔runner can
 * never drift) plus its skill bodies resolved from `<skillsDir>/<slug>.md`.
 * Skill-slug resolution is the runner's I/O job; the engine takes resolved bodies.
 */
export interface LoadedAgent {
  manifest: AgentManifest;
  skillBodies: string[];
  missingSkills: string[];
}

export async function loadAgent(agentYamlPath: string, skillsDir: string): Promise<LoadedAgent> {
  const raw = await readFile(agentYamlPath, 'utf8');
  const manifest = AgentManifest.parse(parseYaml(raw));

  const skillBodies: string[] = [];
  const missingSkills: string[] = [];
  for (const slug of manifest.skills) {
    try {
      const body = await readFile(join(skillsDir, `${slug}.md`), 'utf8');
      skillBodies.push(`### ${slug}\n${body.trim()}`);
    } catch {
      missingSkills.push(slug); // surfaced by the caller — never silently dropped
    }
  }
  return { manifest, skillBodies, missingSkills };
}
