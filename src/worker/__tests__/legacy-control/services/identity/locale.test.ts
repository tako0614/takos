import type { Database } from "@/db";

import { assertEquals } from "@std/assert";

import { getSpaceLocale, localeDeps } from "@/services/identity/locale";
import { asTestDatabase } from "@test/db-stubs";

function createFakeDb(row: { value?: unknown } | null): Database {
  // Only the `select().from().where().get()` chain is exercised; everything
  // else is bypassed because `localeDeps.getDb` is overridden to return the
  // fake directly.
  return asTestDatabase({
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => row,
              };
            },
          };
        },
      };
    },
  });
}

Deno.test("getSpaceLocale - returns ja when metadata row contains ja", async () => {
  const db = createFakeDb({ value: "ja" });
  localeDeps.getDb = () => db;
  assertEquals(await getSpaceLocale(db, "space-1"), "ja");
});

Deno.test("getSpaceLocale - returns en when metadata row contains en", async () => {
  const db = createFakeDb({ value: "en" });
  localeDeps.getDb = () => db;
  assertEquals(await getSpaceLocale(db, "space-1"), "en");
});

Deno.test("getSpaceLocale - returns null when no metadata row exists", async () => {
  const db = createFakeDb(null);
  localeDeps.getDb = () => db;
  assertEquals(await getSpaceLocale(db, "space-1"), null);
});

Deno.test("getSpaceLocale - returns null when metadata value is not a valid locale", async () => {
  const db = createFakeDb({ value: "fr" });
  localeDeps.getDb = () => db;
  assertEquals(await getSpaceLocale(db, "space-1"), null);
});

Deno.test("getSpaceLocale - returns null when metadata value is undefined", async () => {
  const db = createFakeDb({ value: undefined });
  localeDeps.getDb = () => db;
  assertEquals(await getSpaceLocale(db, "space-1"), null);
});

Deno.test("getSpaceLocale - returns null when metadata value is null", async () => {
  const db = createFakeDb({ value: null });
  localeDeps.getDb = () => db;
  assertEquals(await getSpaceLocale(db, "space-1"), null);
});
