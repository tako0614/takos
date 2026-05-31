import {
  normalizeUsernameInput,
  syncRouteWithUsernameChange,
} from "../../../views/app/settings-username.ts";

import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";

test("settings username helpers - normalizes user input to canonical username characters", () => {
  assertEquals(normalizeUsernameInput("@My-User.Name"), "my-username");
  assertEquals(normalizeUsernameInput("___Alpha"), "___alpha");
});
test("settings username helpers - updates self profile routes after username change", () => {
  const route = syncRouteWithUsernameChange(
    { view: "profile", username: "old-handle" },
    "old-handle",
    "new-handle",
  );

  assertEquals(route, { view: "profile", username: "new-handle" });
});
test("settings username helpers - updates self repo routes after username change", () => {
  const route = syncRouteWithUsernameChange(
    { view: "repo", username: "old-handle", repoName: "demo" },
    "old-handle",
    "new-handle",
  );

  assertEquals(route, {
    view: "repo",
    username: "new-handle",
    repoName: "demo",
  });
});
test("settings username helpers - leaves unrelated routes unchanged", () => {
  const route = { view: "chat", spaceId: "ws-1" } as const;

  assertEquals(
    syncRouteWithUsernameChange(route, "old-handle", "new-handle"),
    route,
  );
  assertEquals(
    syncRouteWithUsernameChange(
      { view: "profile", username: "someone-else" },
      "old-handle",
      "new-handle",
    ),
    { view: "profile", username: "someone-else" },
  );
});
