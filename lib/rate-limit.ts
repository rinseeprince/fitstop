import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory rate limiter for API routes
 * In production, consider using Redis or a dedicated rate limiting service
 */

type RateLimitConfig = {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests allowed in the window
};

type RequestRecord = {
  count: number;
  resetTime: number;
};

// In-memory store (will reset when server restarts)
const requestStore = new Map<string, RequestRecord>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestStore.entries()) {
    if (now > record.resetTime) {
      requestStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

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
export function rateLimit(
  request: NextRequest,
  config: RateLimitConfig = { windowMs: 60000, maxRequests: 100 }
): NextResponse | null {
  const clientId = getClientIdentifier(request);
  const now = Date.now();
  const record = requestStore.get(clientId);

  // If no record exists or window has expired, create new record
  if (!record || now > record.resetTime) {
    requestStore.set(clientId, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return null;
  }

  // Increment count
  record.count++;

  // Check if limit exceeded
  if (record.count > config.maxRequests) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
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
          "X-RateLimit-Limit": config.maxRequests.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": record.resetTime.toString(),
        },
      }
    );
  }

  return null;
}

/**
 * Stricter rate limit for auth-related endpoints (login, signup, etc.)
 */
export function authRateLimit(request: NextRequest): NextResponse | null {
  return rateLimit(request, {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 requests per 15 minutes
  });
}

/**
 * Standard rate limit for general API endpoints
 */
export function apiRateLimit(request: NextRequest): NextResponse | null {
  return rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
  });
}

/**
 * Lenient rate limit for public check-in submission endpoints
 */
export function checkInRateLimit(request: NextRequest): NextResponse | null {
  return rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 requests per minute
  });
}
