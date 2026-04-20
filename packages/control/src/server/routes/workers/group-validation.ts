import { eq } from "drizzle-orm";
import { ValidationError } from "takos-common/errors";
import { getDb } from "../../../infra/db/index.ts";
import { groups } from "../../../infra/db/schema.ts";
import type { AppContext } from "../route-auth.ts";
import { requireSpaceAccess } from "../route-auth.ts";
import { errorResponse } from "../response-utils.ts";

type GroupResolutionResult = {
  groupId: string | null;
  response?: Response;
};

export async function resolveCreateSpaceId(
  c: AppContext,
  userId: string,
  requestedSpaceId?: string | null,
): Promise<string> {
  const spaceId = requestedSpaceId?.trim() || null;
  if (!spaceId) {
    return userId;
  }

  const access = await requireSpaceAccess(
    c,
    spaceId,
    userId,
    ["owner", "admin", "editor"],
    "Space not found or insufficient permissions",
  );
  return access.space.id;
}

export async function resolveGroupIdForSpace(
  c: AppContext,
  input: {
    groupId?: string | null;
    spaceId: string;
    errorMessage: string;
  },
): Promise<GroupResolutionResult> {
  const groupId = input.groupId?.trim() || null;
  if (!groupId) {
    return { groupId: null };
  }

  const db = getDb(c.env.DB);
  const group = await db.select({
    id: groups.id,
    spaceId: groups.spaceId,
  })
    .from(groups)
    .where(eq(groups.id, groupId))
    .get();

  if (!group || group.spaceId !== input.spaceId) {
    return {
      groupId: null,
      response: errorResponse(
        new ValidationError(input.errorMessage, [
          { field: "group_id", message: input.errorMessage },
        ]),
      ),
    };
  }

  return { groupId: group.id };
}
