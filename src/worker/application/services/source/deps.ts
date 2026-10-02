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
import { getIndexedRunEventsAfter as realGetIndexedRunEventsAfter } from "../offload/indexed-run-events.ts";
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
  getIndexedRunEventsAfter: realGetIndexedRunEventsAfter,
  validatePathSegment: realValidatePathSegment,
  checkSpaceAccess: realCheckSpaceAccess,
  gitStore,
};
