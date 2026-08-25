/**
 * Reminder Service
 * Handles sending check-in reminders to clients and tracking reminder history
 */

import { supabaseAdmin } from "./supabase-admin";
import { getClientById, getClientsForCoach } from "./client-service";
import { getDaysUntilOrPastDue } from "./check-in-tracking-service";
import { differenceInHours } from "@/lib/date-helpers";
import type { ReminderType, CheckInReminder } from "@/types/check-in";
import type { CheckInReminderRow } from "@/lib/database-helpers";

/**
 * Send a check-in reminder to a client
 * @param clientId - Client ID
 * @param reminderType - Type of reminder (upcoming, overdue, follow_up)
 * @param manualSend - Whether this is a manual send by coach or automated
 * @returns Object with success status and reminder ID
 */
export async function sendCheckInReminder(
  clientId: string,
  reminderType: ReminderType = "overdue",
  manualSend: boolean = false
): Promise<{ success: boolean; reminderId?: string; errorMessage?: string }> {
  try {
    const client = await getClientById(clientId);

    if (!client) {
      return { success: false, errorMessage: "Client not found" };
    }

    // Check if reminder was already sent recently (avoid spam)
    if (!manualSend && client.lastReminderSentAt) {
      const hoursSinceLastReminder = differenceInHours(
        new Date(),
        new Date(client.lastReminderSentAt)
      );

      // Don't send if reminder was sent within last 24 hours
      if (hoursSinceLastReminder < 24) {
        return {
          success: false,
          errorMessage: "Reminder already sent within last 24 hours",
        };
      }
    }

    // NOTE: this reminder is RECORDED, not sent. There is no email/SMS
    // integration yet — the coach's "send reminder" action logs the reminder and
    // stamps last_reminder_sent_at, and nothing reaches the client.
    //
    // It used to also mint a magic-link check-in token here and build a link
    // into an unused variable. That flow was sunsetted months ago and is now
    // deleted, so the token mint went with it; when an email integration lands,
    // point it at the client portal rather than reviving a token.

    // Calculate days overdue (null if not overdue yet)
    const daysOverdue = getDaysUntilOrPastDue(client);
    const daysOverdueValue = daysOverdue > 0 ? daysOverdue : null;

    // Log reminder in database
    const { data: reminder, error: reminderError } = await supabaseAdmin
      .from("check_in_reminders")
      .insert({
        client_id: clientId,
        reminder_type: reminderType,
        days_overdue: daysOverdueValue,
        sent_via: manualSend ? "manual" : "system",
      })
      .select()
      .single();

    if (reminderError) {
      throw new Error(`Failed to create reminder record: ${reminderError.message}`);
    }

    // Update last reminder sent timestamp on client
    const { error: updateError } = await supabaseAdmin
      .from("clients")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", clientId);

    if (updateError) {
      throw new Error(`Failed to update client reminder timestamp: ${updateError.message}`);
    }

    return { success: true, reminderId: reminder.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, errorMessage };
  }
}

/**
 * Send automated reminders for all clients of a coach
 * Called by cron job daily
 * @param coachId - Coach ID
 * @returns Number of reminders sent
 */
export async function sendAutomatedReminders(
  coachId: string
): Promise<{ sent: number; errors: string[] }> {
  const clients = await getClientsForCoach(coachId);
  let sentCount = 0;
  const errors: string[] = [];

  for (const client of clients) {
    // Skip if client has no active check-in schedule
    if (!client.active || client.checkInFrequency === "none") {
      continue;
    }

    // Skip if reminders are disabled for this client
    const reminderPrefs = client.reminderPreferences || {
      enabled: true,
      autoSend: false,
      sendBeforeHours: 24,
    };

    if (!reminderPrefs.enabled || !reminderPrefs.autoSend) {
      continue;
    }

    const daysOverdue = getDaysUntilOrPastDue(client);

    // Calculate hours until due (for upcoming reminders)
    const sendBeforeHours = reminderPrefs.sendBeforeHours || 24;
    const hoursUntilDue = daysOverdue * -24; // Negative days = hours until due

    let reminderType: ReminderType | null = null;

    // Send "upcoming" reminder if due within send_before_hours
    if (hoursUntilDue > 0 && hoursUntilDue <= sendBeforeHours) {
      reminderType = "upcoming";
    }
    // Send "overdue" reminder if 1-3 days overdue
    else if (daysOverdue >= 1 && daysOverdue <= 3) {
      reminderType = "overdue";
    }
    // Send "follow_up" reminder if 4+ days overdue
    else if (daysOverdue >= 4) {
      reminderType = "follow_up";
    }

    if (reminderType) {
      const result = await sendCheckInReminder(client.id, reminderType, false);

      if (result.success) {
        sentCount++;
      } else {
        errors.push(`Client ${client.name}: ${result.errorMessage}`);
      }
    }
  }

  return { sent: sentCount, errors };
}

/**
 * Get all reminders for a client
 * @param clientId - Client ID
 * @param limit - Max number of reminders to return
 * @returns Array of reminders
 */
export async function getClientReminders(
  clientId: string,
  limit: number = 50
): Promise<CheckInReminder[]> {
  const { data, error } = await supabaseAdmin
    .from("check_in_reminders")
    .select("*")
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch reminders: ${error.message}`);
  }

  if (!data) {
    return [];
  }

  return data.map((row: CheckInReminderRow) => ({
    id: row.id,
    clientId: row.client_id,
    sentAt: row.sent_at ?? new Date().toISOString(),
    reminderType: row.reminder_type as "upcoming" | "overdue" | "follow_up",
    daysOverdue: row.days_overdue,
    responded: row.responded ?? false,
    respondedAt: row.responded_at ?? undefined,
    checkInId: row.check_in_id ?? undefined,
    sentVia: (row.sent_via ?? "system") as "manual" | "system",
    notes: row.notes ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
  }));
}
