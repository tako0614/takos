import { Hono } from "hono";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { CUSTOM_TOOLS } from "../../../application/tools/custom/index.ts";
import type { ToolDefinition } from "../../../application/tools/tool-definitions.ts";
import { NotFoundError } from "takos-common/errors";
import { data } from "../response-utils.ts";

function serializeCustomTool(tool: ToolDefinition) {
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    enabled: true,
    type: "custom",
    workerId: undefined,
    bundleDeploymentId: null,
  };
}

function findCustomTool(toolName: string): ToolDefinition | undefined {
  return CUSTOM_TOOLS.find((tool) => tool.name === toolName);
}

const spaceTools = new Hono<SpaceAccessRouteEnv>()
  // Expose the static control-plane custom tool registry, including the
  // default-injected skill tools that stay managed through the registry.
  .get("/:spaceId/tools", spaceAccess(), async (c) => {
    return data(c, CUSTOM_TOOLS.map(serializeCustomTool));
  })
  .get("/:spaceId/tools/:toolName", spaceAccess(), async (c) => {
    const toolName = c.req.param("toolName");
    const tool = findCustomTool(toolName);
    if (!tool) {
      throw new NotFoundError("Custom tool");
    }
    return data(c, serializeCustomTool(tool));
  });

export default spaceTools;
