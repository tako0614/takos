/**
 * Auth flows for the account-plane RPC client: upstream OAuth (Google/GitHub)
 * and passkey registration (WebAuthn). The OAuth half is navigation-based; the
 * passkey half is request/response over {@link apiFetch}.
 *
 * Ported from takosumi dashboard-ui/src/lib/rpc/auth.ts.
 */
import { apiFetch, qs } from "./http.ts";
import * as paths from "./paths.ts";
import type { SessionRecord } from "./session.ts";

const STATE_KEY = "tg_oauth_state";
const RETURN_KEY = "tg_oauth_return";
const PROVIDER_KEY = "tg_oauth_provider";

type Provider = "google" | "github" | "passkey";

function randomState(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startUpstreamOAuth(provider: "google" | "github"): void {
  if (typeof window === "undefined") return;
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  // Upstream OAuth providers don't echo back which provider was used in the
  // callback URL — stash it here so /sign-in/callback can recover it.
  sessionStorage.setItem(PROVIDER_KEY, provider);
  // Preserve intended return URL (e.g. user landed on /apps unauth and was
  // bounced to /sign-in; after auth we want to send them back to /apps).
  const url = new URL(location.href);
  const intended = url.searchParams.get("return") ?? "/home";
  sessionStorage.setItem(RETURN_KEY, intended);

  location.assign(
    paths.UPSTREAM_AUTHORIZE +
      qs({
        provider,
        state,
        redirect_uri: location.origin + "/sign-in/callback",
      }),
  );
}

export function recallOAuthProvider(): "google" | "github" | null {
  if (typeof sessionStorage === "undefined") return null;
  const v = sessionStorage.getItem(PROVIDER_KEY);
  return v === "google" || v === "github" ? v : null;
}

export interface CallbackResult {
  readonly session: SessionRecord;
  readonly returnTo: string;
}

interface CallbackResponse {
  readonly subject: string;
  readonly session_id: string;
  readonly expires_at: number;
  readonly provider_id?: string;
  readonly display_name?: string;
  readonly email?: string;
}

export async function completeUpstreamOAuth(
  code: string,
  state: string,
  provider: Provider,
): Promise<CallbackResult> {
  const expected = sessionStorage.getItem(STATE_KEY);
  if (!expected || expected !== state) {
    throw new Error("oauth state mismatch — possible CSRF or stale tab");
  }
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(PROVIDER_KEY);
  const returnTo = sessionStorage.getItem(RETURN_KEY) ?? "/home";
  sessionStorage.removeItem(RETURN_KEY);

  // The worker's /v1/auth/upstream/callback handler only accepts GET with
  // query params (it was originally designed as the direct upstream redirect
  // target). Calling via GET with code/state/provider in the URL keeps the
  // SPA out of the redirect chain while still using the documented contract.
  const body: CallbackResponse = await apiFetch(
    paths.UPSTREAM_CALLBACK + qs({ code, state, provider }),
    { method: "GET", auth: false },
  );
  return {
    session: {
      subject: body.subject,
      sessionId: body.session_id,
      // expires_at is epoch ms (worker passes Date.now() + ttl).
      expiresAt: body.expires_at,
      provider,
      ...(body.display_name ? { displayName: body.display_name } : {}),
      ...(body.email ? { email: body.email } : {}),
    },
    returnTo,
  };
}

export interface PasskeyRegisterOptions {
  readonly rp: { readonly id: string; readonly name: string };
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
  };
  readonly challenge: string;
  readonly pubKeyCredParams?: readonly {
    readonly alg: number;
    readonly type: "public-key";
  }[];
  readonly timeout?: number;
  readonly attestation?: AttestationConveyancePreference;
  readonly excludeCredentials?: readonly {
    readonly id: string;
    readonly type: "public-key";
  }[];
  readonly authenticatorSelection?: AuthenticatorSelectionCriteria;
}

export async function requestPasskeyRegisterOptions(
  subject: string,
): Promise<PasskeyRegisterOptions> {
  return await apiFetch<PasskeyRegisterOptions>(
    paths.PASSKEY_REGISTER_OPTIONS,
    { method: "POST", body: { subject } },
  );
}

export async function completePasskeyRegistration(input: {
  subject: string;
  credentialId: string;
  publicKeyJwk: JsonWebKey;
  /**
   * The server-minted challenge echoed back from the register/options
   * response. The server requires this so it can confirm the ceremony is
   * the one it issued (replay protection) and unlock clientDataJSON /
   * attestationObject verification on the complete endpoint.
   */
  challenge: string;
  /**
   * base64url-encoded `clientDataJSON` from the authenticator's
   * `navigator.credentials.create()` result. The server parses it and
   * checks `type === "webauthn.create"`, the challenge, and the origin.
   */
  clientDataJSON: string;
  /**
   * base64url-encoded `attestationObject` from the authenticator. The
   * server enforces that its `fmt` matches the requested attestation
   * policy ("none").
   */
  attestationObject: string;
  signCount?: number;
  transports?: readonly string[];
}): Promise<{ credential_id: string; subject: string; sign_count: number }> {
  return await apiFetch(paths.PASSKEY_REGISTER_COMPLETE, {
    method: "POST",
    body: input,
  });
}
