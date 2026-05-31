import { forwardInProcessControlJsonRequest } from "../../routes/in-process-control-routes.ts";
import type { ApiBindings } from "./bindings.ts";
import {
  commonError,
  type CommonErrorEnvelope,
  copyHeaderIfPresent,
  isRecord,
  readBodyString,
} from "./common.ts";

export async function handleTakosumiLaunch(
  request: Request,
  env?: ApiBindings,
): Promise<Response> {
  const inputToken = await launchTokenFromRequest(request);
  if (!inputToken) {
    return Response.json(
      commonError("INVALID_ARGUMENT", "launch token is required"),
      { status: 400 },
    );
  }
  const opaqueConfig = opaqueLaunchTokenConfig();
  if (!opaqueConfig.ok) {
    return Response.json(
      commonError(
        "INTERNAL_ERROR",
        "opaque launch token config is not configured",
      ),
      { status: 500 },
    );
  }
  return await consumeTakosumiLaunchToken({
    request,
    env,
    token: inputToken,
    installationId: opaqueConfig.installationId,
    redirectUri: opaqueConfig.redirectUri,
    issuer: takosumiAccountsIssuerUrl(),
  });
}

async function consumeTakosumiLaunchToken(input: {
  request: Request;
  env?: ApiBindings;
  token: string;
  installationId: string;
  issuer: string | null;
  redirectUri?: string;
}): Promise<Response> {
  if (new URL(input.request.url).protocol !== "https:") {
    return Response.json(
      commonError("UNAUTHORIZED", "launch token requires HTTPS"),
      { status: 401 },
    );
  }
  const accountsBaseUrl = takosumiAccountsBaseUrl();
  if (!accountsBaseUrl) {
    return Response.json(
      commonError("INTERNAL_ERROR", "Takosumi Accounts URL is not configured"),
      { status: 500 },
    );
  }
  if (new URL(accountsBaseUrl).protocol !== "https:") {
    return Response.json(
      commonError("INTERNAL_ERROR", "Takosumi Accounts URL must use HTTPS"),
      { status: 500 },
    );
  }

  const consumeUrl = `${accountsBaseUrl}/v1/installations/${
    encodeURIComponent(input.installationId)
  }/launch-token/consume`;
  const consumeBody: Record<string, string> = { token: input.token };
  if (input.redirectUri) consumeBody.redirect_uri = input.redirectUri;
  const response = await fetch(consumeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(consumeBody),
  });
  if (!response.ok) {
    const error = await accountsLaunchError(response);
    return Response.json(error.body, { status: error.status });
  }

  const body = await response.json().catch(() => null) as unknown;
  const launch = launchConsumeResult(body);
  if (!launch) {
    return Response.json(
      commonError(
        "INTERNAL_ERROR",
        "Takosumi Accounts returned invalid launch",
      ),
      { status: 502 },
    );
  }
  return await createLaunchSession({
    request: input.request,
    env: input.env,
    issuer: input.issuer ?? accountsBaseUrl,
    launch,
  });
}

async function launchTokenFromRequest(
  request: Request,
): Promise<string | undefined> {
  const url = new URL(request.url);
  const queryLaunchToken = url.searchParams.get("launch_token")?.trim();
  if (queryLaunchToken) return queryLaunchToken;
  if (request.method === "POST") {
    const body = await request.json().catch(() => null) as unknown;
    if (isRecord(body)) {
      const launchToken = readBodyString(body, "launch_token");
      if (launchToken) return launchToken;
    }
  }
  return undefined;
}

type OpaqueLaunchTokenConfig =
  | { ok: true; installationId: string; redirectUri: string }
  | { ok: false };

function opaqueLaunchTokenConfig(): OpaqueLaunchTokenConfig {
  const installationId = Deno.env.get("INSTALL_LAUNCH_INSTALLATION_ID")?.trim();
  const redirectUri = Deno.env.get("INSTALL_LAUNCH_REDIRECT_URI")?.trim();
  if (installationId && redirectUri) {
    return { ok: true, installationId, redirectUri };
  }
  return { ok: false };
}

