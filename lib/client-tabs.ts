export const CLIENT_TABS = [
  { value: "overview", label: "Overview" },
  // Label-only rename (Metrics → Journey, Session 3.1): the URL value stays
  // "metrics" so every existing link keeps resolving.
  { value: "metrics", label: "Journey" },
  { value: "training", label: "Training" },
  { value: "nutrition", label: "Nutrition" },
  { value: "wellness", label: "Wellness" },
  { value: "daily-habits", label: "Habits" },
  { value: "check-ins", label: "Check-ins" },
  { value: "notes", label: "Notes" },
] as const

export type ClientTab = (typeof CLIENT_TABS)[number]["value"]

/**
 * The URL for a top-level tab switch. Preserves the query EXCEPT `subtab`,
 * which Training and Nutrition BOTH write: carried across a tab change it
 * satisfies the other tab's pane guard and opens the wrong pane — those
 * guards (`training-plan-builder.tsx`, `nutrition/builder/
 * nutrition-plan-builder.tsx`) defend a render-order race, not a persisted
 * stale param. Dropping it restores their pre-Journey behaviour bit for bit.
 * Single-owner params (Journey's `journey`) ride through — carrying one is
 * always safe and is exactly what restores that tab's pane on the return trip.
 */
export function buildClientTabUrl(
  clientId: string,
  tab: ClientTab,
  currentSearch: string
): string {
  const params = new URLSearchParams(currentSearch)
  params.delete("subtab")
  params.set("tab", tab)
  return `/clients/${clientId}?${params.toString()}`
}
