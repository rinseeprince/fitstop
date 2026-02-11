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
      "Upstash Redis environment variables not found. Rate limiting will be disabled."
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
  
  // If Redis is not available, allow the request through
  if (!redisClient) {
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
 * Lenient rate limit for public check-in submission endpoints
 */
export async function checkInRateLimit(request: NextRequest): Promise<NextResponse | null> {
  return rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
  });
}