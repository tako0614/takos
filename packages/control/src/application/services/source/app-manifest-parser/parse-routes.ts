// ============================================================
// parse-routes.ts
// ============================================================
//
// Flat-schema route parser (Phase 1).
//
// Walks the top-level `routes[]` array and builds `AppRoute[]`.
// The old envelope schema had `name` and `ingress` fields — both
// are rejected in the flat schema.
//
// Route shape:
//   - target  (required) — compute name
//   - path    (required) — must start with '/'
//   - methods (optional) — HTTP methods to match
//   - timeoutMs (optional)
// ============================================================

import type { AppCompute, AppRoute } from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asStringArray,
} from "../app-manifest-utils.ts";

const VALID_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export function parseRoutes(
  topLevel: Record<string, unknown>,
  compute: Record<string, AppCompute>,
): AppRoute[] {
  if (topLevel.routes == null) return [];
  if (!Array.isArray(topLevel.routes)) {
    throw new Error("routes must be an array");
  }

  return topLevel.routes.map((entry, index) => {
    const route = asRecord(entry);
    const prefix = `routes[${index}]`;

    if (route.name != null) {
      throw new Error(
        `${prefix}.name is not supported in the flat manifest schema`,
      );
    }
    if (route.ingress != null) {
      throw new Error(
        `${prefix}.ingress is not supported in the flat manifest schema`,
      );
    }

    const target = asRequiredString(route.target, `${prefix}.target`);
    if (!compute[target]) {
      throw new Error(
        `${prefix}.target references unknown compute: ${target}`,
      );
    }

    const path = asRequiredString(route.path, `${prefix}.path`);
    if (!path.startsWith("/")) {
      throw new Error(`${prefix}.path must start with '/' (got: ${path})`);
    }

    const methods = asStringArray(route.methods, `${prefix}.methods`);
    if (methods) {
      for (const method of methods) {
        if (!VALID_HTTP_METHODS.includes(method.toUpperCase())) {
          throw new Error(
            `${prefix}.methods contains invalid method: ${method}`,
          );
        }
      }
    }

    return {
      target,
      path,
      ...(methods ? { methods } : {}),
      ...(route.timeoutMs != null
        ? { timeoutMs: Number(route.timeoutMs) }
        : {}),
    };
  });
}
