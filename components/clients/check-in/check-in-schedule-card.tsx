"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Calendar, Bell, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, CheckInFrequency, DayOfWeek } from "@/types/check-in";

interface CheckInScheduleSectionProps {
  client: Client;
  onUpdate?: () => void;
  onCancel?: () => void;
}

/**
 * CheckInScheduleSection — edit-only form for check-in schedule configuration.
 * The read-only display is handled by the parent (client-overview-tab.tsx).
 */
export function CheckInScheduleSection({ client, onUpdate, onCancel }: CheckInScheduleSectionProps) {
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const [frequency] = useState<CheckInFrequency>("weekly");
  const [expectedDay, setExpectedDay] = useState<DayOfWeek>(
    client.expectedCheckInDay || "monday"
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
          checkInFrequency: "weekly",
          expectedCheckInDay: expectedDay,
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

  return (
    <div className="space-y-4">
      <div>
        <Label>Frequency</Label>
        <Select value="weekly" disabled>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Check-In Day</Label>
        <Select value={expectedDay} onValueChange={(v) => setExpectedDay(v as DayOfWeek)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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

      <div className="pt-4 border-t border-border space-y-4">
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
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface CheckInScheduleCardProps {
  client: Client;
  onUpdate?: () => void;
}

export function CheckInScheduleCard({ client, onUpdate }: CheckInScheduleCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Check-In Schedule
        </CardTitle>
      </CardHeader>
      <CardBody>
        <CheckInScheduleSection client={client} onUpdate={onUpdate} />
      </CardBody>
    </Card>
  );
}
