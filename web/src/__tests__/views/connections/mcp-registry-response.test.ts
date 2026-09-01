import { describe, expect, test } from "bun:test";
import {
  parseMcpRegistrySearchResult,
  parseMcpRegistrySources,
} from "../../../views/connections/mcp-registry-response.ts";

describe("MCP Registry response validation", () => {
  test("rejects malformed source records before rendering", () => {
    expect(() => parseMcpRegistrySources({})).toThrow(
      "Invalid MCP Registry sources response",
    );
    expect(() =>
      parseMcpRegistrySources([
        {
          id: "source-1",
          source_kind: "unexpected",
        },
      ]),
    ).toThrow("Invalid MCP Registry sources response");
  });

  test("rejects a malformed Registry candidate before card rendering", () => {
    expect(() =>
      parseMcpRegistrySearchResult({
        query: "docs",
        candidates: [{ name: "broken" }],
        source_results: [],
        source_failures: [],
        limitations: {
          mode: "live",
          upstream_search: "server_name_substring_only",
          cached_full_text_aggregation: false,
          credentials_supported: false,
          note: "",
        },
      }),
    ).toThrow("Invalid MCP Registry search response");
  });
});
