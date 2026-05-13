import type { PhaseStatus, Milestone } from "./roadmap";

export type ClientProgram = {
  roadmap: {
    id: string;
    name: string;
    longTermGoal: string | null;
    goalWeight: number | null;
    goalBodyFatPercentage: number | null;
    status: string;
    startedAt: string | null;
    targetEndDate: string | null;
  };
  phases: {
    id: string;
    name: string;
    description: string | null;
    objectives: string | null;
    orderIndex: number;
    status: PhaseStatus;
    startDate: string | null;
    endDate: string | null;
    durationWeeks: number | null;
    phaseGoalWeight: number | null;
    phaseGoalBodyFatPercentage: number | null;
    coachReflection: string | null;
    milestones: Milestone[];
  }[];
  activePhaseId: string | null;
  weightUnit: "lbs" | "kg";
  metrics: {
    startingWeight: number | null;
    currentWeight: number | null;
  };
};
