import { common } from './en/common.ts';
import { auth } from './en/auth.ts';
import { chat } from './en/chat.ts';
import { settings } from './en/settings.ts';
import { agent } from './en/agent.ts';
import { deploy } from './en/deploy.ts';
import { repository } from './en/repository.ts';
import { source } from './en/source.ts';
import { storage } from './en/storage.ts';
import { tools } from './en/tools.ts';

export const en = {
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
