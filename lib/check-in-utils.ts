import { format, formatDistanceToNow } from "date-fns";
import type { CheckIn, ProgressChartData } from "@/types/check-in";

// Format relative time (e.g., "2 hours ago")
export const formatRelativeTime = (dateString: string): string => {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};

// Prepare chart data from check-ins
export const prepareChartData = (checkIns: CheckIn[]): ProgressChartData => {
  const sortedCheckIns = [...checkIns].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const chartData: ProgressChartData = {
    weight: [],
    bodyFat: [],
  };

  sortedCheckIns.forEach((checkIn) => {
    const date = format(new Date(checkIn.createdAt), "MMM d");

    if (checkIn.weight) {
      chartData.weight.push({
        date,
        value: checkIn.weight,
      });
    }

    if (checkIn.bodyFatPercentage) {
      chartData.bodyFat.push({
        date,
        value: checkIn.bodyFatPercentage,
      });
    }
  });

  return chartData;
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
