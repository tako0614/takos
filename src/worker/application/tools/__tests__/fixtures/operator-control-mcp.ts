/**
 * Concrete producer fixture for the operator control MCP deployment model.
 *
 * The blueprint is service-side InstallConfig data. `moduleInterface` models
 * the equivalent optional takosumi_interface declaration. Both produce the
 * same ordinary Interface spec; only the blueprint can propose the installing
 * Principal binding.
 */
export const OPERATOR_CONTROL_MCP_FIXTURE = {
  output: {
    name: "endpoint",
    value: "https://control.example/mcp",
    sensitive: false,
  },
  interfaceBlueprint: {
    key: "operator-control-mcp-v1",
    name: "operator-control-mcp",
    spec: {
      type: "mcp.server",
      version: "2025-11-25",
      document: {
        transport: "streamable-http",
        display: { title: "Takosumi Control" },
      },
      inputs: {
        endpoint: {
          source: "capsule_output",
          outputName: "endpoint",
        },
      },
      access: {
        visibility: "workspace",
        resourceUriInput: "endpoint",
      },
    },
    bindings: [
      {
        key: "installer-control",
        subject: { source: "installing_principal" },
        permissions: ["mcp.invoke"],
        delivery: { type: "oauth2" },
      },
    ],
  },
  moduleInterface: {
    resourceType: "takosumi_interface",
    name: "operator-control-mcp",
    spec: {
      type: "mcp.server",
      version: "2025-11-25",
      document: {
        transport: "streamable-http",
        display: { title: "Takosumi Control" },
      },
      inputs: {
        endpoint: {
          source: "capsule_output",
          outputName: "endpoint",
        },
      },
      access: {
        visibility: "workspace",
        resourceUriInput: "endpoint",
      },
    },
  },
  toolsList: [
    {
      name: "capsule_plan",
      description: "Create a policy-checked Takosumi plan Run",
      inputSchema: { type: "object", properties: {} },
    },
  ],
} as const;
