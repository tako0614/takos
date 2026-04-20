import { EcsContainerBackend } from "../ecs-container-backend.ts";
import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult,
} from "../command-runner.ts";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

type CommandCall = {
  args: string[];
  command: string;
  options?: CommandRunnerOptions;
};

function createCommandRunner(
  handler: (args: string[]) => Promise<CommandRunnerResult>,
): { calls: CommandCall[]; runner: CommandRunner } {
  const calls: CommandCall[] = [];
  const runner: CommandRunner = async (
    command,
    args,
    options,
  ) => {
    calls.push({ command, args: [...args], options });
    return await handler(args);
  };
  return { calls, runner };
}

function findCall(
  calls: CommandCall[],
  first: string,
  second: string,
): CommandCall {
  const call = calls.find(({ args }) =>
    args[0] === first && args[1] === second
  );
  assert(call);
  return call;
}

Deno.test("EcsContainerBackend - registers a task definition revision, creates a service when missing, and tails logs", async () => {
  const { calls, runner } = createCommandRunner(async (args) => {
    if (args[0] === "ecs" && args[1] === "describe-task-definition") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          taskDefinition: {
            family: "takos-worker",
            executionRoleArn: "arn:aws:iam::123456789012:role/takosExecution",
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            cpu: "256",
            memory: "512",
            containerDefinitions: [{
              name: "app",
              image: "ghcr.io/takos/old:latest",
              portMappings: [{
                containerPort: 3000,
                hostPort: 3000,
                protocol: "tcp",
              }],
              logConfiguration: {
                logDriver: "awslogs",
                options: {
                  "awslogs-group": "/ecs/takos-worker",
                },
              },
            }],
          },
        }),
        stderr: "",
      };
    }

    if (args[0] === "ecs" && args[1] === "describe-services") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ services: [] }),
        stderr: "",
      };
    }

    if (args[0] === "ecs" && args[1] === "register-task-definition") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          taskDefinition: {
            taskDefinitionArn:
              "arn:aws:ecs:us-east-1:123456789012:task-definition/takos-worker:42",
          },
        }),
        stderr: "",
      };
    }

    if (args[0] === "ecs" && args[1] === "create-service") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    if (args[0] === "ecs" && args[1] === "wait") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    if (args[0] === "logs" && args[1] === "tail") {
      return {
        exitCode: 0,
        stdout: "a\nb\nc\n",
        stderr: "",
      };
    }

    if (args[0] === "ecs" && args[1] === "delete-service") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    throw new Error(`unexpected command: ${args.join(" ")}`);
  });

  const backend = new EcsContainerBackend({
    region: "us-east-1",
    clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
    taskDefinitionFamily: "takos-worker",
    subnetIds: ["subnet-a", "subnet-b"],
    securityGroupIds: ["sg-1"],
    containerName: "app",
    commandRunner: runner,
  });

  const result = await backend.createAndStart({
    imageRef:
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/takos-worker:latest",
    name: "takos-space-1-worker",
    exposedPort: 8080,
    healthPath: "/healthz",
    requestedEndpoint: {
      kind: "http-url",
      base_url: "https://worker.example.test",
    },
    envVars: {
      NODE_ENV: "production",
    },
    labels: {
      "takos.route-ref": "worker",
    },
  });

  assertEquals(result, {
    containerId: "takos-space-1-worker",
    resolvedEndpoint: {
      kind: "http-url",
      base_url: "https://worker.example.test",
    },
    healthCheckUrl: "https://worker.example.test/healthz",
  });
  assertEquals(await backend.getLogs("takos-space-1-worker", 2), "b\nc\n");
  assertEquals(await backend.remove("takos-space-1-worker"), undefined);

  const registerCall = findCall(calls, "ecs", "register-task-definition");
  assertEquals(registerCall.command, "aws");
  assertEquals(registerCall.options, {
    env: { AWS_DEFAULT_REGION: "us-east-1" },
  });
  const registerInputIndex = registerCall.args.indexOf("--cli-input-json");
  assert(registerInputIndex >= 0);
  assertStringIncludes(
    registerCall.args[registerInputIndex + 1]!,
    '"image":"123456789012.dkr.ecr.us-east-1.amazonaws.com/takos-worker:latest"',
  );
  assertStringIncludes(
    registerCall.args[registerInputIndex + 1]!,
    '"environment":[{"name":"NODE_ENV","value":"production"}]',
  );

  const createServiceCall = findCall(calls, "ecs", "create-service");
  assertEquals(createServiceCall.command, "aws");
  assertEquals(createServiceCall.options, {
    env: { AWS_DEFAULT_REGION: "us-east-1" },
  });
  assertEquals(
    createServiceCall.args.includes(
      "awsvpcConfiguration={subnets=[subnet-a,subnet-b],securityGroups=[sg-1],assignPublicIp=ENABLED}",
    ),
    true,
  );

  const logsCall = findCall(calls, "logs", "tail");
  assertEquals(logsCall.command, "aws");
  assertEquals(logsCall.options, { env: { AWS_DEFAULT_REGION: "us-east-1" } });
  assertEquals(logsCall.args[2], "/ecs/takos-worker");
});

Deno.test("EcsContainerBackend - updates an existing service instead of creating a new one", async () => {
  const { calls, runner } = createCommandRunner(async (args) => {
    if (args[0] === "ecs" && args[1] === "describe-task-definition") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          taskDefinition: {
            family: "takos-worker",
            containerDefinitions: [{
              name: "app",
              image: "ghcr.io/takos/old:latest",
            }],
          },
        }),
        stderr: "",
      };
    }
    if (args[0] === "ecs" && args[1] === "describe-services") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          services: [{
            serviceArn:
              "arn:aws:ecs:us-east-1:123456789012:service/takos/current",
            status: "ACTIVE",
          }],
        }),
        stderr: "",
      };
    }
    if (args[0] === "ecs" && args[1] === "register-task-definition") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          taskDefinition: {
            taskDefinitionArn:
              "arn:aws:ecs:us-east-1:123456789012:task-definition/takos-worker:99",
          },
        }),
        stderr: "",
      };
    }
    if (args[0] === "ecs" && args[1] === "update-service") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "ecs" && args[1] === "wait") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  });

  const backend = new EcsContainerBackend({
    region: "us-east-1",
    clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
    taskDefinitionFamily: "takos-worker",
    serviceArn: "arn:aws:ecs:us-east-1:123456789012:service/takos/current",
    baseUrl: "https://current.example.test",
    commandRunner: runner,
  });

  assertEquals(
    await backend.createAndStart({
      imageRef:
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/takos-worker:next",
      name: "ignored-name",
      exposedPort: 8080,
    }),
    {
      containerId: "current",
      resolvedEndpoint: {
        kind: "http-url",
        base_url: "https://current.example.test",
      },
      healthCheckUrl: "https://current.example.test/health",
    },
  );

  const updateServiceCall = findCall(calls, "ecs", "update-service");
  assertEquals(updateServiceCall.command, "aws");
  assertEquals(updateServiceCall.options, {
    env: { AWS_DEFAULT_REGION: "us-east-1" },
  });
  assertEquals(updateServiceCall.args.includes("--service"), true);
  assertEquals(updateServiceCall.args.includes("current"), true);
  assertEquals(updateServiceCall.args.includes("--force-new-deployment"), true);
  assertEquals(
    calls.some(({ args }) => args[0] === "ecs" && args[1] === "create-service"),
    false,
  );
});
