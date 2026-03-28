import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAppManifest } from '../src/lib/app-manifest.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempRepo(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-app-manifest-'));
  tempDirs.push(dir);

  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const fullPath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }));

  return dir;
}

describe('app manifest', () => {
  it('loads workers manifest', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: sample-app
  appId: dev.takos.sample-app
spec:
  version: 1.0.0
  description: Sample app
  resources:
    main-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/main-db/up
        down: .takos/migrations/main-db/down
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
      bindings:
        d1: [main-db]
  routes:
    - name: gateway-root
      target: gateway
      path: /
  mcpServers:
    - name: gateway-mcp
      route: gateway-root
`,
    });

    const manifest = await loadAppManifest(path.join(repoDir, '.takos/app.yml'));

    expect(manifest.metadata.name).toBe('sample-app');
    expect(manifest.spec.workers.gateway).toBeDefined();
    expect(manifest.spec.workers.gateway.build.fromWorkflow).toEqual({
      path: '.takos/workflows/build.yml',
      job: 'build-gateway',
      artifact: 'gateway-dist',
      artifactPath: 'dist/gateway.mjs',
    });
    expect(manifest.spec.routes).toHaveLength(1);
    expect(manifest.spec.mcpServers).toHaveLength(1);
  });

  it('rejects workers without fromWorkflow build source', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-worker
spec:
  version: 1.0.0
  workers:
    gateway:
      build: {}
`,
    });

    await expect(loadAppManifest(path.join(repoDir, '.takos/app.yml'))).rejects.toThrow(/build(\.fromWorkflow)? is required/);
  });

  it('rejects missing workflow files during validation', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: missing-workflow
spec:
  version: 1.0.0
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`,
    });

    const { validateAppManifest } = await import('../src/lib/app-manifest.js');
    await expect(validateAppManifest(repoDir)).rejects.toThrow(/Workflow file not found/);
  });

  it('rejects missing workflow jobs during validation', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: missing-job
spec:
  version: 1.0.0
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`,
      '.takos/workflows/build.yml': `
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
`,
    });

    const { validateAppManifest } = await import('../src/lib/app-manifest.js');
    await expect(validateAppManifest(repoDir)).rejects.toThrow(/Workflow job not found/);
  });

  it('rejects deploy producer jobs that use needs', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: invalid-job
spec:
  version: 1.0.0
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`,
      '.takos/workflows/build.yml': `
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: echo setup
  build-gateway:
    runs-on: ubuntu-latest
    needs: [setup]
    steps:
      - run: echo build
`,
    });

    const { validateAppManifest } = await import('../src/lib/app-manifest.js');
    await expect(validateAppManifest(repoDir)).rejects.toThrow(/must not use needs/);
  });

  it('requires at least one worker', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: no-workers
spec:
  version: 1.0.0
`,
    });

    await expect(loadAppManifest(path.join(repoDir, '.takos/app.yml'))).rejects.toThrow(/spec.workers must contain at least one worker/);
  });
});
