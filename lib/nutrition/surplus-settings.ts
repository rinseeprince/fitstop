/**
 * A nutrition plan's two training-surplus settings (migration 196): "Apply
 * training day surplus" — whether a day with a session adds its sessions'
 * surplus percentage to the baseline — and "Add training calories as" — false
 * keeps the plan's carb:fat split, true adds the whole surplus as carbs.
 *
 * They belong to each saved version and are written by the plan save, so a day
 * is priced with the settings of the version covering it (owner, 2026-09-23: a
 * past day's target never changes, and the settings apply on save, never when
 * a switch moves). A change reaches the days from the save's first day on and
 * never an earlier one.
 */
export type SurplusSettings = {
  includeActivityBurn: boolean;
  surplusAsCarbs: boolean;
};

/**
 * What a client's first plan starts from, and what a client with no plan
 * covering the day reads: the surplus on, kept to the plan's split. The same
 * pair as the columns' defaults.
 */
export const DEFAULT_SURPLUS_SETTINGS: SurplusSettings = {
  includeActivityBurn: true,
  surplusAsCarbs: false,
};

/** A version row's two settings, or the defaults when no version is given. */
export function surplusSettingsOf(
  version: { include_activity_burn: boolean; surplus_as_carbs: boolean } | null
): SurplusSettings {
  if (!version) return DEFAULT_SURPLUS_SETTINGS;
  return {
    includeActivityBurn: version.include_activity_burn,
    surplusAsCarbs: version.surplus_as_carbs,
  };
}
