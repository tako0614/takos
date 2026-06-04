import { resolveDb } from "../../../infra/db/index.ts";
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
import * as gitStore from "../takos-git/index.ts";

export const sourceServiceDeps = {
  getDb: resolveDb,
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
