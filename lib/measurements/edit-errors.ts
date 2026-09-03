import { NextResponse } from "next/server";

/**
 * The refusals of the measurement log's three row actions — correct, remove
 * (a void), restore — as typed errors, thrown by
 * `services/measurement-edits-service.ts` and answered by the three routes
 * through `measurementEditErrorResponse`.
 *
 * Two layers refuse. The service refuses what it can see (a row that is not
 * this client's, a removed row being corrected, a value outside the metric's
 * bounds); the RPC pair of migration 160 refuses what only the database can
 * prove at write time (a foreign row, a double void, a restore of a live row,
 * the client's only weight) and speaks in message prefixes. `fromRpcMessage`
 * turns those prefixes into the same classes, so a route sees one vocabulary
 * whichever layer said no.
 */
export class MeasurementNotFoundError extends Error {
  constructor() {
    super("Reading not found.");
    this.name = "MeasurementNotFoundError";
  }
}

/** The row is not in the state the action needs — answered 409. */
export class MeasurementStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasurementStateError";
  }
}

/** A corrected value the metric's bounds refuse — answered 400. */
export class MeasurementValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasurementValueError";
  }
}

// Migration 160's contract: `<prefix>: <detail>`.
const RPC_REFUSALS: ReadonlyArray<[prefix: string, refuse: () => Error]> = [
  ["not_found", () => new MeasurementNotFoundError()],
  ["already_voided", () => new MeasurementStateError("This reading has already been removed.")],
  ["not_voided", () => new MeasurementStateError("This reading has not been removed.")],
  [
    "last_weight",
    () =>
      new MeasurementStateError(
        "A client's only weight reading can't be removed. Correct it instead."
      ),
  ],
];

/** The typed error an RPC refusal maps to, or null for an unexpected failure. */
export function fromRpcMessage(message: string | null | undefined): Error | null {
  if (!message) return null;
  for (const [prefix, refuse] of RPC_REFUSALS) {
    if (message.startsWith(`${prefix}:`)) return refuse();
  }
  return null;
}

/** The route's answer to a typed refusal; null means "not one of ours". */
export function measurementEditErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof MeasurementNotFoundError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 404 });
  }
  if (error instanceof MeasurementStateError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  }
  if (error instanceof MeasurementValueError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
  return null;
}
