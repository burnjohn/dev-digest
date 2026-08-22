import { describe, expect, it } from 'vitest';
import { classifyFile } from './classifier.js';

describe('classifyFile — boilerplate', () => {
  it('package-lock.json → boilerplate', () => {
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
  });

  it('pnpm-lock.yaml → boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
  });

  it('yarn.lock → boilerplate', () => {
    expect(classifyFile('yarn.lock')).toBe('boilerplate');
  });

  it('bun.lockb → boilerplate', () => {
    expect(classifyFile('bun.lockb')).toBe('boilerplate');
  });

  it('dist/bundle.js → boilerplate (dist/ segment)', () => {
    expect(classifyFile('dist/bundle.js')).toBe('boilerplate');
  });

  it('build/output.js → boilerplate (build/ segment)', () => {
    expect(classifyFile('build/output.js')).toBe('boilerplate');
  });

  it('.next/cache/file.js → boilerplate (.next/ segment)', () => {
    expect(classifyFile('.next/cache/file.js')).toBe('boilerplate');
  });

  it('src/generated/client.ts → boilerplate (generated/ segment)', () => {
    expect(classifyFile('src/generated/client.ts')).toBe('boilerplate');
  });

  it('src/__snapshots__/component.snap → boilerplate (__snapshots__/ segment)', () => {
    expect(classifyFile('src/__snapshots__/component.snap')).toBe('boilerplate');
  });

  it('src/lib/vendor.min.js → boilerplate (.min.js suffix)', () => {
    expect(classifyFile('src/lib/vendor.min.js')).toBe('boilerplate');
  });

  it('src/types/api.d.ts → boilerplate (.d.ts suffix)', () => {
    expect(classifyFile('src/types/api.d.ts')).toBe('boilerplate');
  });

  it('coverage/lcov.info → boilerplate (coverage/ segment)', () => {
    expect(classifyFile('coverage/lcov.info')).toBe('boilerplate');
  });
});

describe('classifyFile — wiring', () => {
  it('src/index.ts → wiring', () => {
    expect(classifyFile('src/index.ts')).toBe('wiring');
  });

  it('src/modules/auth/routes.ts → wiring', () => {
    expect(classifyFile('src/modules/auth/routes.ts')).toBe('wiring');
  });

  it('src/app/module.ts → wiring', () => {
    expect(classifyFile('src/app/module.ts')).toBe('wiring');
  });

  it('src/config.ts → wiring', () => {
    expect(classifyFile('src/config.ts')).toBe('wiring');
  });

  it('server/src/db/migrations/0001_init.sql → wiring (migrations/ segment)', () => {
    expect(classifyFile('server/src/db/migrations/0001_init.sql')).toBe('wiring');
  });

  it('schema.ts → wiring', () => {
    expect(classifyFile('src/db/schema.ts')).toBe('wiring');
  });

  it('.env.example → wiring (.env prefix)', () => {
    expect(classifyFile('.env.example')).toBe('wiring');
  });

  it('docker-compose.yml → wiring (docker-compose prefix + .yml suffix)', () => {
    expect(classifyFile('docker-compose.yml')).toBe('wiring');
  });

  it('Dockerfile → wiring', () => {
    expect(classifyFile('Dockerfile')).toBe('wiring');
  });

  it('src/setup.ts → wiring', () => {
    expect(classifyFile('src/setup.ts')).toBe('wiring');
  });

  it('tsconfig.json → wiring (.json suffix)', () => {
    expect(classifyFile('tsconfig.json')).toBe('wiring');
  });

  it('.github/workflows/ci.yml → wiring (.github/ prefix)', () => {
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
  });
});

describe('classifyFile — core', () => {
  it('src/services/payment.service.ts → core', () => {
    expect(classifyFile('src/services/payment.service.ts')).toBe('core');
  });

  it('src/modules/reviews/service.ts → core', () => {
    expect(classifyFile('src/modules/reviews/service.ts')).toBe('core');
  });

  it('src/modules/auth/middleware.ts → core', () => {
    expect(classifyFile('src/modules/auth/middleware.ts')).toBe('core');
  });

  it('src/lib/utils/string.ts → core', () => {
    expect(classifyFile('src/lib/utils/string.ts')).toBe('core');
  });

  it('src/components/Button.tsx → core', () => {
    expect(classifyFile('src/components/Button.tsx')).toBe('core');
  });

  it('src/hooks/useAuth.ts → core', () => {
    expect(classifyFile('src/hooks/useAuth.ts')).toBe('core');
  });

  it('src/modules/classifier.ts (contains classifier in name) → core', () => {
    expect(classifyFile('src/modules/smart-diff/classifier.ts')).toBe('core');
  });
});
