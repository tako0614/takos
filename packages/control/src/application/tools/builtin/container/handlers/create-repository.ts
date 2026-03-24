import type { ToolHandler } from '../../../types';
import { getDb, repositories } from '../../../../../infra/db';
import { and, eq } from 'drizzle-orm';
import { createRepository, RepositoryCreationError } from '../../../../services/source/repos';
import {
  validateStringInput,
} from '../session';
import { logInfo } from '../../../../../shared/utils/logger';

export const createRepositoryHandler: ToolHandler = async (args, context) => {
  const rawName = validateStringInput(args.name, 'name');
  const name = rawName || 'main';
  const description = validateStringInput(args.description, 'description') || '';

  const db = getDb(context.db);
  const existing = await db.select({ id: repositories.id, name: repositories.name })
    .from(repositories)
    .where(and(eq(repositories.accountId, context.spaceId), eq(repositories.name, name)))
    .get();

  if (existing) {
    return `Repository "${name}" already exists.\n\nRepository ID: ${existing.id}\n\nYou can use this ID with container_start.`;
  }

  logInfo(`Creating repository '${name}' for workspace ${context.spaceId}`, { module: 'tools/builtin/container/handlers/create-repository' });
  try {
    const repository = await createRepository(context.db, context.env.GIT_OBJECTS, {
      spaceId: context.spaceId,
      name,
      description: description || null,
      visibility: 'private',
      actorAccountId: context.userId,
    });

    logInfo(`Created repository '${repository.name}' with id ${repository.id}`, { module: 'tools/builtin/container/handlers/create-repository' });

    return [
      'Repository created successfully!',
      '',
      `Repository ID: ${repository.id}`,
      `Name: ${repository.name}`,
      `Branch: ${repository.default_branch}`,
      'Git: initialized',
      '',
      `Now you can start a container with:`,
      `container_start(repo_id: "${repository.id}")`,
    ].join('\n');
  } catch (error) {
    if (error instanceof RepositoryCreationError) {
      throw new Error(error.message);
    }
    throw error;
  }
};
