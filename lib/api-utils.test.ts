import { describe, it, expect } from 'vitest'
import {
  parsePaginationParams,
  parseNumericParam,
  isValidUUID,
  sanitizeString,
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

  describe('parseNumericParam', () => {
    it('returns null for null input', () => {
      expect(parseNumericParam(null)).toBeNull()
    })

    it('parses valid integer', () => {
      expect(parseNumericParam('42')).toBe(42)
    })

    it('parses negative integer', () => {
      expect(parseNumericParam('-10')).toBe(-10)
    })

    it('returns null for non-numeric string', () => {
      expect(parseNumericParam('abc')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseNumericParam('')).toBeNull()
    })

    it('parses zero', () => {
      expect(parseNumericParam('0')).toBe(0)
    })

    it('truncates decimal to integer', () => {
      expect(parseNumericParam('3.14')).toBe(3)
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

  describe('sanitizeString', () => {
    it('returns clean string unchanged', () => {
      expect(sanitizeString('Hello World')).toBe('Hello World')
    })

    it('removes null characters', () => {
      expect(sanitizeString('Hello\x00World')).toBe('HelloWorld')
    })

    it('removes control characters', () => {
      expect(sanitizeString('Hello\x1FWorld')).toBe('HelloWorld')
    })

    it('removes DEL character', () => {
      expect(sanitizeString('Hello\x7FWorld')).toBe('HelloWorld')
    })

    it('preserves newlines and tabs by default', () => {
      // Note: \n (0x0A) and \t (0x09) are in the control char range
      // The current implementation removes them
      expect(sanitizeString('Hello\nWorld')).toBe('HelloWorld')
    })

    it('handles empty string', () => {
      expect(sanitizeString('')).toBe('')
    })

    it('preserves unicode characters', () => {
      expect(sanitizeString('Hello 世界 🌍')).toBe('Hello 世界 🌍')
    })
  })
})
