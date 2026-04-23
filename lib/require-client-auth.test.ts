import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/rate-limit', () => ({
  clientApiRateLimit: vi.fn(),
  apiRateLimit: vi.fn(),
  checkInRateLimit: vi.fn(),
  aiRateLimit: vi.fn(),
  authRateLimit: vi.fn(),
}))

vi.mock('@/lib/csrf-protection', () => ({
  requireCSRFProtection: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  getAuthenticatedClientId: vi.fn(),
  getAuthenticatedClientWithCheckInDay: vi.fn(),
}))

import {
  requireClientAuth,
  requireClientAuthWithCheckInDay,
} from './require-client-auth'
import {
  clientApiRateLimit,
  apiRateLimit,
  checkInRateLimit,
  aiRateLimit,
  authRateLimit,
} from '@/lib/rate-limit'
import { requireCSRFProtection } from '@/lib/csrf-protection'
import {
  getAuthenticatedClientId,
  getAuthenticatedClientWithCheckInDay,
} from '@/lib/auth-helpers'

function makeRequest(method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/client/test', { method })
}

describe('requireClientAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default happy path: every guard passes
    vi.mocked(clientApiRateLimit).mockResolvedValue(null)
    vi.mocked(apiRateLimit).mockResolvedValue(null)
    vi.mocked(checkInRateLimit).mockResolvedValue(null)
    vi.mocked(aiRateLimit).mockResolvedValue(null)
    vi.mocked(authRateLimit).mockResolvedValue(null)
    vi.mocked(requireCSRFProtection).mockResolvedValue(null)
    vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
  })

  it('returns ok with clientId on happy path', async () => {
    const result = await requireClientAuth(makeRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.clientId).toBe('client-123')
    }
    expect(clientApiRateLimit).toHaveBeenCalledTimes(1)
    expect(requireCSRFProtection).toHaveBeenCalledTimes(1)
    expect(getAuthenticatedClientId).toHaveBeenCalledTimes(1)
  })

  it('short-circuits with 429 when rate-limited', async () => {
    const rateResponse = NextResponse.json(
      { error: 'Too many requests' },
      { status: 429 },
    )
    vi.mocked(clientApiRateLimit).mockResolvedValue(rateResponse)

    const result = await requireClientAuth(makeRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response).toBe(rateResponse)
    }
    // CSRF and auth should NOT have been called once rate limit trips
    expect(requireCSRFProtection).not.toHaveBeenCalled()
    expect(getAuthenticatedClientId).not.toHaveBeenCalled()
  })

  it('short-circuits with 403 when CSRF fails', async () => {
    const csrfResponse = new Response(
      JSON.stringify({ success: false, error: 'CSRF validation failed' }),
      { status: 403 },
    )
    vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse)

    const result = await requireClientAuth(makeRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response).toBe(csrfResponse)
    }
    expect(getAuthenticatedClientId).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null)

    const result = await requireClientAuth(makeRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      const body = await result.response.json()
      expect(body).toEqual({ success: false, error: 'Unauthorized' })
    }
  })

  it('uses the aiRateLimit tier when overridden', async () => {
    await requireClientAuth(makeRequest(), { rateLimit: 'ai', userId: 'user-1' })

    expect(aiRateLimit).toHaveBeenCalledTimes(1)
    expect(aiRateLimit).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(clientApiRateLimit).not.toHaveBeenCalled()
  })

  it('uses the checkInRateLimit tier when overridden', async () => {
    await requireClientAuth(makeRequest(), { rateLimit: 'checkIn' })

    expect(checkInRateLimit).toHaveBeenCalledTimes(1)
    expect(clientApiRateLimit).not.toHaveBeenCalled()
  })

  it('uses the apiRateLimit tier when overridden', async () => {
    await requireClientAuth(makeRequest(), { rateLimit: 'api' })

    expect(apiRateLimit).toHaveBeenCalledTimes(1)
    expect(clientApiRateLimit).not.toHaveBeenCalled()
  })

  it('uses the authRateLimit tier when overridden', async () => {
    await requireClientAuth(makeRequest(), { rateLimit: 'auth' })

    expect(authRateLimit).toHaveBeenCalledTimes(1)
    expect(clientApiRateLimit).not.toHaveBeenCalled()
  })
})

describe('requireClientAuthWithCheckInDay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(clientApiRateLimit).mockResolvedValue(null)
    vi.mocked(requireCSRFProtection).mockResolvedValue(null)
    vi.mocked(getAuthenticatedClientWithCheckInDay).mockResolvedValue({
      clientId: 'client-123',
      checkInDay: 'monday',
    })
  })

  it('returns ok with clientId and checkInDay on happy path', async () => {
    const result = await requireClientAuthWithCheckInDay(makeRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.clientId).toBe('client-123')
      expect(result.checkInDay).toBe('monday')
    }
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedClientWithCheckInDay).mockResolvedValue(null)

    const result = await requireClientAuthWithCheckInDay(makeRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
    }
  })

  it('short-circuits on rate limit before touching auth', async () => {
    vi.mocked(clientApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: 'Too many' }, { status: 429 }),
    )

    const result = await requireClientAuthWithCheckInDay(makeRequest())

    expect(result.ok).toBe(false)
    expect(getAuthenticatedClientWithCheckInDay).not.toHaveBeenCalled()
  })
})
