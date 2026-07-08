import type { FeaturedAppCatalogEntry } from "./featured-app-catalog-types.ts";

/**
 * Takos does not define built-in installable apps. The app store/catalog is
 * operator or store supplied, and app repositories remain plain Git/OpenTofu
 * sources.
 */
export const FALLBACK_FEATURED_APP_CATALOG: readonly FeaturedAppCatalogEntry[] =
  [];
