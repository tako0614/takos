import type { D1Database } from '../../../shared/types/bindings.ts';
import { z } from 'zod';
import type { Env } from '../../../shared/types';
import { type NotificationChannel, type NotificationPreferenceMatrix, type NotificationType } from './notification-models';
export declare const updateNotificationPreferencesSchema: z.ZodObject<{
    updates: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["deploy.completed", "deploy.failed", "run.completed", "run.failed", "pr.review.requested", "pr.comment", "social.followed", "social.follow.requested", "social.follow.accepted", "workspace.invite", "billing.quota_warning", "security.new_login"]>;
        channel: z.ZodEnum<["in_app", "email", "push"]>;
        enabled: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        type: "run.failed" | "deploy.completed" | "deploy.failed" | "run.completed" | "pr.review.requested" | "pr.comment" | "social.followed" | "social.follow.requested" | "social.follow.accepted" | "workspace.invite" | "billing.quota_warning" | "security.new_login";
        enabled: boolean;
        channel: "email" | "push" | "in_app";
    }, {
        type: "run.failed" | "deploy.completed" | "deploy.failed" | "run.completed" | "pr.review.requested" | "pr.comment" | "social.followed" | "social.follow.requested" | "social.follow.accepted" | "workspace.invite" | "billing.quota_warning" | "security.new_login";
        enabled: boolean;
        channel: "email" | "push" | "in_app";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    updates: {
        type: "run.failed" | "deploy.completed" | "deploy.failed" | "run.completed" | "pr.review.requested" | "pr.comment" | "social.followed" | "social.follow.requested" | "social.follow.accepted" | "workspace.invite" | "billing.quota_warning" | "security.new_login";
        enabled: boolean;
        channel: "email" | "push" | "in_app";
    }[];
}, {
    updates: {
        type: "run.failed" | "deploy.completed" | "deploy.failed" | "run.completed" | "pr.review.requested" | "pr.comment" | "social.followed" | "social.follow.requested" | "social.follow.accepted" | "workspace.invite" | "billing.quota_warning" | "security.new_login";
        enabled: boolean;
        channel: "email" | "push" | "in_app";
    }[];
}>;
export declare const setMutedUntilSchema: z.ZodObject<{
    muted_until: z.ZodNullable<z.ZodEffects<z.ZodString, string, string>>;
}, "strip", z.ZodTypeAny, {
    muted_until: string | null;
}, {
    muted_until: string | null;
}>;
export declare const listNotificationsQuerySchema: z.ZodObject<{
    limit: z.ZodOptional<z.ZodNumber>;
    before: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
    before?: string | undefined;
}, {
    limit?: number | undefined;
    before?: string | undefined;
}>;
export type NotificationDto = {
    id: string;
    user_id: string;
    space_id: string | null;
    type: string;
    title: string;
    body: string | null;
    data: Record<string, unknown>;
    read_at: string | null;
    created_at: string;
};
export declare function ensureNotificationSettings(dbBinding: D1Database, userId: string): Promise<void>;
export declare function getNotificationsMutedUntil(dbBinding: D1Database, userId: string): Promise<string | null>;
export declare function isNotificationsMuted(dbBinding: D1Database, userId: string): Promise<boolean>;
export declare function setNotificationsMutedUntil(dbBinding: D1Database, userId: string, mutedUntil: string | null): Promise<{
    muted_until: string | null;
}>;
export declare function ensureNotificationPreferences(dbBinding: D1Database, userId: string): Promise<void>;
export declare function getNotificationPreferences(dbBinding: D1Database, userId: string): Promise<NotificationPreferenceMatrix>;
export declare function updateNotificationPreferences(dbBinding: D1Database, userId: string, updates: Array<{
    type: NotificationType;
    channel: NotificationChannel;
    enabled: boolean;
}>): Promise<NotificationPreferenceMatrix>;
export declare function listNotifications(dbBinding: D1Database, userId: string, opts?: {
    limit?: number;
    before?: string | null;
}): Promise<{
    notifications: NotificationDto[];
}>;
export declare function getUnreadCount(dbBinding: D1Database, userId: string): Promise<number>;
export declare function markNotificationRead(dbBinding: D1Database, userId: string, notificationId: string): Promise<{
    success: true;
}>;
export declare function createNotification(env: Env, input: {
    userId: string;
    spaceId?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
}): Promise<{
    notification_id: string | null;
}>;
//# sourceMappingURL=service.d.ts.map