import { formatDistanceToNow } from "date-fns";
import type { CheckInStatus } from "@/types/check-in";

// Format relative time (e.g., "2 hours ago")
export const formatRelativeTime = (dateString: string): string => {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};


// Get status label
export const getStatusLabel = (status: CheckInStatus): string => {
  switch (status) {
    case "pending":
      return "Pending";
    case "reviewed":
      return "Reviewed";
    default:
      return "Unknown";
  }
};
