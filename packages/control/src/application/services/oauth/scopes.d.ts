export declare function parseScopes(scopeString: string): string[];
export declare function validateScopes(scopes: string[]): {
    valid: boolean;
    unknown: string[];
};
export declare function areScopesAllowed(requested: string[], allowed: string[]): boolean;
export declare function hasAccess(grantedScopes: string[], resource: string, action: 'read' | 'write' | 'execute'): boolean;
export declare function getScopeSummary(scopes: string[]): {
    identity: string[];
    resources: string[];
};
//# sourceMappingURL=scopes.d.ts.map