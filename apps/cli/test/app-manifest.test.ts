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
  it('loads multi-service manifest', async () => {
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
  services:
    gateway:
      type: worker
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
      bindings:
        d1: [main-db]
    payments:
      type: http
      baseUrl: https://payments.internal.example
  routes:
    - name: gateway-root
      service: gateway
      path: /
    - name: payments-api
      service: payments
      path: /payments
      ingress: gateway
  mcpServers:
    - name: payments
      route: payments-api
`,
    });

    const manifest = await loadAppManifest(path.join(repoDir, '.takos/app.yml'));

    expect(manifest.metadata.name).toBe('sample-app');
    expect(manifest.spec.services.gateway.type).toBe('worker');
    const gatewayService = manifest.spec.services.gateway;
    if (gatewayService.type === 'worker') {
      expect(gatewayService.build.fromWorkflow).toEqual({
        path: '.takos/workflows/build.yml',
        job: 'build-gateway',
        artifact: 'gateway-dist',
        artifactPath: 'dist/gateway.mjs',
      });
    }
    expect(manifest.spec.services.payments.type).toBe('http');
    expect(manifest.spec.routes).toHaveLength(2);
    expect(manifest.spec.mcpServers).toHaveLength(1);
  });

  it('rejects http routes without ingress', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-app
spec:
  version: 1.0.0
  services:
    api:
      type: http
      baseUrl: https://api.example.com
  routes:
    - service: api
      path: /api
`,
    });

    await expect(loadAppManifest(path.join(repoDir, '.takos/app.yml'))).rejects.toThrow(/ingress is required/);
  });

  it('rejects worker services without fromWorkflow build source', async () => {
    const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-worker
spec:
  version: 1.0.0
  services:
    gateway:
      type: worker
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
  services:
    gateway:
      type: worker
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
  services:
    gateway:
      type: worker
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
  services:
    gateway:
      type: worker
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
});
