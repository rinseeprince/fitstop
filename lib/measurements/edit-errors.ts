import { NextResponse } from "next/server";

/**
 * The refusals of the measurement log's three row actions — edit, remove (a
 * void), restore — as typed errors, thrown by
 * `services/measurement-edits-service.ts` and answered by the routes through
 * `measurementEditErrorResponse`.
 *
 * Two layers refuse. The service refuses what it can see (a row that is not
 * this client's, a removed row being edited, a value outside the metric's
 * bounds); the RPCs of migrations 160 and 161 refuse what only the database
 * can prove at write time (a foreign row, a removed row, a double void, a
 * restore of a live row, the client's only weight) and speak in message
 * prefixes. `fromRpcMessage` turns those prefixes into the same classes, so a
 * route sees one vocabulary whichever layer said no.
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

/** An edited value the metric's bounds refuse — answered 400. */
export class MeasurementValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasurementValueError";
  }
}

// The RPCs' contract: `<prefix>: <detail>`.
const RPC_REFUSALS: ReadonlyArray<[prefix: string, refuse: () => Error]> = [
  ["not_found", () => new MeasurementNotFoundError()],
  [
    "voided",
    () => new MeasurementStateError("This reading has been removed. Restore it before editing it."),
  ],
  ["already_voided", () => new MeasurementStateError("This reading has already been removed.")],
  ["not_voided", () => new MeasurementStateError("This reading has not been removed.")],
  [
    "last_weight",
    () =>
      new MeasurementStateError("A client's only weight reading can't be removed. Edit it instead."),
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
