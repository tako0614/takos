import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultOciOrchestratorBackendResolver,
  createLocalOciOrchestratorFetchForTests,
} from '../oci-orchestrator.ts';
import type { ContainerBackend, ContainerCreateOpts, ContainerCreateResult } from '../container-backend.ts';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

function createFakeContainerBackend(): ContainerBackend {
  type FakeContainerState = {
    port: number;
  };
  let nextId = 0;
  const states = new Map<string, FakeContainerState>();

  return {
    async pullImage(): Promise<void> {
      return Promise.resolve();
    },
    async createAndStart(opts: ContainerCreateOpts): Promise<ContainerCreateResult> {
      const containerId = `mock-container-${nextId++}`;
      const port = opts.exposedPort > 0 ? opts.exposedPort : 8080;
      states.set(containerId, { port });
      return { containerId, hostPort: port };
    },
    async stop(containerId: string): Promise<void> {
      states.delete(containerId);
    },
    async remove(containerId: string): Promise<void> {
      states.delete(containerId);
    },
    async getLogs(containerId: string): Promise<string> {
      const state = states.get(containerId);
      if (!state) return '';
      return `container ${containerId} listening on ${state.port}\n`;
    },
    async getContainerIp(): Promise<string | null> {
      return '127.0.0.1';
    },
  };
}

