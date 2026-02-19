import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { 
  calculateNextExpectedCheckIn, 
  getDaysUntilOrPastDue, 
  isClientOverdue 
} from "@/services/check-in-tracking-service";
import { clientApiRateLimit } from "@/lib/rate-limit";
import type { ClientNotification } from "@/hooks/use-client-notifications";

/**
 * GET /api/client/notifications
 * 
 * Retrieves notifications for an authenticated client, including check-in
 * reminders, overdue notifications, and status information.
 * 
 * @param request - The Next.js request object
 * @returns Promise<NextResponse> - JSON response with notifications and status
 * 
 * @example
 * ```typescript
 * // Response format
 * {
 *   success: true,
 *   data: {
 *     notifications: [
 *       {
 *         id: "checkin-overdue-123",
 *         type: "check-in",
 *         title: "Check-in Overdue",
 *         description: "Your check-in is 2 days overdue...",
 *         timestamp: "2024-01-01T00:00:00Z",
 *         actionUrl: "/client/check-in",
 *         read: false,
 *         metadata: { daysOverdue: 2, severity: "overdue" }
 *       }
 *     ],
 *     unreadCount: 1,
 *     checkInStatus: {
 *       isOverdue: true,
 *       daysUntilOrPast: 2,
 *       nextExpected: "2024-01-01T00:00:00Z",
 *       frequency: "weekly"
 *     }
 *   }
 * }
 * ```
 * 
 * @throws {401} Unauthorized - Client not authenticated
 * @throws {404} Client not found
 * @throws {500} Server error during notification retrieval
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    const notifications: ClientNotification[] = [];

    // Check-in related notifications
    const checkInFrequency = client.checkInFrequency || "weekly";
    
    if (checkInFrequency !== "none") {
      const isOverdue = isClientOverdue(client);
      const daysUntilOrPast = getDaysUntilOrPastDue(client);
      const nextExpected = calculateNextExpectedCheckIn(client);

      if (isOverdue) {
        // Overdue check-in notification
        const severity = daysUntilOrPast >= 4 ? "critical" : daysUntilOrPast >= 2 ? "urgent" : "overdue";
        
        notifications.push({
          id: `checkin-overdue-${clientId}`,
          type: "check-in",
          title: `Check-in ${severity === "critical" ? "Critically " : ""}Overdue`,
          description: `Your check-in is ${daysUntilOrPast} day${daysUntilOrPast > 1 ? "s" : ""} overdue. Complete it now to stay on track!`,
          timestamp: nextExpected?.toISOString() || new Date().toISOString(),
          actionUrl: "/client/check-in",
          read: false,
          metadata: {
            daysOverdue: daysUntilOrPast,
            severity,
            nextExpected: nextExpected?.toISOString(),
          }
        });
      } else if (daysUntilOrPast >= -1) {
        // Due soon notification (due today or tomorrow)
        const dueTodayOrTomorrow = daysUntilOrPast === 0 ? "today" : "tomorrow";
        
        notifications.push({
          id: `checkin-due-${clientId}`,
          type: "check-in", 
          title: `Check-in Due ${dueTodayOrTomorrow === "today" ? "Today" : "Tomorrow"}`,
          description: `Your check-in is due ${dueTodayOrTomorrow}. Take a few minutes to complete it!`,
          timestamp: nextExpected?.toISOString() || new Date().toISOString(),
          actionUrl: "/client/check-in",
          read: false,
          metadata: {
            daysUntilDue: Math.abs(daysUntilOrPast),
            nextExpected: nextExpected?.toISOString(),
          }
        });
      }
    }

    // Sort notifications by priority and timestamp
    notifications.sort((a, b) => {
      // Overdue notifications first
      if (a.type === "check-in" && b.type === "check-in") {
        const aOverdue = a.metadata?.severity;
        const bOverdue = b.metadata?.severity;
        
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        if (aOverdue && bOverdue) {
          const severityOrder = { critical: 0, urgent: 1, overdue: 2 };
          return severityOrder[aOverdue as keyof typeof severityOrder] - 
                 severityOrder[bOverdue as keyof typeof severityOrder];
        }
      }
      
      // Then by timestamp (newest first)
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return NextResponse.json({
      success: true,
      data: {
        notifications,
        unreadCount: notifications.filter(n => !n.read).length,
        checkInStatus: {
          isOverdue: isClientOverdue(client),
          daysUntilOrPast: getDaysUntilOrPastDue(client),
          nextExpected: calculateNextExpectedCheckIn(client)?.toISOString(),
          frequency: checkInFrequency,
        }
      },
    });
  } catch (error) {
    console.error("Error fetching client notifications:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch notifications",
      },
      { status: 500 }
    );
  }
}