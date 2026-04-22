import { common } from "./ja/common.ts";
import { auth } from "./ja/auth.ts";
import { chat } from "./ja/chat.ts";
import { settings } from "./ja/settings.ts";
import { agent } from "./ja/agent.ts";
import { deploy } from "./ja/deploy.ts";
import { repository } from "./ja/repository.ts";
import { source } from "./ja/source.ts";
import { storage } from "./ja/storage.ts";
import { tools } from "./ja/tools.ts";

export const ja = {
  ...common,
  ...auth,
  ...chat,
  ...settings,
  ...agent,
  ...deploy,
  ...repository,
  ...source,
  ...storage,
  ...tools,
} as const;
