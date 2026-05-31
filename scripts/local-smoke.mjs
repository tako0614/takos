import fs from 'node:fs';

// Host-side defaults mirror .env.local.example for local process smoke checks.
const defaults = {
  takosWorkerPort: '8787',
  takosumiPort: '8788',
  takosAgentPort: '8789',
  takosGitPort: '8790',
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

async function expectJsonHealth(label, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} health check failed with ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  console.log(`${label}: ok`, body ?? {});
}

async function main() {
  loadEnvFile(Deno.env.get('TAKOS_LOCAL_ENV_FILE') || '.env.local');

  const takosWorkerUrl = env(
    'TAKOS_WORKER_PUBLIC_URL',
    baseUrl(env('TAKOS_WORKER_PORT', defaults.takosWorkerPort)),
  );
  const takosumiUrl = env(
    'TAKOSUMI_PUBLIC_URL',
    baseUrl(env('TAKOSUMI_PORT', defaults.takosumiPort)),
  );
  const takosAgentUrl = env(
    'TAKOS_AGENT_PUBLIC_URL',
    baseUrl(env('TAKOS_AGENT_PORT', defaults.takosAgentPort)),
  );
  const takosGitUrl = env(
    'TAKOS_GIT_PUBLIC_URL',
    baseUrl(env('TAKOS_GIT_PORT', defaults.takosGitPort)),
  );

  await expectJsonHealth('takos-worker', `${takosWorkerUrl}/health`);
  await expectJsonHealth('takosumi', `${takosumiUrl}/health`);
  await expectJsonHealth('takos-agent', `${takosAgentUrl}/health`);
  await expectJsonHealth('takos-git', `${takosGitUrl}/health`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
