"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Clock, AlertCircle, CheckCircle, ClipboardList } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useOverdueClients, useClientsDueSoon, useUnreviewedCheckIns } from "@/hooks/use-check-in-data";
import { checkInReviewUrl } from "@/lib/client-tabs";
import { formatDistanceToNow } from "date-fns";

export function NotificationsDropdown({ compact = false }: { compact?: boolean } = {}) {
  const { clients: overdueClients, total: overdueTotal } = useOverdueClients();
  const { clients: dueSoonClients, total: dueSoonTotal } = useClientsDueSoon();
  const { checkIns: unreviewedCheckIns, total: unreviewedTotal } = useUnreviewedCheckIns();
  const [open, setOpen] = useState(false);

  const totalNotifications = overdueTotal + dueSoonTotal + unreviewedTotal;
  const recentUnreviewed = unreviewedCheckIns.slice(0, 3);
  const criticallyOverdue = overdueClients.filter((c) => c.daysOverdue >= 4);
  const recentOverdue = overdueClients.slice(0, 3);
  const recentDueSoon = dueSoonClients.slice(0, 2);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="relative text-[#93b0b4] hover:text-[#5a7d82] transition-colors p-1">
          <Bell className={compact ? "h-[15px] w-[15px]" : "h-[18px] w-[18px]"} />
          {totalNotifications > 0 && (
            <span className={`absolute flex items-center justify-center rounded-full bg-[#0d9488] text-white font-semibold px-1 ${compact ? "-top-0.5 -right-0.5 h-[14px] min-w-[14px] text-[9px]" : "-top-1 -right-1 h-[16px] min-w-[16px] text-[10px]"}`}>
              {totalNotifications > 9 ? "9+" : totalNotifications}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {totalNotifications > 0 && (
            <Badge variant="secondary" className="text-xs">
              {totalNotifications} new
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {totalNotifications === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-2">
              <CheckCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">All caught up!</p>
            <p className="text-xs mt-1">No pending check-ins</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {recentUnreviewed.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-primary flex items-center gap-1">
                  <ClipboardList className="h-3 w-3" />
                  New Check-Ins
                </div>
                {recentUnreviewed.map((checkIn) => (
                  <DropdownMenuItem key={checkIn.id} asChild>
                    <Link
                      // Straight to the check-in on its client's Check-ins tab,
                      // through the single writer of that form. The row names
                      // one check-in, so it should land on that one.
                      href={checkInReviewUrl(checkIn.clientId, checkIn.id)}
                      className="flex items-start gap-3 p-3 cursor-pointer"
                      onClick={() => setOpen(false)}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold flex-shrink-0">
                        {(checkIn.clientName || "C")
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {checkIn.clientName || "Unknown Client"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Submitted{" "}
                          {formatDistanceToNow(new Date(checkIn.createdAt), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}

            {criticallyOverdue.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Critically Overdue
                </div>
                {criticallyOverdue.map((client) => (
                  <DropdownMenuItem key={client.id} asChild>
                    <Link
                      href={`/clients/${client.id}`}
                      className="flex items-start gap-3 p-3 cursor-pointer"
                      onClick={() => setOpen(false)}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/15 text-destructive text-xs font-semibold flex-shrink-0">
                        {client.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {client.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {client.daysOverdue}d overdue
                        </p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}

            {recentOverdue.length > 0 && criticallyOverdue.length === 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-warning flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Overdue
                </div>
                {recentOverdue.map((client) => (
                  <DropdownMenuItem key={client.id} asChild>
                    <Link
                      href={`/clients/${client.id}`}
                      className="flex items-start gap-3 p-3 cursor-pointer"
                      onClick={() => setOpen(false)}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/15 text-warning text-xs font-semibold flex-shrink-0">
                        {client.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {client.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {client.daysOverdue}d overdue
                        </p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}

            {recentDueSoon.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-primary flex items-center gap-1">
                  <Bell className="h-3 w-3" />
                  Due Soon
                </div>
                {recentDueSoon.map((client) => (
                  <DropdownMenuItem key={client.id} asChild>
                    <Link
                      href={`/clients/${client.id}`}
                      className="flex items-start gap-3 p-3 cursor-pointer"
                      onClick={() => setOpen(false)}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold flex-shrink-0">
                        {client.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {client.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Due{" "}
                          {client.nextExpectedCheckIn &&
                            formatDistanceToNow(
                              new Date(client.nextExpectedCheckIn),
                              { addSuffix: true }
                            )}
                        </p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </div>
        )}

        {totalNotifications > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href={unreviewedTotal > 0 ? "/check-ins/review" : "/clients?view=overdue"}
                className="w-full text-center text-sm font-medium cursor-pointer"
                onClick={() => setOpen(false)}
              >
                {unreviewedTotal > 0 ? "Review all check-ins" : "View all overdue clients"}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
