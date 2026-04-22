/**
 * Unified spaces router — aggregates all space sub-routers into a single mount point.
 */
import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { ApiVariables } from "../api.ts";

import spacesBase from "./routes.ts";
import spacesMembers from "./members.ts";
import spacesRepos from "./repositories.ts";
import spacesStorage from "./storage.ts";
import spacesStores from "./stores.ts";
import spacesStoreRegistry from "./store-registry.ts";

const spaces = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

spaces.route("/", spacesBase);
spaces.route("/", spacesMembers);
spaces.route("/", spacesRepos);
spaces.route("/", spacesStorage);
spaces.route("/", spacesStores);
spaces.route("/", spacesStoreRegistry);

export default spaces;
