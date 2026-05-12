const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

const servicePorts = [
  { label: 'takos-app', env: 'TAKOS_APP_PORT', defaultPort: 8787 },
  { label: 'takosumi', env: 'TAKOSUMI_PORT', defaultPort: 8788 },
  { label: 'takos-agent', env: 'TAKOS_AGENT_PORT', defaultPort: 8789 },
  { label: 'takos-git', env: 'TAKOS_GIT_PORT', defaultPort: 8790 },
  { label: 'postgres', env: 'TAKOS_POSTGRES_PORT', defaultPort: 15432 },
  { label: 'redis', env: 'TAKOS_REDIS_PORT', defaultPort: 16379 },
];

function env(name, fallback) {
  return Deno.env.get(name) || fallback;
}

function numberEnv(name, fallback) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findAvailablePort(usedPorts) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
    const port = listener.addr.port;
    listener.close();
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error('unable to allocate an available localhost port');
}

async function selectPorts() {
  const useDefaultPorts = Deno.env.get('TAKOS_LOCAL_E2E_USE_DEFAULT_PORTS') ===
    '1';
  const usedPorts = new Set();
  const selected = {};
  for (const service of servicePorts) {
    const configured = Deno.env.get(service.env);
    if (configured) {
      selected[service.env] = configured;
      usedPorts.add(Number(configured));
      continue;
    }
    selected[service.env] = String(
      useDefaultPorts ? service.defaultPort : await findAvailablePort(usedPorts),
    );
  }
  return selected;
}

function composeBaseArgs(project, envFile) {
  return [
    'compose',
    '--env-file',
    envFile,
    '-p',
    project,
    '-f',
    'compose.local.yml',
  ];
}

async function runCommand(commandName, args, options = {}) {
  const {
    check = true,
    env = {},
    timeoutMs = numberEnv('TAKOS_LOCAL_E2E_COMMAND_TIMEOUT_MS', 5 * 60 * 1000),
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const command = new Deno.Command(commandName, {
    args,
    env,
    stdout: 'piped',
    stderr: 'piped',
    signal: controller.signal,
  });
  try {
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (check && output.code !== 0) {
      throw new Error(
        `${commandName} ${args.join(' ')} failed with ${output.code}\n${stdout}${stderr}`,
      );
    }
    return { code: output.code, stdout, stderr };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `${commandName} ${args.join(' ')} timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runDocker(args, options = {}) {
  return await runCommand('docker', args, options);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(ports) {
  const timeoutMs = numberEnv('TAKOS_LOCAL_E2E_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = numberEnv(
    'TAKOS_LOCAL_E2E_POLL_INTERVAL_MS',
    DEFAULT_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + timeoutMs;
  const healthChecks = [
    { label: 'takos-app', url: `http://127.0.0.1:${ports.TAKOS_APP_PORT}/health` },
    { label: 'takosumi', url: `http://127.0.0.1:${ports.TAKOSUMI_PORT}/health` },
    { label: 'takos-agent', url: `http://127.0.0.1:${ports.TAKOS_AGENT_PORT}/health` },
    { label: 'takos-git', url: `http://127.0.0.1:${ports.TAKOS_GIT_PORT}/health` },
  ];
  const pending = new Map(healthChecks.map((check) => [check.label, check]));
  const lastErrors = new Map();

  while (pending.size > 0 && Date.now() < deadline) {
    for (const [label, check] of [...pending]) {
      try {
        const response = await fetchWithTimeout(check.url);
        const bodyText = await response.text();
        if (!response.ok) {
          lastErrors.set(label, `${response.status} ${bodyText}`);
          continue;
        }
        JSON.parse(bodyText);
        pending.delete(label);
        console.log(`[local-e2e] ${label} health ok`);
      } catch (error) {
        lastErrors.set(label, error instanceof Error ? error.message : String(error));
      }
    }
    if (pending.size > 0) await delay(pollIntervalMs);
  }

  if (pending.size > 0) {
    const details = [...pending.keys()]
      .map((label) => `${label}: ${lastErrors.get(label) ?? 'not ready'}`)
      .join('\n');
    throw new Error(`compose services did not become healthy:\n${details}`);
  }
}

async function expectJson(label, url, options, validate) {
  const response = await fetchWithTimeout(url, options, 5000);
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(`${label} returned non-JSON body (${response.status}): ${bodyText}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${bodyText}`);
  }
  validate(body);
  console.log(`[local-e2e] ${label} ok`);
}

