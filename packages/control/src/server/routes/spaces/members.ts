import { Hono } from 'hono';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { SpaceRole } from '../../../shared/types';
import { badRequest, requireSpaceAccess, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  createSpaceMember,
  getUserByEmail,
  getSpaceMember,
  listSpaceMembers,
} from '../../../application/services/identity/spaces';
import { createNotification } from '../../../application/services/notifications/service';
import { getDb } from '../../../infra/db';
import { accounts, accountMemberships } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { logWarn } from '../../../shared/utils/logger';
import { AuthorizationError, NotFoundError, ConflictError, InternalError } from '@takos/common/errors';

interface MemberWithOwnership {
  id: string;
  spaceId: string;
  principalId: string;
  role: SpaceRole;
  createdAt: string;
  spaceOwnerPrincipalId: string;
}

interface TransactionError {
  error: string;
  status: 404 | 409;
}

/**
 * Fetch a workspace member with ownership info for authorization checks.
 */
async function findMemberWithOwnership(
  d1: D1Database,
  spaceId: string,
  principalId: string
): Promise<MemberWithOwnership | null> {
  const db = getDb(d1);

  const membership = await db.select().from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, spaceId), eq(accountMemberships.memberId, principalId)))
    .limit(1)
    .get();

  if (!membership) return null;

  const space = await db.select({ ownerAccountId: accounts.ownerAccountId })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();

  return {
    id: membership.id,
    spaceId: membership.accountId,
    principalId: membership.memberId,
    role: membership.role as SpaceRole,
    createdAt: membership.createdAt,
    spaceOwnerPrincipalId: space?.ownerAccountId ?? '',
  };
}

/**
 * Convert known transaction error codes into typed error responses.
 * Re-throws unknown errors.
 */
function handleMemberTransactionError(err: unknown, fallbackMessage: string): TransactionError {
  if (err instanceof Error) {
    if (err.message === 'MEMBER_NOT_FOUND') {
      return { error: 'Member not found', status: 404 };
    }
    if (err.message.startsWith('CANNOT_')) {
      return { error: `${fallbackMessage} - member state may have changed`, status: 409 };
    }
  }
  throw err;
}

/**
 * Validate that the target member can be modified/removed, returning an error
 * response string if blocked, or null if allowed.
 */
function validateMemberModification(
  actorRole: SpaceRole,
  target: MemberWithOwnership,
  action: 'modify' | 'remove'
): { error: string; status: ContentfulStatusCode } | null {
  if (target.role === 'owner') {
    const verb = action === 'modify' ? 'change' : 'remove';
    return { error: `Cannot ${verb} owner${action === 'modify' ? ' role' : ''}`, status: 400 };
  }

  if (target.spaceOwnerPrincipalId === target.principalId) {
    return { error: `Cannot ${action} space owner`, status: 403 };
  }

  if (actorRole === 'admin' && target.role === 'admin') {
    return { error: `Cannot ${action} another admin`, status: 403 };
  }

  return null;
}

