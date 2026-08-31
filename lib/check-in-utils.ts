import { formatDistanceToNow } from "date-fns";

// Format relative time (e.g., "2 hours ago")
export const formatRelativeTime = (dateString: string): string => {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};


// Get status label
export const getStatusLabel = (
  status: "pending" | "ai_processed" | "reviewed"
): string => {
  switch (status) {
    case "pending":
      return "Pending";
    case "ai_processed":
      return "AI Processed";
    case "reviewed":
      return "Reviewed";
    default:
      return "Unknown";
  }
};
