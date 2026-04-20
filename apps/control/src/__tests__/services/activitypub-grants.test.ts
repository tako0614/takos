import { assertEquals } from "jsr:@std/assert";
import { grantCapabilitiesFor } from "@/application/services/activitypub/grants.ts";

Deno.test("activitypub grants - higher capabilities imply lower capabilities", () => {
  assertEquals(grantCapabilitiesFor("visit"), [
    "visit",
    "read",
    "write",
    "admin",
  ]);
  assertEquals(grantCapabilitiesFor("read"), ["read", "write", "admin"]);
  assertEquals(grantCapabilitiesFor("write"), ["write", "admin"]);
  assertEquals(grantCapabilitiesFor("admin"), ["admin"]);
});
