/**
 * Typed RPC client for the takos account-plane screens (folded from the
 * takosumi dashboard SPA).
 *
 * A thin, fully-typed wrapper over the in-process account plane REST API. The
 * account plane is mounted at the worker origin root (`/v1/*` — see
 * takos/src/worker/web.ts), so every method talks same-origin with the HttpOnly
 * `takosumi_session` cookie (`credentials: "include"`). Every method goes
 * through {@link apiFetch} (transport in ./http) and uses contract-mirrored
 * paths (./paths).
 *
 * This is the load-bearing shared module for the account/installations screens.
 * Do NOT reuse the takos product `lib/rpc.ts` (that is the Hono `/api` client
 * for the product surface — different base + auth).
 *
 * Usage: `import { rpc, ApiError } from "./lib/api.ts";` then e.g.
 * `await rpc.installations.get(id)`.
 *
 * Ported from takosumi dashboard-ui/src/lib/rpc/index.ts.
 */
import { clearSession, refreshSession } from "./session.ts";
import * as installations from "./installations.ts";
import * as tokens from "./tokens.ts";
import * as billing from "./billing.ts";
import * as auth from "./auth.ts";

export const rpc = {
  session: {
    /** Refresh + return the current session (null when unauthenticated). */
    me: refreshSession,
    /** Clear the local cache and ask the server to revoke the cookie. */
    signOut: clearSession,
  },
  installations: {
    list: installations.listInstallationsForSpace,
    get: installations.getInstallation,
    plan: installations.planInstallation,
    create: installations.createInstallation,
    uninstall: installations.uninstallInstallation,
    services: installations.listInstallationServices,
    serviceCatalog: installations.listWorkloadServices,
    rotateServiceToken: installations.rotateInstallationServiceToken,
    materialize: installations.materializeInstallation,
    requestExport: installations.requestInstallationExport,
    getExportOperation: installations.getInstallationExportOperation,
    exportDownloadUrl: installations.installationExportDownloadUrl,
    events: installations.listInstallationEvents,
  },
  tokens: {
    list: tokens.listTokens,
    create: tokens.createToken,
    revoke: tokens.revokeToken,
  },
  billing: {
    checkout: billing.startStripeCheckout,
  },
  auth: {
    startUpstreamOAuth: auth.startUpstreamOAuth,
    completeUpstreamOAuth: auth.completeUpstreamOAuth,
    recallOAuthProvider: auth.recallOAuthProvider,
    requestPasskeyRegisterOptions: auth.requestPasskeyRegisterOptions,
    completePasskeyRegistration: auth.completePasskeyRegistration,
  },
} as const;

export { ApiError } from "./http.ts";

export type {
  CreateInstallationInput,
  DeploymentOutput,
  ExportInput,
  ExportOperation,
  Installation,
  InstallationEvent,
  InstallationEventsResult,
  InstallationPlanRunInput,
  InstallationPlanRunResponse,
  MaterializeInput,
  OidcClientConfig,
  RotateWorkloadServiceTokenResult,
  WorkloadService,
  WorkloadServiceDescriptor,
  WorkloadServiceStatus,
} from "./installations.ts";
export type {
  CreateTokenInput,
  CreateTokenResult,
  PersonalAccessToken,
} from "./tokens.ts";
export type { StripeCheckoutResult } from "./billing.ts";
export type { CallbackResult, PasskeyRegisterOptions } from "./auth.ts";
