import { assertEquals, assertRejects } from "jsr:@std/assert";

import { encrypt } from "../../../../../packages/control/src/shared/utils/crypto.ts";
import {
  collectReferencedSecretNamesFromEnv,
  resolveSecretValues,
} from "@/queues/workflow-secrets";

type SecretRow = {
  id: string;
  name: string;
  encryptedValue: string;
};

function createFakeD1(secretRows: SecretRow[] = []) {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            raw: async () =>
              secretRows.map((row) => [
                row.id,
                row.name,
                row.encryptedValue,
              ]),
            first: async () => null,
            all: async () => ({ results: secretRows }),
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      };
    },
  };
}

async function createSecretRow(
  id: string,
  name: string,
  value: string,
  encryptionKey: string,
  repoId = "repo-1",
): Promise<SecretRow> {
  const encrypted = await encrypt(
    value,
    encryptionKey,
    `secret:${repoId}:${name}`,
  );

  return {
    id,
    name,
    encryptedValue: JSON.stringify(encrypted),
  };
}

Deno.test("collectReferencedSecretNamesFromEnv - extracts, deduplicates, and sorts names", () => {
  const env = {
    TOKEN: "${{ secrets.API_TOKEN }}",
    COMBINED: "${{ secrets.USER }}:${{ secrets.PASS }}",
    DUPLICATE: "${{ secrets.API_TOKEN }}",
    STATIC: "true",
  };

  assertEquals(collectReferencedSecretNamesFromEnv(env), [
    "API_TOKEN",
    "PASS",
    "USER",
  ]);
});

Deno.test("collectReferencedSecretNamesFromEnv - supports spacing and numeric suffixes", () => {
  assertEquals(
    collectReferencedSecretNamesFromEnv({
      TOKEN: "${{  secrets.API_KEY_V2  }}",
    }),
    ["API_KEY_V2"],
  );
});

Deno.test("resolveSecretValues - returns empty object when no encryption key is provided", async () => {
  assertEquals(
    await resolveSecretValues(
      createFakeD1() as never,
      "repo-1",
      ["s1"],
      undefined,
      [],
    ),
    {},
  );
});

Deno.test("resolveSecretValues - throws when required secrets need an encryption key", async () => {
  await assertRejects(
    () =>
      resolveSecretValues(
        createFakeD1() as never,
        "repo-1",
        ["s1"],
        undefined,
        ["SECRET_A"],
      ),
    Error,
    "Encryption key is required",
  );
});

Deno.test("resolveSecretValues - returns empty object when there are no secret IDs", async () => {
  assertEquals(
    await resolveSecretValues(
      createFakeD1() as never,
      "repo-1",
      [],
      "enc-key",
      [],
    ),
    {},
  );
});

Deno.test("resolveSecretValues - throws when required secrets are missing from the ID list", async () => {
  await assertRejects(
    () =>
      resolveSecretValues(
        createFakeD1() as never,
        "repo-1",
        [],
        "enc-key",
        ["MISSING_SECRET"],
      ),
    Error,
    "Missing referenced secrets: MISSING_SECRET",
  );
});

Deno.test("resolveSecretValues - decrypts database records with the matching salt", async () => {
  const encryptionKey = "enc-key";
  const db = createFakeD1([
    await createSecretRow("s1", "API_TOKEN", "token-value", encryptionKey),
    await createSecretRow("s2", "DB_PASS", "password-value", encryptionKey),
  ]);

  const result = await resolveSecretValues(
    db as never,
    "repo-1",
    ["s1", "s2"],
    encryptionKey,
  );

  assertEquals(result, {
    API_TOKEN: "token-value",
    DB_PASS: "password-value",
  });
});

Deno.test("resolveSecretValues - skips secrets that fail to decrypt", async () => {
  const encryptionKey = "enc-key";
  const db = createFakeD1([
    await createSecretRow("s1", "GOOD", "good-value", encryptionKey),
    {
      id: "s2",
      name: "BAD",
      encryptedValue: '{"not":"valid-encrypted-data"}',
    },
  ]);

  const result = await resolveSecretValues(
    db as never,
    "repo-1",
    ["s1", "s2"],
    encryptionKey,
  );

  assertEquals(result, { GOOD: "good-value" });
});

Deno.test("resolveSecretValues - throws when required secrets are still missing after resolution", async () => {
  const encryptionKey = "enc-key";
  const db = createFakeD1([
    await createSecretRow("s1", "FOUND", "value", encryptionKey),
  ]);

  await assertRejects(
    () =>
      resolveSecretValues(
        db as never,
        "repo-1",
        ["s1"],
        encryptionKey,
        ["FOUND", "MISSING"],
      ),
    Error,
    "Missing referenced secrets: MISSING",
  );
});

Deno.test("resolveSecretValues - ignores invalid encrypted JSON payloads", async () => {
  const result = await resolveSecretValues(
    createFakeD1([
      {
        id: "s1",
        name: "BROKEN",
        encryptedValue: "not-json",
      },
    ]) as never,
    "repo-1",
    ["s1"],
    "enc-key",
  );

  assertEquals(result, {});
});
