export interface TemplateContext {
    routes: Record<string, {
        url: string;
        domain: string;
        path: string;
    }>;
    containers: Record<string, {
        port: number;
    }>;
    services: Record<string, {
        ipv4?: string;
        port: number;
    }>;
    workers: Record<string, {
        url: string;
    }>;
    resources: Record<string, {
        id: string;
    }>;
}
/**
 * Resolve all template strings in an inject map against the given context.
 * Template syntax: `{{section.name.field}}` e.g. `{{routes.api.url}}`
 */
export declare function resolveTemplates(inject: Record<string, string>, context: TemplateContext): Record<string, string>;
/**
 * Validate that all template references in an inject map refer to known
 * sections and names in the manifest. Returns an array of error messages
 * (empty if everything is valid).
 */
export declare function validateTemplateReferences(inject: Record<string, string>, manifest: {
    containers?: Record<string, unknown>;
    services?: Record<string, unknown>;
    workers?: Record<string, unknown>;
    routes?: Array<{
        name: string;
    }>;
    resources?: Record<string, unknown>;
}): string[];
//# sourceMappingURL=app-manifest-template.d.ts.map