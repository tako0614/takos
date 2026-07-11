import { expect, test } from "bun:test";

import type { Env, FetchBinding } from "../../../../shared/types/index.ts";
import { discoverMcpServerCards } from "../mcp/server-cards.ts";

const CARD_MEDIA_TYPE = "application/mcp-server-card+json";
const CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";

function json(value: unknown, contentType = "application/json", status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function envWithEgress(fetch: FetchBinding["fetch"]): Env {
  return {
    ENVIRONMENT: "production",
    TAKOS_EGRESS: { fetch },
  } as unknown as Env;
}

function catalog(cardUrl = "https://connector.example/mcp/server-card") {
  return {
    specVersion: "draft",
    entries: [
      {
        identifier: "com.example/docs",
        displayName: "Example Docs",
        mediaType: CARD_MEDIA_TYPE,
        url: cardUrl,
      },
    ],
  };
}

function card(remoteUrl = "https://connector.example/mcp") {
  return {
    $schema: CARD_SCHEMA,
    name: "com.example/docs",
    title: "Example Docs",
    description: "Read and write documents through the example connector.",
    version: "1.0.0",
    repository: {
      url: "https://github.com/example/docs-mcp",
      source: "github",
      subfolder: "deploy/opentofu",
    },
    remotes: [{ type: "streamable-http", url: remoteUrl }],
  };
}

test("experimental domain discovery reads the well-known catalog and advisory cards", async () => {
  const requests: Array<{
    url: string;
    accept: string | null;
    redirect: RequestRedirect | undefined;
  }> = [];
  const env = envWithEgress(async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      accept: new Headers(init?.headers).get("accept"),
      redirect: init?.redirect,
    });
    if (url === "https://example.com/.well-known/mcp/catalog.json") {
      return json(catalog());
    }
    if (url === "https://connector.example/mcp/server-card") {
      return json(card(), CARD_MEDIA_TYPE);
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const result = await discoverMcpServerCards(env, {
    spaceId: "workspace_1",
    domain: "EXAMPLE.com",
  });
  expect(result).toMatchObject({
    domain: "example.com",
    catalogUrl: "https://example.com/.well-known/mcp/catalog.json",
    experimental: true,
    failures: [],
    candidates: [
      {
        name: "com.example/docs",
        title: "Example Docs",
        url: "https://connector.example/mcp",
        transport: "streamable-http",
        repositoryUrl: "https://github.com/example/docs-mcp",
        repositorySubfolder: "deploy/opentofu",
        packages: [],
        provenance: [
          {
            sourceKind: "server_card",
            preview: true,
            cardUrl: "https://connector.example/mcp/server-card",
          },
        ],
      },
    ],
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    accept: "application/json",
    redirect: "manual",
  });
  expect(requests[1]).toMatchObject({
    accept: CARD_MEDIA_TYPE,
    redirect: "manual",
  });
});

test("Server Cards remain advisory and unsafe or malformed endpoints are skipped", async () => {
  const env = envWithEgress(async (input) => {
    const url = String(input);
    if (url.includes("/.well-known/mcp/catalog.json")) return json(catalog());
    return json(card("https://127.0.0.1/mcp"), CARD_MEDIA_TYPE);
  });
  const result = await discoverMcpServerCards(env, {
    spaceId: "workspace_1",
    domain: "example.com",
  });
  expect(result.candidates).toEqual([]);
  expect(result.failures).toEqual([]);

  const wrongMediaType = envWithEgress(async (input) => {
    const url = String(input);
    if (url.includes("/.well-known/mcp/catalog.json")) return json(catalog());
    return json(card(), "application/json");
  });
  const wrongMediaResult = await discoverMcpServerCards(wrongMediaType, {
    spaceId: "workspace_1",
    domain: "example.com",
  });
  expect(wrongMediaResult.candidates).toEqual([]);
  expect(wrongMediaResult.failures).toHaveLength(1);
});

test("domain discovery rejects redirects, private domains, and oversized documents", async () => {
  await expect(
    discoverMcpServerCards(
      envWithEgress(async () =>
        Response.redirect("https://other.example/catalog.json", 302),
      ),
      { spaceId: "workspace_1", domain: "example.com" },
    ),
  ).rejects.toThrow("redirects are not followed");

  await expect(
    discoverMcpServerCards(
      envWithEgress(async () => json(catalog())),
      {
        spaceId: "workspace_1",
        domain: "127.0.0.1",
      },
    ),
  ).rejects.toThrow();

  await expect(
    discoverMcpServerCards(
      envWithEgress(
        async () =>
          new Response("{}", {
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(512 * 1024 + 1),
            },
          }),
      ),
      { spaceId: "workspace_1", domain: "example.com" },
    ),
  ).rejects.toThrow("too large");
});
