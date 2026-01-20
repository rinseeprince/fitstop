import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { rateLimit, authRateLimit, apiRateLimit, checkInRateLimit } from './rate-limit'

// Helper to create a mock NextRequest
function createMockRequest(ip: string = '127.0.0.1'): NextRequest {
  const headers = new Headers()
  headers.set('x-forwarded-for', ip)

  return {
    headers,
  } as unknown as NextRequest
}

describe('Rate Limit Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('rateLimit', () => {
    it('allows requests under the limit', () => {
      const request = createMockRequest('192.168.1.1')
      const config = { windowMs: 60000, maxRequests: 10 }

      // First request should pass
      const result = rateLimit(request, config)
      expect(result).toBeNull()
    })

    it('allows multiple requests under the limit', () => {
      const request = createMockRequest('192.168.1.2')
      const config = { windowMs: 60000, maxRequests: 5 }

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        const result = rateLimit(request, config)
        expect(result).toBeNull()
      }
    })

    it('blocks requests over the limit', () => {
      const request = createMockRequest('192.168.1.3')
      const config = { windowMs: 60000, maxRequests: 3 }

      // Allow 3 requests
      for (let i = 0; i < 3; i++) {
        rateLimit(request, config)
      }

      // 4th request should be blocked
      const result = rateLimit(request, config)
      expect(result).not.toBeNull()
      expect(result?.status).toBe(429)
    })

    it('returns correct error response format', async () => {
      const request = createMockRequest('192.168.1.4')
      const config = { windowMs: 60000, maxRequests: 1 }

      // Use up the limit
      rateLimit(request, config)

      // Get the blocked response
      const result = rateLimit(request, config)
      expect(result).not.toBeNull()

      const body = await result?.json()
      expect(body.error).toBe('Too many requests')
      expect(body.message).toContain('Rate limit exceeded')
      expect(body.retryAfter).toBeDefined()
    })

    it('sets correct rate limit headers', () => {
      const request = createMockRequest('192.168.1.5')
      const config = { windowMs: 60000, maxRequests: 1 }

      // Use up the limit
      rateLimit(request, config)

      // Get the blocked response
      const result = rateLimit(request, config)
      expect(result).not.toBeNull()

      expect(result?.headers.get('Retry-After')).toBeDefined()
      expect(result?.headers.get('X-RateLimit-Limit')).toBe('1')
      expect(result?.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(result?.headers.get('X-RateLimit-Reset')).toBeDefined()
    })

    it('resets count after window expires', () => {
      const request = createMockRequest('192.168.1.6')
      const config = { windowMs: 60000, maxRequests: 2 }

      // Use up the limit
      rateLimit(request, config)
      rateLimit(request, config)

      // Should be blocked
      let result = rateLimit(request, config)
      expect(result).not.toBeNull()

      // Advance time past the window
      vi.advanceTimersByTime(61000)

      // Should be allowed again
      result = rateLimit(request, config)
      expect(result).toBeNull()
    })

    it('tracks different IPs separately', () => {
      const request1 = createMockRequest('10.0.0.1')
      const request2 = createMockRequest('10.0.0.2')
      const config = { windowMs: 60000, maxRequests: 2 }

      // Use up limit for IP 1
      rateLimit(request1, config)
      rateLimit(request1, config)

      // IP 1 should be blocked
      expect(rateLimit(request1, config)).not.toBeNull()

      // IP 2 should still be allowed
      expect(rateLimit(request2, config)).toBeNull()
    })

    it('handles missing x-forwarded-for header', () => {
      const request = {
        headers: new Headers(),
      } as unknown as NextRequest

      const config = { windowMs: 60000, maxRequests: 5 }

      // Should still work, using 'unknown' as identifier
      const result = rateLimit(request, config)
      expect(result).toBeNull()
    })

    it('handles multiple IPs in x-forwarded-for', () => {
      const headers = new Headers()
      headers.set('x-forwarded-for', '192.168.1.1, 10.0.0.1, 172.16.0.1')

      const request = { headers } as unknown as NextRequest
      const config = { windowMs: 60000, maxRequests: 1 }

      // Should use the first IP
      rateLimit(request, config)

      // Second request from same "first IP" should be blocked
      const result = rateLimit(request, config)
      expect(result).not.toBeNull()
    })

    it('uses default config when not provided', () => {
      const request = createMockRequest('192.168.1.7')

      // Default is 100 requests per minute
      for (let i = 0; i < 100; i++) {
        const result = rateLimit(request)
        expect(result).toBeNull()
      }

      // 101st should be blocked
      const result = rateLimit(request)
      expect(result).not.toBeNull()
    })
  })

  describe('authRateLimit', () => {
    it('has strict limits (5 requests per 15 minutes)', () => {
      const request = createMockRequest('192.168.2.1')

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        const result = authRateLimit(request)
        expect(result).toBeNull()
      }

      // 6th should be blocked
      const result = authRateLimit(request)
      expect(result).not.toBeNull()
    })

    it('resets after 15 minutes', () => {
      const request = createMockRequest('192.168.2.2')

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        authRateLimit(request)
      }

      // Should be blocked
      expect(authRateLimit(request)).not.toBeNull()

      // Advance 15 minutes + 1 second
      vi.advanceTimersByTime(15 * 60 * 1000 + 1000)

      // Should be allowed again
      expect(authRateLimit(request)).toBeNull()
    })
  })

  describe('apiRateLimit', () => {
    it('allows 60 requests per minute', () => {
      const request = createMockRequest('192.168.3.1')

      // Should allow 60 requests
      for (let i = 0; i < 60; i++) {
        const result = apiRateLimit(request)
        expect(result).toBeNull()
      }

      // 61st should be blocked
      const result = apiRateLimit(request)
      expect(result).not.toBeNull()
    })

    it('resets after 1 minute', () => {
      const request = createMockRequest('192.168.3.2')

      // Use up 60 requests
      for (let i = 0; i < 60; i++) {
        apiRateLimit(request)
      }

      // Should be blocked
      expect(apiRateLimit(request)).not.toBeNull()

      // Advance 1 minute + 1 second
      vi.advanceTimersByTime(61000)

      // Should be allowed again
      expect(apiRateLimit(request)).toBeNull()
    })
  })

  describe('checkInRateLimit', () => {
    it('allows 30 requests per minute', () => {
      const request = createMockRequest('192.168.4.1')

      // Should allow 30 requests
      for (let i = 0; i < 30; i++) {
        const result = checkInRateLimit(request)
        expect(result).toBeNull()
      }

      // 31st should be blocked
      const result = checkInRateLimit(request)
      expect(result).not.toBeNull()
    })
  })
})
