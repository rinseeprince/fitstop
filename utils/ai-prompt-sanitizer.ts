/**
 * Sanitization utility for user-generated content before it enters AI prompts.
 * Protects against prompt injection attempts and ensures content safety.
 */

/**
 * Sanitizes user-generated input to prevent prompt injection attacks.
 * 
 * @param input - The user-generated string to sanitize
 * @returns Sanitized string safe for AI prompt interpolation
 */
export function sanitizeForAIPrompt(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove null bytes and non-printable characters (except newlines, tabs, and spaces)
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Split into lines for injection pattern checking
  const lines = sanitized.split('\n');
  
  // Filter out lines that look like prompt injection attempts
  const injectionPatterns = [
    /^\s*ignore\s+/i,
    /^\s*disregard\s+/i,
    /^\s*system\s*:/i,
    /^\s*assistant\s*:/i,
    /^\s*human\s*:/i,
    /^\s*override\s+/i,
  ];

  const filteredLines = lines.filter(line => {
    // Check if line starts with any injection pattern
    return !injectionPatterns.some(pattern => pattern.test(line));
  });

  // Rejoin the filtered lines
  sanitized = filteredLines.join('\n');

  // Truncate to maximum 500 characters
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 500);
  }

  return sanitized.trim();
}