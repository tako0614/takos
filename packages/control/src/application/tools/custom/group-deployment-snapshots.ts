import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { GroupDeploymentSnapshotService } from "../../services/platform/group-deployment-snapshots.ts";

const SNAPSHOT_ID_PROPERTIES = {
  group_deployment_snapshot_id: {
    type: "string",
    description: "Group deployment snapshot ID",
  },
} as const;

export const GROUP_DEPLOYMENT_SNAPSHOT_LIST: ToolDefinition = {
  name: "group_deployment_snapshot_list",
  description: "List group deployment snapshots in this space.",
  category: "space",
  parameters: { type: "object", properties: {} },
};

export const GROUP_DEPLOYMENT_SNAPSHOT_GET: ToolDefinition = {
  name: "group_deployment_snapshot_get",
  description: "Get a group deployment snapshot by ID.",
  category: "space",
  parameters: {
    type: "object",
    properties: SNAPSHOT_ID_PROPERTIES,
    required: ["group_deployment_snapshot_id"],
  },
};

export const GROUP_DEPLOYMENT_SNAPSHOT_DEPLOY_FROM_REPO: ToolDefinition = {
  name: "group_deployment_snapshot_deploy_from_repo",
  description:
    "Deploy a space group from a public HTTPS git repository URL using a repo-local deploy manifest.",
  category: "space",
  parameters: {
    type: "object",
    properties: {
      repository_url: {
        type: "string",
        description: "Canonical HTTPS git repository URL",
      },
      group_name: {
        type: "string",
        description: "Target group name for the snapshot.",
      },
      ref: { type: "string", description: "Branch, tag, or commit ref" },
      ref_type: {
        type: "string",
        enum: ["branch", "tag", "commit"],
        description: "Ref type",
      },
    },
    required: ["repository_url", "group_name"],
  },
};

export const GROUP_DEPLOYMENT_SNAPSHOT_REMOVE: ToolDefinition = {
  name: "group_deployment_snapshot_remove",
  description: "Delete a group deployment snapshot record.",
  category: "space",
  parameters: {
    type: "object",
    properties: SNAPSHOT_ID_PROPERTIES,
    required: ["group_deployment_snapshot_id"],
  },
};

export const GROUP_DEPLOYMENT_SNAPSHOT_ROLLBACK: ToolDefinition = {
  name: "group_deployment_snapshot_rollback",
  description:
    "Rollback the space group to the previous group deployment snapshot.",
  category: "space",
  parameters: {
    type: "object",
    properties: SNAPSHOT_ID_PROPERTIES,
    required: ["group_deployment_snapshot_id"],
  },
};

function readSnapshotId(args: Record<string, unknown>): string {
  const id = String(args.group_deployment_snapshot_id ?? "").trim();
  if (!id) {
    throw new Error("group_deployment_snapshot_id is required");
  }
  return id;
}

export const groupDeploymentSnapshotListHandler: ToolHandler = async (
  _args,
  context,
) => {
  const service = new GroupDeploymentSnapshotService(context.env);
  const snapshots = await service.list(context.spaceId);
  return JSON.stringify(
    {
      group_deployment_snapshots: snapshots,
    },
    null,
    2,
  );
};

export const groupDeploymentSnapshotGetHandler: ToolHandler = async (
  args,
  context,
) => {
  const id = readSnapshotId(args);
  const service = new GroupDeploymentSnapshotService(context.env);
  const deployment = await service.get(context.spaceId, id);
  if (!deployment) {
    throw new Error(`Group deployment snapshot not found: ${id}`);
  }
  return JSON.stringify(
    {
      group_deployment_snapshot: deployment,
    },
    null,
    2,
  );
};

export const groupDeploymentSnapshotDeployFromRepoHandler: ToolHandler = async (
  args,
  context,
) => {
  const repositoryUrl = String(args.repository_url || "").trim();
  const groupName = String(args.group_name || "").trim();
  const ref = String(args.ref || "").trim();
  const refType = String(args.ref_type || "branch").trim().toLowerCase();
  if (!repositoryUrl) throw new Error("repository_url is required");
  if (!groupName) throw new Error("group_name is required");
  if (refType !== "branch" && refType !== "tag" && refType !== "commit") {
    throw new Error("ref_type must be one of: branch, tag, commit");
  }
  const service = new GroupDeploymentSnapshotService(context.env);
  const result = await service.deploy(context.spaceId, context.userId, {
    groupName,
    source: {
      kind: "git_ref",
      repositoryUrl,
      ...(ref ? { ref } : {}),
      ...(ref ? { refType: refType as "branch" | "tag" | "commit" } : {}),
    },
  });
  return JSON.stringify({ success: true, data: result }, null, 2);
};

export const groupDeploymentSnapshotRemoveHandler: ToolHandler = async (
  args,
  context,
) => {
  const id = readSnapshotId(args);
  const service = new GroupDeploymentSnapshotService(context.env);
  await service.remove(context.spaceId, id);
  return JSON.stringify(
    {
      success: true,
      group_deployment_snapshot_id: id,
    },
    null,
    2,
  );
};

export const groupDeploymentSnapshotRollbackHandler: ToolHandler = async (
  args,
  context,
) => {
  const id = readSnapshotId(args);
  const service = new GroupDeploymentSnapshotService(context.env);
  const result = await service.rollback(context.spaceId, context.userId, id);
  return JSON.stringify({ success: true, data: result }, null, 2);
};

export const WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS = [
  GROUP_DEPLOYMENT_SNAPSHOT_LIST,
  GROUP_DEPLOYMENT_SNAPSHOT_GET,
  GROUP_DEPLOYMENT_SNAPSHOT_DEPLOY_FROM_REPO,
  GROUP_DEPLOYMENT_SNAPSHOT_REMOVE,
  GROUP_DEPLOYMENT_SNAPSHOT_ROLLBACK,
];

export const WORKSPACE_DEPLOYMENT_SNAPSHOT_HANDLERS: Record<
  string,
  ToolHandler
> = {
  group_deployment_snapshot_list: groupDeploymentSnapshotListHandler,
  group_deployment_snapshot_get: groupDeploymentSnapshotGetHandler,
  group_deployment_snapshot_deploy_from_repo:
    groupDeploymentSnapshotDeployFromRepoHandler,
  group_deployment_snapshot_remove: groupDeploymentSnapshotRemoveHandler,
  group_deployment_snapshot_rollback: groupDeploymentSnapshotRollbackHandler,
};
