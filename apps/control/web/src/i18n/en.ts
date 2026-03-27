import { common } from './en/common';
import { auth } from './en/auth';
import { chat } from './en/chat';
import { settings } from './en/settings';
import { agent } from './en/agent';
import { deploy } from './en/deploy';
import { repository } from './en/repository';
import { source } from './en/source';
import { storage } from './en/storage';
import { tools } from './en/tools';

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
