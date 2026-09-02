import { describe, expect, test } from "bun:test";

import {
  agentExecutionEnabled,
  parseRuntimeCapabilities,
  vectorSearchEnabled,
} from "../../store/runtime-capabilities.ts";

describe("parseRuntimeCapabilities", () => {
  test("reads a well-formed report", () => {
    expect(
      parseRuntimeCapabilities({
        capabilities: {
          vectorSearch: "vectorize",
          agentContainers: "cloudflare-containers",
        },
      }),
    ).toEqual({
      vectorSearch: "vectorize",
      agentContainers: "cloudflare-containers",
    });
  });

  test("reads the reduced mode an ordinary production apply produces", () => {
    expect(
      parseRuntimeCapabilities({
        capabilities: { vectorSearch: "disabled", agentContainers: "disabled" },
      }),
    ).toEqual({ vectorSearch: "disabled", agentContainers: "disabled" });
  });

  test("rejects anything it does not recognise, rather than defaulting", () => {
    // Defaulting would let a bad answer disable working features.
    expect(parseRuntimeCapabilities(null)).toBe(null);
    expect(parseRuntimeCapabilities({})).toBe(null);
    expect(parseRuntimeCapabilities({ capabilities: {} })).toBe(null);
    expect(
      parseRuntimeCapabilities({
        capabilities: { vectorSearch: "elasticsearch", agentContainers: "x" },
      }),
    ).toBe(null);
    expect(
      parseRuntimeCapabilities({ capabilities: { vectorSearch: "vectorize" } }),
    ).toBe(null);
  });
});

describe("availability helpers stay optimistic when the answer is unknown", () => {
  test("null reads as available", () => {
    expect(vectorSearchEnabled(null)).toBe(true);
    expect(agentExecutionEnabled(null)).toBe(true);
  });

  test("disabled reads as unavailable", () => {
    expect(
      vectorSearchEnabled({
        vectorSearch: "disabled",
        agentContainers: "disabled",
      }),
    ).toBe(false);
    expect(
      agentExecutionEnabled({
        vectorSearch: "disabled",
        agentContainers: "disabled",
      }),
    ).toBe(false);
  });

  test("every non-disabled mode reads as available", () => {
    expect(
      vectorSearchEnabled({
        vectorSearch: "pgvector",
        agentContainers: "external-host",
      }),
    ).toBe(true);
    expect(
      agentExecutionEnabled({
        vectorSearch: "pgvector",
        agentContainers: "external-host",
      }),
    ).toBe(true);
  });
});
