/**
 * Shared HTML templates for auth pages.
 * Consistent zinc-based dark UI matching the frontend LoginPage.
 */
declare function escapeHtml(value: string): string;
export { escapeHtml };
/** Simple error page with title, message, and optional link */
export declare function errorPage(title: string, message: string, linkHref?: string, linkText?: string): string;
/** Warning page (e.g. setup required) */
export declare function warningPage(title: string, message: string, linkHref?: string, linkText?: string): string;
/** External service login page with session check + Google button */
export declare function externalLoginPage(opts: {
    serviceName: string;
    googleOAuthUrl: string;
    encodedRedirectUri: string;
    nonce: string;
    homeUrl?: string;
    homeLabel?: string;
}): string;
/** External auth redirect page that POSTs token without leaking it in URL */
export declare function externalTokenPostRedirectPage(opts: {
    redirectUri: string;
    token: string;
    nonce: string;
}): string;
/** OAuth consent page */
export declare function consentPage(opts: {
    clientName: string;
    clientLogoUri: string | null;
    userEmail: string;
    identityScopes: string[];
    resourceScopes: string[];
    hiddenFields: Record<string, string>;
}): string;
/** OAuth device flow: entry page */
export declare function deviceCodeEntryPage(opts: {
    userEmail: string;
    presetUserCode: string | null;
    message: string | null;
    homeUrl?: string;
    homeLabel?: string;
}): string;
/** OAuth device flow: consent page */
export declare function deviceConsentPage(opts: {
    clientName: string;
    clientLogoUri: string | null;
    userEmail: string;
    userCode: string;
    csrfToken: string;
    identityScopes: string[];
    resourceScopes: string[];
}): string;
/** OAuth device flow: result page */
export declare function deviceResultPage(opts: {
    title: string;
    message: string;
    homeUrl?: string;
    homeLabel?: string;
}): string;
//# sourceMappingURL=html.d.ts.map