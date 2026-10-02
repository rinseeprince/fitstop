import { toast } from "sonner";
import { HabitEntryError } from "@/hooks/use-client-habit-entries";

/**
 * A habit entry that did not save, said out loud — on the habits page and the
 * check-in's Habits step alike: a refusal in the server's own sentence, a day
 * locked underneath the screen (a check-in sent from another tab) under its
 * own title, and a write that got no answer in the words the other log pages
 * use, never the browser's own ("Failed to fetch").
 */
export function toastHabitEntryError(error: unknown): void {
  if (!(error instanceof HabitEntryError)) {
    console.error("[habits] entry write failed:", error);
    toast.error("Couldn't update habit", { description: "Network error. Please try again." });
  } else if (error.status === 403) {
    toast.error("This day is locked", { description: error.message });
  } else {
    toast.error("Couldn't update habit", { description: error.message });
  }
}
