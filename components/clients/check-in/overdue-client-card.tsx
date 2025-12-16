"use client";

import { useState } from "react";
import type { OverdueClient } from "@/types/check-in";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertCircle, Calendar, Send } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface OverdueClientCardProps {
  client: OverdueClient;
  onReminderSent?: () => void;
}

export function OverdueClientCard({
  client,
  onReminderSent,
}: OverdueClientCardProps) {
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  const handleSendReminder = async () => {
    setIsSending(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminderType: "overdue" }),
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: "Reminder sent",
          description: `Check-in reminder sent to ${client.name}`,
        });
        onReminderSent?.();
      } else {
        throw new Error(data.error || "Failed to send reminder");
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to send reminder",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const getSeverityColor = () => {
    switch (client.severity) {
      case "critically_overdue":
        return "bg-red-100 text-red-800 border-red-300";
      case "overdue":
        return "bg-amber-100 text-amber-800 border-amber-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getSeverityLabel = () => {
    if (client.daysOverdue >= 7) return "Critically Overdue";
    if (client.daysOverdue >= 4) return "Very Overdue";
    return "Overdue";
  };

  return (
    <Card className={`border-l-4 ${getSeverityColor()}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                {client.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold text-lg">{client.name}</h3>
              <p className="text-sm text-muted-foreground">{client.email}</p>
            </div>
          </div>
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {client.daysOverdue}d overdue
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <p className="text-muted-foreground">Status</p>
            <Badge variant="outline" className={getSeverityColor()}>
              {getSeverityLabel()}
            </Badge>
          </div>
          <div>
            <p className="text-muted-foreground">Expected Check-In</p>
            <p className="font-medium flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {client.nextExpectedCheckIn
                ? format(new Date(client.nextExpectedCheckIn), "MMM d, yyyy")
                : "Not set"}
            </p>
          </div>
          {client.lastCheckInDate && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Last Check-In</p>
              <p className="font-medium">
                {format(new Date(client.lastCheckInDate), "MMM d, yyyy")}
              </p>
            </div>
          )}
        </div>

        <Button
          onClick={handleSendReminder}
          disabled={isSending}
          className="w-full"
          variant="outline"
        >
          <Send className="h-4 w-4 mr-2" />
          {isSending ? "Sending..." : "Send Reminder"}
        </Button>
      </CardContent>
    </Card>
  );
}
