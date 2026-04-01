import { getDb as realGetDb } from "../../../infra/db/index.ts";
import {
  generateId as realGenerateId,
  sanitizeRepoName as realSanitizeRepoName,
} from "../../../shared/utils/index.ts";
import {
  createEmbeddingsService as realCreateEmbeddingsService,
  isEmbeddingsAvailable as realIsEmbeddingsAvailable,
} from "../execution/embeddings.ts";
import {
  logError as realLogError,
  logWarn as realLogWarn,
} from "../../../shared/utils/logger.ts";
import { getRunEventsAfterFromR2 as realGetRunEventsAfterFromR2 } from "../offload/run-events.ts";
import { validatePathSegment as realValidatePathSegment } from "../../../shared/utils/path-validation.ts";
import { checkSpaceAccess as realCheckSpaceAccess } from "../identity/space-access.ts";
import * as gitStore from "../git-smart/index.ts";

export const sourceServiceDeps = {
  getDb: (db: Parameters<typeof realGetDb>[0]) => {
    if (db && typeof (db as { select?: unknown }).select === "function") {
      return db as ReturnType<typeof realGetDb>;
    }
    return realGetDb(db);
  },
  generateId: realGenerateId,
  sanitizeRepoName: realSanitizeRepoName,
  createEmbeddingsService: realCreateEmbeddingsService,
  isEmbeddingsAvailable: realIsEmbeddingsAvailable,
  logError: realLogError,
  logWarn: realLogWarn,
  getRunEventsAfterFromR2: realGetRunEventsAfterFromR2,
  validatePathSegment: realValidatePathSegment,
  checkSpaceAccess: realCheckSpaceAccess,
  gitStore,
};
