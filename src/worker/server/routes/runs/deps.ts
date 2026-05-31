import { getDb } from "../../../infra/db/index.ts";
import { checkThreadAccess } from "../../../application/services/threads/thread-service.ts";
import { checkRunAccess } from "./access.ts";
import { createThreadRun } from "../../../application/services/execution/run-creation.ts";
import { loadRunObservation } from "./observation.ts";

export const runsRouteDeps = {
  getDb,
  checkThreadAccess,
  checkRunAccess,
  createThreadRun,
  loadRunObservation,
};
