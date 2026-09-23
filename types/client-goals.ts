import type { GoalType } from "@/lib/goals/goal-types";

// A client's goals (migration 193): one row per goal, running from its start
// day until the next goal starts, with every deadline it has had in its own
// dated list. Kilograms and percent, canonical (CONVENTIONS §20).

/** One deadline a goal has had — a date, or none — and the day it took effect. */
export type ClientGoalDeadline = {
  effectiveOn: string;
  deadline: string | null;
  setBy: string | null;
};

export type GoalSource = "coach" | "intake";

/** A goal with every deadline it has had, oldest first. */
export type ClientGoal = {
  id: string;
  clientId: string;
  name: string;
  type: GoalType;
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  description: string | null;
  /** YYYY-MM-DD on the client's calendar. */
  startsOn: string;
  source: GoalSource;
  setBy: string | null;
  createdAt: string;
  updatedAt: string;
  deadlines: ClientGoalDeadline[];
};

/** A goal as it stands on one day: the deadline in force that day. */
export type GoalOnDay = Omit<ClientGoal, "deadlines"> & {
  deadline: string | null;
};

/** The goal in force today, with the readings its progress runs from. */
export type CurrentGoal = GoalOnDay & {
  /** The client's reading on the goal's start day, per metric (kg, %). */
  startReadings: { weight: number | null; bodyFat: number | null };
};

/** A goal that has ended: its last day and the deadline it ended with. */
export type PastGoal = GoalOnDay & { endsOn: string };

/** `GET /api/clients/[id]/goals`: today's goal and the ones planned after it. */
export type ClientGoalsOverview = {
  current: CurrentGoal | null;
  /** Soonest first, each with the deadline it will start with. */
  planned: GoalOnDay[];
  /** The client's calendar day, which a goal's start is floored on. */
  clientToday: string;
};
