/**
 * Moderation commands: show-user, ban, unban.
 */

import {
  ensureValidUserId,
  executeD1Sql,
  extractResults,
  fail,
  type GlobalOptions,
  nowIso,
  print,
  randomId,
  type ResolvedConfig,
  sqlLiteral,
  sqlNullable,
  takeOption,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchUserRow(
  config: ResolvedConfig,
  userId: string,
): Promise<Record<string, unknown>> {
  const result = await executeD1Sql(
    config,
    `SELECT id, email, username, name FROM users WHERE id = ${
      sqlLiteral(userId)
    } LIMIT 1`,
  );

  const row = extractResults(result)[0] as Record<string, unknown> | undefined;
  if (!row) {
    fail(`User not found: ${userId}`);
  }
  return row;
}

async function fetchModerationRow(
  config: ResolvedConfig,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const result = await executeD1Sql(
    config,
    `SELECT user_id, status, suspended_until, banned_at, warn_count, last_warn_at, reason, updated_at FROM user_moderation WHERE user_id = ${
      sqlLiteral(userId)
    } LIMIT 1`,
  );

  const row = extractResults(result)[0] as Record<string, unknown> | undefined;
  return row ?? null;
}

async function insertModerationAuditLog(input: {
  config: ResolvedConfig;
  actorUserId?: string;
  targetUser: Record<string, unknown>;
  actionType: "ban" | "unban";
  reason?: string;
  previousStatus: string;
  nextStatus: string;
  createdAt: string;
}): Promise<void> {
  const targetUserId = String(input.targetUser.id || "");
  const targetLabel = String(
    input.targetUser.username || input.targetUser.email || targetUserId,
  );
  const details = JSON.stringify({
    source: "admin-cli",
    previous_status: input.previousStatus,
    next_status: input.nextStatus,
    environment: input.config.environment,
  });

  const sql = `
    INSERT INTO moderation_audit_logs (
      id, actor_user_id, report_id, target_type, target_id, target_label,
      action_type, reason, details, created_at
    ) VALUES (
      ${sqlLiteral(randomId())},
      ${sqlNullable(input.actorUserId)},
      NULL,
      'user',
      ${sqlLiteral(targetUserId)},
      ${sqlLiteral(targetLabel)},
      ${sqlLiteral(input.actionType)},
      ${sqlNullable(input.reason)},
      ${sqlLiteral(details)},
      ${sqlLiteral(input.createdAt)}
    )
  `;

  await executeD1Sql(input.config, sql);
}

async function validateActorUserId(
  config: ResolvedConfig,
  actorUserId: string | undefined,
): Promise<void> {
  if (!actorUserId) {
    return;
  }

  ensureValidUserId(actorUserId, "actor_user_id");

  const result = await executeD1Sql(
    config,
    `SELECT id FROM users WHERE id = ${sqlLiteral(actorUserId)} LIMIT 1`,
  );

  if (!extractResults(result)[0]) {
    fail(`Actor user not found: ${actorUserId}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdModerationShowUser(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const userId = args[0];
  if (!userId) {
    fail("Usage: moderation show-user <user_id>");
  }
  ensureValidUserId(userId, "user_id");

  const user = await fetchUserRow(config, userId);
  const moderation = await fetchModerationRow(config, userId);

  const output = {
    user,
    moderation: moderation || {
      user_id: userId,
      status: "active",
      suspended_until: null,
      banned_at: null,
      warn_count: 0,
      last_warn_at: null,
      reason: null,
      updated_at: null,
    },
  };

  if (options.isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    print("User:", options.isJson);
    console.table([output.user as Record<string, unknown>]);
    print("Moderation:", options.isJson);
    console.table([output.moderation as Record<string, unknown>]);
  }

  return 1;
}

export async function cmdModerationBan(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const userId = localArgs.shift();
  if (!userId) {
    fail(
      "Usage: moderation ban <user_id> [--reason <text>] [--actor-user-id <id>]",
    );
  }
  ensureValidUserId(userId, "user_id");

  const reason = takeOption(localArgs, "--reason");
  const actorUserId = takeOption(localArgs, "--actor-user-id");
  await validateActorUserId(config, actorUserId);

  const user = await fetchUserRow(config, userId);
  const previousModeration = await fetchModerationRow(config, userId);
  const previousStatus = String(previousModeration?.status || "active");
  const timestamp = nowIso();

  const sql = `
    INSERT INTO user_moderation (user_id, status, banned_at, reason, updated_at)
    VALUES (
      ${sqlLiteral(userId)},
      'banned',
      ${sqlLiteral(timestamp)},
      ${sqlNullable(reason)},
      ${sqlLiteral(timestamp)}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'banned',
      suspended_until = NULL,
      banned_at = excluded.banned_at,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `;

  await executeD1Sql(config, sql);

  await insertModerationAuditLog({
    config,
    actorUserId,
    targetUser: user,
    actionType: "ban",
    reason,
    previousStatus,
    nextStatus: "banned",
    createdAt: timestamp,
  });

  const moderation = await fetchModerationRow(config, userId);
  const output = {
    user,
    moderation,
    previous_status: previousStatus,
    updated_status: "banned",
  };

  if (options.isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    print(`User banned: ${userId}`, options.isJson);
    if (reason) {
      print(`reason: ${reason}`, options.isJson);
    }
    console.table([moderation as Record<string, unknown>]);
  }

  return 1;
}

export async function cmdModerationUnban(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const userId = localArgs.shift();
  if (!userId) {
    fail(
      "Usage: moderation unban <user_id> [--reason <text>] [--actor-user-id <id>]",
    );
  }
  ensureValidUserId(userId, "user_id");

  const reason = takeOption(localArgs, "--reason");
  const actorUserId = takeOption(localArgs, "--actor-user-id");
  await validateActorUserId(config, actorUserId);

  const user = await fetchUserRow(config, userId);
  const previousModeration = await fetchModerationRow(config, userId);
  const previousStatus = String(previousModeration?.status || "active");
  const timestamp = nowIso();

  const sql = `
    INSERT INTO user_moderation (user_id, status, suspended_until, banned_at, reason, updated_at)
    VALUES (
      ${sqlLiteral(userId)},
      'active',
      NULL,
      NULL,
      ${sqlNullable(reason)},
      ${sqlLiteral(timestamp)}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'active',
      suspended_until = NULL,
      banned_at = NULL,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `;

  await executeD1Sql(config, sql);

  await insertModerationAuditLog({
    config,
    actorUserId,
    targetUser: user,
    actionType: "unban",
    reason,
    previousStatus,
    nextStatus: "active",
    createdAt: timestamp,
  });

  const moderation = await fetchModerationRow(config, userId);
  const output = {
    user,
    moderation,
    previous_status: previousStatus,
    updated_status: "active",
  };

  if (options.isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    print(`User unbanned: ${userId}`, options.isJson);
    if (reason) {
      print(`reason: ${reason}`, options.isJson);
    }
    console.table([moderation as Record<string, unknown>]);
  }

  return 1;
}
