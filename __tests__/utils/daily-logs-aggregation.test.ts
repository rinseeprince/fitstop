import { describe, it, expect } from 'vitest';
import { aggregateDailyLogs, sanitiseReps } from "@/utils/daily-logs-aggregation";
import type { DailyLog } from "@/types/daily-log";

describe("aggregateDailyLogs", () => {
  it("returns zero values for empty array", () => {
    const result = aggregateDailyLogs([]);
    
    expect(result.avgMood).toBe(0);
    expect(result.avgEnergy).toBe(0);
    expect(result.avgSleep).toBe(0);
    expect(result.avgStress).toBe(0);
    expect(result.sessionsCompleted).toBe(0);
    expect(result.totalPlannedSessions).toBe(0);
    expect(result.nutritionHitDays).toBe(0);
    expect(result.totalLoggedDays).toBe(0);
  });

  it("correctly aggregates wellness metrics with mixed data", () => {
    const logs: Partial<DailyLog>[] = [
      {
        id: "1",
        date: "2024-01-01",
        mood: 4,
        energy: 8,
        sleep: 7,
        stress: 3,
      },
      {
        id: "2",
        date: "2024-01-02",
        mood: 3,
        energy: 6,
        // sleep missing
        stress: 5,
      },
      {
        id: "3",
        date: "2024-01-03",
        // all wellness metrics missing
      },
    ];

    const result = aggregateDailyLogs(logs as DailyLog[]);
    
    expect(result.avgMood).toBe(3.5); // (4 + 3) / 2
    expect(result.avgEnergy).toBe(7); // (8 + 6) / 2
    expect(result.avgSleep).toBe(7); // 7 / 1 (only one value)
    expect(result.avgStress).toBe(4); // (3 + 5) / 2
    expect(result.totalLoggedDays).toBe(3);
  });

  it("correctly counts training sessions", () => {
    const logs: Partial<DailyLog>[] = [
      {
        id: "1",
        date: "2024-01-01",
        trained: true,
        trainingData: {
          sessionCompleted: true,
          trainingSessionId: "session-1",
          trainingSessionName: "Push Day",
          isAlternativeSession: false,
          activityStatuses: {},
          unplannedActivities: [],
        },
      },
      {
        id: "2",
        date: "2024-01-02",
        trained: false,
        trainingData: {
          sessionCompleted: false,
          trainingSessionId: "session-2",
          trainingSessionName: "Pull Day",
          isAlternativeSession: false,
          activityStatuses: {},
          unplannedActivities: [],
        },
      },
      {
        id: "3",
        date: "2024-01-03",
        trained: true,
        trainingData: {
          sessionCompleted: true,
          trainingSessionId: "session-3",
          trainingSessionName: "Legs",
          isAlternativeSession: false,
          activityStatuses: {},
          unplannedActivities: [],
        },
      },
    ];

    const result = aggregateDailyLogs(logs as DailyLog[]);
    
    expect(result.sessionsCompleted).toBe(2); // 2 trained = true
    expect(result.totalPlannedSessions).toBe(3); // 3 have trainingSessionId
  });

  it("correctly counts activity completions with proper shape", () => {
    const logs: Partial<DailyLog>[] = [
      {
        id: "1",
        date: "2024-01-01",
        trainingData: {
          sessionCompleted: true,
          trainingSessionId: "session-1",
          trainingSessionName: "Full Body",
          isAlternativeSession: false,
          activityStatuses: {
            "activity-1": {
              completed: true,
              activityName: "Running",
              estimatedCalories: 300,
            },
            "activity-2": {
              completed: false,
              activityName: "Cycling",
              estimatedCalories: 250,
            },
            "activity-3": {
              completed: true,
              activityName: "Swimming",
              estimatedCalories: 400,
            },
          },
          unplannedActivities: [
            {
              activityName: "Basketball",
              intensityLevel: "moderate",
              durationMinutes: 30,
            },
          ],
        },
      },
    ];

    const result = aggregateDailyLogs(logs as DailyLog[]);
    
    expect(result.totalPlannedActivities).toBe(3);
    expect(result.plannedActivitiesCompleted).toBe(2); // Only 2 have completed: true
    expect(result.unplannedActivitiesCount).toBe(1);
  });

  it("correctly counts nutrition adherence", () => {
    const logs: Partial<DailyLog>[] = [
      {
        id: "1",
        date: "2024-01-01",
        nutritionAdherence: "hit",
        caloriesConsumed: 2000,
        targetCalories: 2100,
        calorieSurplusDeficit: -100,
      },
      {
        id: "2",
        date: "2024-01-02",
        nutritionAdherence: "partial",
        caloriesConsumed: 2200,
        targetCalories: 2100,
        calorieSurplusDeficit: 100,
      },
      {
        id: "3",
        date: "2024-01-03",
        nutritionAdherence: "hit",
        caloriesConsumed: 2050,
        targetCalories: 2100,
        calorieSurplusDeficit: -50,
      },
      {
        id: "4",
        date: "2024-01-04",
        nutritionAdherence: "missed",
        caloriesConsumed: 2800,
        targetCalories: 2100,
        calorieSurplusDeficit: 700,
      },
    ];

    const result = aggregateDailyLogs(logs as DailyLog[]);
    
    expect(result.nutritionHitDays).toBe(2); // Only "hit" days count
    expect(result.avgCalories).toBe(2263); // (2000 + 2200 + 2050 + 2800) / 4, rounded
    expect(result.avgTargetCalories).toBe(2100);
    expect(result.totalSurplusDeficit).toBe(650); // -100 + 100 + -50 + 700
  });

  it("handles logs with null and undefined values correctly", () => {
    const logs: Partial<DailyLog>[] = [
      {
        id: "1",
        date: "2024-01-01",
        mood: undefined,
        energy: undefined,
        trained: undefined,
      },
      {
        id: "2",
        date: "2024-01-02",
        mood: 4,
        energy: 7,
        trained: false,
      },
    ];

    const result = aggregateDailyLogs(logs as DailyLog[]);
    
    expect(result.avgMood).toBe(4); // Only count the non-null value
    expect(result.avgEnergy).toBe(7); // Only count the non-undefined value
    expect(result.sessionsCompleted).toBe(0); // null and false both count as not completed
  });

  it("rounds averages correctly", () => {
    const logs: Partial<DailyLog>[] = [
      { id: "1", date: "2024-01-01", mood: 3, energy: 7, sleep: 6, stress: 4 },
      { id: "2", date: "2024-01-02", mood: 4, energy: 8, sleep: 7, stress: 3 },
      { id: "3", date: "2024-01-03", mood: 4, energy: 6, sleep: 8, stress: 5 },
    ];

    const result = aggregateDailyLogs(logs as DailyLog[]);
    
    expect(result.avgMood).toBe(3.7); // (3 + 4 + 4) / 3 = 3.67, rounded to 3.7
    expect(result.avgEnergy).toBe(7); // (7 + 8 + 6) / 3 = 7
    expect(result.avgSleep).toBe(7); // (6 + 7 + 8) / 3 = 7
    expect(result.avgStress).toBe(4); // (4 + 3 + 5) / 3 = 4
  });
});

