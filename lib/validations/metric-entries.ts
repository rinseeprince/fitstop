import { z } from "zod";
import {
  METRIC_ENTRY_KEYS,
  METRIC_VALUE_RANGES,
} from "@/lib/metrics/metric-entry-definitions";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Date is format-only here: the no-future bound is enforced route-side against
// the coach's timezone (the coach is the setter — same split as the
// goal-deadline write bound in app/api/clients/[id]/goals).
export const createMetricEntrySchema = z
  .object({
    metricKey: z.enum(METRIC_ENTRY_KEYS),
    value: z.number().finite(),
    entryDate: z.string().regex(dateRegex, "Date must be YYYY-MM-DD"),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const range = METRIC_VALUE_RANGES[data.metricKey];
    if (data.value < range.min || data.value > range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${data.metricKey} must be between ${range.min} and ${range.max}`,
      });
    }
    if (range.integer && !Number.isInteger(data.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${data.metricKey} must be a whole number`,
      });
    }
  });

