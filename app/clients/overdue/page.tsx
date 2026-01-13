"use client";

import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { useOverdueClients } from "@/hooks/use-check-in-data";
import { OverdueClientCard } from "@/components/clients/check-in/overdue-client-card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

export default function OverdueClientsPage() {
  const { clients, total, isLoading, mutate } = useOverdueClients();

  const criticallyOverdue = clients.filter(
    (c) => c.severity === "critically_overdue"
  );
  const overdue = clients.filter((c) => c.severity === "overdue");

  const pageHeader = (
    <PageHeader
      title="Overdue Check-Ins"
      description={
        total === 0
          ? "All clients are up to date with their check-ins!"
          : `${total} ${total === 1 ? "client needs" : "clients need"} attention`
      }
      backHref="/clients"
    />
  );

  if (isLoading) {
    return (
      <AppLayout pageHeader={pageHeader}>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout pageHeader={pageHeader}>
      {total === 0 ? (
        <div className="text-center py-12 bg-muted/20 rounded-lg border-2 border-dashed">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-semibold mb-2">All Caught Up!</h2>
          <p className="text-muted-foreground mb-4">
            No clients are currently overdue for check-ins.
          </p>
          <Button asChild>
            <Link href="/clients">View All Clients</Link>
          </Button>
        </div>
      ) : (
        <>
          {criticallyOverdue.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-destructive mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Critically Overdue ({criticallyOverdue.length})
                <span className="text-sm font-normal text-muted-foreground">
                  4+ days
                </span>
              </h2>
              <div className="grid gap-4">
                {criticallyOverdue.map((client) => (
                  <OverdueClientCard
                    key={client.id}
                    client={client}
                    onReminderSent={mutate}
                  />
                ))}
              </div>
            </section>
          )}

          {overdue.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold text-warning mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Overdue ({overdue.length})
                <span className="text-sm font-normal text-muted-foreground">
                  1-3 days
                </span>
              </h2>
              <div className="grid gap-4">
                {overdue.map((client) => (
                  <OverdueClientCard
                    key={client.id}
                    client={client}
                    onReminderSent={mutate}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </AppLayout>
  );
}
