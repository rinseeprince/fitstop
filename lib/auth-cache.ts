import { getRedisClient } from "@/lib/rate-limit";

/**
 * Short-TTL read-through cache for auth resolution (Session 3.8).
 *
 * The user -> client-id mapping is effectively immutable for the lifetime of an
 * account, so we use TTL-only invalidation rather than active eviction. A 60s
 * window absorbs the burst of auth lookups a single page render fans out across
 * its data fetches while keeping any staleness window trivially small.
 */
const AUTH_CACHE_TTL_SECONDS = 60; // mapping effectively immutable; TTL-only invalidation; 60s absorbs a page's burst

/**
 * Generic read-through cache core. On a cache miss (or when Redis is
 * unavailable) it runs `loader`, caching any non-null result for the TTL.
 *
 * @upstash/redis `get<T>`/`set` serialize JSON automatically, so caching the
 * object wrapper round-trips cleanly. Null/undefined results are never cached.
 */
async function getCachedAuthValue<T>(
  key: string,
  loader: () => Promise<T | null>,
): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return loader();

  try {
    const hit = await redis.get<T>(key);
    if (hit !== null && hit !== undefined) return hit as T;
  } catch {
    /* swallow, fall through */
  }

  const fresh = await loader();
  if (fresh !== null && fresh !== undefined) {
    try {
      await redis.set(key, fresh as unknown as string, { ex: AUTH_CACHE_TTL_SECONDS });
    } catch {
      /* swallow */
    }
  }
  return fresh;
}

/**
 * Read-through cache for the user -> client-id mapping.
 */
export async function getCachedClientId(
  userId: string,
  loader: () => Promise<string | null>,
): Promise<string | null> {
  return getCachedAuthValue("authmap:client:" + userId, loader);
}

/**
 * Read-through cache for the user -> coach-id mapping.
 *
 * As immutable as the client mapping above, and for the same reason: the only
 * writer that can create the row upserts on `user_id` with `ignoreDuplicates`
 * (services/auth-profile-service.ts), and the coach settings update is keyed by
 * `id` and touches only `timezone`. Nothing re-points an existing user at a
 * different coach row. Null is never cached, so a coach whose row is bootstrapped
 * mid-session resolves on the very next call rather than waiting out the TTL.
 */
export async function getCachedCoachId(
  userId: string,
  loader: () => Promise<string | null>,
): Promise<string | null> {
  return getCachedAuthValue("authmap:coach:" + userId, loader);
}

/**
 * Invalidate a user's cached auth mappings. Call this on client deactivation:
 * the mapping is cached only while the client was active, so without a bust a
 * just-deactivated client keeps resolving (loader/DB skipped) for up to the TTL.
 * Best-effort — a Redis miss falls back to the 60s TTL.
 */
export async function invalidateClientAuthCache(userId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del("authmap:client:" + userId, "authmap:clientcid:" + userId);
  } catch {
    /* swallow — TTL will expire the entries within 60s */
  }
}
