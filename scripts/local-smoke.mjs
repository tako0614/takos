import fs from "node:fs";

// Host-side defaults mirror .env.local.example for local process smoke checks.
const defaults = {
  paasApiPort: "8787",
  paasRouterPort: "8788",
  paasRuntimeAgentPort: "8789",
  paasLogWorkerPort: "8790",
  runtimePort: "8081",
  executorPort: "8082",
};

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1);
    if (!Deno.env.get(key)) {
      Deno.env.set(key, value);
    }
  }
}

function env(name, fallback) {
  return Deno.env.get(name) || fallback;
}

function baseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function publicHealthUrl(publicName, portName, defaultPort) {
  return env(
    publicName,
    baseUrl(env(portName, defaultPort)),
  );
}

async function expectJsonHealth(label, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} health check failed with ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  console.log(`${label}: ok`, body ?? {});
}

async function main() {
  loadEnvFile(Deno.env.get("TAKOS_LOCAL_ENV_FILE") || ".env.local");

  const paasApiUrl = env(
    "TAKOS_PAAS_API_PUBLIC_URL",
    baseUrl(env("TAKOS_PAAS_API_PORT", defaults.paasApiPort)),
  );
  const paasRouterUrl = env(
    "TAKOS_PAAS_ROUTER_PUBLIC_URL",
    baseUrl(env("TAKOS_PAAS_ROUTER_PORT", defaults.paasRouterPort)),
  );
  const paasRuntimeAgentUrl = env(
    "TAKOS_PAAS_RUNTIME_AGENT_PUBLIC_URL",
    baseUrl(
      env("TAKOS_PAAS_RUNTIME_AGENT_PORT", defaults.paasRuntimeAgentPort),
    ),
  );
  const paasLogWorkerUrl = env(
    "TAKOS_PAAS_LOG_WORKER_PUBLIC_URL",
    baseUrl(env("TAKOS_PAAS_LOG_WORKER_PORT", defaults.paasLogWorkerPort)),
  );
  const runtimeUrl = publicHealthUrl(
    "TAKOS_LOCAL_RUNTIME_PUBLIC_URL",
    "TAKOS_RUNTIME_PORT",
    defaults.runtimePort,
  );
  const executorUrl = publicHealthUrl(
    "TAKOS_LOCAL_EXECUTOR_PUBLIC_URL",
    "TAKOS_EXECUTOR_PORT",
    defaults.executorPort,
  );

  await expectJsonHealth("paas-api", `${paasApiUrl}/health`);
  await expectJsonHealth("paas-router", `${paasRouterUrl}/health`);
  await expectJsonHealth("paas-runtime-agent", `${paasRuntimeAgentUrl}/health`);
  await expectJsonHealth("paas-log-worker", `${paasLogWorkerUrl}/health`);
  await expectJsonHealth("runtime", `${runtimeUrl}/health`);
  await expectJsonHealth("executor", `${executorUrl}/health`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
