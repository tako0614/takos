import { test } from "bun:test";
import { assertEquals, assertRejects } from "@takos/test/assert";
import { readFile } from "node:fs/promises";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { encrypt } from "../../../shared/utils/crypto.ts";
import { resolveSecretValues } from "../workflow-secrets.ts";

/**
 * Guards the least-privilege secret-resolution contract: only the secrets a job
 * references by NAME reach the user-code container, never every secret in the
 * repo. A regression to id-based / whole-repo resolution would forward
 * unreferenced repo secrets into untrusted workflow code.
 */

type SecretRow = { id: string; name: string; encryptedValue: string };

// Minimal drizzle-like binding whose `.where(...).all()` applies the same
// name-filter the real query does (inArray(name, referenced)). Seeding it with
// an unreferenced row lets us assert that row never surfaces in the output.
function dbWithSecrets(
  allSecrets: SecretRow[],
  referenced: string[],
): SqlDatabaseBinding {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                all: async () =>
                  allSecrets.filter((s) => referenced.includes(s.name)),
                get: async () => null,
              };
            },
          };
        },
      };
    },
    insert() {
      return { values: () => ({ run: async () => ({}) }) };
    },
    update() {
      return { set: () => ({ where: async () => ({}) }) };
    },
    delete() {
      return { where: async () => ({}) };
    },
  };
  return db as unknown as SqlDatabaseBinding;
}

const REPO_ID = "repo_secrets_test";
const KEY = "master-secret-key-for-tests";

async function seedSecret(name: string, value: string): Promise<SecretRow> {
  const encrypted = await encrypt(value, KEY, `secret:${REPO_ID}:${name}`);
  return { id: `id_${name}`, name, encryptedValue: JSON.stringify(encrypted) };
}

test("resolveSecretValues returns ONLY referenced secrets, never an unreferenced repo secret", async () => {
  const referenced = ["DEPLOY_TOKEN"];
  const allSecrets = [
    await seedSecret("DEPLOY_TOKEN", "deploy-token-value"),
    await seedSecret("UNREFERENCED_REPO_SECRET", "must-not-leak"),
  ];

  const resolved = await resolveSecretValues(
    dbWithSecrets(allSecrets, referenced),
    REPO_ID,
    referenced,
    KEY,
  );

  assertEquals(resolved, { DEPLOY_TOKEN: "deploy-token-value" });
});

test("resolveSecretValues throws when a required referenced secret is absent", async () => {
  const referenced = ["DEPLOY_TOKEN", "MISSING_SECRET"];
  const allSecrets = [await seedSecret("DEPLOY_TOKEN", "deploy-token-value")];

  await assertRejects(
    () =>
      resolveSecretValues(
        dbWithSecrets(allSecrets, referenced),
        REPO_ID,
        referenced,
        KEY,
        ["MISSING_SECRET"],
      ),
    Error,
    "Missing referenced secrets: MISSING_SECRET",
  );
});

test("resolveSecretValues requires an encryption key when secrets are referenced", async () => {
  await assertRejects(
    () => resolveSecretValues(dbWithSecrets([], []), REPO_ID, ["X"], undefined),
    Error,
    "Encryption key is required",
  );
});

test("resolveSecretValues with no referenced names returns {} but still enforces required", async () => {
  assertEquals(
    await resolveSecretValues(dbWithSecrets([], []), REPO_ID, [], KEY),
    {},
  );
  await assertRejects(
    () => resolveSecretValues(dbWithSecrets([], []), REPO_ID, [], KEY, ["NEED"]),
    Error,
    "Missing referenced secrets: NEED",
  );
});

test("resolveSecretValues source filters by secret NAME, not id (no whole-repo regression)", async () => {
  const source = await readFile(
    new URL("../workflow-secrets.ts", import.meta.url),
    "utf8",
  );
  // The query must scope to the referenced names.
  if (!source.includes("inArray(workflowSecrets.name")) {
    throw new Error("resolveSecretValues must filter by workflowSecrets.name");
  }
  // Regressing to id-based / unscoped fetch would re-leak unreferenced secrets.
  if (source.includes("inArray(workflowSecrets.id")) {
    throw new Error(
      "resolveSecretValues must NOT resolve secrets by id (whole-repo leak risk)",
    );
  }
});
