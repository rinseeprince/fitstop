/**
 * Upload validation helpers: filename sanitization + magic-byte signature checks.
 * Used by the content upload route and the storage services to defend against
 * path-traversal object keys and files masquerading as an allowed type.
 */

/**
 * Reduce an arbitrary, user-controlled filename to a safe basename: strip any
 * directory components and control/exotic characters so it can't traverse or
 * produce a weird storage object key.
 */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_") // collapse anything exotic
    .replace(/^\.+/, ""); // no leading dots (".." / hidden)
  return cleaned.slice(0, 120) || "file";
}

/**
 * Restrict a file extension derived from a (user-controlled) MIME type to a safe
 * token: alphanumerics only. Prevents `image/../../x` -> ".." style keys.
 */
export function safeExtensionFromMime(mimeType: string, fallback = "jpg"): string {
  const ext = mimeType.split("/")[1]?.replace(/[^A-Za-z0-9]/g, "") ?? "";
  return ext || fallback;
}

// Leading-byte signatures for the types we can reliably sniff.
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  "image/webp": (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // "WEBP"
  "application/pdf": (b) =>
    b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // "%PDF"
};

/**
 * Verify a file's leading bytes match its declared MIME type for sniffable types
 * (images + PDF). Non-sniffable allowed types (office docs, plain text — no
 * reliable magic number) pass through; the MIME allowlist still gates those.
 * Defends against e.g. an HTML/script payload uploaded as image/png.
 */
export function fileSignatureMatches(header: Uint8Array, declaredMime: string): boolean {
  const check = MAGIC[declaredMime];
  if (!check) return true; // not sniffable — rely on the MIME allowlist
  return check(header);
}
