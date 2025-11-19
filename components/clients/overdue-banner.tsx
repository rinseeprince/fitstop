"use client";

import { useOverdueClients } from "@/hooks/use-check-in-data";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    <Alert variant="destructive" className="mb-6 border-amber-500 bg-amber-50">
      <AlertTriangle className="h-5 w-5 text-amber-600" />
      <AlertTitle className="text-amber-900 font-semibold">
        {total} {total === 1 ? "client is" : "clients are"} overdue for check-ins
      </AlertTitle>
      <AlertDescription className="text-amber-800 mt-2">
        {criticalCount > 0 && (
          <p className="font-medium">
            {criticalCount} critically overdue (4+ days)
          </p>
        )}
        {overdueCount > 0 && (
          <p className="mt-1">
            {overdueCount} overdue (1-3 days)
          </p>
        )}
        <Button
          variant="link"
          className="mt-3 p-0 h-auto text-amber-900 hover:text-amber-950 font-semibold"
          asChild
        >
          <Link href="/clients/overdue">
            View overdue clients →
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
