import type { Hono } from "hono";
import { CacheTTL, withCache } from "../../middleware/cache.ts";
import type { PublicRouteEnv } from "../route-auth.ts";
import type { ActivityPubStoreDeps } from "./deps.ts";
import {
  buildRepoActorId,
  buildStoreActorId,
  getHostFromUrl,
  getOriginFromUrl,
  jrdJson,
  jsonLd,
  takosContext,
} from "./helpers.ts";

type ParsedWebFingerResource =
  | { kind: "store"; slug: string; domain: string }
  | { kind: "repo"; domain: string; repoOwner: string; repoName: string }
  | null;

function parseWebFingerResource(
  resource: string,
): ParsedWebFingerResource | "invalid" {
  if (resource.startsWith("acct:")) {
    const acct = resource.slice(5);
    const atIndex = acct.lastIndexOf("@");
    if (atIndex <= 0) {
      return "invalid";
    }

    return {
      kind: "store",
      slug: acct.slice(0, atIndex),
      domain: acct.slice(atIndex + 1),
    };
  }

  if (!resource.startsWith("http://") && !resource.startsWith("https://")) {
    return "invalid";
  }

  try {
    const url = new URL(resource);
    const storeMatch = url.pathname.match(/^\/ap\/stores\/([^/]+)$/);
    if (storeMatch) {
      return {
        kind: "store",
        slug: decodeURIComponent(storeMatch[1]),
        domain: url.host,
      };
    }

    const repoMatch = url.pathname.match(/^\/ap\/repos\/([^/]+)\/([^/]+)$/);
    if (repoMatch) {
      return {
        kind: "repo",
        domain: url.host,
        repoOwner: decodeURIComponent(repoMatch[1]),
        repoName: decodeURIComponent(repoMatch[2]),
      };
    }
  } catch {
    return "invalid";
  }

  return "invalid";
}

export function registerWebfingerRoutes(
  activitypubStore: Hono<PublicRouteEnv>,
  deps: ActivityPubStoreDeps,
): void {
  activitypubStore.get(
    "/.well-known/webfinger",
    withCache({
      ttl: CacheTTL.PUBLIC_CONTENT,
      queryParamsToInclude: ["resource"],
    }),
    async (c) => {
      const resource = c.req.query("resource");
      if (!resource) {
        return c.json({ error: "resource parameter required" }, 400);
      }

      const requestHost = getHostFromUrl(c.req.url);
      const origin = getOriginFromUrl(c.req.url);
      const parsedResource = parseWebFingerResource(resource);

      if (parsedResource === "invalid") {
        return c.json({ error: "Invalid resource format" }, 400);
      }

      if (!parsedResource || parsedResource.domain !== requestHost) {
        return c.json({ error: "Actor not found" }, 404);
      }

      if (parsedResource.kind === "repo") {
        const repo = await deps.findCanonicalRepo(
          c.env,
          parsedResource.repoOwner,
          parsedResource.repoName,
        );
        if (!repo) {
          return c.json({ error: "Actor not found" }, 404);
        }

        const actorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
        return jrdJson(c, {
          subject: resource,
          aliases: [actorId],
          links: [
            { rel: "self", type: "application/activity+json", href: actorId },
          ],
        });
      }

      const storeRecord = await deps.findStoreBySlug(
        c.env,
        parsedResource.slug,
      );
      if (!storeRecord) {
        return c.json({ error: "Actor not found" }, 404);
      }

      const actorId = buildStoreActorId(origin, storeRecord.slug);
      return jrdJson(c, {
        subject: `acct:${storeRecord.slug}@${requestHost}`,
        aliases: [actorId],
        links: [
          { rel: "self", type: "application/activity+json", href: actorId },
        ],
      });
    },
  );

  activitypubStore.get(
    "/ns/takos",
    withCache({
      ttl: CacheTTL.PUBLIC_CONTENT,
      includeQueryParams: false,
    }),
    async (c) => {
      return jsonLd(c, { "@context": takosContext() });
    },
  );

  activitypubStore.get("/ns/takos-git", (c) => {
    return c.redirect(`${getOriginFromUrl(c.req.url)}/ns/takos`, 301);
  });
}
