export const SPLIT_TYPE_LABELS: Record<string, string> = {
  push_pull_legs: "Push/Pull/Legs",
  upper_lower: "Upper/Lower",
  full_body: "Full Body",
  bro_split: "Bro Split",
  push_pull: "Push/Pull",
  custom: "Custom",
};

/**
 * The most days one program holds: 52 weeks of seven. Every day is a real row
 * in a saved program — its sessions, or one rest row.
 */
export const MAX_PROGRAM_DAYS = 364;

/**
 * The most sessions a program's day holds. A day can hold several (a morning
 * run and an evening lift); this is far above any real day and bounds what a
 * program save, the builder and the assistant will carry.
 */
export const MAX_SESSIONS_PER_DAY = 20;

/** The most sessions a week of a program can hold: seven full days. */
export const MAX_SESSIONS_PER_WEEK = 7 * MAX_SESSIONS_PER_DAY;

/**
 * The most sessions one program write carries: a library save, a placement's
 * body, and one Edit plan open (the calendar entries it reads and the sessions
 * it writes). A day can hold several sessions, so this counts sessions, not
 * days.
 */
export const MAX_PROGRAM_SESSIONS = 2000;

/**
 * The most sessions one week-layout write may move. A day can hold several
 * sessions, so a week can hold more than seven; this only bounds one request.
 */
export const MAX_WEEK_LAYOUT_MOVES = 50;
