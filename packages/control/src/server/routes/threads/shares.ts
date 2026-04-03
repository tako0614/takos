import { Hono, type Hono as HonoType } from "hono";
import { z } from "zod";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import type { ThreadShareMode } from "../../../application/services/threads/thread-shares.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { zValidator } from "../zod-validator.ts";
import { threadSharesRouteDeps } from "./deps.ts";
import {
  requireThreadAccess,
  resolveThreadShareInput,
  withThreadShareLinks,
} from "./helpers.ts";

type ThreadsRouter = HonoType<{ Bindings: Env; Variables: BaseVariables }>;

const createThreadShareSchema = z.object({
  mode: z.string().optional(),
  password: z.string().optional(),
  expires_at: z.string().optional(),
  expires_in_days: z.number().optional(),
});

export function registerThreadShareRoutes(app: ThreadsRouter) {
  app.post(
    "/threads/:id/share",
    zValidator("json", createThreadShareSchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const body = c.req.valid("json") as {
        mode?: ThreadShareMode;
        password?: string;
        expires_at?: string;
        expires_in_days?: number;
      };
      const access = requireThreadAccess(
        await threadSharesRouteDeps.checkThreadAccess(
          c.env.DB,
          threadId,
          user.id,
          [
            "owner",
            "admin",
            "editor",
          ],
        ),
      );
      const shareInput = resolveThreadShareInput(body);

      try {
        const created = await threadSharesRouteDeps.createThreadShare({
          db: c.env.DB,
          threadId,
          spaceId: access.thread.space_id,
          createdBy: user.id,
          ...shareInput,
        });

        const sharePath = `/share/${created.share.token}`;
        const origin = new URL(c.req.url).origin;

        return c.json({
          share: created.share,
          share_path: sharePath,
          share_url: origin + sharePath,
          password_required: created.passwordRequired,
        }, 201);
      } catch (err) {
        logError("Failed to create share", err, {
          module: "routes/thread-shares",
        });
        const message = err instanceof Error
          ? err.message
          : "Failed to create share";
        throw new BadRequestError(message);
      }
    },
  );

  app.get("/threads/:id/shares", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await threadSharesRouteDeps.checkThreadAccess(
        c.env.DB,
        threadId,
        user.id,
      ),
    );

    const shares = await threadSharesRouteDeps.listThreadShares(
      c.env.DB,
      threadId,
    );
    return c.json({
      shares: withThreadShareLinks(new URL(c.req.url).origin, shares),
    });
  });

  app.post("/threads/:id/shares/:shareId/revoke", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    const shareId = c.req.param("shareId");
    requireThreadAccess(
      await threadSharesRouteDeps.checkThreadAccess(
        c.env.DB,
        threadId,
        user.id,
        [
          "owner",
          "admin",
          "editor",
        ],
      ),
    );

    const ok = await threadSharesRouteDeps.revokeThreadShare({
      db: c.env.DB,
      threadId,
      shareId,
    });
    if (!ok) {
      throw new NotFoundError("Share");
    }

    return c.json({ success: true });
  });
}

const threadSharesRoutes = new Hono<
  { Bindings: Env; Variables: BaseVariables }
>();
registerThreadShareRoutes(threadSharesRoutes);

export { threadSharesRouteDeps } from "./deps.ts";

export default threadSharesRoutes;
