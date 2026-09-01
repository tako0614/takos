import { Hono } from "hono";

import type { Env } from "../../../shared/types/index.ts";
import {
  clearSessionCookie,
  deleteSession,
  getSessionIdFromCookie,
} from "../../../application/services/identity/session.ts";
import { recordSessionRevocation } from "../../../application/services/identity/session-revocation.ts";
import {
  buildDataSubjectExport,
  getPrivacyAccessSummary,
  PrivacyExportCapacityError,
  requestAccountDeletion,
} from "../../../application/services/identity/privacy-rights.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";
import { type BaseVariables, parseJsonBody } from "../route-auth.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export const privacyRouteDeps = {
  buildDataSubjectExport,
  getPrivacyAccessSummary,
  requestAccountDeletion,
  getPlatformServices,
  getSessionIdFromCookie,
  recordSessionRevocation,
  deleteSession,
  clearSessionCookie,
};

function exportFilename(userId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `takos-data-export-${userId}-${date}.json`;
}

function parseDeletionRequestBody(
  value: unknown,
): { reason?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "reason")) return null;
  if (body.reason === undefined) return {};
  if (typeof body.reason !== "string") return null;
  const reason = body.reason.trim();
  if (!reason || reason.length > 1000) return null;
  return { reason };
}

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .get("/", async (c) => {
    const user = c.get("user");
    const summary = await privacyRouteDeps.getPrivacyAccessSummary(
      c.env.DB,
      user,
    );
    return c.json(summary);
  })
  .get("/access", async (c) => {
    const user = c.get("user");
    const summary = await privacyRouteDeps.getPrivacyAccessSummary(
      c.env.DB,
      user,
    );
    return c.json(summary);
  })
  .get("/export", async (c) => {
    const user = c.get("user");
    try {
      const payload = await privacyRouteDeps.buildDataSubjectExport(
        c.env.DB,
        user,
      );
      return c.json(payload, 200, {
        "Content-Disposition": `attachment; filename="${
          exportFilename(user.id)
        }"`,
      });
    } catch (error) {
      if (error instanceof PrivacyExportCapacityError) {
        return c.json({
          error: "This export requires assisted processing",
          code: error.code,
          collection: error.collection,
          contact: "privacy@takos.jp",
        }, 413);
      }
      throw error;
    }
  })
  .post("/deletion-requests", async (c) => {
    const user = c.get("user");
    const parsed = await parseJsonBody<unknown>(c, {});
    const body = parseDeletionRequestBody(parsed);
    if (!body) {
      return c.json({ error: "Invalid deletion request" }, 400);
    }
    const result = await privacyRouteDeps.requestAccountDeletion(
      c.env.DB,
      user,
      { reason: body?.reason },
    );

    const sessionId = privacyRouteDeps.getSessionIdFromCookie(
      c.req.header("Cookie"),
    );
    if (sessionId) {
      try {
        await privacyRouteDeps.recordSessionRevocation(c.env.DB, {
          sessionId,
          userId: user.id,
          reason: "admin_revoked",
        });
      } catch (error) {
        // The accepted request atomically disabled the account and removed
        // app-local SQL sessions. This extra blacklist write is cleanup for a
        // stale cookie and must not turn an accepted request into a retry that
        // appears to have failed.
        logWarn("Deletion request session revocation cleanup failed", {
          module: "privacy-rights",
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const sessionStore = privacyRouteDeps.getPlatformServices(c)
        .notifications.sessionStore;
      if (sessionStore) {
        try {
          await privacyRouteDeps.deleteSession(sessionStore, sessionId);
        } catch (error) {
          logWarn("Deletion request session store cleanup failed", {
            module: "privacy-rights",
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    c.header("Set-Cookie", privacyRouteDeps.clearSessionCookie());
    return c.json(result, 202);
  });
