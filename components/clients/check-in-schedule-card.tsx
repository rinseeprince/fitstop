"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReminderHistoryModal } from "./reminder-history-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar, Clock, Bell, Save, Edit2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, CheckInFrequency, DayOfWeek } from "@/types/check-in";
import { format } from "date-fns";

interface CheckInScheduleCardProps {
  client: Client;
  onUpdate?: () => void;
}

export function CheckInScheduleCard({ client, onUpdate }: CheckInScheduleCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showReminderHistory, setShowReminderHistory] = useState(false);
  const { toast } = useToast();

  const [frequency, setFrequency] = useState<CheckInFrequency>(
    client.checkInFrequency || "weekly"
  );
  const [customDays, setCustomDays] = useState(
    client.checkInFrequencyDays?.toString() || "7"
  );
  const [expectedDay, setExpectedDay] = useState<DayOfWeek | "null">(
    client.expectedCheckInDay || "null"
  );
  const [reminderEnabled, setReminderEnabled] = useState(
    client.reminderPreferences?.enabled ?? true
  );
  const [autoSend, setAutoSend] = useState(
    client.reminderPreferences?.autoSend ?? false
  );
  const [sendBeforeHours, setSendBeforeHours] = useState(
    client.reminderPreferences?.sendBeforeHours?.toString() || "24"
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/check-in-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkInFrequency: frequency,
          checkInFrequencyDays: frequency === "custom" ? parseInt(customDays) : undefined,
          expectedCheckInDay: expectedDay === "null" ? null : expectedDay,
          reminderPreferences: {
            enabled: reminderEnabled,
            autoSend: autoSend,
            sendBeforeHours: parseInt(sendBeforeHours),
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: "Schedule updated",
          description: "Check-in schedule has been saved successfully.",
        });
        setIsEditing(false);
        onUpdate?.();
      } else {
        throw new Error(data.error || "Failed to update schedule");
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update schedule",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getFrequencyLabel = () => {
    switch (client.checkInFrequency) {
      case "weekly":
        return "Weekly";
      case "biweekly":
        return "Bi-weekly";
      case "monthly":
        return "Monthly";
      case "custom":
        return `Every ${client.checkInFrequencyDays} days`;
      case "none":
        return "No schedule";
      default:
        return "Weekly";
    }
  };

  const getDayLabel = (day: string | null | undefined) => {
    if (!day) return "Any day";
    return day.charAt(0).toUpperCase() + day.slice(1);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Check-In Schedule
          </CardTitle>
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!isEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Frequency</p>
                <Badge variant="secondary" className="font-normal">
                  {getFrequencyLabel()}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Expected Day</p>
                <Badge variant="outline" className="font-normal">
                  {getDayLabel(client.expectedCheckInDay)}
                </Badge>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  Reminders
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReminderHistory(true)}
                  className="text-xs"
                >
                  View History
                </Button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Enabled</span>
                  <span>{client.reminderPreferences?.enabled ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Auto-send</span>
                  <span>{client.reminderPreferences?.autoSend ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Send before</span>
                  <span>
                    {client.reminderPreferences?.sendBeforeHours || 24} hours
                  </span>
                </div>
              </div>
            </div>

            {client.checkInAdherenceRate !== undefined && (
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-3">Adherence Stats</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-bold text-primary">
                      {Math.round(client.checkInAdherenceRate)}%
                    </p>
                    <p className="text-xs text-muted-foreground">Adherence Rate</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-primary">
                      {client.currentStreak || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Current Streak</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as CheckInFrequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="none">No schedule</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {frequency === "custom" && (
              <div>
                <Label>Every X days</Label>
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                />
              </div>
            )}

            <div>
              <Label>Expected Day (Optional)</Label>
              <Select value={expectedDay} onValueChange={(v) => setExpectedDay(v as DayOfWeek | "null")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="null">Any day</SelectItem>
                  <SelectItem value="monday">Monday</SelectItem>
                  <SelectItem value="tuesday">Tuesday</SelectItem>
                  <SelectItem value="wednesday">Wednesday</SelectItem>
                  <SelectItem value="thursday">Thursday</SelectItem>
                  <SelectItem value="friday">Friday</SelectItem>
                  <SelectItem value="saturday">Saturday</SelectItem>
                  <SelectItem value="sunday">Sunday</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-4 border-t space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Reminder Settings
              </h4>

              <div className="flex items-center justify-between">
                <Label htmlFor="reminder-enabled">Enable Reminders</Label>
                <Switch
                  id="reminder-enabled"
                  checked={reminderEnabled}
                  onCheckedChange={setReminderEnabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="auto-send">Auto-send Reminders</Label>
                <Switch
                  id="auto-send"
                  checked={autoSend}
                  onCheckedChange={setAutoSend}
                  disabled={!reminderEnabled}
                />
              </div>

              <div>
                <Label>Send Before (hours)</Label>
                <Input
                  type="number"
                  min="1"
                  max="168"
                  value={sendBeforeHours}
                  onChange={(e) => setSendBeforeHours(e.target.value)}
                  disabled={!reminderEnabled}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <ReminderHistoryModal
        clientId={client.id}
        clientName={client.name}
        open={showReminderHistory}
        onClose={() => setShowReminderHistory(false)}
      />
    </Card>
  );
}
