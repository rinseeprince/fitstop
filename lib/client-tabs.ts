export const CLIENT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "roadmap", label: "Roadmap" },
  { value: "metrics", label: "Metrics" },
  { value: "training", label: "Training" },
  { value: "nutrition", label: "Nutrition" },
  { value: "wellness", label: "Wellness" },
  { value: "daily-habits", label: "Habits" },
  { value: "check-ins", label: "Check-ins" },
  { value: "notes", label: "Notes" },
] as const

export type ClientTab = (typeof CLIENT_TABS)[number]["value"]
