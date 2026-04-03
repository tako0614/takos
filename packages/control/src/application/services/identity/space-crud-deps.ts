import { getDb } from "../../../infra/db/index.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { resolveUserPrincipalId } from "./principals.ts";

export const spaceCrudDeps = {
  getDb,
  resolveUserPrincipalId,
  isValidOpaqueId,
};
