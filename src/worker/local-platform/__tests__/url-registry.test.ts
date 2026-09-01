import { describe, expect, test } from "bun:test";

import {
  createFetcherRegistry,
  parseServiceTargetMap,
} from "../url-registry.ts";

describe("local external runtime target configuration", () => {
  test("accepts explicit HTTP(S) targets and normalizes their base path", () => {
    expect(parseServiceTargetMap(JSON.stringify({
      "tenant-runtime": "https://runtime.example.test/base",
      EXECUTOR_HOST: "http://executor.internal:8787",
    }))).toEqual({
      "tenant-runtime": "https://runtime.example.test/base/",
      EXECUTOR_HOST: "http://executor.internal:8787/",
    });
  });

  test("rejects malformed names and values instead of silently dropping them", () => {
    expect(() => parseServiceTargetMap('{"__proto__":"https://safe.test"}'))
      .toThrow("Invalid service target name");
    expect(() => parseServiceTargetMap('{"runtime":false}')).toThrow(
      "must be a non-empty URL string",
    );
    expect(() => parseServiceTargetMap("[]")).toThrow("must be a JSON object");
  });

  test("rejects non-HTTP and credential-bearing destinations", () => {
    expect(() => parseServiceTargetMap('{"runtime":"file:///tmp/socket"}'))
      .toThrow("must use HTTP or HTTPS");
    expect(() =>
      parseServiceTargetMap(
        '{"runtime":"https://user:secret@runtime.example.test"}',
      )
    ).toThrow("must not contain credentials");
    expect(() =>
      createFetcherRegistry({
        runtime: "https://runtime.example.test/base?token=secret",
      })
    ).toThrow("must not contain query or fragment state");
  });
});
