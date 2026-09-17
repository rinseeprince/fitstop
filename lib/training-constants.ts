export const SPLIT_TYPE_LABELS: Record<string, string> = {
  push_pull_legs: "Push/Pull/Legs",
  upper_lower: "Upper/Lower",
  full_body: "Full Body",
  bro_split: "Bro Split",
  push_pull: "Push/Pull",
  custom: "Custom",
};

/**
 * The most calendar sessions one Edit plan open carries: the bound on the
 * editor's version (the entries it read) and on its save (the sessions it
 * writes). A day can hold several sessions, so this counts sessions, not days.
 */
export const MAX_PLAN_EDIT_SESSIONS = 2000;

/**
 * The most sessions one week-layout write may move. A day can hold several
 * sessions, so a week can hold more than seven; this only bounds one request.
 */
export const MAX_WEEK_LAYOUT_MOVES = 50;
