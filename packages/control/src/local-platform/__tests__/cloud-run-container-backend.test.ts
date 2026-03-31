import { describe, expect, it, vi } from 'vitest';
import { CloudRunContainerBackend } from '../cloud-run-container-backend.ts';

describe('CloudRunContainerBackend', () => {
  it('deploys a service, returns the service URL, reads logs, and deletes the service', async () => {
    const commandRunner = vi.fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          status: {
            url: 'https://takos-worker-uc.a.run.app',
          },
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'line-1\nline-2\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

    const backend = new CloudRunContainerBackend({
      projectId: 'takos-project',
      region: 'us-central1',
      serviceAccount: 'takos-runtime@takos-project.iam.gserviceaccount.com',
      ingress: 'internal-and-cloud-load-balancing',
      allowUnauthenticated: false,
      commandRunner,
    });

    const result = await backend.createAndStart({
      imageRef: 'us-central1-docker.pkg.dev/takos-project/services/web:latest',
      name: 'Takos_Service',
      exposedPort: 8080,
      healthPath: '/readyz',
      envVars: {
        NODE_ENV: 'production',
      },
    });

    expect(result).toEqual({
      containerId: 'takos-service',
      resolvedEndpoint: {
        kind: 'http-url',
        base_url: 'https://takos-worker-uc.a.run.app',
      },
      healthCheckUrl: 'https://takos-worker-uc.a.run.app/readyz',
    });

    await expect(backend.getLogs('takos-service', 25)).resolves.toBe('line-1\nline-2\n');
    await expect(backend.remove('takos-service')).resolves.toBeUndefined();

    expect(commandRunner).toHaveBeenNthCalledWith(1, 'gcloud', expect.arrayContaining([
      'run',
      'deploy',
      'takos-service',
      '--image',
      'us-central1-docker.pkg.dev/takos-project/services/web:latest',
      '--region',
      'us-central1',
      '--service-account',
      'takos-runtime@takos-project.iam.gserviceaccount.com',
      '--ingress',
      'internal-and-cloud-load-balancing',
      '--no-allow-unauthenticated',
      '--project',
      'takos-project',
    ]));
    expect(commandRunner).toHaveBeenNthCalledWith(2, 'gcloud', expect.arrayContaining([
      'logging',
      'read',
      'resource.type="cloud_run_revision" AND resource.labels.service_name="takos-service"',
      '--project',
      'takos-project',
    ]));
    expect(commandRunner).toHaveBeenNthCalledWith(3, 'gcloud', expect.arrayContaining([
      'run',
      'services',
      'delete',
      'takos-service',
      '--region',
      'us-central1',
      '--quiet',
      '--project',
      'takos-project',
    ]));
  });
});
