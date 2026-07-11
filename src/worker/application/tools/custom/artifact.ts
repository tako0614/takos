import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";
import type { ArtifactType } from "../../../shared/types/index.ts";
import { artifacts, getDb } from "../../../infra/db/index.ts";
import { generateId } from "../../../shared/utils/index.ts";

export const CREATE_ARTIFACT: ToolDefinition = {
  name: "create_artifact",
  description:
    "Create an artifact (code, document, report, etc.) as output of this run. Artifacts are displayed to the user and can be downloaded.",
  category: "artifact",
  namespace: "artifact",
  family: "artifact.create",
  risk_level: "none",
  side_effects: true,
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Artifact type",
        enum: ["code", "config", "doc", "patch", "report", "other"],
      },
      title: {
        type: "string",
        description: "Title of the artifact",
      },
      content: {
        type: "string",
        description: "Content of the artifact",
      },
    },
    required: ["type", "title", "content"],
  },
};

export const createArtifactHandler: ToolHandler = async (args, context) => {
  const type = args.type as ArtifactType;
  const title = args.title as string;
  const content = args.content as string;

  const id = generateId();
  const now = new Date().toISOString();

  const db = getDb(context.db);
  await db.insert(artifacts).values({
    id,
    runId: context.runId,
    accountId: context.spaceId,
    type,
    title,
    content,
    metadata: "{}",
    createdAt: now,
  });

  return `Created artifact: ${title} (${type})`;
};

export const { tools: ARTIFACT_TOOLS, handlers: ARTIFACT_HANDLERS } =
  defineTools([
    [CREATE_ARTIFACT, createArtifactHandler],
  ]);
