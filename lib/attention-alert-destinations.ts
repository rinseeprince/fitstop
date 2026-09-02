import type { AlertType } from "@/types/attention-feed";
import type { ClientTab } from "@/lib/client-tabs";

/**
 * Where an attention alert sends the coach: the client-page tab that owns the
 * underlying data, plus the uppercase destination label the Overview renders.
 * Extracted verbatim from the dashboard feed's alertTabMap so the dashboard
 * and the client Overview can never disagree about an alert's destination.
 * No alert type maps to check-ins — the check-in row owns that destination.
 */
type AlertDestination = {
  tab: ClientTab;
  label: "TRAINING" | "WELLNESS" | "NUTRITION" | "HABITS";
};

const TAB_LABELS = {
  training: "TRAINING",
  wellness: "WELLNESS",
  nutrition: "NUTRITION",
  "daily-habits": "HABITS",
} as const satisfies Partial<Record<ClientTab, AlertDestination["label"]>>;

export const ALERT_DESTINATIONS: Record<AlertType, AlertDestination> = {
  mood_drop: { tab: "wellness", label: TAB_LABELS.wellness },
  energy_drop: { tab: "wellness", label: TAB_LABELS.wellness },
  high_stress: { tab: "wellness", label: TAB_LABELS.wellness },
  high_soreness: { tab: "wellness", label: TAB_LABELS.wellness },
  no_log_gap: { tab: "wellness", label: TAB_LABELS.wellness },
  nutrition_missed: { tab: "nutrition", label: TAB_LABELS.nutrition },
  activity_cal_mismatch: { tab: "nutrition", label: TAB_LABELS.nutrition },
  training_missed: { tab: "training", label: TAB_LABELS.training },
  partial_training_pattern: { tab: "training", label: TAB_LABELS.training },
  habit_dropoff: { tab: "daily-habits", label: TAB_LABELS["daily-habits"] },
  no_engagement: { tab: "training", label: TAB_LABELS.training },
};

export function alertDestination(type: AlertType): AlertDestination {
  return ALERT_DESTINATIONS[type];
}
