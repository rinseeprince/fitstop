import { NextResponse } from "next/server";

/**
 * Validates a date parameter's FORMAT for API routes (YYYY-MM-DD + a real
 * calendar date). Returns an error response if malformed, null if valid.
 *
 * Deliberately NO past/future day-boundary checks: those were anchored to the
 * server's UTC day, which rejected an east-of-UTC client's own "today" as a
 * future date every morning (and a west-of-UTC client's yesterday as too old).
 * Day-boundary enforcement belongs to the write side via canEditDay /
 * assertCanEdit in the client's timezone — read paths return empty data for
 * dates with nothing on them. (Same reasoning that removed this validator
 * from the day-summary route; see lib/validations/daily-log-cards.ts.)
 *
 * @param dateString - The date string to validate (YYYY-MM-DD format)
 * @returns NextResponse error or null if valid
 */
export function validateDateParameter(
  dateString: string | null | undefined
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
        error: "Invalid date format. Use YYYY-MM-DD",
      },
      { status: 400 }
    );
  }

  // Check it parses to a real calendar date
  const providedDate = new Date(dateString + "T00:00:00");
  if (isNaN(providedDate.getTime())) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid date",
      },
      { status: 400 }
    );
  }

  return null; // Date is valid
}
