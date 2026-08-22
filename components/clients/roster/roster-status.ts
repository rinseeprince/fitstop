import type { RosterStatus } from "@/lib/roster-views"

/**
 * The roster's status vocabulary and chip tones.
 *
 * Two changes from the old roster rows, both required by the one-warning-tone
 * rule: `invited` and `awaiting_activation` used to render in `#d97706` amber,
 * which said "something is wrong" about a client who is merely new. Amber is
 * now reserved for lateness, which lives in the Last check-in column, and both
 * stages take the neutral chip. Labels are sentence case and say the state, not
 * the stage name ("Invite sent", not "Invited").
 */
export const ROSTER_STATUS_LABEL: Record<RosterStatus, string> = {
  invited: "Invite sent",
  awaiting_review: "Intake complete",
  awaiting_activation: "Awaiting activation",
  active: "Active",
  inactive: "Inactive",
}

/** Shared chip geometry — an inner chip, so 4px per the radius table. */
export const CHIP_BASE_CLASS =
  "inline-flex items-center rounded-[4px] px-2 py-0.5 text-[11px] font-medium"

export const ROSTER_STATUS_CHIP: Record<RosterStatus, string> = {
  invited: "bg-[#f0f5f4] text-[#5a7d82]",
  awaiting_review: "bg-[rgba(13,148,136,0.05)] text-[#0a5c55]",
  awaiting_activation: "bg-[#f0f5f4] text-[#5a7d82]",
  active: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]",
  inactive: "bg-[rgba(0,0,0,0.03)] text-[#93b0b4]",
}
