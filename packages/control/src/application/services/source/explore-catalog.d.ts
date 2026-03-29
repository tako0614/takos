import type { Env } from '../../../shared/types';
import type { CatalogSort, CatalogType, CatalogResult } from './explore-types';
export declare function listCatalogItems(dbBinding: Env['DB'], options: {
    sort: CatalogSort;
    limit: number;
    offset: number;
    searchQuery?: string;
    type?: CatalogType;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    tagsRaw?: string;
    certifiedOnly?: boolean;
    spaceId?: string;
    userId?: string;
}): Promise<CatalogResult>;
//# sourceMappingURL=explore-catalog.d.ts.map