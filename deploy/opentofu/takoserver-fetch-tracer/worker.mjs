export const BUILD_IDENTITY =
  "takos-fetch-tracer@public-registry-provider-3.0.0";

const CONFIG_KEY = "TAKOS_FETCH_TRACER_CONFIG";
const NONCE_KEY = "TAKOS_FETCH_TRACER_NONCE";
const PROJECT_UID_KEY = "TAKOS_FETCH_TRACER_PROJECT_UID";

export default {
  async fetch(_request, env) {
    const body = {
      buildIdentity: BUILD_IDENTITY,
      configValue: env?.[CONFIG_KEY] ?? null,
      nonce: env?.[NONCE_KEY] ?? null,
      projectUid: env?.[PROJECT_UID_KEY] ?? null,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  },
};
