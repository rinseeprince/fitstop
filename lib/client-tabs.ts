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
