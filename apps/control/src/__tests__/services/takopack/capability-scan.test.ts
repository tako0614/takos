import { describe, expect, it } from 'vitest';
import { inferRequiredCapabilitiesFromManifest } from '@/services/takopack/capability-scan';
import type { TakopackManifest } from '@/services/takopack/types';

function createBaseManifest(): TakopackManifest {
  return {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: 'sample-pack',
      appId: 'dev.takos.sample-pack',
      version: '1.0.0',
      createdAt: '2026-03-01T00:00:00.000Z',
    },
    objects: [],
  };
}

describe('inferRequiredCapabilitiesFromManifest', () => {
  it('does not infer egress.http for cloudflare-only endpoint', () => {
    const manifest = createBaseManifest();
    manifest.endpoints = [
      {
        name: 'worker-http',
        protocol: 'http',
        targetRef: 'api-worker',
        targetRuntime: 'cloudflare.worker',
        ingressRef: 'api-worker',
        ingressWorker: 'api-worker',
        routes: [],
      },
    ];

    const required = inferRequiredCapabilitiesFromManifest(manifest);
    expect(required).not.toContain('egress.http');
  });

  it('still infers storage.write when resources are provisioned or bound', () => {
    const manifest = createBaseManifest();
    manifest.resources = {
      d1: [{ binding: 'DB' }],
    };
    manifest.workers = [{
      name: 'api',
      bundle: 'dist/api.mjs',
      bundleHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bundleSize: 10,
      bindings: { d1: ['DB'], r2: [], kv: [] },
      env: {},
    }];

    const required = inferRequiredCapabilitiesFromManifest(manifest);
    expect(required).toContain('storage.write');
    expect(required).not.toContain('egress.http');
  });
});
