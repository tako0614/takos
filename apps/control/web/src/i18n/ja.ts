import { common } from './ja/common';
import { auth } from './ja/auth';
import { chat } from './ja/chat';
import { settings } from './ja/settings';
import { agent } from './ja/agent';
import { deploy } from './ja/deploy';
import { repository } from './ja/repository';
import { source } from './ja/source';
import { storage } from './ja/storage';
import { tools } from './ja/tools';

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
