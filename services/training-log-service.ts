import type { LogTrainingEventInput } from "@/lib/validations/training";
import type {
  LogTrainingEventResponse,
  TrainingEventDetail,
} from "@/types/training";

// =============================================================================
// Event-keyed training log service (Session 1.1: contract stubs)
// =============================================================================
// Session 1.2 fills in transactional writes, snapshot composition, status
// derivation, and the nutrition cascade. Session 1.3 wires these to API routes.
// Stubs throw so tests / typed callers can import the signatures without
// accidentally hitting unimplemented code in production.

export function logTrainingEvent(_params: {
  eventId: string;
  clientId: string;
  payload: LogTrainingEventInput;
}): Promise<LogTrainingEventResponse> {
  return Promise.reject(new Error("logTrainingEvent: not implemented (Session 1.2)"));
}

export function getTrainingEventDetail(
  _eventId: string,
  _clientId: string
): Promise<TrainingEventDetail | null> {
  return Promise.reject(new Error("getTrainingEventDetail: not implemented (Session 1.2)"));
}