async function runGatewayChecks(ports, secret) {
  await expectJson(
    'takos-app -> takosumi spaces list',
    `http://127.0.0.1:${ports.TAKOS_APP_PORT}/api/spaces`,
    {
      headers: {
        'x-takos-internal-secret': secret,
        'x-takos-account-id': 'acct_local_e2e',
      },
    },
    (body) => {
      if (!body || !Array.isArray(body.spaces)) {
        throw new Error('expected spaces array');
      }
    },
  );
}

async function seedGitRepository(hostRoot) {
  await runCommand('bash', ['git/scripts/seed-dev-git.sh', 'local/demo'], {
    env: {
      TAKOS_GIT_REPOSITORY_ROOT: hostRoot,
      TAKOS_GIT_OWNER_SPACE_ID: 'local',
      TAKOS_GIT_SEED_FORCE: '1',
    },
    timeoutMs: 120_000,
  });
  console.log('[local-e2e] seeded takos-git repository local/demo');
}

async function makeTreeWritableForContainer(path) {
  await Deno.chmod(path, 0o777);
  for await (const entry of Deno.readDir(path)) {
    const entryPath = `${path}/${entry.name}`;
    if (entry.isDirectory) {
      await makeTreeWritableForContainer(entryPath);
    } else if (!entry.isSymlink) {
      await Deno.chmod(entryPath, 0o666);
    }
  }
}

async function runGitCloneCheck(ports, secret) {
  const cloneDir = await Deno.makeTempDir({ prefix: 'takos-git-clone-' });
  const remoteUrl = `http://127.0.0.1:${ports.TAKOS_APP_PORT}/local/demo.git`;
  try {
    await runCommand('git', [
      '-c',
      `http.extraHeader=x-takos-internal-secret: ${secret}`,
      '-c',
      'http.extraHeader=x-takos-account-id: acct_local_e2e',
      'clone',
      remoteUrl,
      cloneDir,
    ], { timeoutMs: 120_000 });
    const readme = await Deno.readTextFile(`${cloneDir}/README.md`);
    if (!readme.includes('Seed repository for local takos-git verification.')) {
      throw new Error('cloned repository README did not match seed content');
    }
    console.log('[local-e2e] git clone through apps/api Smart HTTP ok');
  } finally {
    await Deno.remove(cloneDir, { recursive: true });
  }
}

async function printDiagnostics(composeArgs, commandEnv) {
  const ps = await runDocker([...composeArgs, 'ps'], {
    check: false,
    env: commandEnv,
    timeoutMs: 60_000,
  });
  if (ps.stdout.trim()) console.error(ps.stdout.trim());
  if (ps.stderr.trim()) console.error(ps.stderr.trim());

  const logs = await runDocker([...composeArgs, 'logs', '--no-color', '--tail', '160'], {
    check: false,
    env: commandEnv,
    timeoutMs: 120_000,
  });
  if (logs.stdout.trim()) console.error(logs.stdout.trim());
  if (logs.stderr.trim()) console.error(logs.stderr.trim());
}

