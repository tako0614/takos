import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types/index.ts";
import { zValidator } from "../zod-validator.ts";
import {
  discardSession,
  resumeSession,
  startSession,
  stopSession,
} from "./lifecycle.ts";
import { getSessionHealth } from "./heartbeat.ts";
import type { BaseVariables } from "../route-auth.ts";

const sessions = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
const startSessionSchema = z.object({
  repo_id: z.string(),
  branch: z.string().optional(),
});
const stopSessionSchema = z.object({ commit_message: z.string().optional() });

sessions.post(
  "/spaces/:spaceId/sessions",
  zValidator("json", startSessionSchema),
  async (c) =>
    startSession(c, c.req.valid("json") as z.infer<typeof startSessionSchema>),
);

sessions.post(
  "/sessions/:sessionId/stop",
  zValidator("json", stopSessionSchema),
  async (c) =>
    stopSession(c, c.req.valid("json") as z.infer<typeof stopSessionSchema>),
);

sessions.post("/sessions/:sessionId/resume", resumeSession);
sessions.post("/sessions/:sessionId/discard", discardSession);

sessions.get("/sessions/:sessionId/health", getSessionHealth);

export default sessions;
