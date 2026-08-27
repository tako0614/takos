import { expect, test } from "bun:test";

import {
  hasCredentialQueryParams,
  parseInterfaceDisplay,
  resolveDisplayIcon,
} from "../interface-display.ts";

test("credential query detection rejects credential-bearing icon URLs", () => {
  expect(hasCredentialQueryParams(new URLSearchParams("access_token=token")))
    .toBe(true);
  expect(hasCredentialQueryParams(new URLSearchParams("access-token=token")))
    .toBe(true);
  expect(hasCredentialQueryParams(new URLSearchParams("token="))).toBe(false);
  expect(hasCredentialQueryParams(new URLSearchParams("theme=dark"))).toBe(
    false,
  );
  expect(resolveDisplayIcon("https://cdn.example.test/icon.png?token=secret"))
    .toBe(null);
});

test("same-viewer-origin icons are rejected to prevent credentialed navigation", () => {
  expect(
    resolveDisplayIcon(
      "/oauth/authorize?client_id=capsule",
      "https://capsule.example.test/interface",
      "https://capsule.example.test",
    ),
  ).toBe(null);
  expect(
    parseInterfaceDisplay(
      { title: "Capsule", icon: "https://viewer.example.test/oauth/authorize" },
      { viewerOrigin: "https://viewer.example.test" },
    ),
  ).toEqual({ title: "Capsule" });
});
