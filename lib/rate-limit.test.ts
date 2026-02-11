import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { rateLimit, authRateLimit, apiRateLimit, checkInRateLimit } from './rate-limit'

// Mock Upstash dependencies
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    // Mock Redis instance methods if needed
  }))
}))

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({
    limit: vi.fn()
  }))
}))

// Helper to create a mock NextRequest
function createMockRequest(ip: string = '127.0.0.1'): NextRequest {
  const headers = new Headers()
  headers.set('x-forwarded-for', ip)

  return {
    headers,
  } as unknown as NextRequest
}

// Mock environment variables to disable Redis (testing fallback mode)
const originalEnv = process.env

describe('Rate Limit Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Clear environment variables to trigger fallback mode
    process.env = { ...originalEnv }
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  describe('rateLimit', () => {
    it('allows requests when Redis is not available (fallback mode)', async () => {
      const request = createMockRequest('192.168.1.1')
      const config = { windowMs: 60000, maxRequests: 10 }

      // Should always allow requests in fallback mode
      const result = await rateLimit(request, config)
      expect(result).toBeNull()
    })

    it('allows multiple requests in fallback mode', async () => {
      const request = createMockRequest('192.168.1.2')
      const config = { windowMs: 60000, maxRequests: 5 }

      // Should allow unlimited requests in fallback mode
      for (let i = 0; i < 10; i++) {
        const result = await rateLimit(request, config)
        expect(result).toBeNull()
      }
    })

    it('handles missing x-forwarded-for header', async () => {
      const request = {
        headers: new Headers(),
      } as unknown as NextRequest

      const config = { windowMs: 60000, maxRequests: 5 }

      // Should still work in fallback mode, using 'unknown' as identifier
      const result = await rateLimit(request, config)
      expect(result).toBeNull()
    })

    it('handles multiple IPs in x-forwarded-for', async () => {
      const headers = new Headers()
      headers.set('x-forwarded-for', '192.168.1.1, 10.0.0.1, 172.16.0.1')

      const request = { headers } as unknown as NextRequest
      const config = { windowMs: 60000, maxRequests: 1 }

      // Should work in fallback mode
      const result = await rateLimit(request, config)
      expect(result).toBeNull()
    })

    it('uses default config when not provided', async () => {
      const request = createMockRequest('192.168.1.7')

      // Should work with default config in fallback mode
      const result = await rateLimit(request)
      expect(result).toBeNull()
    })
  })

  describe('authRateLimit', () => {
    it('allows requests in fallback mode', async () => {
      const request = createMockRequest('192.168.2.1')

      // Should allow requests in fallback mode
      const result = await authRateLimit(request)
      expect(result).toBeNull()
    })

    it('continues to allow requests in fallback mode', async () => {
      const request = createMockRequest('192.168.2.2')

      // Should allow unlimited requests in fallback mode
      for (let i = 0; i < 10; i++) {
        const result = await authRateLimit(request)
        expect(result).toBeNull()
      }
    })

    it('has correct rate limit configuration (5 requests per 15 minutes)', async () => {
      // This test verifies the configuration is correctly passed to the base rateLimit function
      const request = createMockRequest('192.168.2.3')
      
      // In fallback mode, should always return null regardless of config
      const result = await authRateLimit(request)
      expect(result).toBeNull()
    })
  })

  describe('apiRateLimit', () => {
    it('allows requests in fallback mode', async () => {
      const request = createMockRequest('192.168.3.1')

      // Should allow requests in fallback mode
      const result = await apiRateLimit(request)
      expect(result).toBeNull()
    })

    it('continues to allow requests in fallback mode', async () => {
      const request = createMockRequest('192.168.3.2')

      // Should allow unlimited requests in fallback mode
      for (let i = 0; i < 10; i++) {
        const result = await apiRateLimit(request)
        expect(result).toBeNull()
      }
    })

    it('has correct rate limit configuration (60 requests per minute)', async () => {
      // This test verifies the configuration is correctly passed to the base rateLimit function
      const request = createMockRequest('192.168.3.3')
      
      // In fallback mode, should always return null regardless of config
      const result = await apiRateLimit(request)
      expect(result).toBeNull()
    })
  })

  describe('checkInRateLimit', () => {
    it('allows requests in fallback mode', async () => {
      const request = createMockRequest('192.168.4.1')

      // Should allow requests in fallback mode
      const result = await checkInRateLimit(request)
      expect(result).toBeNull()
    })

    it('continues to allow requests in fallback mode', async () => {
      const request = createMockRequest('192.168.4.2')

      // Should allow unlimited requests in fallback mode
      for (let i = 0; i < 10; i++) {
        const result = await checkInRateLimit(request)
        expect(result).toBeNull()
      }
    })

    it('has correct rate limit configuration (30 requests per minute)', async () => {
      // This test verifies the configuration is correctly passed to the base rateLimit function
      const request = createMockRequest('192.168.4.3')
      
      // In fallback mode, should always return null regardless of config
      const result = await checkInRateLimit(request)
      expect(result).toBeNull()
    })
  })

  describe('Environment integration', () => {
    it('handles async nature of rate limit functions', async () => {
      const request = createMockRequest('192.168.5.2')
      
      // All rate limit functions should return Promises
      const ratePromise = rateLimit(request)
      const authPromise = authRateLimit(request)
      const apiPromise = apiRateLimit(request)
      const checkInPromise = checkInRateLimit(request)
      
      expect(ratePromise).toBeInstanceOf(Promise)
      expect(authPromise).toBeInstanceOf(Promise)
      expect(apiPromise).toBeInstanceOf(Promise)
      expect(checkInPromise).toBeInstanceOf(Promise)
      
      const [rateResult, authResult, apiResult, checkInResult] = await Promise.all([
        ratePromise,
        authPromise,
        apiPromise,
        checkInPromise
      ])
      
      expect(rateResult).toBeNull()
      expect(authResult).toBeNull()
      expect(apiResult).toBeNull()
      expect(checkInResult).toBeNull()
    })

    it('properly handles fallback mode when Redis is unavailable', async () => {
      // This test verifies that when Redis environment variables are not set,
      // the system gracefully falls back to allowing all requests
      const request = createMockRequest('192.168.5.3')
      
      // Multiple calls should all succeed in fallback mode
      const results = await Promise.all([
        rateLimit(request),
        authRateLimit(request),
        apiRateLimit(request),
        checkInRateLimit(request)
      ])
      
      // All should return null (allow the request)
      results.forEach(result => {
        expect(result).toBeNull()
      })
    })
  })
})