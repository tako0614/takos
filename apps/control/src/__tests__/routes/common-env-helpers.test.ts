import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, spy } from "jsr:@std/testing/mock";

import { buildCommonEnvActor } from "@/routes/common-env-handlers";
import { createMockEnv } from "../../../test/integration/setup.ts";

Deno.test("buildCommonEnvActor - builds actor from request headers", async () => {
  const env = createMockEnv();
  const hashAuditIp = spy(async () => "hashed-ip");
  const mockContext = {
    req: {
      header: (name: string) => {
        const headers: Record<string, string> = {
          "x-request-id": "req-123",
          "user-agent": "TestAgent/1.0",
          "cf-connecting-ip": "1.2.3.4",
        };
        return headers[name.toLowerCase()];
      },
    },
    env,
  };

  const actor = await buildCommonEnvActor(mockContext as never, "user-1", {
    hashAuditIp,
  });

  assertEquals(actor, {
    type: "user",
    userId: "user-1",
    requestId: "req-123",
    ipHash: "hashed-ip",
    userAgent: "TestAgent/1.0",
  });
  assertSpyCallArgs(hashAuditIp, 0, [env, "1.2.3.4"]);
});

Deno.test("buildCommonEnvActor - handles missing headers gracefully", async () => {
  const env = createMockEnv();
  const hashAuditIp = spy(async () => "hashed-ip");
  const mockContext = {
    req: {
      header: () => undefined,
    },
    env,
  };

  const actor = await buildCommonEnvActor(mockContext as never, "user-1", {
    hashAuditIp,
  });

  assertEquals(actor.type, "user");
  assertEquals(actor.userId, "user-1");
  assertEquals(actor.requestId, undefined);
  assertEquals(actor.userAgent, undefined);
});

Deno.test("buildCommonEnvActor - uses x-forwarded-for when cf-connecting-ip is not present", async () => {
  const env = createMockEnv();
  const hashAuditIp = spy(async () => "hashed-ip");
  const mockContext = {
    req: {
      header: (name: string) => {
        const headers: Record<string, string> = {
          "x-forwarded-for": "5.6.7.8, 9.10.11.12",
        };
        return headers[name.toLowerCase()];
      },
    },
    env,
  };

  await buildCommonEnvActor(mockContext as never, "user-1", { hashAuditIp });
  assertSpyCallArgs(hashAuditIp, 0, [env, "5.6.7.8"]);
});

Deno.test("buildCommonEnvActor - uses cf-ray as fallback for request ID", async () => {
  const env = createMockEnv();
  const hashAuditIp = spy(async () => "hashed-ip");
  const mockContext = {
    req: {
      header: (name: string) => {
        if (name === "cf-ray") return "ray-456";
        return undefined;
      },
    },
    env,
  };

  const actor = await buildCommonEnvActor(mockContext as never, "user-1", {
    hashAuditIp,
  });

  assertEquals(actor.requestId, "ray-456");
});
