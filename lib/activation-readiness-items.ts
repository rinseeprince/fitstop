import type { ClientTab } from "@/lib/client-tabs"

/** The WIRE shape of `GET /api/clients/[id]/activation-readiness` — the three
 *  plans activation sends through. The client profile is deliberately absent:
 *  it is derived in the browser from the client record the Overview already
 *  holds (`lib/client-profile-completeness.ts`), so it costs no query and the
 *  endpoint keeps answering "is it there?" and never "what is in it". */
export type Readiness = {
  hasTrainingPlan: boolean
  hasNutritionPlan: boolean
  hasHabits: boolean
}

/** Everything the activation card can list. `hasProfile` is a PREREQUISITE,
 *  not a plan — see SETUP_ITEMS. */
export type SetupItemKey = keyof Readiness | "hasProfile"

export type SetupItem = { key: SetupItemKey; label: string; tab: ClientTab }

/** A PLAN row. Narrower than SetupItem on purpose: everything that indexes
 *  `Readiness` (the counter, the footer sentence, the activation dialog) takes
 *  these, so a prerequisite can never be typed into a plan's slot. */
export type PlanItem = SetupItem & { key: keyof Readiness }

/**
 * The three PLANS. Activation "sends" these, so the card's counter, its footer
 * sentence and the activation dialog's missing-list are all about these and
 * ONLY these — adding a fourth entry here would make the card say "4 of 4
 * plans ready" and the footer offer to send a profile through.
 */
export const REQUIRED_ITEMS: PlanItem[] = [
  { key: "hasTrainingPlan", label: "Training plan", tab: "training" },
  { key: "hasNutritionPlan", label: "Nutrition plan", tab: "nutrition" },
  { key: "hasHabits", label: "Daily habits", tab: "daily-habits" },
]

/**
 * The client's own details — height, gender, birth date, activity level and a
 * logged weight. NOT a plan: nothing is sent when the coach activates, and it
 * stays out of the counter and the footer sentence.
 *
 * It leads the list because everything below it is priced off it. The
 * nutrition calculator solves against the TDEE these inputs produce, so
 * programming before they are set is programming against a default age and a
 * default activity multiplier. `tab` is the fallback destination; the card
 * routes a missing WEIGHT to the metrics surface and everything else to the
 * profile editor, because those are two different homes.
 */
export const PROFILE_ITEM: SetupItem = {
  key: "hasProfile",
  label: "Client profile",
  tab: "metrics",
}

/** What the card renders, in the order a coach should work through it. */
export const SETUP_ITEMS: SetupItem[] = [PROFILE_ITEM, ...REQUIRED_ITEMS]
