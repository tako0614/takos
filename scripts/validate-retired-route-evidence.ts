#!/usr/bin/env -S bun --preload ./shims/deno-compat.ts

const retiredRouteTests = [
  'public v3 deployment create rejects unmanaged direct deploy when GitOps is configured',
  'public v3 deployment create rejects retired inline workflow deploys',
  'public v3 deployment follow-up routes are retired',
  'public v3 deployment list route is retired',
  'retired group deployment snapshot routes are not exposed by app API',
  'canonical group deployment mutation routes are retired',
  'retired deploy routes are not exposed by app API',
  'retired OAuth provider routes return 404 without proxying',
  'retired billing routes return 410 and are not proxied',
];

const retiredAffordancePattern =
  'group_deployment_snapshot_deploy_from_repo|group_deployment_snapshot\\.deploy_from_repo|deploy_from_repo';

const apiTestPath = 'src/routes/public/index_test.ts';
const apiTestText = await Deno.readTextFile(apiTestPath);
const missingTests = retiredRouteTests.filter((name) => !apiTestText.includes(`Deno.test("${name}"`));

if (missingTests.length > 0) {
  for (const name of missingTests) {
    console.error(`missing retired-route API evidence test: ${name}`);
  }
  Deno.exit(1);
}

await run('bun', [
  'test',
  apiTestPath,
]);

await assertNoGitGrepMatches('.', retiredAffordancePattern, [
  'src/routes/public',
  'src/worker',
  'packages',
]);
await assertNoGitGrepMatches('.', retiredAffordancePattern, ['containers/agent']);

console.log(
  `Retired-route removal evidence validated: src/routes/public route tests passed with ${retiredRouteTests.length} named retired-route evidence tests present and direct deploy affordance scan is clean.`,
);

async function run(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  const output = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  }).output();
  if (!output.success) {
    console.error(`${command} ${args.join(' ')} failed with exit code ${output.code}`);
    Deno.exit(output.code || 1);
  }
}

async function assertNoGitGrepMatches(
  repo: string,
  pattern: string,
  paths: readonly string[],
): Promise<void> {
  const output = await new Deno.Command('git', {
    args: ['-C', repo, 'grep', '-n', '-E', pattern, '--', ...paths],
    stdout: 'piped',
    stderr: 'piped',
  }).output();

  if (output.code === 1) return;

  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (stdout) console.error(stdout);
  if (stderr) console.error(stderr);
  console.error(`${repo}: retired direct deploy affordance pattern matched`);
  Deno.exit(output.code || 1);
}
