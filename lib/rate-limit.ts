import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/**
 * Upstash Redis-backed rate limiter for API routes
 * Supports serverless environments like Vercel
 */

type RateLimitConfig = {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests allowed in the window
};

// Initialize Redis client
let redis: Redis | null = null;
let redisInitialized = false;

function getRedisClient(): Redis | null {
  if (redisInitialized) {
    return redis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      "Upstash Redis not configured. Using in-memory rate limiting fallback (not distributed)."
    );
    redisInitialized = true;
    return null;
  }

  redis = new Redis({
    url,
    token,
  });
  redisInitialized = true;
  return redis;
}

// In-memory fallback rate limiter (per-process, not distributed)
const inMemoryStore = new Map<string, { count: number; resetAt: number }>();
const MAX_STORE_SIZE = 10_000;

function inMemoryRateLimit(
  clientId: string,
  maxRequests: number,
  windowMs: number
): { success: boolean; retryAfter: number } {
  const now = Date.now();
  const key = `${clientId}:${maxRequests}:${windowMs}`;
  const entry = inMemoryStore.get(key);

  if (!entry || now >= entry.resetAt) {
    // Prevent unbounded memory growth from spoofed IPs
    if (!entry && inMemoryStore.size >= MAX_STORE_SIZE) {
      // Evict expired entries first
      for (const [k, v] of inMemoryStore) {
        if (now >= v.resetAt) inMemoryStore.delete(k);
      }
      // If still full, reject the request
      if (inMemoryStore.size >= MAX_STORE_SIZE) {
        return { success: false, retryAfter: Math.ceil(windowMs / 1000) };
      }
    }
    inMemoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, retryAfter: 0 };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { success: false, retryAfter };
  }

  return { success: true, retryAfter: 0 };
}

// Periodically clean up expired entries (every 60 seconds)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of inMemoryStore) {
      if (now >= entry.resetAt) {
        inMemoryStore.delete(key);
      }
    }
  }, 60_000).unref?.();
}

/**
 * Get client identifier from request
 * Uses IP address from x-forwarded-for header or falls back to generic identifier
 */
function getClientIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  return ip;
}

/**
 * Rate limit middleware for API routes
 * Returns null if rate limit is not exceeded, or a Response with 429 status if exceeded
 */
export async function rateLimit(
  request: NextRequest,
  config: RateLimitConfig = { windowMs: 60000, maxRequests: 100 }
): Promise<NextResponse | null> {
  const redisClient = getRedisClient();
  
  // If Redis is not available, use in-memory fallback
  if (!redisClient) {
    const clientId = getClientIdentifier(request);
    const result = inMemoryRateLimit(clientId, config.maxRequests, config.windowMs);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Too many requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: result.retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": result.retryAfter.toString() },
        }
      );
    }
    return null;
  }

  const clientId = getClientIdentifier(request);
  
  // Create a rate limiter instance for this specific config
  const ratelimit = new Ratelimit({
    redis: redisClient,
    limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.windowMs} ms`),
    analytics: true,
  });

  try {
    const { success, limit, remaining, reset } = await ratelimit.limit(clientId);

    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return NextResponse.json(
        {
          error: "Too many requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        }
      );
    }

    return null;
  } catch (error) {
    console.error("Rate limiting error:", error);
    // If there's an error with rate limiting, allow the request through
    return null;
  }
}

/**
 * Stricter rate limit for auth-related endpoints (login, signup, etc.)
 */
export async function authRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 requests per 15 minutes
  });
}

/**
 * Standard rate limit for general API endpoints
 */
export async function apiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
  });
}

/**
 * More permissive rate limit for authenticated client API endpoints
 * Allows for burst traffic during page navigation while still preventing abuse
 */
export async function clientApiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 10 * 1000, // 10 seconds
    maxRequests: 30, // 30 requests per 10 seconds
  });
}

/**
 * Lenient rate limit for public check-in submission endpoints
 */
export async function checkInRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
  });
}

/**
 * Rate limit for coach-side client management endpoints
 * Allows burst traffic for dashboard navigation
 */
export async function coachApiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 10 * 1000, // 10 seconds
    maxRequests: 30, // 30 requests per 10 seconds
  });
}

/**
 * Strict rate limit for AI-powered endpoints (OpenAI calls)
 * Prevents cost abuse from repeated AI requests
 */
export async function aiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 requests per minute
  });
}