function createObservedContainerBackend(label: string, events: string[]): ContainerBackend {
  let nextId = 0;
  const states = new Set<string>();

  return {
    async pullImage(imageRef): Promise<void> {
      events.push(`${label}:pull:${imageRef}`);
    },
    async createAndStart(opts: ContainerCreateOpts): Promise<ContainerCreateResult> {
      const containerId = `${label}-${nextId++}`;
      states.add(containerId);
      events.push(`${label}:create:${opts.name}`);
      return { containerId, hostPort: opts.exposedPort };
    },
    async stop(containerId: string): Promise<void> {
      events.push(`${label}:stop:${containerId}`);
      states.delete(containerId);
    },
    async remove(containerId: string): Promise<void> {
      events.push(`${label}:remove:${containerId}`);
      states.delete(containerId);
    },
    async getLogs(containerId: string): Promise<string> {
      events.push(`${label}:logs:${containerId}`);
      return states.has(containerId) ? `${label}:${containerId}\n` : '';
    },
    async getContainerIp(containerId: string): Promise<string | null> {
      events.push(`${label}:ip:${containerId}`);
      return label === 'k8s' ? '10.0.0.8' : '127.0.0.1';
    },
  };
}


  const originalEnv = {
    OCI_ORCHESTRATOR_DATA_DIR: Deno.env.get('OCI_ORCHESTRATOR_DATA_DIR'),
    TAKOS_LOCAL_DATA_DIR: Deno.env.get('TAKOS_LOCAL_DATA_DIR'),
    TAKOS_SKIP_OCI_HEALTH_CHECK: Deno.env.get('TAKOS_SKIP_OCI_HEALTH_CHECK'),
  };
  let tempDir: string | null = null;
  Deno.test('oci orchestrator local service - stores deployments and exposes service records and logs', async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-oci-orchestrator-'));
    Deno.env.set('OCI_ORCHESTRATOR_DATA_DIR', tempDir);
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    Deno.env.set('TAKOS_SKIP_OCI_HEALTH_CHECK', '1');
  try {
  const fetch = await createLocalOciOrchestratorFetchForTests({
      backend: createFakeContainerBackend(),
    });

    const deployResponse = await fetch(new Request('http://oci-orchestrator/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_id: 'dep-oci-1',
        space_id: 'space-1',
        artifact_ref: 'worker-v1',
        provider: {
          name: 'k8s',
          config: {
            namespace: 'takos',
            deploymentName: 'worker',
          },
        },
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

    const deployBodyText = await deployResponse.text();
    assertEquals(deployResponse.status, 200);
    const deployBody = JSON.parse(deployBodyText);
    assertEquals(deployBody, ({
      ok: true,
      service: ({
        space_id: 'space-1',
        route_ref: 'worker',
        deployment_id: 'dep-oci-1',
        provider_name: 'k8s',
        provider_config: {
          namespace: 'takos',
          deploymentName: 'worker',
        },
        image_ref: 'ghcr.io/takos/worker:latest',
        status: 'deployed',
      }),
    }));

    const serviceResponse = await fetch(new Request('http://oci-orchestrator/services/worker?space_id=space-1'));
    assertEquals(serviceResponse.status, 200);
    await assertEquals(await serviceResponse.json(), ({
      service: ({
        deployment_id: 'dep-oci-1',
        provider_name: 'k8s',
        image_ref: 'ghcr.io/takos/worker:latest',
      }),
    }));

    const logsResponse = await fetch(new Request('http://oci-orchestrator/services/worker/logs?space_id=space-1&tail=20'));
    assertEquals(logsResponse.status, 200);
    const logsText = await logsResponse.text();
    assertStringIncludes(logsText, 'DEPLOY');
    assertStringIncludes(logsText, 'dep-oci-1');

    const removeResponse = await fetch(new Request('http://oci-orchestrator/services/worker/remove?space_id=space-1', {
      method: 'POST',
    }));
    assertEquals(removeResponse.status, 200);
    await assertEquals(await removeResponse.json(), ({
      ok: true,
      service: ({
        status: 'removed',
      }),
    }));

    const missingResponse = await fetch(new Request('http://oci-orchestrator/services/worker?space_id=space-1'));
    assertEquals(missingResponse.status, 200);
    await assertEquals(await missingResponse.json(), ({
      service: ({
        status: 'removed',
      }),
    }));
  } finally {
  for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  }
})
  Deno.test('oci orchestrator local service - resolves provider-native backends from provider config', () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-oci-orchestrator-'));
    Deno.env.set('OCI_ORCHESTRATOR_DATA_DIR', tempDir);
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    Deno.env.set('TAKOS_SKIP_OCI_HEALTH_CHECK', '1');
  try {
  const resolver = createDefaultOciOrchestratorBackendResolver({
      fallbackBackend: createFakeContainerBackend(),
    });

    assertEquals(resolver({
      providerName: 'k8s',
      providerConfig: { namespace: 'takos' },
    }).constructor.name, 'K8sContainerBackend');

    assertEquals(resolver({
      providerName: 'cloud-run',
      providerConfig: { projectId: 'takos-project', region: 'us-central1' },
    }).constructor.name, 'CloudRunContainerBackend');

    assertEquals(resolver({
      providerName: 'ecs',
      providerConfig: {
        region: 'us-east-1',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/takos',
        taskDefinitionFamily: 'takos-worker',
      },
    }).constructor.name, 'EcsContainerBackend');
  } finally {
  for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  }
})
  Deno.test('oci orchestrator local service - uses provider-specific backends across redeploy, logs, and remove', async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-oci-orchestrator-'));
    Deno.env.set('OCI_ORCHESTRATOR_DATA_DIR', tempDir);
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    Deno.env.set('TAKOS_SKIP_OCI_HEALTH_CHECK', '1');
  try {
  const events: string[] = [];
    const dockerBackend = createObservedContainerBackend('docker', events);
    const k8sBackend = createObservedContainerBackend('k8s', events);
    const fetch = await createLocalOciOrchestratorFetchForTests({
      backendResolver: ({ providerName }) => (providerName === 'k8s' ? k8sBackend : dockerBackend),
    });

    const firstDeploy = await fetch(new Request('http://oci-orchestrator/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_id: 'dep-k8s-1',
        space_id: 'space-1',
        artifact_ref: 'worker-v1',
        provider: {
          name: 'k8s',
          config: { namespace: 'takos' },
        },
        target: {
          route_ref: 'worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
          artifact: {
            image_ref: 'ghcr.io/takos/worker:k8s',
            exposed_port: 8080,
          },
        },
      }),
    }));
    assertEquals(firstDeploy.status, 200);
    await assertEquals(await firstDeploy.json(), ({
      service: ({
        provider_name: 'k8s',
        container_id: 'k8s-0',
      }),
      resolved_endpoint: {
        kind: 'http-url',
        base_url: 'http://10.0.0.8:8080',
      },
    }));

    const secondDeploy = await fetch(new Request('http://oci-orchestrator/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_id: 'dep-oci-2',
        space_id: 'space-1',
        artifact_ref: 'worker-v2',
        provider: {
          name: 'oci',
        },
        target: {
          route_ref: 'worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
          artifact: {
            image_ref: 'ghcr.io/takos/worker:oci',
            exposed_port: 8080,
          },
        },
      }),
    }));
    assertEquals(secondDeploy.status, 200);
    await assertEquals(await secondDeploy.json(), ({
      service: ({
        provider_name: 'oci',
        container_id: 'docker-0',
      }),
      resolved_endpoint: {
        kind: 'http-url',
        base_url: 'http://127.0.0.1:8080',
      },
    }));

    const logsResponse = await fetch(new Request('http://oci-orchestrator/services/worker/logs?space_id=space-1&tail=20'));
    assertEquals(logsResponse.status, 200);
    await assertStringIncludes(await logsResponse.text(), 'docker:docker-0');

    const removeResponse = await fetch(new Request('http://oci-orchestrator/services/worker/remove?space_id=space-1', {
      method: 'POST',
    }));
    assertEquals(removeResponse.status, 200);
    await assertEquals(await removeResponse.json(), ({
      service: ({
        provider_name: 'oci',
        status: 'removed',
      }),
    }));

    assertEquals(events, ([
      'k8s:pull:ghcr.io/takos/worker:k8s',
      'k8s:create:takos-space-1-worker',
      'k8s:stop:k8s-0',
      'k8s:remove:k8s-0',
      'docker:pull:ghcr.io/takos/worker:oci',
      'docker:create:takos-space-1-worker',
      'docker:logs:docker-0',
      'docker:stop:docker-0',
      'docker:remove:docker-0',
    ]));

    assert(events.indexOf('k8s:stop:k8s-0') < events.indexOf('docker:create:takos-space-1-worker'));
    assert(events.indexOf('docker:logs:docker-0') > events.indexOf('docker:create:takos-space-1-worker'));
  } finally {
  for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  }
})