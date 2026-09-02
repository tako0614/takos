import { Hono } from "hono";

import type { Env } from "../../shared/types/index.ts";
import type { BaseVariables } from "./route-auth.ts";
import { resolveRuntimeCapabilities } from "../../platform/runtime-capabilities.ts";

/**
 * What this deployment can do, for a signed-in client.
 *
 * An install without a Vectorize index or a Container application is a
 * documented reduced mode, so the UI needs to know which entry points can work
 * before it offers them. The operator-facing view — including schema migration
 * state — lives on `GET /internal/runtime/status` instead; this route
 * deliberately exposes only the capability names.
 */
export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .get("/capabilities", (c) =>
    c.json({ capabilities: resolveRuntimeCapabilities(c.env) }),
  );
