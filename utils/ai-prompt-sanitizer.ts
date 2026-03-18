/**
 * Sanitization utility for user-generated content before it enters AI prompts.
 * Protects against prompt injection attempts and ensures content safety.
 */

/**
 * Sanitizes user-generated input to prevent prompt injection attacks.
 *
 * @param input - The user-generated string to sanitize
 * @param maxLength - Maximum allowed length (default 2000)
 * @returns Sanitized string safe for AI prompt interpolation
 */
export function sanitizeForAIPrompt(input: string, maxLength = 2000): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  // Remove null bytes and non-printable characters (except newlines, tabs, and spaces)
  // eslint-disable-next-line no-control-regex
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Normalize Unicode to prevent confusable character attacks
  sanitized = sanitized.normalize("NFKC");

  // Remove zero-width characters used to bypass filters
  sanitized = sanitized.replace(
    /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g,
    ""
  );

  // Split into lines for injection pattern checking
  const lines = sanitized.split("\n");

  // Filter out lines that look like prompt injection attempts
  const injectionPatterns = [
    /^\s*ignore\s+(all\s+)?(previous|above|prior)/i,
    /^\s*disregard\s+(all\s+)?(previous|above|prior)/i,
    /^\s*forget\s+(all\s+)?(previous|above|prior)/i,
    /^\s*system\s*:/i,
    /^\s*assistant\s*:/i,
    /^\s*human\s*:/i,
    /^\s*user\s*:/i,
    /^\s*override\s+(all\s+)?(instructions|rules|guidelines)/i,
    /^\s*you\s+are\s+now\s+/i,
    /^\s*new\s+instructions?\s*:/i,
    /^\s*\[system\]/i,
    /^\s*<\|.*\|>/i,
    /^\s*###\s*(system|instruction)/i,
  ];

  const filteredLines = lines.filter(
    (line) => !injectionPatterns.some((pattern) => pattern.test(line))
  );

  sanitized = filteredLines.join("\n");

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized.trim();
}

/**
 * Wraps user content with structural delimiters for safe inclusion in AI prompts.
 * This is the primary defense — the content is clearly marked as user data,
 * making it harder for injected instructions to be treated as system-level.
 *
 * @param content - The user-generated content to wrap
 * @param label - The XML tag label (default "client_response")
 * @returns Sanitized content wrapped in structural delimiters
 */
export function wrapUserContent(
  content: string,
  label = "client_response"
): string {
  let sanitized = sanitizeForAIPrompt(content);
  // Strip closing delimiter tags to prevent delimiter escape attacks
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  sanitized = sanitized.replace(new RegExp(`</${escaped}>`, "gi"), "");
  return `<${label}>\n${sanitized}\n</${label}>`;
}
