import fs from "node:fs";

// ホスト側のデフォルトポートは DEFAULT_LOCAL_PORTS と一致している必要がある
// （packages/control/src/local-platform/runtime-types.ts を参照）
const defaults = {
  controlWebPort: "8787",
  controlDispatchPort: "8788",
  runtimeHostPort: "8789",
  executorHostPort: "8790",
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

  const controlWebUrl = env(
    "TAKOS_LOCAL_WEB_PUBLIC_URL",
    baseUrl(env("TAKOS_CONTROL_WEB_PORT", defaults.controlWebPort)),
  );
  const controlDispatchUrl = env(
    "TAKOS_LOCAL_DISPATCH_PUBLIC_URL",
    baseUrl(env("TAKOS_CONTROL_DISPATCH_PORT", defaults.controlDispatchPort)),
  );
  const runtimeHostUrl = env(
    "TAKOS_LOCAL_RUNTIME_HOST_PUBLIC_URL",
    baseUrl(env("TAKOS_RUNTIME_HOST_PORT", defaults.runtimeHostPort)),
  );
  const executorHostUrl = env(
    "TAKOS_LOCAL_EXECUTOR_HOST_PUBLIC_URL",
    baseUrl(env("TAKOS_EXECUTOR_HOST_PORT", defaults.executorHostPort)),
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

  await expectJsonHealth("control-web", `${controlWebUrl}/health`);
  await expectJsonHealth("control-dispatch", `${controlDispatchUrl}/health`);
  await expectJsonHealth("runtime-host", `${runtimeHostUrl}/health`);
  await expectJsonHealth("executor-host", `${executorHostUrl}/health`);
  await expectJsonHealth("runtime", `${runtimeUrl}/health`);
  await expectJsonHealth("executor", `${executorUrl}/health`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
