import {
  deepStrictEqual as assertEquals,
  strictEqual,
} from "node:assert/strict";
import { test } from "bun:test";
import {
  classifyConnectionInput,
  deriveMcpServerName,
  describeDirectConnection,
} from "../../../views/connections/connection-input.ts";
import { getConnectionEndpointDisclosure } from "../../../views/connections/connection-disclosure.ts";

test("connection input - recognizes an exact HTTPS MCP URL", () => {
  assertEquals(classifyConnectionInput("  https://connector.example/mcp  "), {
    kind: "https_url",
    value: "https://connector.example/mcp",
  });
  assertEquals(describeDirectConnection("https://connector.example/mcp"), {
    endpoint: "https://connector.example/mcp",
    hostname: "connector.example",
    suggestedName: "connector-example",
  });
});

test("connection input - separates Registry IDs from search terms", () => {
  assertEquals(classifyConnectionInput("io.github.example/google-workspace"), {
    kind: "registry_id",
    value: "io.github.example/google-workspace",
  });
  assertEquals(classifyConnectionInput("Google Docs"), {
    kind: "search",
    value: "Google Docs",
  });
  assertEquals(classifyConnectionInput("connector.example"), {
    kind: "domain",
    value: "connector.example",
  });
});

test("connection input - does not accept non-HTTPS or credential URLs", () => {
  strictEqual(
    classifyConnectionInput("http://connector.example/mcp").kind,
    "unsupported_url",
  );
  strictEqual(
    classifyConnectionInput("https://user:secret@connector.example/mcp").kind,
    "unsupported_url",
  );
  strictEqual(
    classifyConnectionInput("https://connector.example:8443/mcp").kind,
    "unsupported_url",
  );
  assertEquals(describeDirectConnection("https://connector.example:443/mcp"), {
    endpoint: "https://connector.example/mcp",
    hostname: "connector.example",
    suggestedName: "connector-example",
  });
});

test("connection input - derives backend-compatible connection names", () => {
  strictEqual(
    deriveMcpServerName("www.connector.example"),
    "connector-example",
  );
  strictEqual(deriveMcpServerName("123.example"), "mcp-123-example");
});

test("connection disclosure does not infer operator or execution location", () => {
  assertEquals(getConnectionEndpointDisclosure("connector.example"), {
    endpointDomain: "connector.example",
    connectorOperator: null,
    dataSentTo: "connector.example",
  });
});
