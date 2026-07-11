import { describe, expect, test } from "bun:test";
import type { McpRegistrySearchCandidate } from "../../../types/index.ts";
import {
  deriveRegistryConnectionName,
  getRegistryCandidateConnectionInfo,
  getRegistryNamespace,
  getSafeHttpsLink,
  isValidRegistryBaseUrl,
} from "../../../views/connections/registry-helpers.ts";

function candidate(
  overrides: Partial<McpRegistrySearchCandidate> = {},
): McpRegistrySearchCandidate {
  return {
    name: "io.example/google-workspace",
    title: "Google Workspace",
    description: "Workspace tools",
    version: "1.0.0",
    url: "https://connector.example/mcp",
    transport: "streamable-http",
    repository_url: "https://github.com/example/connector",
    repository_subfolder: null,
    requires_configuration: false,
    packages: [],
    provenance: [],
    ...overrides,
  };
}

describe("registry connection helpers", () => {
  test("extracts the provider namespace and a valid Takos name", () => {
    const value = candidate();
    expect(getRegistryNamespace(value.name)).toBe("io.example");
    expect(deriveRegistryConnectionName(value)).toBe("google-workspace");
  });

  test("only exposes credential-free HTTPS links", () => {
    expect(getSafeHttpsLink("https://example.com/repo#readme")).toBe(
      "https://example.com/repo#readme",
    );
    expect(getSafeHttpsLink("http://example.com/repo")).toBeNull();
    expect(getSafeHttpsLink("https://user:secret@example.com/repo")).toBeNull();
    expect(getSafeHttpsLink("javascript:alert(1)")).toBeNull();
  });

  test("rejects Registry base URLs with query or fragment state", () => {
    expect(isValidRegistryBaseUrl("https://registry.example.com/v0.1")).toBe(
      true,
    );
    expect(isValidRegistryBaseUrl("https://registry.example.com/?key=x")).toBe(
      false,
    );
    expect(isValidRegistryBaseUrl("https://registry.example.com/#docs")).toBe(
      false,
    );
    expect(isValidRegistryBaseUrl("https://registry.example.com:8443")).toBe(
      false,
    );
    expect(
      isValidRegistryBaseUrl("https://registry.example.com:443/v0.1"),
    ).toBe(true);
  });

  test("accepts a direct Streamable HTTP endpoint", () => {
    expect(getRegistryCandidateConnectionInfo(candidate())).toEqual({
      status: "connectable",
      hostname: "connector.example",
      endpoint: "https://connector.example/mcp",
    });
  });

  test("requires configuration before attempting a connection", () => {
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({ requires_configuration: true }),
      ),
    ).toEqual({
      status: "configuration_required",
      hostname: "connector.example",
      endpoint: "https://connector.example/mcp",
    });
  });

  test("rejects an endpoint that is not HTTPS", () => {
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({ url: "http://connector.example/mcp" }),
      ).status,
    ).toBe("invalid_endpoint");
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({ url: "https://connector.example:8443/mcp" }),
      ).status,
    ).toBe("invalid_endpoint");
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({ url: "https://connector.example:443/mcp" }),
      ).status,
    ).toBe("connectable");
  });

  test("routes package metadata through Capsule planning only when a repository exists", () => {
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({ transport: "package", url: null }),
      ),
    ).toEqual({ status: "deployable", hostname: null, endpoint: null });
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({
          transport: "package",
          url: null,
          repository_url: null,
        }),
      ),
    ).toEqual({
      status: "deployment_unavailable",
      hostname: null,
      endpoint: null,
    });
    expect(
      getRegistryCandidateConnectionInfo(
        candidate({
          transport: "package",
          url: null,
          repository_url: "http://github.example/connector",
        }),
      ).status,
    ).toBe("deployment_unavailable");
  });
});
