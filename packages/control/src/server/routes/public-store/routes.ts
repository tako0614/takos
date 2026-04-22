import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { NotFoundError } from "takos-common/errors";
import {
  findPublicStoreInventoryItem,
  getPublicStoreDocument,
  listPublicStoreFeed,
  listPublicStoreInventory,
  searchPublicStoreRepositories,
} from "../../../application/services/store-network/public-store.ts";

type Variables = Record<string, never>;

export const publicStoreRouteDeps = {
  getPublicStoreDocument,
  listPublicStoreInventory,
  findPublicStoreInventoryItem,
  searchPublicStoreRepositories,
  listPublicStoreFeed,
};

export function setPublicStoreRouteTestDeps(
  overrides: Partial<typeof publicStoreRouteDeps>,
): void {
  Object.assign(publicStoreRouteDeps, overrides);
}

function originFromUrl(url: string): string {
  return new URL(url).origin;
}

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/:storeSlug", async (c) => {
    const store = await publicStoreRouteDeps.getPublicStoreDocument(
      c.env.DB,
      originFromUrl(c.req.url),
      c.req.param("storeSlug"),
    );
    if (!store) throw new NotFoundError("Store");
    return c.json({ store });
  })
  .get("/:storeSlug/inventory", async (c) => {
    const { limit, offset } = parsePagination(c.req.query(), {
      limit: 20,
      maxLimit: 100,
    });
    const result = await publicStoreRouteDeps.listPublicStoreInventory(
      c.env.DB,
      originFromUrl(c.req.url),
      c.req.param("storeSlug"),
      { limit, offset },
    );
    if (!result) throw new NotFoundError("Store");
    return c.json({
      store: result.store,
      total: result.total,
      limit,
      offset,
      items: result.items,
    });
  })
  .get("/:storeSlug/inventory/:referenceId", async (c) => {
    const item = await publicStoreRouteDeps.findPublicStoreInventoryItem(
      c.env.DB,
      originFromUrl(c.req.url),
      c.req.param("storeSlug"),
      c.req.param("referenceId"),
    );
    if (!item) throw new NotFoundError("Repository reference");
    return c.json({ repository: item });
  })
  .get("/:storeSlug/search/repositories", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    if (!query) {
      return c.json({ error: "q parameter required" }, 400);
    }
    const { limit, offset } = parsePagination(c.req.query(), {
      limit: 20,
      maxLimit: 100,
    });
    const result = await publicStoreRouteDeps.searchPublicStoreRepositories(
      c.env.DB,
      originFromUrl(c.req.url),
      c.req.param("storeSlug"),
      query,
      { limit, offset },
    );
    if (!result) throw new NotFoundError("Store");
    return c.json({
      store: result.store,
      total: result.total,
      query,
      limit,
      offset,
      repositories: result.items,
    });
  })
  .get("/:storeSlug/feed", async (c) => {
    const { limit, offset } = parsePagination(c.req.query(), {
      limit: 20,
      maxLimit: 100,
    });
    const result = await publicStoreRouteDeps.listPublicStoreFeed(
      c.env.DB,
      originFromUrl(c.req.url),
      c.req.param("storeSlug"),
      { limit, offset },
    );
    if (!result) throw new NotFoundError("Store");
    return c.json({
      store: result.store,
      total: result.total,
      limit,
      offset,
      items: result.items,
    });
  });
