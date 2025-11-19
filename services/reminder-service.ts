/**
 * Reminder Service
 * Handles sending check-in reminders to clients and tracking reminder history
 */

import { supabaseAdmin } from "./supabase-admin";
import { getClientById, getClientsForCoach } from "./client-service";
import { createCheckInToken } from "./check-in-service";
import { getDaysUntilOrPastDue } from "./check-in-tracking-service";
import { differenceInHours } from "@/lib/date-utils";
import type { ReminderType, CheckInReminder } from "@/types/check-in";

/**
 * Generate check-in link from token
 */
export function generateCheckInLink(token: string, baseUrl?: string): string {
  const url = baseUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${url}/check-in/${token}`;
}

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

    // Generate new check-in token
    const { token, expiresAt } = await createCheckInToken(clientId);
    const checkInLink = generateCheckInLink(token);

    // TODO: Integration point for email/SMS service
    // For now, we just create the token and track the reminder
    // Future: Send email via Resend/SendGrid/etc.
    // await sendReminderEmail(client, checkInLink, reminderType);

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

    return { success: true, reminderId: (reminder as any).id };
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
 * Mark a reminder as responded when client submits check-in
 * @param clientId - Client ID
 * @param checkInId - Check-in ID that was submitted
 */
export async function markReminderAsResponded(
  clientId: string,
  checkInId: string
): Promise<void> {
  // Find most recent unanswered reminder for this client
  const { data: reminder, error: fetchError } = await supabaseAdmin
    .from("check_in_reminders")
    .select("*")
    .eq("client_id", clientId)
    .eq("responded", false)
    .order("sent_at", { ascending: false })
    .limit(1)
    .single();

  if (fetchError || !reminder) {
    // No unanswered reminder found - that's okay
    return;
  }

  // Mark reminder as responded
  const { error: updateError } = await supabaseAdmin
    .from("check_in_reminders")
    .update({
      responded: true,
      responded_at: new Date().toISOString(),
      check_in_id: checkInId,
    })
    .eq("id", (reminder as any).id);

  if (updateError) {
    throw new Error(`Failed to mark reminder as responded: ${updateError.message}`);
  }
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

  return data.map((row: any) => ({
    id: row.id,
    clientId: row.client_id,
    sentAt: row.sent_at,
    reminderType: row.reminder_type,
    daysOverdue: row.days_overdue,
    responded: row.responded,
    respondedAt: row.responded_at,
    checkInId: row.check_in_id,
    sentVia: row.sent_via,
    notes: row.notes,
    createdAt: row.created_at,
  }));
}

/**
 * Get reminder response rate for a client
 * @param clientId - Client ID
 * @returns Response rate as percentage (0-100)
 */
export async function getClientReminderResponseRate(
  clientId: string
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("check_in_reminders")
    .select("responded")
    .eq("client_id", clientId);

  if (error || !data || data.length === 0) {
    return 0;
  }

  const totalReminders = data.length;
  const respondedReminders = data.filter((r: any) => r.responded).length;

  return Math.round((respondedReminders / totalReminders) * 100);
}
