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

/**
 * A line in an opened row of the Journey's goals table, dated by the day it
 * takes effect on the client's calendar: a deadline change, a nutrition
 * version during the goal (its window, calories and the goal it was built
 * for), or a program starting, replacing another, or ending.
 */
export type GoalHistoryLine =
  | { kind: "deadline"; on: string; from: string | null; to: string | null }
  | {
      kind: "nutrition";
      on: string;
      until: string;
      calories: number;
      /** The weight target (kg) and deadline its calories were priced for. */
      builtFor: { goalWeightKg: number | null; deadline: string | null };
    }
  | { kind: "program"; on: string; change: "starts" | "ends"; name: string }
  | { kind: "program"; on: string; change: "replaces"; name: string; replaced: string };

/**
 * A row of the Journey's goals table (`GET /api/clients/[id]/goals/history`,
 * newest first): the goal with its deadline as it ended, or as it stands.
 */
export type GoalHistoryRow = GoalOnDay & {
  /** Its last day; null while no goal follows it. */
  endsOn: string | null;
  status: "planned" | "current" | "ended";
  /** Oldest first. */
  lines: GoalHistoryLine[];
};

/** `GET /api/clients/[id]/goals`: today's goal and the ones planned after it. */
export type ClientGoalsOverview = {
  current: CurrentGoal | null;
  /** Soonest first, each with the deadline it will start with. */
  planned: GoalOnDay[];
  /** The client's calendar day, which a goal's start is floored on. */
  clientToday: string;
};
