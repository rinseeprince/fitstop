"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useOverdueClients, useClientsDueSoon } from "@/hooks/use-check-in-data";
import { formatDistanceToNow } from "date-fns";

export function NotificationsDropdown() {
  const { clients: overdueClients, total: overdueTotal } = useOverdueClients();
  const { clients: dueSoonClients, total: dueSoonTotal } = useClientsDueSoon();
  const [open, setOpen] = useState(false);

  const totalNotifications = overdueTotal + dueSoonTotal;
  const criticallyOverdue = overdueClients.filter((c) => c.daysOverdue >= 4);
  const recentOverdue = overdueClients.slice(0, 3);
  const recentDueSoon = dueSoonClients.slice(0, 2);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalNotifications > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {totalNotifications > 9 ? "9+" : totalNotifications}
            </Badge>
          )}
        </Button>
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
            <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="font-medium">All caught up!</p>
            <p className="text-xs mt-1">No pending check-ins</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {criticallyOverdue.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-red-600 flex items-center gap-1">
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
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-semibold flex-shrink-0">
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
                <div className="px-2 py-1.5 text-xs font-semibold text-amber-600 flex items-center gap-1">
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
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 text-xs font-semibold flex-shrink-0">
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
                <div className="px-2 py-1.5 text-xs font-semibold text-blue-600 flex items-center gap-1">
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
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs font-semibold flex-shrink-0">
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
                href="/clients/overdue"
                className="w-full text-center text-sm font-medium cursor-pointer"
                onClick={() => setOpen(false)}
              >
                View all overdue clients
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
