"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MetricsHub, type MetricsTab } from "@/components/client-portal/metrics/metrics-hub";

const TABS: MetricsTab[] = ["physique", "performance", "wellness", "habits"];

function MetricsPageInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = TABS.includes(tabParam as MetricsTab)
    ? (tabParam as MetricsTab)
    : "physique";

  // Performance deep-link params (exerciseId/exerciseName) are read by
  // PerformanceView directly from the URL, so the page only needs the tab.
  return <MetricsHub initialTab={initialTab} />;
}

export default function ClientMetricsPage() {
  return (
    <Suspense fallback={null}>
      <MetricsPageInner />
    </Suspense>
  );
}
