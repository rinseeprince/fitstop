/**
 * Date utility functions for consistent date handling across the application
 */

/**
 * Returns today's date as a YYYY-MM-DD string in local timezone
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Returns a date string in YYYY-MM-DD format from a Date object in local timezone
 * @param {Date} date - The date to format
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Returns a date N days ago from today as a YYYY-MM-DD string in local timezone
 * @param {number} days - Number of days to subtract from today
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getDateString(date);
};

/**
 * Returns a date N days from a given date as a YYYY-MM-DD string in local timezone
 * @param {Date} fromDate - The starting date
 * @param {number} days - Number of days to add (negative for past dates)
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateDaysFrom = (fromDate: Date, days: number): string => {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + days);
  return getDateString(date);
};

/**
 * Returns the Monday of the week containing the given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Monday's date in YYYY-MM-DD format
 */
export const getWeekStart = (dateString: string): string => {
  const date = new Date(dateString + 'T00:00:00');
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  date.setDate(diff);
  return getDateString(date);
};

/**
 * Returns the Sunday of the week containing the given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Sunday's date in YYYY-MM-DD format
 */
export const getWeekEnd = (dateString: string): string => {
  const date = new Date(dateString + 'T00:00:00');
  const day = date.getDay();
  const diff = date.getDate() - day + 7;
  date.setDate(diff);
  return getDateString(date);
};

/**
 * Returns an array of 7 dates for the week containing the given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string[]} Array of dates in YYYY-MM-DD format, Monday to Sunday
 */
export const getWeekDays = (dateString: string): string[] => {
  const monday = getWeekStart(dateString);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday + 'T00:00:00');
    date.setDate(date.getDate() + i);
    days.push(getDateString(date));
  }
  return days;
};

/**
 * Day name to JS getDay() number mapping
 */
const DAY_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Returns the start of the training week containing dateString.
 * Training week starts the day after the client's check-in day.
 * Defaults to Monday when checkInDay is null/undefined (backward compatible).
 */
export const getTrainingWeekStart = (
  dateString: string,
  checkInDay?: string | null
): string => {
  const weekStartDayNum = checkInDay
    ? (DAY_NUM[checkInDay.toLowerCase()] + 1) % 7
    : 1; // Monday
  const date = new Date(dateString + 'T00:00:00');
  const current = date.getDay();
  let diff = current - weekStartDayNum;
  if (diff < 0) diff += 7;
  date.setDate(date.getDate() - diff);
  return getDateString(date);
};

/**
 * Returns the end of the training week containing dateString (6 days after week start).
 */
export const getTrainingWeekEnd = (
  dateString: string,
  checkInDay?: string | null
): string => {
  const start = new Date(getTrainingWeekStart(dateString, checkInDay) + 'T00:00:00');
  start.setDate(start.getDate() + 6);
  return getDateString(start);
};

/**
 * Returns an array of 7 dates for the training week containing the given date.
 * Uses getTrainingWeekStart to determine the first day based on the client's check-in day.
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {string | null} checkInDay - Client's check-in day (e.g. "wednesday"). Defaults to Monday start.
 * @returns {string[]} Array of 7 dates in YYYY-MM-DD format
 */
export const getTrainingWeekDays = (
  dateString: string,
  checkInDay?: string | null
): string[] => {
  const start = getTrainingWeekStart(dateString, checkInDay);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(start + 'T00:00:00');
    date.setDate(date.getDate() + i);
    days.push(getDateString(date));
  }
  return days;
};