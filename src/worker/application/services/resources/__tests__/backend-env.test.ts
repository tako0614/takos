import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import type { Env } from "../../../../shared/types/index.ts";
import { inferDefaultManagedResourceBackend } from "../lifecycle.ts";
import { inferResourceBackend } from "../../../../server/routes/resources/route-helpers.ts";

// Multi-cloud materialization (aws/gcp/k8s) is operator-substrate scope owned by
// OpenTofu RunnerProfiles, not the Takos worker. The worker provisions only the
// native `cloudflare` backend and the portable self-hosted `local` backend, so
// cloud-specific envs no longer select an aws/gcp/k8s in-worker backend.

test("k8s namespace env no longer selects an in-worker k8s backend", () => {
  const k8sEnv = {
    K8S_NAMESPACE: "takos",
    K8S_DEPLOYMENT_NAME: "takos-worker",
    K8S_IMAGE_REGISTRY: "ghcr.io/takos",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(k8sEnv as Partial<Env>),
    "local",
  );
  assertEquals(
    inferResourceBackend(k8sEnv as never),
    "local",
  );
});

test("resource backend inference ignores generic AWS region and S3 envs", () => {
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

test("AWS service envs no longer select an in-worker aws backend", () => {
  const dynamoEnv = {
    AWS_REGION: "ap-northeast-1",
    AWS_DYNAMO_KV_TABLE: "takos-kv",
    AWS_SQS_RUN_QUEUE_URL: "https://sqs.example.test/run",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(dynamoEnv as Partial<Env>),
    "local",
  );
  assertEquals(
    inferResourceBackend(dynamoEnv as never),
    "local",
  );
});

test("explicit retired multi-cloud backend names normalize to the portable local backend", () => {
  for (const retired of ["aws", "gcp", "k8s"] as const) {
    assertEquals(
      inferDefaultManagedResourceBackend({
        TAKOS_RESOURCE_BACKEND: retired,
        AWS_REGION: "ap-northeast-1",
      } as Partial<Env>),
      "local",
    );
    assertEquals(
      inferResourceBackend({
        TAKOS_RESOURCE_BACKEND: retired,
        AWS_REGION: "ap-northeast-1",
      } as never),
      "local",
    );
  }
});

test("cloudflare credentials still select the native cloudflare backend", () => {
  const cfEnv = {
    CF_ACCOUNT_ID: "acc",
    CF_API_TOKEN: "tok",
  };
  assertEquals(
    inferDefaultManagedResourceBackend(cfEnv as Partial<Env>),
    "cloudflare",
  );
  assertEquals(
    inferResourceBackend(cfEnv as never),
    "cloudflare",
  );
});