async function main() {
  const project = env(
    'TAKOS_LOCAL_E2E_PROJECT',
    `takos-e2e-${Date.now()}-${Deno.pid}`,
  );
  const envFile = env('TAKOS_LOCAL_ENV_FILE', '.env.local.example');
  const gitRepositoryHostRoot = await Deno.makeTempDir({
    prefix: 'takos-git-repositories-',
  });
  const ports = await selectPorts();
  const secret = env('TAKOS_INTERNAL_SERVICE_SECRET', 'local-dev-secret');
  const commandEnv = {
    ...ports,
    TAKOS_APP_URL: `http://localhost:${ports.TAKOS_APP_PORT}`,
    TAKOS_INTERNAL_SERVICE_SECRET: secret,
    TAKOS_INTERNAL_API_SECRET: env('TAKOS_INTERNAL_API_SECRET', secret),
    TAKOSUMI_INTERNAL_API_SECRET: env('TAKOSUMI_INTERNAL_API_SECRET', secret),
    TAKOS_ALLOW_NO_LLM: env('TAKOS_ALLOW_NO_LLM', '1'),
    TAKOS_GIT_REPOSITORY_HOST_ROOT: gitRepositoryHostRoot,
  };
  const composeArgs = composeBaseArgs(project, envFile);
  const keepStack = Deno.env.get('TAKOS_LOCAL_E2E_KEEP_STACK') === '1';
  let started = false;

  console.log(`[local-e2e] project=${project}`);
  console.log(`[local-e2e] gitRepositoryHostRoot=${gitRepositoryHostRoot}`);
  console.log(
    `[local-e2e] ports app=${ports.TAKOS_APP_PORT} takosumi=${ports.TAKOSUMI_PORT} agent=${ports.TAKOS_AGENT_PORT} git=${ports.TAKOS_GIT_PORT}`,
  );

  try {
    await seedGitRepository(gitRepositoryHostRoot);
    await makeTreeWritableForContainer(gitRepositoryHostRoot);

    const config = await runDocker([...composeArgs, 'config', '--services'], {
      env: commandEnv,
      timeoutMs: 120_000,
    });
    const services = config.stdout.trim().split(/\s+/).filter(Boolean).sort();
    const expectedServices = [
      'postgres',
      'postgres-init',
      'redis',
      'takos-agent',
      'takos-app',
      'takos-git',
      'takosumi',
    ];
    for (const expected of expectedServices) {
      if (!services.includes(expected)) {
        throw new Error(`compose config is missing service ${expected}`);
      }
    }
    console.log(`[local-e2e] compose config ok (${services.join(', ')})`);

    await runDocker([...composeArgs, 'up', '--build', '-d'], {
      env: commandEnv,
      timeoutMs: numberEnv('TAKOS_LOCAL_E2E_UP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    });
    started = true;
    console.log('[local-e2e] compose stack started');

    await waitForHealth(ports);
    await runGatewayChecks(ports, commandEnv.TAKOS_INTERNAL_API_SECRET);
    await runGitCloneCheck(ports, commandEnv.TAKOS_INTERNAL_API_SECRET);
    console.log('[local-e2e] completed');
  } catch (error) {
    console.error(`[local-e2e] failed: ${error instanceof Error ? error.message : String(error)}`);
    await printDiagnostics(composeArgs, commandEnv).catch((diagnosticError) => {
      console.error(
        `[local-e2e] failed to collect diagnostics: ${
          diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
        }`,
      );
    });
    throw error;
  } finally {
    if (started && !keepStack) {
      await runDocker(
        [...composeArgs, 'down', '--volumes', '--remove-orphans', '--timeout', '10'],
        { check: false, env: commandEnv, timeoutMs: 120_000 },
      );
      console.log('[local-e2e] compose stack cleaned up');
      await Deno.remove(gitRepositoryHostRoot, { recursive: true });
      console.log('[local-e2e] git repository seed cleaned up');
    } else if (started) {
      console.log('[local-e2e] keeping compose stack for inspection');
      console.log(
        `[local-e2e] keeping git repository seed at ${gitRepositoryHostRoot}`,
      );
    } else {
      await Deno.remove(gitRepositoryHostRoot, { recursive: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
