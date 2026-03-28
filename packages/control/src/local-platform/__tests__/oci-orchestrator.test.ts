import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalOciOrchestratorFetchForTests } from '../oci-orchestrator.ts';

describe('oci orchestrator local service', () => {
  const originalEnv = {
    OCI_ORCHESTRATOR_DATA_DIR: process.env.OCI_ORCHESTRATOR_DATA_DIR,
    TAKOS_LOCAL_DATA_DIR: process.env.TAKOS_LOCAL_DATA_DIR,
  };
  let tempDir: string | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-oci-orchestrator-'));
    process.env.OCI_ORCHESTRATOR_DATA_DIR = tempDir;
    delete process.env.TAKOS_LOCAL_DATA_DIR;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('stores deployments and exposes service records and logs', async () => {
    const fetch = await createLocalOciOrchestratorFetchForTests();

    const deployResponse = await fetch(new Request('http://oci-orchestrator/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_id: 'dep-oci-1',
        space_id: 'space-1',
        artifact_ref: 'worker-v1',
        target: {
          route_ref: 'worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
          artifact: {
            image_ref: 'ghcr.io/takos/worker:latest',
            exposed_port: 8080,
          },
        },
        runtime: {
          compatibility_date: '2026-03-22',
          compatibility_flags: ['nodejs_compat'],
          limits: { cpu_ms: 50 },
        },
      }),
    }));

    expect(deployResponse.status).toBe(200);
    const deployBody = await deployResponse.json();
    expect(deployBody).toEqual(expect.objectContaining({
      ok: true,
      service: expect.objectContaining({
        space_id: 'space-1',
        route_ref: 'worker',
        deployment_id: 'dep-oci-1',
        image_ref: 'ghcr.io/takos/worker:latest',
        status: 'deployed',
      }),
    }));

    const serviceResponse = await fetch(new Request('http://oci-orchestrator/services/worker?space_id=space-1'));
    expect(serviceResponse.status).toBe(200);
    await expect(serviceResponse.json()).resolves.toEqual(expect.objectContaining({
      service: expect.objectContaining({
        deployment_id: 'dep-oci-1',
        image_ref: 'ghcr.io/takos/worker:latest',
      }),
    }));

    const logsResponse = await fetch(new Request('http://oci-orchestrator/services/worker/logs?space_id=space-1&tail=20'));
    expect(logsResponse.status).toBe(200);
    const logsText = await logsResponse.text();
    expect(logsText).toContain('DEPLOY');
    expect(logsText).toContain('dep-oci-1');

    const removeResponse = await fetch(new Request('http://oci-orchestrator/services/worker/remove?space_id=space-1', {
      method: 'POST',
    }));
    expect(removeResponse.status).toBe(200);
    await expect(removeResponse.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      service: expect.objectContaining({
        status: 'removed',
      }),
    }));

    const missingResponse = await fetch(new Request('http://oci-orchestrator/services/worker?space_id=space-1'));
    expect(missingResponse.status).toBe(200);
    await expect(missingResponse.json()).resolves.toEqual(expect.objectContaining({
      service: expect.objectContaining({
        status: 'removed',
      }),
    }));
  });
});
