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
 *
 * `extraParams` ADDRESSES a pane on arrival (the Overview's block-ending row
 * sends `{ journey: "blocks" }`): each entry is set after the tab, overriding
 * any carried value. Only single-owner params belong here — setting `subtab`
 * through it would reintroduce the cross-tab guard bug this function exists
 * to prevent.
 */
export function buildClientTabUrl(
  clientId: string,
  tab: ClientTab,
  currentSearch: string,
  extraParams?: Record<string, string>
): string {
  const params = new URLSearchParams(currentSearch)
  params.delete("subtab")
  params.set("tab", tab)
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    params.set(key, value)
  }
  return `/clients/${clientId}?${params.toString()}`
}
