/**
 * Mock data builders for FitStop test suite
 * These factories create type-safe test data with sensible defaults
 */

import { generateUUID, generateISODate } from './test-utils'
import type { TrainingEventWithLogRow } from '@/services/training-event-service'
import type { TrainingEvent, TrainingEventLog, TrainingEventStatus } from '@/types/training'

// =============================================================================
// Client Builders
// =============================================================================

// =============================================================================
// Check-In Builders
// =============================================================================

// =============================================================================
// Check-In Token Builders
// =============================================================================

// =============================================================================
// Training Plan Builders
// =============================================================================

// =============================================================================
// Training Session Builders
// =============================================================================

// =============================================================================
// Training Exercise Builders
// =============================================================================

// =============================================================================
// Check-In Form Data Builders
// =============================================================================

// =============================================================================
// Session Completion Builders
// =============================================================================

// =============================================================================
// Exercise Highlight Builders
// =============================================================================

// =============================================================================
// Training Event Builders
// =============================================================================

interface MockTrainingEventOptions {
  id?: string
  clientId?: string
  trainingPlanId?: string
  trainingSessionId?: string | null
  date?: string
  sessionName?: string
  sessionFocus?: string | null
  estimatedCalories?: number | null
  status?: TrainingEventStatus
  sessionLogId?: string | null
  /** The workout's log — where its quality lives. Null when it isn't logged. */
  log?: TrainingEventLog | null
  createdAt?: string
  updatedAt?: string
}

export function createMockTrainingEvent(options: MockTrainingEventOptions = {}): TrainingEvent {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    clientId: options.clientId ?? generateUUID(),
    trainingPlanId: options.trainingPlanId ?? generateUUID(),
    trainingSessionId: options.trainingSessionId ?? generateUUID(),
    date: options.date ?? '2026-04-08',
    sessionName: options.sessionName ?? 'Push Day',
    sessionFocus: options.sessionFocus ?? null,
    estimatedCalories: options.estimatedCalories !== undefined ? options.estimatedCalories : 350,
    status: options.status ?? 'scheduled',
    sessionLogId: options.sessionLogId ?? null,
    log: options.log ?? null,
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
  }
}

export function createMockTrainingEventRow(
  options: MockTrainingEventOptions = {}
): TrainingEventWithLogRow {
  const event = createMockTrainingEvent(options)

  return {
    // The workout's log, as every calendar read embeds it.
    session_log: event.log
      ? {
          id: event.log.id,
          completion_quality: event.log.completionQuality,
          training_session_id: event.log.performedSessionId,
          notes: event.log.notes,
        }
      : null,
    id: event.id,
    client_id: event.clientId,
    training_plan_id: event.trainingPlanId,
    training_session_id: event.trainingSessionId,
    date: event.date,
    day_order: 0,
    session_name: event.sessionName,
    session_focus: event.sessionFocus,
    estimated_calories: event.estimatedCalories,
    status: event.status,
    session_log_id: event.sessionLogId,
    is_modified: event.isModified,
    calorie_surplus_percentage: event.calorieSurplusPercentage ?? null,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  }
}
