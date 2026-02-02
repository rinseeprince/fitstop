/**
 * API utility functions for common operations
 */

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/**
 * Safely parse pagination parameters from URL search params.
 * Returns validated limit and offset, or error if invalid.
 */
export function parsePaginationParams(searchParams: URLSearchParams): {
  valid: true;
  limit: number;
  offset: number;
} | {
  valid: false;
  error: string;
} {
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  let limit = DEFAULT_PAGE_LIMIT;
  let offset = 0;

  if (limitParam !== null) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit < 1) {
      return { valid: false, error: "Invalid limit parameter: must be a positive integer" };
    }
    if (limit > MAX_PAGE_LIMIT) {
      return { valid: false, error: `Invalid limit parameter: maximum is ${MAX_PAGE_LIMIT}` };
    }
  }

  if (offsetParam !== null) {
    offset = parseInt(offsetParam, 10);
    if (isNaN(offset) || offset < 0) {
      return { valid: false, error: "Invalid offset parameter: must be a non-negative integer" };
    }
  }

  return { valid: true, limit, offset };
}

/**
 * Safely parse a numeric ID parameter.
 * Returns the number if valid, null otherwise.
 */
export function parseNumericParam(value: string | null): number | null {
  if (value === null) return null;

  const num = parseInt(value, 10);
  if (isNaN(num)) return null;

  return num;
}

/**
 * Validate UUID format
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Sanitize a string for safe use in responses (strip control characters)
 */
export function sanitizeString(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '');
}
