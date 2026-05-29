"use client";

import { useMemo } from "react";
import type { ProgressData, ClientMetricSeries } from "@/services/client-portal-progress";

// The metric series are now shaped server-side (render-ready, ISO dates on the
// wire). This hook is a thin reader: it just hands back the already-built arrays.
// Type re-exports keep existing importers compiling.
export type { ClientMetricSeries } from "@/services/client-portal-progress";
export type ClientMetricData = ClientMetricSeries;

export const useClientProgressMetrics = (progressData: ProgressData | null) => {
  return useMemo(
    () => ({
      bodyMetrics: progressData?.bodyMetrics ?? [],
      wellnessMetrics: progressData?.wellnessMetrics ?? [],
    }),
    [progressData],
  );
};
