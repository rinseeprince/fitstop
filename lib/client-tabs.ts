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
 * The URL for a top-level tab switch. Preserves the query EXCEPT the LEGACY
 * `subtab`, which Training and Nutrition BOTH used to write: carried across a
 * tab change it satisfies the other tab's pane guard and opens the wrong pane.
 * Nothing writes it since Session 7.2 — each tab owns a param of its own name
 * (`journey`, `training`, `nutrition`) — but it is still deleted here, because
 * an old bookmark can still carry one in.
 *
 * Single-owner params ride through, which is exactly what restores each tab's
 * pane on the return trip. Carrying one is always safe: only its own tab reads
 * it, so a value belonging to a tab you are not on is inert.
 *
 * `extraParams` ADDRESSES a pane on arrival (the Overview's block-ending row
 * sends `{ journey: "blocks" }`): each entry is set after the tab, overriding
 * any carried value. Only single-owner params belong here — setting `subtab`
 * through it would reintroduce the cross-tab guard bug this function exists
 * to prevent. A `null` value DELETES the key: the whole query is carried, so
 * a caller addressing a param sometimes needs to clear the last trip's value
 * rather than leave a stale one to win (the exercise drill-down's optional
 * `exerciseId`, which the destination prefers over `exerciseName`).
 */
export function buildClientTabUrl(
  clientId: string,
  tab: ClientTab,
  currentSearch: string,
  extraParams?: Record<string, string | null>
): string {
  const params = new URLSearchParams(currentSearch)
  params.delete("subtab")
  params.set("tab", tab)
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  return `/clients/${clientId}?${params.toString()}`
}

/** The two tabs that own a pane param named after themselves. Journey is the
 *  same shape (`?journey=`) but resolves its own value in
 *  `metrics-tab-content.tsx`; these are the two that migrated off the shared
 *  `?subtab=` in Session 7.2. */
export type PaneOwnerTab = "training" | "nutrition"

/**
 * The pane a tab should show, read from the URL.
 *
 * The SINGLE-OWNER param is read UNCONDITIONALLY. Nothing else writes it, so
 * the race the legacy guard defends cannot occur: in the window where
 * `activeTab` has flipped but `router.replace` has not landed, the URL carries
 * THIS tab's own last value — the right answer, not a foreign one. Guarding it
 * would also break every deep link into a pane, because the builder mounts
 * while the URL still names the previous tab: a guarded read returns null,
 * renders the default pane, then swaps when the replace lands. A visible flash
 * on arrival, every time.
 *
 * The LEGACY `subtab` keeps the guard for exactly the reason it was written
 * (Session 3.1): Training and Nutrition BOTH wrote it, so carried across a tab
 * switch it satisfies the other tab's guard and opens the wrong pane. It stays
 * guarded for as long as an old link can still carry one.
 */
export function resolvePaneParam(
  search: URLSearchParams,
  tab: PaneOwnerTab
): string | null {
  return search.get(tab) ?? (search.get("tab") === tab ? search.get("subtab") : null)
}

/**
 * The query for a pane switch within a tab. Sets the tab's own param and drops
 * the legacy shared one, so a link that arrived carrying `?subtab=` cleans
 * itself up on the coach's first pane click rather than riding along to
 * satisfy the other tab's guard later.
 */
export function paneParamSearch(
  currentSearch: string,
  tab: PaneOwnerTab,
  pane: string
): string {
  const params = new URLSearchParams(currentSearch)
  params.set(tab, pane)
  params.delete("subtab")
  return params.toString()
}

