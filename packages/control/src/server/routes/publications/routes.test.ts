import { assertEquals, assertThrows } from "jsr:@std/assert";

import type { PublicationRecord } from "../../../application/services/platform/service-publications.ts";
import {
  assertGrantPublicationDeleteAllowed,
  assertTakosGrantSpecShape,
} from "./routes.ts";

function makePublicationRecord(
  publication: PublicationRecord["publication"],
): PublicationRecord {
  return {
    id: "pub_1",
    name: publication.name,
    sourceType: "manifest",
    groupId: "group_1",
    ownerServiceId: "svc_1",
    catalogName: publication.publisher === "takos" ? "takos" : null,
    publicationType: publication.type,
    publication,
    outputs: [],
    resolved: {},
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
  };
}

Deno.test("publication routes allow deleting Takos grants", () => {
  assertGrantPublicationDeleteAllowed(
    makePublicationRecord({
      name: "takos-api",
      publisher: "takos",
      type: "api-key",
      spec: { scopes: ["files:read"] },
    }),
  );
});

Deno.test("publication routes reject deleting route publications", () => {
  assertThrows(
    () =>
      assertGrantPublicationDeleteAllowed(
        makePublicationRecord({
          name: "search",
          publisher: "web",
          type: "McpServer",
          path: "/mcp",
        }),
      ),
    Error,
    "Route publications cannot be deleted through DELETE /api/publications/:name",
  );
});

Deno.test("publication routes reject unknown Takos grant spec fields", () => {
  assertThrows(
    () =>
      assertTakosGrantSpecShape({
        name: "takos-api",
        publisher: "takos",
        type: "api-key",
        spec: {
          scopes: ["files:read"],
          extra: "oops",
        },
      }),
    Error,
    "spec.extra is not supported for Takos publication specs",
  );

  assertThrows(
    () =>
      assertTakosGrantSpecShape({
        name: "notes-oauth",
        publisher: "takos",
        type: "oauth-client",
        spec: {
          redirectUris: ["https://example.com/callback"],
          scopes: ["threads:read"],
          metadata: {
            logoUri: "https://example.com/logo.png",
            unknownUri: "https://example.com/unknown",
          },
        },
      }),
    Error,
    "spec.metadata.unknownUri is not supported for Takos publication specs",
  );
});
