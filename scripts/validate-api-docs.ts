import * as runtime from "./runtime.ts";
const apiDoc = await runtime.readTextFile(
  new URL("../docs/reference/api.md", import.meta.url),
);

const requiredText = [
  "## Current Boundary",
  "Takosumi Accounts",
  "## Capsule API",
  "`/api/spaces/:spaceId/threads/search`",
  "`/api/threads/:threadId/runs`",
  "`/api/threads/:threadId/messages/search`",
  "`/api/threads/:threadId/shares/:shareId/revoke`",
  "`/api/runs/:id/events`",
  "`/api/runs/:id/replay`",
  "`/api/runs/:id/ws`",
  "`/api/runs/:id/artifacts`",
  "`/api/artifacts/:id`",
  "`/api/spaces/:spaceId/tools`",
  "`/api/spaces/:spaceId/tools/:toolName`",
  "`/api/explore/catalog`",
  "`/api/explore/repos/by-name/:username/:repoName`",
  "`/api/explore/packages/by-repo/:repoId/reviews`",
  "`/api/spaces/:spaceId/capsules`",
  "`/api/spaces/:spaceId/capsules/:capsuleId/services`",
  "`/api/spaces/:spaceId/capsules/git-url/plan`",
  "`/api/spaces/:spaceId/capsules/git-url/apply`",
  "`/_takosumi/launch`",
  "`/git/:owner/:repo.git/info/refs`",
] as const;

const forbiddenText = [
  "`/api/public/v1/oauth",
  "`/api/public/v1/deployments`",
  "`/oauth/authorize",
  "`/api/oauth",
  "`/api/billing",
  "`/api/internal/v1/billing",
  "`/api/publications",
  "`/api/deployments/plan",
  "`/api/services/*`",
  "`/api/spaces/:spaceId/services`",
  "`/api/resources/*`",
  "`/api/spaces/:spaceId/resources/*`",
  "`/api/spaces/:spaceId/app-installations`",
  "`/api/repositories/:repoId/commits/:commitSha`",
  "`/api/spaces/:spaceId/repos`",
  "`/api/spaces/:spaceId/groups/deployments",
  "`/api/spaces/:spaceId/apps",
  "`/api/me/personal-access-tokens",
  "group-deployment",
  "group_deployment",
  `takos-${"paas"}`,
  "apps/paas",
  "Installation API",
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
  console.error(errors.join("\n"));
  runtime.exit(1);
}

console.log(
  `Validated Takos API docs (${requiredText.length} required current markers).`,
);
