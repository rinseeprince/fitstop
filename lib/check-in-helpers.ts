import { stripInlineMarkdown } from "@/lib/check-in/markdown";

/**
 * First sentence of an AI summary, stripped of inline markdown and truncated to
 * 120 chars, for list previews. Shared by the global review queue and the
 * per-client check-ins tab.
 */
export const getAiPreview = (aiSummary?: string): string | null => {
  const clean = stripInlineMarkdown(aiSummary);
  if (!clean) return null;
  const firstSentence = clean.split(/[.!?]\s/)[0];
  return firstSentence.length > 120
    ? firstSentence.slice(0, 120) + "..."
    : firstSentence;
};
