/**
 * A nutrition version's daily calories: the coach's custom calories when the
 * custom macros are on, else its baseline — what every day of its grid holds
 * before a session's surplus or a hand edit.
 */
export function versionCalories(version: {
  baselineCalories: number;
  customMacrosEnabled: boolean;
  customCalories: number | null;
}): number {
  return version.customMacrosEnabled && version.customCalories != null
    ? version.customCalories
    : version.baselineCalories;
}
