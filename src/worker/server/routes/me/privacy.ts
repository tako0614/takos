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
  requestAccountDeletion,
} from "../../../application/services/identity/privacy-rights.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";
import { type BaseVariables, parseJsonBody } from "../route-auth.ts";

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
    const payload = await privacyRouteDeps.buildDataSubjectExport(
      c.env.DB,
      user,
    );
    return c.json(payload, 200, {
      "Content-Disposition": `attachment; filename="${
        exportFilename(user.id)
      }"`,
    });
  })
  .post("/deletion-requests", async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody<{ reason?: string }>(c, {});
    const result = await privacyRouteDeps.requestAccountDeletion(
      c.env.DB,
      user,
      { reason: body?.reason },
    );

    const sessionId = privacyRouteDeps.getSessionIdFromCookie(
      c.req.header("Cookie"),
    );
    if (sessionId) {
      await privacyRouteDeps.recordSessionRevocation(c.env.DB, {
        sessionId,
        userId: user.id,
        reason: "admin_revoked",
      });

      const sessionStore = privacyRouteDeps.getPlatformServices(c)
        .notifications.sessionStore;
      if (sessionStore) {
        await privacyRouteDeps.deleteSession(sessionStore, sessionId);
      }
    }

    c.header("Set-Cookie", privacyRouteDeps.clearSessionCookie());
    return c.json(result, 202);
  });
