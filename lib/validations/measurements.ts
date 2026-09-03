import { z } from "zod";

/** How long a removal reason may be. Optional everywhere; the coach UI sends none. */
const VOID_REASON_MAX_LENGTH = 200;

// The value is canonical (kg / cm / %, CONVENTIONS §20). Its bounds depend on
// the reading's metric, which only the row knows, so the service checks them
// after reading the row (`METRIC_VALUE_RANGES`); the schema holds the shape.
export const correctMeasurementSchema = z
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
