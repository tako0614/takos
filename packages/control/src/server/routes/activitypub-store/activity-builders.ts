import type { StoreRepositoryRecord } from "./activitypub-queries.ts";
import {
  activityContext,
  ACTIVITYSTREAMS_CONTEXT,
  AS_PUBLIC,
  buildRepoActor,
  buildRepoActorId,
} from "./helpers.ts";

export function buildAcceptActivity(
  actor: string,
  object: Record<string, unknown>,
): Record<string, unknown> {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Accept",
    actor,
    object,
  };
}

export function buildInventoryLogActivity(
  actorId: string,
  item: { activityType: string; createdAt: string; repoActorUrl: string },
): Record<string, unknown> {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    id: `${actorId}/activities/${item.activityType.toLowerCase()}/${
      encodeURIComponent(item.createdAt)
    }`,
    type: item.activityType,
    actor: actorId,
    published: item.createdAt,
    to: [AS_PUBLIC],
    object: item.repoActorUrl,
    target: `${actorId}/inventory`,
  };
}

export function buildAnnounceActivity(
  actorId: string,
  push: { ref: string; createdAt: string },
  repoActorUrl: string,
): Record<string, unknown> {
  return {
    "@context": activityContext(),
    id: `${actorId}/activities/announce/${encodeURIComponent(push.createdAt)}`,
    type: "Announce",
    actor: actorId,
    published: push.createdAt,
    to: [AS_PUBLIC],
    object: {
      type: push.ref.startsWith("refs/tags/") ? "Create" : "Push",
      actor: repoActorUrl,
      published: push.createdAt,
      target: push.ref,
    },
  };
}

export function buildRepoTagActivity(
  repoActorId: string,
  push: { ref: string; afterSha: string; createdAt: string },
): Record<string, unknown> {
  return {
    "@context": activityContext(),
    id: `${repoActorId}/activities/tag/${encodeURIComponent(push.createdAt)}`,
    type: "Create",
    actor: repoActorId,
    published: push.createdAt,
    to: [AS_PUBLIC],
    object: {
      type: "Tag",
      name: push.ref.slice("refs/tags/".length),
      ref: push.ref,
      target: push.afterSha,
      published: push.createdAt,
    },
  };
}

export function buildRepoDeleteActivity(
  repoActorId: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    "@context": activityContext(),
    id: `${repoActorId}/activities/delete/${encodeURIComponent(createdAt)}`,
    type: "Delete",
    actor: repoActorId,
    published: createdAt,
    to: [AS_PUBLIC],
    // ActivityStreams §3.3 recommends a Tombstone object instead of a bare URL
    // for Delete activities. Mastodon accepts both but Tombstone is the spec
    // form and lets receivers know what type was deleted (`formerType`).
    object: {
      type: "Tombstone",
      id: repoActorId,
      formerType: "Repository",
      deleted: createdAt,
    },
  };
}

export function buildRepoPushActivity(
  repoActorId: string,
  push: {
    ref: string;
    createdAt: string;
    pusherActorUrl: string | null;
    commitCount: number;
    commits: Array<{
      hash: string;
      message: string;
      authorName: string;
      authorEmail: string;
      committed: string;
    }>;
  },
): Record<string, unknown> {
  return {
    "@context": activityContext(),
    id: `${repoActorId}/activities/push/${encodeURIComponent(push.createdAt)}`,
    type: "Push",
    actor: repoActorId,
    attributedTo: push.pusherActorUrl || undefined,
    published: push.createdAt,
    to: [AS_PUBLIC],
    target: push.ref,
    object: push.commits.length > 0
      ? {
        type: "OrderedCollection",
        totalItems: push.commits.length,
        orderedItems: push.commits.map((cm) => ({
          type: "Commit",
          hash: cm.hash,
          message: cm.message,
          attributedTo: { name: cm.authorName, email: cm.authorEmail },
          committed: cm.committed,
        })),
      }
      : {
        type: "OrderedCollection",
        totalItems: push.commitCount,
        orderedItems: [],
      },
  };
}

export function buildRepoOutboxFallbackActivity(
  origin: string,
  repo: StoreRepositoryRecord,
): Record<string, unknown> {
  const repoActorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
  return {
    "@context": activityContext(),
    id: `${repoActorId}/activities/create/${
      encodeURIComponent(repo.createdAt)
    }`,
    type: "Create",
    actor: repoActorId,
    published: repo.createdAt,
    to: [AS_PUBLIC],
    object: buildRepoActor(origin, repo, { includeContext: false }),
  };
}
