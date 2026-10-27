import { getAuthUserId } from "@convex-dev/auth/server";

import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

/** Returns the signed-in user's id, or null when the request is anonymous. */
export async function currentUserId(ctx: AuthCtx): Promise<Id<"users"> | null> {
  return await getAuthUserId(ctx);
}

/** Requires a signed-in user. */
export async function requireUser(ctx: AuthCtx): Promise<Id<"users">> {
  const userId = await currentUserId(ctx);
  if (!userId) throw new Error("Sign in to continue.");
  return userId;
}

/**
 * Loads a journey only when it belongs to the signed-in user.
 * A missing journey and someone else's journey intentionally share one error
 * so callers cannot probe which journey ids exist.
 */
export async function requireJourneyOwner(
  ctx: DbCtx,
  journeyId: Id<"journeys">,
): Promise<Doc<"journeys">> {
  const userId = await requireUser(ctx);
  const journey = await ctx.db.get(journeyId);
  if (!journey || journey.ownerId !== userId) {
    throw new Error("Learning journey not found.");
  }
  return journey;
}

/** Action-safe ownership check: actions have no db, so read the owner through a query. */
export async function requireJourneyOwnerAction(
  ctx: ActionCtx,
  journeyId: Id<"journeys">,
): Promise<Id<"users">> {
  const userId = await requireUser(ctx);
  const ownerId = await ctx.runQuery(internal.learn.getJourneyOwnerId, {
    journeyId,
  });
  if (ownerId !== userId) {
    throw new Error("Learning journey not found.");
  }
  return userId;
}
