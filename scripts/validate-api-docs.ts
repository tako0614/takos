const apiDoc = await Deno.readTextFile(
  new URL('../docs/reference/api.md', import.meta.url),
);

const requiredText = [
  '## Current Boundary',
  'Takosumi Accounts',
  'Installation API',
  '`/api/public/v1/deployments`',
  '`/api/spaces/:spaceId/threads/search`',
  '`/api/threads/:threadId/runs`',
  '`/api/threads/:threadId/messages/search`',
  '`/api/threads/:threadId/shares/:shareId/revoke`',
  '`/api/runs/:id/events`',
  '`/api/runs/:id/replay`',
  '`/api/runs/:id/ws`',
  '`/api/runs/:id/artifacts`',
  '`/api/artifacts/:id`',
  '`/api/spaces/:spaceId/tools`',
  '`/api/spaces/:spaceId/tools/:toolName`',
  '`/api/explore/catalog`',
  '`/api/explore/repos/by-name/:username/:repoName`',
  '`/api/explore/packages/by-repo/:repoId/reviews`',
  '`/api/repositories/:repoId/commits/:commitSha`',
  '`/api/services/*`',
  '`/api/spaces/:spaceId/resources/*`',
  '`/api/spaces/:spaceId/app-installations`',
  '`/api/spaces/:spaceId/app-installations/git-url/dry-run`',
  '`/_takosumi/launch`',
  '`/git/:owner/:repo.git/info/refs`',
] as const;

const forbiddenText = [
  '`/api/public/v1/oauth',
  '`/oauth/authorize',
  '`/api/oauth',
  '`/api/billing',
  '`/api/internal/v1/billing',
  '`/api/publications',
  '`/api/deployments/plan',
  '`/api/spaces/:spaceId/groups/deployments',
  '`/api/spaces/:spaceId/apps',
  '`/api/me/personal-access-tokens',
  'group-deployment',
  'group_deployment',
  `takos-${'paas'}`,
  'apps/paas',
] as const;

const errors: string[] = [];

for (const text of requiredText) {
  if (!apiDoc.includes(text)) {
    errors.push(`missing required API docs text: ${text}`);
  }
}

for (const text of forbiddenText) {
  if (apiDoc.includes(text)) {
    errors.push(`forbidden retired API docs text: ${text}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  Deno.exit(1);
}

console.log(`Validated Takos API docs (${requiredText.length} required current markers).`);
