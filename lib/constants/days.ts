export const DAYS_OF_WEEK = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]["value"];

export const VALID_DAYS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export function isDayOfWeek(value: string | undefined | null): value is DayOfWeek {
  return value != null && VALID_DAYS.includes(value as DayOfWeek);
}
