import fs from 'node:fs';

	// ホスト側のデフォルトポートは DEFAULT_LOCAL_PORTS と一致している必要がある
	// （packages/control/src/local-platform/runtime-types.ts を参照）
const defaults = {
  controlWebPort: '8787',
  controlDispatchPort: '8788',
  runtimeHostPort: '8789',
  executorHostPort: '8790',
  browserHostPort: '8791',
  runtimePort: '8081',
  executorPort: '8082',
  browserPort: '8083',
};

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function baseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

async function expectJsonHealth(label, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} health check failed with ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  console.log(`${label}: ok`, body ?? {});
}

async function runBrowserFlow(browserHostUrl) {
  const sessionId = `smoke-${Date.now()}`;
  const payload = {
    sessionId,
    spaceId: 'local-smoke-space',
    userId: 'local-smoke-user',
    viewport: { width: 1280, height: 720 },
  };

  const createResponse = await fetch(`${browserHostUrl}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!createResponse.ok) {
    throw new Error(`browser create failed with ${createResponse.status}: ${await createResponse.text()}`);
  }

  const stateResponse = await fetch(`${browserHostUrl}/session/${sessionId}`);
  if (!stateResponse.ok) {
    throw new Error(`browser session fetch failed with ${stateResponse.status}`);
  }
  const state = await stateResponse.json();

  const htmlResponse = await fetch(`${browserHostUrl}/session/${sessionId}/html`);
  if (!htmlResponse.ok) {
    throw new Error(`browser html failed with ${htmlResponse.status}`);
  }
  const html = await htmlResponse.json();

  const destroyResponse = await fetch(`${browserHostUrl}/session/${sessionId}`, {
    method: 'DELETE',
  });
  if (!destroyResponse.ok) {
    throw new Error(`browser destroy failed with ${destroyResponse.status}`);
  }

  console.log('browser-flow: ok', {
    sessionId,
    status: state.status,
    htmlKeys: html && typeof html === 'object' ? Object.keys(html) : [],
  });
}

async function main() {
  loadEnvFile(process.env.TAKOS_LOCAL_ENV_FILE || '.env.local');

  const controlWebUrl = env('TAKOS_LOCAL_WEB_PUBLIC_URL', baseUrl(env('TAKOS_CONTROL_WEB_PORT', defaults.controlWebPort)));
  const controlDispatchUrl = env('TAKOS_LOCAL_DISPATCH_PUBLIC_URL', baseUrl(env('TAKOS_CONTROL_DISPATCH_PORT', defaults.controlDispatchPort)));
  const runtimeHostUrl = env('TAKOS_LOCAL_RUNTIME_HOST_PUBLIC_URL', baseUrl(env('TAKOS_RUNTIME_HOST_PORT', defaults.runtimeHostPort)));
  const executorHostUrl = env('TAKOS_LOCAL_EXECUTOR_HOST_PUBLIC_URL', baseUrl(env('TAKOS_EXECUTOR_HOST_PORT', defaults.executorHostPort)));
  const browserHostUrl = env('TAKOS_LOCAL_BROWSER_HOST_PUBLIC_URL', baseUrl(env('TAKOS_BROWSER_HOST_PORT', defaults.browserHostPort)));
  const runtimeUrl = env('TAKOS_LOCAL_RUNTIME_PUBLIC_URL', baseUrl(env('TAKOS_RUNTIME_PORT', defaults.runtimePort)));
  const executorUrl = env('TAKOS_LOCAL_EXECUTOR_PUBLIC_URL', baseUrl(env('TAKOS_EXECUTOR_PORT', defaults.executorPort)));
  const browserUrl = env('TAKOS_LOCAL_BROWSER_PUBLIC_URL', baseUrl(env('TAKOS_BROWSER_PORT', defaults.browserPort)));

  await expectJsonHealth('control-web', `${controlWebUrl}/health`);
  await expectJsonHealth('control-dispatch', `${controlDispatchUrl}/health`);
  await expectJsonHealth('runtime-host', `${runtimeHostUrl}/health`);
  await expectJsonHealth('executor-host', `${executorHostUrl}/health`);
  await expectJsonHealth('browser-host', `${browserHostUrl}/health`);
  await expectJsonHealth('runtime', `${runtimeUrl}/health`);
  await expectJsonHealth('executor', `${executorUrl}/health`);
  await expectJsonHealth('browser', `${browserUrl}/internal/healthz`);

  await runBrowserFlow(browserHostUrl);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