export default new Hono<AuthenticatedRouteEnv>()
  .get('/:spaceId/members', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    const members = await listSpaceMembers(c.env.DB, access.space.id);

    return c.json({ members });
  })
  .post('/:spaceId/members',
    zValidator('json', z.object({ email: z.string(), role: z.string() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const body = c.req.valid('json') as { email: string; role: SpaceRole };

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin'],
      'Space not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    if (!body.email || !body.role) {
      return badRequest(c, 'Email and role are required');
    }

    if (body.role === 'owner') {
      return badRequest(c, 'Cannot add owner role');
    }

    const targetUser = await getUserByEmail(c.env.DB, body.email);
    if (!targetUser) {
      throw new NotFoundError('User');
    }
    if (!targetUser.principal_id) {
      throw new InternalError('Target user principal not found');
    }

    const existingMember = await getSpaceMember(c.env.DB, access.space.id, targetUser.principal_id);
    if (existingMember) {
      throw new ConflictError('User is already a member');
    }

    const memberData = await createSpaceMember(c.env.DB, access.space.id, targetUser.principal_id, body.role);

    try {
      await createNotification(c.env, {
        userId: targetUser.id,
        spaceId: access.space.id,
        type: 'workspace.invite',
        title: `Workspace invitation: ${access.space.name}`,
        body: `You were added as ${body.role}.`,
        data: {
          space_id: access.space.id,
          workspace_name: access.space.name,
          role: body.role,
          invited_by: user.id,
        },
      });
    } catch (err) {
      logWarn('Failed to create workspace invite notification', { module: 'notifications', error: err instanceof Error ? err.message : String(err) });
    }

    return c.json({
      member: {
        username: targetUser.username,
        name: targetUser.name,
        picture: targetUser.picture,
        role: memberData.role,
        created_at: memberData.created_at,
      },
    }, 201);
  })
  .patch('/:spaceId/members/:username',
    zValidator('json', z.object({ role: z.string() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const targetUsername = c.req.param('username');
    const db = getDb(c.env.DB);
    const targetUser = await db.select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, targetUsername))
      .limit(1)
      .get();
    if (!targetUser) {
      throw new NotFoundError('User');
    }
    const targetUserId = targetUser.id;
    const body = c.req.valid('json') as { role: SpaceRole };

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin'],
      'Space not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    if (!body.role) {
      return badRequest(c, 'Role is required');
    }

    if (body.role === 'owner') {
      return badRequest(c, 'Cannot set owner role');
    }

    const targetMember = await findMemberWithOwnership(c.env.DB, access.space.id, targetUserId);
    if (!targetMember) {
      throw new NotFoundError('Member');
    }

    const modifyCheck = validateMemberModification(access.membership.role as SpaceRole, targetMember, 'modify');
    if (modifyCheck) {
      throw modifyCheck;
    }

    // Admin cannot promote to admin (only owner can)
    if (access.membership.role === 'admin' && body.role === 'admin') {
      throw new AuthorizationError('Only owner can promote to admin');
    }

    let updatedMember: { username: string; name: string; picture: string | null; role: string; created_at: string | unknown } | TransactionError;
    try {
      const currentMember = await findMemberWithOwnership(c.env.DB, access.space.id, targetUserId);

      if (!currentMember) throw new Error('MEMBER_NOT_FOUND');
      if (currentMember.role === 'owner') throw new Error('CANNOT_CHANGE_OWNER');
      if (currentMember.spaceOwnerPrincipalId === targetUserId) throw new Error('CANNOT_MODIFY_WORKSPACE_OWNER');

      await db.update(accountMemberships)
        .set({ role: body.role })
        .where(and(eq(accountMemberships.accountId, access.space.id), eq(accountMemberships.memberId, targetUserId)));

      const memberUser = await db.select({ slug: accounts.slug, name: accounts.name, picture: accounts.picture })
        .from(accounts)
        .where(eq(accounts.id, targetUserId))
        .limit(1)
        .get();

      updatedMember = {
        username: memberUser?.slug || '',
        name: memberUser?.name || '',
        picture: memberUser?.picture || null,
        role: body.role,
        created_at: currentMember.createdAt,
      };
    } catch (err: unknown) {
      updatedMember = handleMemberTransactionError(err, 'Failed to update member role');
    }

    if ('error' in updatedMember) {
      throw updatedMember;
    }

    return c.json({ member: updatedMember });
  })
  .delete('/:spaceId/members/:username', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const targetUsername = c.req.param('username');

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin'],
      'Space not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const db = getDb(c.env.DB);
    const targetUser = await db.select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, targetUsername))
      .limit(1)
      .get();
    if (!targetUser) {
      throw new NotFoundError('User');
    }
    const targetUserId = targetUser.id;

    const targetMember = await findMemberWithOwnership(c.env.DB, access.space.id, targetUserId);
    if (!targetMember) {
      throw new NotFoundError('Member');
    }

    const removeCheck = validateMemberModification(access.membership.role as SpaceRole, targetMember, 'remove');
    if (removeCheck) {
      throw removeCheck;
    }

    let deleteResult: true | TransactionError;
    try {
      const currentMember = await findMemberWithOwnership(c.env.DB, access.space.id, targetUserId);

      if (!currentMember) throw new Error('MEMBER_NOT_FOUND');
      if (currentMember.role === 'owner') throw new Error('CANNOT_REMOVE_OWNER');
      if (currentMember.spaceOwnerPrincipalId === targetUserId) throw new Error('CANNOT_REMOVE_WORKSPACE_OWNER');

      await db.delete(accountMemberships)
        .where(and(eq(accountMemberships.accountId, access.space.id), eq(accountMemberships.memberId, targetUserId)));

      deleteResult = true as const;
    } catch (err: unknown) {
      deleteResult = handleMemberTransactionError(err, 'Failed to remove member');
    }

    if (typeof deleteResult === 'object' && 'error' in deleteResult) {
      throw deleteResult;
    }

    return c.json({ success: true });
  });
