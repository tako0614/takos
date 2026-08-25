export type OidcTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

// OIDC token exchange runs on the interactive login path. Keep the upstream
// call bounded so a stalled issuer cannot hold a callback open indefinitely.
const OIDC_FETCH_TIMEOUT_MS = 10_000;

export type OidcFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Exchange a browser authorization code at the issuer token endpoint.
 *
 * The optional fetch implementation is a production-useful route dependency:
 * platform adapters can supply a service-bound fetcher while the default uses
 * the Worker global. Keeping it request-scoped also makes tests concurrency-safe
 * without mutating global fetch.
 */
export async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: OidcFetch;
}): Promise<OidcTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  const response = await (input.fetchImpl ?? fetch)(input.tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OIDC token endpoint returned ${response.status}`);
  }
  return await response.json() as OidcTokenResponse;
}
