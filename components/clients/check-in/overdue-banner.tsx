"use client";

import { useOverdueClients } from "@/hooks/use-check-in-data";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export function OverdueBanner() {
  const { clients, total, isLoading } = useOverdueClients();

  // Don't show banner if no overdue clients or still loading
  if (isLoading || total === 0) {
    return null;
  }

  const criticalCount = clients.filter(
    (c) => c.severity === "critically_overdue"
  ).length;
  const overdueCount = clients.filter((c) => c.severity === "overdue").length;

  return (
    <div className="mb-6 rounded-[6px] border border-[rgba(245,158,11,0.20)] bg-[rgba(245,158,11,0.07)] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-[#d97706] mt-0.5 shrink-0" strokeWidth={1.5} />
        <div className="flex-1">
          <p className="text-[#0c1a1e] font-semibold">
            {total} {total === 1 ? "client is" : "clients are"} overdue for check-ins
          </p>
          <div className="mt-2 space-y-1 text-sm">
            {criticalCount > 0 && (
              <p className="font-medium text-[#b91c1c]">
                {criticalCount} critically overdue (4+ days)
              </p>
            )}
            {overdueCount > 0 && (
              <p className="text-[#d97706]">
                {overdueCount} overdue (1-3 days)
              </p>
            )}
          </div>
          <Link
            href="/clients/overdue"
            className="inline-block mt-3 text-sm font-semibold text-[#d97706] hover:text-[#b45309] transition-colors"
          >
            View overdue clients →
          </Link>
        </div>
      </div>
    </div>
  );
}
