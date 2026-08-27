import { format } from "date-fns";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

// The vocabulary the session picker and the week view share for a session of
// the client's week: the app's date spelling and the state chip. One module so
// the two surfaces cannot word a state — or spell a day — differently.

/** The app's date spelling (`EEE, MMM d`) — see training-event-occupancy.ts. */
export function formatDay(date: string): string {
  return format(new Date(date + "T00:00:00"), "EEE, MMM d");
}

export function stateLabel(state: ClientTrainingWeekSession["state"]): string {
  switch (state) {
    case "today":
      return "Today";
    case "missed":
      return "Missed";
    case "done":
      return "Done";
    default:
      return "Upcoming";
  }
}

export function stateClass(state: ClientTrainingWeekSession["state"]): string {
  switch (state) {
    case "missed":
      return "bg-[rgba(192,96,96,0.08)] text-[#c06060]";
    case "today":
      return "bg-[rgba(13,148,136,0.05)] text-[#0d9488]";
    case "done":
      return "bg-[rgba(13,148,136,0.12)] text-[#0a5c55]";
    default:
      return "bg-[#f0f4f4] text-[#5a7d82]";
  }
}