describe("sanitiseReps", () => {
  it("returns undefined for 0", () => {
    expect(sanitiseReps(0)).toBeUndefined();
  });

  it("returns undefined for negative numbers", () => {
    expect(sanitiseReps(-1)).toBeUndefined();
    expect(sanitiseReps(-100)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(sanitiseReps(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(sanitiseReps(undefined)).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(sanitiseReps(NaN)).toBeUndefined();
  });

  it("returns undefined for non-numeric strings", () => {
    expect(sanitiseReps("abc")).toBeUndefined();
    expect(sanitiseReps("")).toBeUndefined();
  });

  it("returns the number for valid positive integers", () => {
    expect(sanitiseReps(1)).toBe(1);
    expect(sanitiseReps(10)).toBe(10);
    expect(sanitiseReps(100)).toBe(100);
  });

  it("parses valid numeric strings", () => {
    expect(sanitiseReps("5")).toBe(5);
    expect(sanitiseReps("15")).toBe(15);
    expect(sanitiseReps("100")).toBe(100);
  });

  it("returns undefined for zero as string", () => {
    expect(sanitiseReps("0")).toBeUndefined();
  });

  it("returns undefined for negative numbers as strings", () => {
    expect(sanitiseReps("-5")).toBeUndefined();
  });

  it("handles decimal numbers by parsing as integers", () => {
    expect(sanitiseReps(5.7)).toBe(5);
    expect(sanitiseReps("5.7")).toBe(5);
  });
});