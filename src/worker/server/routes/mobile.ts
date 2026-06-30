import { Hono } from "hono";
import {
  parseMobilePushHostRegistrationRequest,
  type ParsedMobilePushHostRegistrationRequest,
} from "takosumi-contract/mobile";

import type { Env } from "../../shared/types/index.ts";
import type { BaseVariables } from "./route-auth.ts";
import {
  registerMobilePushRegistration,
  unregisterMobilePushRegistration,
} from "../../application/services/notifications/mobile-push.ts";

async function readJson(c: {
  readonly req: { readonly json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

async function readPushRegistrationRequest(c: {
  readonly req: { readonly json: () => Promise<unknown> };
}): Promise<
  | { readonly ok: true; readonly body: ParsedMobilePushHostRegistrationRequest }
  | {
      readonly ok: false;
      readonly error: { readonly code: "BAD_REQUEST"; readonly error: string };
    }
> {
  const parsed = parseMobilePushHostRegistrationRequest(await readJson(c), {
    product: "takos",
  });
  if (!parsed.ok) return parsed;
  return { ok: true, body: parsed.value };
}

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .post("/push-registrations", async (c) => {
    const parsed = await readPushRegistrationRequest(c);
    if (!parsed.ok) return c.json(parsed.error, 400);

    const user = c.get("user");
    const body = parsed.body;
    const registration = await registerMobilePushRegistration(c.env.DB, {
      accountId: user.id,
      product: body.product,
      token: body.token,
      environment: body.environment,
      hostUrl: body.hostUrl,
    });

    return c.json({ registration });
  })
  .delete("/push-registrations", async (c) => {
    const parsed = await readPushRegistrationRequest(c);
    if (!parsed.ok) return c.json(parsed.error, 400);

    const user = c.get("user");
    const body = parsed.body;
    const result = await unregisterMobilePushRegistration(c.env.DB, {
      accountId: user.id,
      product: body.product,
      token: body.token,
      environment: body.environment,
      hostUrl: body.hostUrl,
    });

    return c.json(result);
  });
