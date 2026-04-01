import {
  type CommonEnvAuditActor,
  hashAuditIp,
} from "../../application/services/common-env/audit.ts";
import type { Env } from "../../shared/types/index.ts";

export const commonEnvHandlersDeps = {
  hashAuditIp,
};

/**
 * Build an audit actor from a Hono request context and user ID.
 * Shared between workspace common-env routes and worker settings routes.
 */
export async function buildCommonEnvActor(
  c: {
    req: { header: (name: string) => string | undefined };
    env: Env;
  },
  userId: string,
  deps: typeof commonEnvHandlersDeps = commonEnvHandlersDeps,
): Promise<CommonEnvAuditActor> {
  const requestId = c.req.header("x-request-id") || c.req.header("cf-ray");
  const userAgent = c.req.header("user-agent") || c.req.header("User-Agent");
  const forwarded = c.req.header("x-forwarded-for");
  const ip = c.req.header("cf-connecting-ip") ||
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined);
  return {
    type: "user",
    userId,
    requestId,
    ipHash: await deps.hashAuditIp(c.env, ip),
    userAgent,
  };
}
