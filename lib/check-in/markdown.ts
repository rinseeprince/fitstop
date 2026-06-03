/**
 * Defensively strip inline markdown emphasis from AI-generated text so legacy
 * check-ins (whose model output included **bold** / *italic*) render clean in
 * plain-text containers. The permanent fix is the plain-text AI output schema
 * (Session 4); this is the render-time safety net for already-stored data.
 *
 * Deliberately conservative: it removes the emphasis markers the model emitted
 * around words plus leading heading / list markers, and leaves ordinary
 * underscores (snake_case) untouched.
 */
export function stripInlineMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+?)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*]\s+/gm, "")
    .trim();
}
