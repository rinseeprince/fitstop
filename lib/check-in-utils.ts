import { format, formatDistanceToNow } from "date-fns";
import type { CheckIn, ProgressComparison, ProgressChartData, ChartDataPoint } from "@/types/check-in";

// Format check-in date
export const formatCheckInDate = (dateString: string): string => {
  return format(new Date(dateString), "MMM d, yyyy");
};

// Format check-in time
export const formatCheckInTime = (dateString: string): string => {
  return format(new Date(dateString), "h:mm a");
};

// Format relative time (e.g., "2 hours ago")
export const formatRelativeTime = (dateString: string): string => {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
};

// Generate check-in link
export const generateCheckInLink = (token: string, baseUrl?: string): string => {
  const url = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return `${url}/check-in/${token}`;
};

// Calculate progress comparison between two check-ins
export const calculateProgressComparison = (
  current: CheckIn,
  previous?: CheckIn
): ProgressComparison => {
  const changes: ProgressComparison["changes"] = {};

  if (previous) {
    // Weight change
    if (current.weight && previous.weight) {
      changes.weight = Number((current.weight - previous.weight).toFixed(1));
    }

    // Body fat change
    if (current.bodyFatPercentage && previous.bodyFatPercentage) {
      changes.bodyFatPercentage = Number(
        (current.bodyFatPercentage - previous.bodyFatPercentage).toFixed(1)
      );
    }

    // Measurements changes
    const measurements: any = {};
    if (current.waist && previous.waist) {
      measurements.waist = Number((current.waist - previous.waist).toFixed(1));
    }
    if (current.hips && previous.hips) {
      measurements.hips = Number((current.hips - previous.hips).toFixed(1));
    }
    if (current.chest && previous.chest) {
      measurements.chest = Number((current.chest - previous.chest).toFixed(1));
    }
    if (current.arms && previous.arms) {
      measurements.arms = Number((current.arms - previous.arms).toFixed(1));
    }
    if (current.thighs && previous.thighs) {
      measurements.thighs = Number((current.thighs - previous.thighs).toFixed(1));
    }

    if (Object.keys(measurements).length > 0) {
      changes.measurements = measurements;
    }

    // Adherence change
    if (current.adherencePercentage && previous.adherencePercentage) {
      changes.adherence = current.adherencePercentage - previous.adherencePercentage;
    }
  }

  return {
    current,
    previous,
    changes,
  };
};

// Prepare chart data from check-ins
export const prepareChartData = (checkIns: CheckIn[]): ProgressChartData => {
  const sortedCheckIns = [...checkIns].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const chartData: ProgressChartData = {
    weight: [],
    bodyFat: [],
    adherence: [],
    mood: [],
    energy: [],
  };

  sortedCheckIns.forEach((checkIn) => {
    const date = format(new Date(checkIn.createdAt), "MMM d");

    if (checkIn.weight) {
      chartData.weight.push({
        date,
        value: checkIn.weight,
        label: `${checkIn.weight} ${checkIn.weightUnit || "lbs"}`,
      });
    }

    if (checkIn.bodyFatPercentage) {
      chartData.bodyFat.push({
        date,
        value: checkIn.bodyFatPercentage,
        label: `${checkIn.bodyFatPercentage}%`,
      });
    }

    if (checkIn.adherencePercentage) {
      chartData.adherence.push({
        date,
        value: checkIn.adherencePercentage,
        label: `${checkIn.adherencePercentage}%`,
      });
    }

    if (checkIn.mood) {
      chartData.mood.push({
        date,
        value: checkIn.mood,
        label: `${checkIn.mood}/5`,
      });
    }

    if (checkIn.energy) {
      chartData.energy.push({
        date,
        value: checkIn.energy,
        label: `${checkIn.energy}/10`,
      });
    }
  });

  return chartData;
};

// Get status badge color
export const getStatusColor = (
  status: "pending" | "ai_processed" | "reviewed"
): string => {
  switch (status) {
    case "pending":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400";
    case "ai_processed":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
    case "reviewed":
      return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400";
  }
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

// Calculate average of a metric
export const calculateAverage = (values: (number | undefined)[]): number => {
  const validValues = values.filter((v): v is number => v !== undefined);
  if (validValues.length === 0) return 0;
  return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
};

// Get trend direction (up, down, stable)
export const getTrendDirection = (
  current: number,
  previous: number,
  threshold: number = 0.5
): "up" | "down" | "stable" => {
  const diff = current - previous;
  if (Math.abs(diff) < threshold) return "stable";
  return diff > 0 ? "up" : "down";
};
