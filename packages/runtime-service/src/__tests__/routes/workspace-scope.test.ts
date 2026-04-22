import { getSpaceIdFromBody } from "../../middleware/space-scope.ts";

import { assertEquals } from "jsr:@std/assert";

function createContext(body: unknown): { get: (key: string) => unknown } {
  return {
    get(key: string) {
      if (key === "parsedBody") return body;
      return undefined;
    },
  };
}

Deno.test("getSpaceIdFromBody - returns spaceId from camelCase body field", () => {
  const c = createContext({ spaceId: "ws-camel" });
  assertEquals(getSpaceIdFromBody(c as any, "spaceId"), "ws-camel");
});
Deno.test("getSpaceIdFromBody - returns space_id from snake_case body field", () => {
  const c = createContext({ space_id: "ws-snake" });
  assertEquals(getSpaceIdFromBody(c as any, "space_id"), "ws-snake");
});
Deno.test("getSpaceIdFromBody - returns null for missing, empty, and non-string values", () => {
  const invalidBodies: unknown[] = [
    undefined,
    null,
    false,
    0,
    "",
    {},
    { spaceId: "" },
    { spaceId: 123 },
    { space_id: "" },
    { space_id: 123 },
  ];

  for (const body of invalidBodies) {
    const c = createContext(body);
    assertEquals(getSpaceIdFromBody(c as any, "spaceId"), null);
    assertEquals(getSpaceIdFromBody(c as any, "space_id"), null);
  }
});
