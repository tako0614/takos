export const BUILD_IDENTITY =
  "takos-fetch-tracer@public-registry-provider-4.0.0";
export const TRACER_SCOPE = "integration-only";

const CONFIG_KEY = "TAKOS_FETCH_TRACER_CONFIG";
const NONCE_KEY = "TAKOS_FETCH_TRACER_NONCE";
const PROJECT_UID_KEY = "TAKOS_FETCH_TRACER_PROJECT_UID";

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(
        { error: "method_not_allowed" },
        405,
        { allow: "GET, HEAD" },
      );
    }

    const { pathname } = new URL(request.url);
    let body;
    let status = 200;
    if (pathname === "/") {
      body = {
        buildIdentity: BUILD_IDENTITY,
        configValue: env?.[CONFIG_KEY] ?? null,
        nonce: env?.[NONCE_KEY] ?? null,
        projectUid: env?.[PROJECT_UID_KEY] ?? null,
      };
    } else if (pathname === "/health") {
      body = {
        component: "takoserver-fetch-tracer",
        product: "takos",
        scope: TRACER_SCOPE,
        status: "ok",
      };
    } else if (pathname === "/.well-known/takos") {
      body = {
        artifact: "takoserver-fetch-tracer",
        capabilities: ["fetch"],
        fullRuntime: false,
        name: "Takos",
        product: "takos",
        runtime: "neutral-javascript-fetch",
        scope: TRACER_SCOPE,
      };
    } else {
      body = { error: "not_found" };
      status = 404;
    }

    if (request.method === "HEAD") {
      return new Response(null, { status, headers: json(body, status).headers });
    }
    return json(body, status);
  },
};
