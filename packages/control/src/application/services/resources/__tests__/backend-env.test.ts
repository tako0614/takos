import { assertEquals } from "jsr:@std/assert";

import type { Env } from "../../../../shared/types/index.ts";
import { inferDefaultManagedResourceBackend } from "../lifecycle.ts";
import { inferResourceBackend } from "../../../../server/routes/resources/route-helpers.ts";

Deno.test("resource backend inference only activates k8s on K8S_NAMESPACE", () => {
  const k8sOnlyOptionalConfig = {
    K8S_DEPLOYMENT_NAME: "takos-worker",
    K8S_IMAGE_REGISTRY: "ghcr.io/takos",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(
      k8sOnlyOptionalConfig as Partial<Env>,
    ),
    "local",
  );
  assertEquals(
    inferResourceBackend(k8sOnlyOptionalConfig as never),
    "local",
  );

  const k8sActivated = {
    K8S_NAMESPACE: "takos",
    K8S_DEPLOYMENT_NAME: "takos-worker",
    K8S_IMAGE_REGISTRY: "ghcr.io/takos",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(k8sActivated as Partial<Env>),
    "k8s",
  );
  assertEquals(
    inferResourceBackend(k8sActivated as never),
    "k8s",
  );
});

Deno.test("resource backend inference ignores generic AWS region and S3 envs", () => {
  const helmSelfHostedEnv = {
    AWS_REGION: "ap-northeast-1",
    AWS_S3_GIT_OBJECTS_BUCKET: "takos-git-objects",
    AWS_S3_ENDPOINT: "https://s3.example.test",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(helmSelfHostedEnv as Partial<Env>),
    "local",
  );
  assertEquals(
    inferResourceBackend(helmSelfHostedEnv as never),
    "local",
  );
});

Deno.test("resource backend inference lets k8s win over AWS service envs", () => {
  const k8sWithAwsServices = {
    K8S_NAMESPACE: "takos",
    AWS_REGION: "ap-northeast-1",
    AWS_DYNAMO_KV_TABLE: "takos-kv",
    AWS_SQS_RUN_QUEUE_URL: "https://sqs.example.test/run",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(k8sWithAwsServices as Partial<Env>),
    "k8s",
  );
  assertEquals(
    inferResourceBackend(k8sWithAwsServices as never),
    "k8s",
  );
});

Deno.test("resource backend inference activates AWS from explicit backend or strong AWS service envs", () => {
  assertEquals(
    inferDefaultManagedResourceBackend({
      TAKOS_RESOURCE_BACKEND: "aws",
      AWS_REGION: "ap-northeast-1",
    } as Partial<Env>),
    "aws",
  );
  assertEquals(
    inferResourceBackend({
      TAKOS_RESOURCE_BACKEND: "aws",
      AWS_REGION: "ap-northeast-1",
    } as never),
    "aws",
  );

  const dynamoEnv = {
    AWS_REGION: "ap-northeast-1",
    AWS_DYNAMO_KV_TABLE: "takos-kv",
  };
  assertEquals(
    inferDefaultManagedResourceBackend(dynamoEnv as Partial<Env>),
    "aws",
  );
  assertEquals(
    inferResourceBackend(dynamoEnv as never),
    "aws",
  );
});
