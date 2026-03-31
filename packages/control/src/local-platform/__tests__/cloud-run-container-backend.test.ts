import { CloudRunContainerBackend } from '../cloud-run-container-backend.ts';


import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('CloudRunContainerBackend - deploys a service, returns the service URL, reads logs, and deletes the service', async () => {
  const commandRunner = ((..._args: any[]) => undefined) as any
       = (async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: {
            url: 'https://takos-worker-uc.a.run.app',
          },
        }),
        stderr: '',
      })) as any
       = (async () => ({
        exitCode: 0,
        stdout: 'line-1\nline-2\n',
        stderr: '',
      })) as any
       = (async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })) as any;

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

    assertEquals(result, {
      containerId: 'takos-service',
      resolvedEndpoint: {
        kind: 'http-url',
        base_url: 'https://takos-worker-uc.a.run.app',
      },
      healthCheckUrl: 'https://takos-worker-uc.a.run.app/readyz',
    });

    await assertEquals(await backend.getLogs('takos-service', 25), 'line-1\nline-2\n');
    await assertEquals(await backend.remove('takos-service'), undefined);

    assertSpyCallArgs(commandRunner, 0, ['gcloud', ([
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
    ])]);
    assertSpyCallArgs(commandRunner, 1, ['gcloud', ([
      'logging',
      'read',
      'resource.type="cloud_run_revision" AND resource.labels.service_name="takos-service"',
      '--project',
      'takos-project',
    ])]);
    assertSpyCallArgs(commandRunner, 2, ['gcloud', ([
      'run',
      'services',
      'delete',
      'takos-service',
      '--region',
      'us-central1',
      '--quiet',
      '--project',
      'takos-project',
    ])]);
})