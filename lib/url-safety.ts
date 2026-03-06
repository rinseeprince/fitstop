/**
 * Checks if a hostname resolves to a private/internal IP range.
 * Used to prevent SSRF attacks when fetching user-supplied URLs.
 */
export function isPrivateHostname(hostname: string): boolean {
  // Strip IPv6 brackets (new URL('http://[::1]/').hostname returns '[::1]')
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Block localhost variants
  if (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "0.0.0.0" ||
    lower.endsWith(".localhost")
  ) {
    return true;
  }

  // Block private IPv4 ranges
  const privateIPv4Patterns = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^169\.254\./, // Link-local
    /^0\./, // 0.0.0.0/8
  ];
  if (privateIPv4Patterns.some((r) => r.test(lower))) {
    return true;
  }

  // Block private IPv6 ranges
  const privateIPv6Patterns = [
    /^fc00:/i, // Unique local
    /^fd[0-9a-f]{2}:/i, // Unique local (fd00::/8)
    /^fe80:/i, // Link-local
  ];
  if (privateIPv6Patterns.some((r) => r.test(lower))) {
    return true;
  }

  // Check IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) — extract embedded IPv4
  const ipv4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped && privateIPv4Patterns.some((r) => r.test(ipv4Mapped[1]))) {
    return true;
  }

  // Block metadata endpoints (cloud providers)
  if (lower === "metadata.google.internal") {
    return true;
  }

  return false;
}

/**
 * Validates a URL is safe for server-side fetching (no SSRF).
 * Returns an error message if unsafe, null if safe.
 */
export function validateExternalUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only HTTP(S) URLs are supported";
  }

  if (isPrivateHostname(parsed.hostname)) {
    return "Internal URLs are not allowed";
  }

  return null;
}
