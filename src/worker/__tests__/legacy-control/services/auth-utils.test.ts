import {
  hashPassword,
  PASSWORD_PBKDF2_ITERATIONS,
  verifyPassword,
} from "../../../application/services/identity/auth-utils.ts";

import { assert, assertEquals } from "@std/assert";

Deno.test("password hashing - uses the configured PBKDF2 iteration count and verifies round-trip", async () => {
  assertEquals(PASSWORD_PBKDF2_ITERATIONS, 100000);

  const hash = await hashPassword("correct horse battery staple");

  assert(/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash));
  await assertEquals(
    await verifyPassword("correct horse battery staple", hash),
    true,
  );
  await assertEquals(await verifyPassword("wrong password", hash), false);
});
