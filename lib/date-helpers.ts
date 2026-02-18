/**
 * Date utility functions for consistent date handling across the application
 */

/**
 * Returns today's date as a YYYY-MM-DD string
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Returns a date string in YYYY-MM-DD format from a Date object
 * @param {Date} date - The date to format
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

/**
 * Returns a date N days ago from today as a YYYY-MM-DD string
 * @param {number} days - Number of days to subtract from today
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

/**
 * Returns a date N days from a given date as a YYYY-MM-DD string
 * @param {Date} fromDate - The starting date
 * @param {number} days - Number of days to add (negative for past dates)
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateDaysFrom = (fromDate: Date, days: number): string => {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};