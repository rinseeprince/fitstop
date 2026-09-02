/**
 * Reminder Service
 * Handles sending check-in reminders to clients and tracking reminder history
 */

import { supabaseAdmin } from "./supabase-admin";
import { getClientById, getClientsForCoach } from "./client-service";
import { getDaysUntilOrPastDue } from "./check-in-tracking-service";
import { differenceInHours } from "@/lib/date-helpers";
import type { ReminderType } from "@/types/check-in";

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
