import { EcsContainerBackend } from '../ecs-container-backend.ts';


import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('EcsContainerBackend - registers a task definition revision, creates a service when missing, and tails logs', async () => {
  const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'ecs' && args[1] === 'describe-task-definition') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            taskDefinition: {
              family: 'takos-worker',
              executionRoleArn: 'arn:aws:iam::123456789012:role/takosExecution',
              networkMode: 'awsvpc',
              requiresCompatibilities: ['FARGATE'],
              cpu: '256',
              memory: '512',
              containerDefinitions: [{
                name: 'app',
                image: 'ghcr.io/takos/old:latest',
                portMappings: [{ containerPort: 3000, hostPort: 3000, protocol: 'tcp' }],
                logConfiguration: {
                  logDriver: 'awslogs',
                  options: {
                    'awslogs-group': '/ecs/takos-worker',
                  },
                },
              }],
            },
          }),
          stderr: '',
        };
      }

      if (args[0] === 'ecs' && args[1] === 'describe-services') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ services: [] }),
          stderr: '',
        };
      }

      if (args[0] === 'ecs' && args[1] === 'register-task-definition') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            taskDefinition: {
              taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/takos-worker:42',
            },
          }),
          stderr: '',
        };
      }

      if (args[0] === 'ecs' && args[1] === 'create-service') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (args[0] === 'ecs' && args[1] === 'wait') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (args[0] === 'logs' && args[1] === 'tail') {
        return {
          exitCode: 0,
          stdout: 'a\nb\nc\n',
          stderr: '',
        };
      }

      if (args[0] === 'ecs' && args[1] === 'delete-service') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      throw new Error(`unexpected command: ${args.join(' ')}`);
    };

    const backend = new EcsContainerBackend({
      region: 'us-east-1',
      clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/takos',
      taskDefinitionFamily: 'takos-worker',
      subnetIds: ['subnet-a', 'subnet-b'],
      securityGroupIds: ['sg-1'],
      containerName: 'app',
      commandRunner,
    });

    const result = await backend.createAndStart({
      imageRef: '123456789012.dkr.ecr.us-east-1.amazonaws.com/takos-worker:latest',
      name: 'takos-space-1-worker',
      exposedPort: 8080,
      healthPath: '/healthz',
      requestedEndpoint: {
        kind: 'http-url',
        base_url: 'https://worker.example.test',
      },
      envVars: {
        NODE_ENV: 'production',
      },
      labels: {
        'takos.route-ref': 'worker',
      },
    });

    assertEquals(result, {
      containerId: 'takos-space-1-worker',
      resolvedEndpoint: {
        kind: 'http-url',
        base_url: 'https://worker.example.test',
      },
      healthCheckUrl: 'https://worker.example.test/healthz',
    });

    await assertEquals(await backend.getLogs('takos-space-1-worker', 2), 'b\nc\n');
    await assertEquals(await backend.remove('takos-space-1-worker'), undefined);

    assertSpyCallArgs(commandRunner, 0, ['aws', ([
      'ecs',
      'register-task-definition',
      '--cli-input-json',
      expect.stringContaining('"image":"123456789012.dkr.ecr.us-east-1.amazonaws.com/takos-worker:latest"'),
    ]), ({
      env: { AWS_DEFAULT_REGION: 'us-east-1' },
    })]);
    assertSpyCallArgs(commandRunner, 0, ['aws', ([
      'ecs',
      'create-service',
      '--service-name',
      'takos-space-1-worker',
      '--network-configuration',
      'awsvpcConfiguration={subnets=[subnet-a,subnet-b],securityGroups=[sg-1],assignPublicIp=ENABLED}',
    ]), ({
      env: { AWS_DEFAULT_REGION: 'us-east-1' },
    })]);
    assertSpyCallArgs(commandRunner, 0, ['aws', ([
      'logs',
      'tail',
      '/ecs/takos-worker',
    ]), ({
      env: { AWS_DEFAULT_REGION: 'us-east-1' },
    })]);
})
  Deno.test('EcsContainerBackend - updates an existing service instead of creating a new one', async () => {
  const commandRunner = async (_command: string, args: string[]) => {
      if (args[0] === 'ecs' && args[1] === 'describe-task-definition') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            taskDefinition: {
              family: 'takos-worker',
              containerDefinitions: [{
                name: 'app',
                image: 'ghcr.io/takos/old:latest',
              }],
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'ecs' && args[1] === 'describe-services') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            services: [{ serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/takos/current', status: 'ACTIVE' }],
          }),
          stderr: '',
        };
      }
      if (args[0] === 'ecs' && args[1] === 'register-task-definition') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            taskDefinition: {
              taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/takos-worker:99',
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'ecs' && args[1] === 'update-service') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'ecs' && args[1] === 'wait') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    };

    const backend = new EcsContainerBackend({
      region: 'us-east-1',
      clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/takos',
      taskDefinitionFamily: 'takos-worker',
      serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/takos/current',
      baseUrl: 'https://current.example.test',
      commandRunner,
    });

    await assertEquals(await backend.createAndStart({
      imageRef: '123456789012.dkr.ecr.us-east-1.amazonaws.com/takos-worker:next',
      name: 'ignored-name',
      exposedPort: 8080,
    }), ({
      containerId: 'current',
      resolvedEndpoint: {
        kind: 'http-url',
        base_url: 'https://current.example.test',
      },
    }));

    assertSpyCallArgs(commandRunner, 0, ['aws', ([
      'ecs',
      'update-service',
      '--service',
      'current',
      '--force-new-deployment',
    ]), ({
      env: { AWS_DEFAULT_REGION: 'us-east-1' },
    })]);
    // TODO: manual assertion - commandRunner was not called with ('aws', ([
      'ecs',
      'create-service',
    ]), expect.anything());
}), expect.anything());
  });
  });
});
