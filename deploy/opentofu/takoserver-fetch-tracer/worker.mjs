export const BUILD_IDENTITY =
  "takos-fetch-tracer@experimental-source-build-dev-override";

const CONFIG_KEY = "TAKOS_FETCH_TRACER_CONFIG";

export default {
  async fetch(_request, env) {
    const body = {
      buildIdentity: BUILD_IDENTITY,
      configValue: env?.[CONFIG_KEY] ?? null,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  },
};
