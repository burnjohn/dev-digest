import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/reviews/smart-diff-rules.js';

describe('classifyFile', () => {
  describe('lock files → boilerplate', () => {
    it('classifies package-lock.json as boilerplate', () => {
      expect(classifyFile('package-lock.json')).toBe('boilerplate');
    });

    it('classifies pnpm-lock.yaml as boilerplate', () => {
      expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    });

    it('classifies yarn.lock as boilerplate', () => {
      expect(classifyFile('yarn.lock')).toBe('boilerplate');
    });

    it('classifies lock file nested in a path as boilerplate (basename match)', () => {
      expect(classifyFile('packages/api/package-lock.json')).toBe('boilerplate');
    });
  });

  describe('boilerplate extensions → boilerplate', () => {
    it('classifies .snap files as boilerplate', () => {
      expect(classifyFile('snapshot.snap')).toBe('boilerplate');
    });

    it('classifies minified JS as boilerplate', () => {
      expect(classifyFile('dist/app.min.js')).toBe('boilerplate');
    });

    it('classifies source map files as boilerplate', () => {
      expect(classifyFile('dist/app.js.map')).toBe('boilerplate');
    });
  });

  describe('path pattern → boilerplate', () => {
    it('classifies root-level dist/bundle.js as boilerplate', () => {
      expect(classifyFile('dist/bundle.js')).toBe('boilerplate');
    });

    it('classifies files under a nested /dist/ segment as boilerplate', () => {
      expect(classifyFile('src/dist/bundle.js')).toBe('boilerplate');
    });

    it('classifies files under /generated/ as boilerplate', () => {
      expect(classifyFile('src/generated/types.ts')).toBe('boilerplate');
    });

    it('classifies files under a /node_modules/ segment as boilerplate', () => {
      // The regex is /\/node_modules\//, so the path must contain /node_modules/
      expect(classifyFile('packages/api/node_modules/lodash/index.js')).toBe('boilerplate');
    });
  });

  describe('core path patterns → core', () => {
    // directory-based patterns
    it('classifies files in /services/ as core', () => {
      expect(classifyFile('src/services/payments.ts')).toBe('core');
    });

    it('classifies files in /service/ (singular) as core', () => {
      expect(classifyFile('src/service/users.ts')).toBe('core');
    });

    it('classifies files in /repositories/ as core', () => {
      expect(classifyFile('src/repositories/repo.ts')).toBe('core');
    });

    it('classifies files in /repository/ (singular) as core', () => {
      expect(classifyFile('src/modules/reviews/repository/pull.repo.ts')).toBe('core');
    });

    it('classifies files in /domain/ as core', () => {
      expect(classifyFile('src/domain/order.ts')).toBe('core');
    });

    it('classifies files in /middleware/ as core', () => {
      expect(classifyFile('src/middleware/auth.ts')).toBe('core');
    });

    it('classifies files in /models/ as core', () => {
      expect(classifyFile('src/models/user.ts')).toBe('core');
    });

    it('classifies files in /entities/ as core', () => {
      expect(classifyFile('src/entities/order.ts')).toBe('core');
    });

    // file-based patterns (module-per-feature style)
    it('classifies a file named service.ts as core', () => {
      expect(classifyFile('server/src/modules/reviews/service.ts')).toBe('core');
    });

    it('classifies a NestJS-style .service.ts file as core', () => {
      expect(classifyFile('src/users/users.service.ts')).toBe('core');
    });

    it('classifies a file named repository.ts as core', () => {
      expect(classifyFile('server/src/modules/reviews/repository.ts')).toBe('core');
    });
  });

  describe('wiring fallback → wiring', () => {
    it('classifies route files as wiring', () => {
      expect(classifyFile('src/routes/index.ts')).toBe('wiring');
    });

    it('classifies root index file as wiring', () => {
      expect(classifyFile('src/index.ts')).toBe('wiring');
    });

    it('classifies a plain config file as wiring (no core/boilerplate pattern)', () => {
      expect(classifyFile('src/config.ts')).toBe('wiring');
    });
  });

  describe('group ordering for mixed file list', () => {
    it('groups files in core → wiring → boilerplate order', () => {
      // Use src/dist/bundle.js so the /\/dist\// regex actually matches
      const paths = [
        'pnpm-lock.yaml',
        'src/services/auth.ts',
        'src/routes/index.ts',
        'src/dist/bundle.js',
      ];

      const classified = paths.map((p) => ({ path: p, role: classifyFile(p) }));

      // Group by role preserving role identity
      const roleOrder: ('core' | 'wiring' | 'boilerplate')[] = ['core', 'wiring', 'boilerplate'];
      const groups = roleOrder
        .map((role) => ({ role, files: classified.filter((f) => f.role === role) }))
        .filter((g) => g.files.length > 0);

      expect(groups[0]!.role).toBe('core');
      expect(groups[1]!.role).toBe('wiring');
      expect(groups[2]!.role).toBe('boilerplate');

      // Sanity: specific files land in the right bucket
      expect(groups[0]!.files.map((f) => f.path)).toContain('src/services/auth.ts');
      expect(groups[1]!.files.map((f) => f.path)).toContain('src/routes/index.ts');
      expect(groups[2]!.files.map((f) => f.path)).toEqual(
        expect.arrayContaining(['pnpm-lock.yaml', 'src/dist/bundle.js']),
      );
    });
  });
});
