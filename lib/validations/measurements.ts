import { z } from "zod";
import { MEASUREMENT_KEYS } from "@/lib/measurements/keys";
import { MEASUREMENT_VALUE_RANGES } from "@/lib/measurements/bounds";

/** How long a removal reason may be. Optional everywhere; the coach UI sends none. */
const VOID_REASON_MAX_LENGTH = 200;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// A coach's reading from the Journey's Log measurement: one body measurement,
// its value canonical (kg / cm / %, CONVENTIONS §20) and inside the metric's
// bounds. The day is format-only here: the route bounds it on the coach's
// today.
export const createMeasurementSchema = z
  .object({
    metricKey: z.enum(MEASUREMENT_KEYS),
    value: z.number().finite(),
    recordedOn: z.string().regex(dateRegex, "Date must be YYYY-MM-DD"),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const range = MEASUREMENT_VALUE_RANGES[data.metricKey];
    if (data.value < range.min || data.value > range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${data.metricKey} must be between ${range.min} and ${range.max}`,
      });
    }
  });

export type CreateMeasurementInput = z.infer<typeof createMeasurementSchema>;

// The edited value is canonical (kg / cm / %, CONVENTIONS §20). Its bounds
// depend on the reading's metric, which only the row knows, so the service
// checks them after reading the row (`MEASUREMENT_VALUE_RANGES`); the schema
// holds the shape.
export const updateMeasurementSchema = z
  .object({
    value: z.number().finite().positive(),
  })
  .strict();

// Reason is free text a later client route may send; a blank reads as none.
export const voidMeasurementSchema = z
  .object({
    reason: z.string().trim().max(VOID_REASON_MAX_LENGTH).optional(),
  })
  .strict();
