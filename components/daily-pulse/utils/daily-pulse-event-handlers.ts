import type { TodaysActivity, UnplannedActivity } from "../daily-pulse-content";

/**
 * Event handler functions for daily pulse component.
 * Extracted to reduce component size.
 */

export const handleAddUnplannedActivity = (
  unplannedActivities: UnplannedActivity[],
  setUnplannedActivities: (activities: UnplannedActivity[]) => void
) => (activity: UnplannedActivity) => {
  setUnplannedActivities([...unplannedActivities, activity]);
};

export const handleRemoveUnplannedActivity = (
  unplannedActivities: UnplannedActivity[],
  setUnplannedActivities: (activities: UnplannedActivity[]) => void
) => (index: number) => {
  setUnplannedActivities(unplannedActivities.filter((_, i) => i !== index));
};

export const handleActivityToggle = (
  plannedActivities: TodaysActivity[],
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>,
  setActivityStatuses: (statuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>) => void
) => (activityId: string, completed: boolean) => {
  const activity = plannedActivities.find(a => a.sessionId === activityId);
  if (activity) {
    setActivityStatuses({
      ...activityStatuses,
      [activityId]: {
        completed,
        activityName: activity.activityName,
        estimatedCalories: activity.estimatedCalories
      }
    });
  }
};