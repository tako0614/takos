import { assertThrows } from "jsr:@std/assert";

import { assertMatchingIdempotentRequest } from "../artifact-refs.ts";
import type { Deployment } from "../models.ts";

Deno.test("assertMatchingIdempotentRequest rejects worker target changes", () => {
  const deployment = {
    artifact_kind: "worker-bundle",
    bundle_hash: "hash-1",
    bundle_size: 10,
    routing_status: "active",
    routing_weight: 100,
    target_json: JSON.stringify({
      queue_consumers: [{ binding: "DELIVERY_QUEUE" }],
    }),
  } as Deployment;

  assertThrows(
    () =>
      assertMatchingIdempotentRequest(deployment, {
        artifactKind: "worker-bundle",
        bundleHash: "hash-1",
        bundleSize: 10,
        targetJson: JSON.stringify({
          queue_consumers: [{ binding: "OTHER_QUEUE" }],
        }),
        strategy: "direct",
      }),
    Error,
    "Idempotency-Key reuse does not match the original deployment request",
  );
});

Deno.test("assertMatchingIdempotentRequest rejects container target changes", () => {
  const deployment = {
    artifact_kind: "container-image",
    bundle_hash: null,
    bundle_size: null,
    routing_status: "active",
    routing_weight: 100,
    target_json: JSON.stringify({
      artifact: {
        kind: "container-image",
        image_ref:
          "ghcr.io/example/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        exposed_port: 8080,
      },
    }),
  } as Deployment;

  assertThrows(
    () =>
      assertMatchingIdempotentRequest(deployment, {
        artifactKind: "container-image",
        bundleHash: null,
        bundleSize: null,
        imageRef:
          "ghcr.io/example/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        targetJson: JSON.stringify({
          artifact: {
            kind: "container-image",
            image_ref:
              "ghcr.io/example/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            exposed_port: 9090,
          },
        }),
        strategy: "direct",
      }),
    Error,
    "Idempotency-Key reuse does not match the original deployment request",
  );
});
