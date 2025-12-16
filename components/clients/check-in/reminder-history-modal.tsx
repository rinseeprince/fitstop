"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientReminders } from "@/hooks/use-check-in-data";
import { Clock, CheckCircle, XCircle, Send, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import type { CheckInReminder } from "@/types/check-in";

interface ReminderHistoryModalProps {
  clientId: string;
  clientName: string;
  open: boolean;
  onClose: () => void;
}

export function ReminderHistoryModal({
  clientId,
  clientName,
  open,
  onClose,
}: ReminderHistoryModalProps) {
  const { reminders, total, isLoading } = useClientReminders(clientId);

  const getReminderTypeLabel = (type: string) => {
    switch (type) {
      case "upcoming":
        return "Upcoming";
      case "overdue":
        return "Overdue";
      case "follow_up":
        return "Follow-up";
      default:
        return type;
    }
  };

  const getReminderTypeColor = (type: string) => {
    switch (type) {
      case "upcoming":
        return "bg-blue-100 text-blue-800";
      case "overdue":
        return "bg-amber-100 text-amber-800";
      case "follow_up":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getReminderIcon = (reminder: CheckInReminder) => {
    if (reminder.responded) {
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    }
    if (reminder.reminderType === "follow_up") {
      return <AlertCircle className="h-4 w-4 text-red-600" />;
    }
    return <Clock className="h-4 w-4 text-amber-600" />;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Reminder History - {clientName}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 p-4 border rounded-lg">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : total === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Send className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium">No reminders sent yet</p>
            <p className="text-sm mt-1">
              Send a reminder to start tracking communication with this client
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Total reminders sent: <span className="font-semibold">{total}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Response rate:{" "}
                <span className="font-semibold">
                  {total > 0
                    ? Math.round(
                        (reminders.filter((r) => r.responded).length / total) * 100
                      )
                    : 0}
                  %
                </span>
              </p>
            </div>

            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  {getReminderIcon(reminder)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={getReminderTypeColor(reminder.reminderType)}
                      >
                        {getReminderTypeLabel(reminder.reminderType)}
                      </Badge>
                      {reminder.daysOverdue !== null && reminder.daysOverdue > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {reminder.daysOverdue}d overdue
                        </Badge>
                      )}
                      <Badge
                        variant={reminder.sentVia === "manual" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {reminder.sentVia === "manual" ? "Manual" : "Auto"}
                      </Badge>
                    </div>

                    <Badge
                      variant={reminder.responded ? "default" : "outline"}
                      className={
                        reminder.responded
                          ? "bg-green-100 text-green-800 border-green-300"
                          : ""
                      }
                    >
                      {reminder.responded ? (
                        <>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Responded
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3 mr-1" />
                          No response
                        </>
                      )}
                    </Badge>
                  </div>

                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        Sent {format(new Date(reminder.sentAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </div>

                    {reminder.responded && reminder.respondedAt && (
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle className="h-3 w-3" />
                        <span>
                          Responded {format(new Date(reminder.respondedAt), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                    )}
                  </div>

                  {reminder.notes && (
                    <p className="mt-2 text-sm text-muted-foreground italic">
                      {reminder.notes}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
