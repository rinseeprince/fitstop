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