import { describe, it, expect } from 'vitest'
import {
  parsePaginationParams,
  isValidUUID,
} from './api-utils'

describe('API Utilities', () => {
  describe('parsePaginationParams', () => {
    it('returns default values when no params provided', () => {
      const params = new URLSearchParams()
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.limit).toBe(20)
        expect(result.offset).toBe(0)
      }
    })

    it('parses valid limit and offset', () => {
      const params = new URLSearchParams('limit=50&offset=10')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.limit).toBe(50)
        expect(result.offset).toBe(10)
      }
    })

    it('rejects negative limit', () => {
      const params = new URLSearchParams('limit=-5')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Invalid limit')
      }
    })

    it('rejects zero limit', () => {
      const params = new URLSearchParams('limit=0')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Invalid limit')
      }
    })

    it('rejects limit over maximum (100)', () => {
      const params = new URLSearchParams('limit=200')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('maximum')
      }
    })

    it('rejects negative offset', () => {
      const params = new URLSearchParams('offset=-1')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Invalid offset')
      }
    })

    it('rejects non-numeric limit', () => {
      const params = new URLSearchParams('limit=abc')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Invalid limit')
      }
    })

    it('rejects non-numeric offset', () => {
      const params = new URLSearchParams('offset=xyz')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Invalid offset')
      }
    })

    it('accepts offset of zero', () => {
      const params = new URLSearchParams('offset=0')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.offset).toBe(0)
      }
    })

    it('accepts limit at maximum boundary', () => {
      const params = new URLSearchParams('limit=100')
      const result = parsePaginationParams(params)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.limit).toBe(100)
      }
    })
  })

  describe('isValidUUID', () => {
    it('validates correct UUID v4', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('validates correct UUID v1', () => {
      expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
    })

    it('rejects UUID without dashes', () => {
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false)
    })

    it('rejects short string', () => {
      expect(isValidUUID('550e8400')).toBe(false)
    })

    it('rejects random string', () => {
      expect(isValidUUID('not-a-uuid-at-all')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isValidUUID('')).toBe(false)
    })

    it('validates lowercase UUID', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('validates uppercase UUID', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
    })
  })
})
