import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
export declare function exportThread(params: {
    db: SqlDatabaseBinding;
    renderPdf?: (html: string) => Promise<ArrayBuffer>;
    threadId: string;
    includeInternal: boolean;
    includeInternalRolesAllowed: boolean;
    format: string;
}): Promise<Response | null>;
//# sourceMappingURL=thread-export.d.ts.map