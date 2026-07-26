import { describe, it, expect } from "vitest";
import { ALERT_DESTINATIONS, alertDestination } from "./attention-alert-destinations";
import type { AlertType } from "@/types/attention-feed";

// The tab values must stay byte-identical to the dashboard feed's original
// alertTabMap — the Link hrefs it builds are behavior.
const EXPECTED_TABS: Record<AlertType, string> = {
  mood_drop: "wellness",
  energy_drop: "wellness",
  high_stress: "wellness",
  high_soreness: "wellness",
  no_log_gap: "wellness",
  nutrition_missed: "nutrition",
  activity_cal_mismatch: "nutrition",
  training_missed: "training",
  partial_training_pattern: "training",
  habit_dropoff: "daily-habits",
  no_engagement: "training",
};

describe("alertDestination", () => {
  it("covers all 11 alert types", () => {
    expect(Object.keys(ALERT_DESTINATIONS).sort()).toEqual(Object.keys(EXPECTED_TABS).sort());
    expect(Object.keys(ALERT_DESTINATIONS)).toHaveLength(11);
  });

  it.each(Object.entries(EXPECTED_TABS))("maps %s to the %s tab", (type, tab) => {
    expect(alertDestination(type as AlertType).tab).toBe(tab);
  });

  it("labels every destination with its tab's uppercase name", () => {
    expect(alertDestination("training_missed").label).toBe("TRAINING");
    expect(alertDestination("mood_drop").label).toBe("WELLNESS");
    expect(alertDestination("nutrition_missed").label).toBe("NUTRITION");
    expect(alertDestination("habit_dropoff").label).toBe("HABITS");
  });

  it("never maps to check-ins (the check-in row owns that destination)", () => {
    for (const dest of Object.values(ALERT_DESTINATIONS)) {
      expect(dest.tab).not.toBe("check-ins");
    }
  });
});
