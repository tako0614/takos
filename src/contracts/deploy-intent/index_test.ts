import { test } from "bun:test";
import { deepStrictEqual, rejects as assertRejects, throws as assertThrows } from 'node:assert/strict';
import {
  type GitRunner,
  parseDeployIntentEnv,
  writeDeployIntent,
} from "./index.ts";

test("parseDeployIntentEnv reads gitops binding env", () => {
  const config = parseDeployIntentEnv({
    DEPLOY_INTENT_DRIVER: "gitops",
    DEPLOY_INTENT_REMOTE: "https://git.example.test/inst/deploy.git",
    DEPLOY_INTENT_TOKEN: "secret-token",
    DEPLOY_INTENT_BRANCH: "deploy",
    DEPLOY_INTENT_WRITE_PATH_PREFIX: "apps/takos",
    DEPLOY_INTENT_AUTHOR_NAME: "Takos Bot",
    DEPLOY_INTENT_AUTHOR_EMAIL: "bot@example.test",
  });

  deepStrictEqual(config, {
    driver: "gitops",
    remote: "https://git.example.test/inst/deploy.git",
    token: "secret-token",
    branch: "deploy",
    writePathPrefix: "apps/takos",
    authorName: "Takos Bot",
    authorEmail: "bot@example.test",
  });
});

test("parseDeployIntentEnv returns undefined when disabled", () => {
  deepStrictEqual(parseDeployIntentEnv({}), undefined);
});

test("parseDeployIntentEnv defaults to deployments prefix", () => {
  const config = parseDeployIntentEnv({
    DEPLOY_INTENT_DRIVER: "gitops",
    DEPLOY_INTENT_REMOTE: "https://git.example.test/inst/deploy.git",
    DEPLOY_INTENT_TOKEN: "secret-token",
  });

  deepStrictEqual(config?.writePathPrefix, "deployments");
});

test("writeDeployIntent commits and pushes a deploy intent document", async () => {
  const writes: Record<string, string> = {};
  const commands: {
    cwd: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }[] = [];
  const git: GitRunner = (args, cwd, options) => {
    commands.push({ cwd, args, env: options?.env });
    if (args.join(" ") === "rev-parse HEAD") {
      return Promise.resolve({
        code: 0,
        stdout: "abc123\n",
      });
    }
    return Promise.resolve({ code: 0, stdout: "" });
  };

  const result = await writeDeployIntent({
    config: {
      driver: "gitops",
      remote: "https://git.example.test/inst/deploy.git",
      token: "secret-token",
      branch: "main",
      writePathPrefix: "deploy-intents",
      authorName: "Takos Bot",
      authorEmail: "bot@example.test",
    },
    worktree: "/tmp/worktree",
    git,
    mkdir: () => Promise.resolve(),
    writeTextFile: (path, data) => {
      writes[path] = data;
      return Promise.resolve();
    },
  }, {
    id: "intent-1",
    mode: "plan",
    message: "Deploy intent intent-1",
    metadata: { spaceId: "space_1" },
    appSpec: {
      apiVersion: "v1",
      metadata: { id: "example.gateway", name: "Example Gateway" },
      components: {},
    },
  });

  deepStrictEqual(result, {
    driver: "gitops",
    remote: "https://git.example.test/inst/deploy.git",
    branch: "main",
    path: "deploy-intents/intent-1.json",
    commit: "abc123",
  });
  deepStrictEqual(
    JSON.parse(writes["/tmp/worktree/deploy-intents/intent-1.json"]),
    {
      kind: "takos.deploy-intent@v1",
      id: "intent-1",
      mode: "plan",
      metadata: { spaceId: "space_1" },
      appSpec: {
        apiVersion: "v1",
        metadata: { id: "example.gateway", name: "Example Gateway" },
        components: {},
      },
    },
  );
  deepStrictEqual(commands.map((command) => command.args), [
    ["config", "user.name", "Takos Bot"],
    ["config", "user.email", "bot@example.test"],
    ["add", "deploy-intents/intent-1.json"],
    ["commit", "-m", "Deploy intent intent-1"],
    ["rev-parse", "HEAD"],
    ["push", "origin", "main"],
  ]);
  // The deploy credential must never appear in argv (leaks via /proc & ps);
  // it is delivered to the push only through GIT_CONFIG_* env vars.
  const pushCommand = commands.find((command) => command.args[0] === "push");
  deepStrictEqual(pushCommand?.env, {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: "Authorization: Bearer secret-token",
  });
  for (const command of commands) {
    for (const arg of command.args) {
      if (arg.includes("secret-token")) {
        throw new Error(`token leaked into argv: ${command.args.join(" ")}`);
      }
    }
  }
});

test("writeDeployIntent clones temporary worktree when not provided", async () => {
  const commands: {
    cwd: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }[] = [];
  const removed: string[] = [];
  await writeDeployIntent({
    config: {
      driver: "gitops",
      remote: "https://git.example.test/inst/deploy.git",
      token: "secret-token",
      branch: "main",
      writePathPrefix: "deploy-intents",
    },
    makeTempDir: () => Promise.resolve("/tmp/generated-worktree"),
    mkdir: () => Promise.resolve(),
    writeTextFile: () => Promise.resolve(),
    remove: (path) => {
      removed.push(path);
      return Promise.resolve();
    },
    git: (args, cwd, options) => {
      commands.push({ cwd, args, env: options?.env });
      if (args.join(" ") === "rev-parse HEAD") {
        return Promise.resolve({ code: 0, stdout: "def456\n" });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  }, {
    id: "intent-2",
    appSpec: {
      apiVersion: "v1",
      metadata: { id: "example.gateway", name: "Example Gateway" },
      components: {},
    },
  });

  // Clone args carry no credential; the token rides in GIT_CONFIG_* env only.
  deepStrictEqual(commands[0], {
    cwd: ".",
    args: [
      "clone",
      "--branch",
      "main",
      "https://git.example.test/inst/deploy.git",
      "/tmp/generated-worktree",
    ],
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: "Authorization: Bearer secret-token",
    },
  });
  deepStrictEqual(removed, ["/tmp/generated-worktree"]);
});

test("writeDeployIntent rejects unsafe intent ids and prefixes", async () => {
  await assertRejects(
    () =>
      writeDeployIntent({
        config: {
          driver: "gitops",
          remote: "https://git.example.test/inst/deploy.git",
          token: "secret-token",
          branch: "main",
          writePathPrefix: "deploy-intents",
        },
        worktree: "/tmp/worktree",
      }, {
        id: "../escape",
        appSpec: {},
      }),
    Error,
    "deploy intent id",
  );
  assertThrows(
    () =>
      parseDeployIntentEnv({
        DEPLOY_INTENT_DRIVER: "gitops",
        DEPLOY_INTENT_REMOTE: "https://git.example.test/inst/deploy.git",
        DEPLOY_INTENT_TOKEN: "secret-token",
        DEPLOY_INTENT_WRITE_PATH_PREFIX: "../escape",
      }),
    Error,
    "WRITE_PATH_PREFIX",
  );
});
