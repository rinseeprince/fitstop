import type {
  CheckIn,
  CheckInReview,
  CheckInWatchItem,
  CheckInCoachAction,
  EnhancedAIData,
  EnhancedAIDataV3,
  AIInsight,
} from "@/types/check-in";
import { stripInlineMarkdown } from "@/lib/check-in/markdown";

type AnyInsights = CheckIn["aiInsights"];

function isV3(insights: AnyInsights): insights is EnhancedAIDataV3 {
  return (
    !!insights &&
    !Array.isArray(insights) &&
    (insights as { _version?: number })._version === 3
  );
}

function isV2(insights: AnyInsights): insights is EnhancedAIData {
  return (
    !!insights &&
    !Array.isArray(insights) &&
    (insights as { _version?: number })._version === 2
  );
}

const INSIGHT_TYPE_TO_WATCH: Record<AIInsight["type"], CheckInWatchItem["type"]> = {
  strength: "win",
  concern: "risk",
  trend: "trend",
};

const URGENCY_TO_PRIORITY: Record<
  "now" | "next_check_in" | "monitor",
  CheckInCoachAction["priority"]
> = {
  now: "high",
  next_check_in: "medium",
  monitor: "low",
};

/**
 * Build a CheckInReview from a stored check-in. New (v3) data maps straight
 * through; legacy v2 / array data is mapped so pre-v3 check-ins still render in
 * the four-block rail without needing regeneration. All strings are passed
 * through stripInlineMarkdown so old markdown never leaks.
 */
export function toCheckInReview(checkIn: CheckIn): CheckInReview {
  const summary = stripInlineMarkdown(checkIn.aiSummary ?? "");
  const clientMessage = stripInlineMarkdown(checkIn.aiResponseDraft ?? "");
  const insights = checkIn.aiInsights;

  if (isV3(insights)) {
    return {
      summary,
      watchItems: insights.watchItems ?? [],
      themes: insights.themes ?? [],
      coachActions: insights.coachActions ?? [],
      clientMessage,
    };
  }

  // Legacy mapping: v2 object or the oldest AIInsight[] array shape.
  const legacyInsights: AIInsight[] = Array.isArray(insights)
    ? insights
    : isV2(insights)
    ? insights.insights ?? []
    : [];

  const watchItems: CheckInWatchItem[] = legacyInsights.map((i) => ({
    type: INSIGHT_TYPE_TO_WATCH[i.type] ?? "trend",
    text: stripInlineMarkdown(i.text),
  }));

  // Surface v2 "flagged for review" concerns as flag watch items.
  if (isV2(insights) && insights.notesIntelligence?.concerns?.length) {
    for (const concern of insights.notesIntelligence.concerns) {
      watchItems.push({ type: "flag", text: stripInlineMarkdown(concern) });
    }
  }

  const themes = isV2(insights)
    ? (insights.notesIntelligence?.themes ?? []).map((t) => stripInlineMarkdown(t))
    : [];

  // Prefer v2 coachActions (urgency-based); otherwise fall back to ai_recommendations.
  let coachActions: CheckInCoachAction[] = [];
  if (isV2(insights) && insights.coachActions?.length) {
    coachActions = insights.coachActions.map((a) => ({
      priority: URGENCY_TO_PRIORITY[a.urgency] ?? "medium",
      text: stripInlineMarkdown(a.action),
    }));
  } else if (checkIn.aiRecommendations?.length) {
    coachActions = checkIn.aiRecommendations.map((r) => ({
      priority: r.priority,
      text: stripInlineMarkdown(r.text),
    }));
  }

  return { summary, watchItems, themes, coachActions, clientMessage };
}
