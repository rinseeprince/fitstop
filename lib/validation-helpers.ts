import { NextResponse } from "next/server";
import { getTodayDateString } from "./date-helpers";

/**
 * Maximum number of days to look back for date-based queries
 */
export const MAX_DATE_LOOKBACK_DAYS = 30;

/**
 * Validates a date parameter for API routes.
 * Returns an error response if the date is invalid, in the future, or too far in the past.
 * 
 * @param dateString - The date string to validate (YYYY-MM-DD format)
 * @param maxDaysBack - Maximum days to look back (default 30)
 * @returns NextResponse error or null if valid
 */
export function validateDateParameter(
  dateString: string | null | undefined,
  maxDaysBack: number = MAX_DATE_LOOKBACK_DAYS
): NextResponse | null {
  if (!dateString) {
    return null; // No date provided is often valid (uses today)
  }

  // Check date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return NextResponse.json(
      { 
        success: false, 
        error: "Invalid date format. Use YYYY-MM-DD" 
      },
      { status: 400 }
    );
  }

  const providedDate = new Date(dateString + "T00:00:00");
  const today = new Date(getTodayDateString() + "T00:00:00");
  
  // Check if date is valid
  if (isNaN(providedDate.getTime())) {
    return NextResponse.json(
      { 
        success: false, 
        error: "Invalid date" 
      },
      { status: 400 }
    );
  }

  // Check if date is in the future
  if (providedDate > today) {
    return NextResponse.json(
      { 
        success: false, 
        error: "Cannot query future dates" 
      },
      { status: 400 }
    );
  }

  // Check if date is too far in the past
  const maxPastDate = new Date(today);
  maxPastDate.setDate(maxPastDate.getDate() - maxDaysBack);
  
  if (providedDate < maxPastDate) {
    return NextResponse.json(
      { 
        success: false, 
        error: `Cannot query dates more than ${maxDaysBack} days in the past` 
      },
      { status: 400 }
    );
  }

  return null; // Date is valid
}