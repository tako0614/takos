import { getDb } from "../../../infra/db/index.ts";
import {
  applyManifest,
  getGroupState,
  planManifest,
} from "../../../application/services/deployment/apply-engine.ts";
import { parseAppManifestYaml } from "../../../application/services/source/app-manifest-parser/index.ts";

export const groupsRouteDeps = {
  getDb,
  getGroupState,
  planManifest,
  applyManifest,
  parseAppManifestYaml,
};

export function groupRecordDeps() {
  return { getDb: groupsRouteDeps.getDb };
}