function takosumiAccountsBaseUrl(): string | null {
  const value = Deno.env.get("ACCOUNTS_BASE_URL")?.trim() ||
    Deno.env.get("TAKOSUMI_ACCOUNTS_INTERNAL_URL")?.trim() ||
    Deno.env.get("TAKOSUMI_ACCOUNTS_URL")?.trim() ||
    Deno.env.get("OIDC_ISSUER_URL")?.trim();
  return normalizedUrl(value);
}

function takosumiAccountsIssuerUrl(): string | null {
  const value = Deno.env.get("OIDC_ISSUER_URL")?.trim() ||
    Deno.env.get("TAKOSUMI_ACCOUNTS_URL")?.trim() ||
    Deno.env.get("ACCOUNTS_BASE_URL")?.trim() ||
    Deno.env.get("TAKOSUMI_ACCOUNTS_INTERNAL_URL")?.trim();
  return normalizedUrl(value);
}

function normalizedUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function accountsLaunchError(
  response: Response,
): Promise<{ status: number; body: CommonErrorEnvelope }> {
  const value = await response.json().catch(() => null) as unknown;
  const upstreamError = isRecord(value) && typeof value.error === "string"
    ? value.error
    : "launch token consume failed";
  const status = response.status === 400 || response.status === 401 ||
      response.status === 404 || response.status === 409 ||
      response.status === 410
    ? response.status
    : 502;
  const code = status === 400
    ? "INVALID_ARGUMENT"
    : status === 401
    ? "UNAUTHORIZED"
    : status === 404
    ? "NOT_FOUND"
    : status === 409 || status === 410
    ? "FAILED_PRECONDITION"
    : "INTERNAL_ERROR";
  return {
    status,
    body: commonError(code, upstreamError),
  };
}

type LaunchConsumeResult = {
  installationId: string;
  accountId: string;
  spaceId: string;
  appId: string;
  subject: string;
  role: string;
};

function launchConsumeResult(value: unknown): LaunchConsumeResult | null {
  if (!isRecord(value) || value.consumed !== true) return null;
  const installationId = readBodyString(value, "installation_id");
  const accountId = readBodyString(value, "account_id");
  const spaceId = readBodyString(value, "space_id");
  const appId = readBodyString(value, "app_id");
  const subject = readBodyString(value, "subject");
  const role = readBodyString(value, "role") ?? "member";
  if (!installationId || !accountId || !spaceId || !appId || !subject) {
    return null;
  }
  return { installationId, accountId, spaceId, appId, subject, role };
}

async function createLaunchSession(input: {
  request: Request;
  env?: ApiBindings;
  issuer: string;
  launch: LaunchConsumeResult;
}): Promise<Response> {
  const secret = Deno.env.get("TAKOS_INTERNAL_API_SECRET")?.trim();
  if (!secret) {
    return Response.json(
      commonError(
        "INTERNAL_ERROR",
        "control launch session handoff is not configured",
      ),
      { status: 500 },
    );
  }

  const headers = new Headers({
    "content-type": "application/json",
    "x-takos-auth-proxy-secret": secret,
  });
  copyHeaderIfPresent(input.request.headers, headers, "user-agent");
  copyHeaderIfPresent(input.request.headers, headers, "cf-connecting-ip");
  copyHeaderIfPresent(input.request.headers, headers, "x-forwarded-for");
  const response = await forwardInProcessControlJsonRequest(
    "/internal/auth/launch-session",
    {
      env: input.env,
      headers,
      body: JSON.stringify({
        issuer: input.issuer,
        installation_id: input.launch.installationId,
        account_id: input.launch.accountId,
        space_id: input.launch.spaceId,
        app_id: input.launch.appId,
        subject: input.launch.subject,
        role: input.launch.role,
        return_to: launchReturnToFromRequest(input.request),
      }),
    },
  ).catch(() => null);
  if (!response) {
    return Response.json(
      commonError("INTERNAL_ERROR", "control launch session handoff failed"),
      { status: 502 },
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function launchReturnToFromRequest(request: Request): string | undefined {
  const value = new URL(request.url).searchParams.get("return_to")?.trim();
  return value || undefined;
}
