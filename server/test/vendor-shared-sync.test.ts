import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * `client/src/vendor/shared` is a hand-maintained COPY of the canonical
 * `server/src/vendor/shared` (no symlink, no sync script). The copies have
 * drifted before — including runtime-meaningful enum deltas — and a drifted
 * base silently forks every contract that `.extend()`s it, with both sides
 * typechecking clean (root INSIGHTS 2026-08-05). The copies are supposed to be
 * IDENTICAL, so this guard byte-compares the whole tree with no allow-list.
 *
 * When this fails: the server copy is canonical — mirror the change to
 * client/src/vendor/shared (or vice versa if the client edit was the mistake).
 */

const SERVER_SHARED = resolve(__dirname, '../src/vendor/shared');
const CLIENT_SHARED = resolve(__dirname, '../../client/src/vendor/shared');

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

describe('vendor/shared mirror', () => {
  it('client copy lists exactly the same files as the canonical server copy', () => {
    expect(listFiles(CLIENT_SHARED)).toEqual(listFiles(SERVER_SHARED));
  });

  it('every mirrored file is byte-identical to the canonical server copy', () => {
    const drifted = listFiles(SERVER_SHARED).filter((rel) => {
      try {
        return !readFileSync(join(SERVER_SHARED, rel)).equals(
          readFileSync(join(CLIENT_SHARED, rel)),
        );
      } catch {
        return true; // missing on the client side
      }
    });
    expect(drifted).toEqual([]);
  });
});
