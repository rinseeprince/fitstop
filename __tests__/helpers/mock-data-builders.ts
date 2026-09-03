/**
 * Mock data builders for FitStop test suite
 * These factories create type-safe test data with sensible defaults
 */

import { generateUUID, generateISODate } from './test-utils'
import type { TrainingEventRow } from '@/lib/database-helpers'
import type { ClientGoalRow } from '@/types/client-goals'
import type { TrainingEvent, TrainingEventStatus } from '@/types/training'

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
// Client Goals Builders
// =============================================================================

interface MockClientGoalsRowOptions {
  id?: string
  clientId?: string
  goalWeight?: number | null
  goalBodyFatPercentage?: number | null
  goalDeadline?: string | null
  primaryGoal?: string | null
  setBy?: string
  notes?: string | null
  effectiveFrom?: string
  supersededAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export function createMockClientGoalsRow(options: MockClientGoalsRowOptions = {}): ClientGoalRow {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    client_id: options.clientId ?? generateUUID(),
    goal_weight: options.goalWeight ?? 170,
    goal_body_fat_percentage: options.goalBodyFatPercentage ?? null,
    goal_deadline: options.goalDeadline ?? null,
    primary_goal: options.primaryGoal ?? 'weight_loss',
    set_by: options.setBy ?? generateUUID(),
    notes: options.notes ?? null,
    effective_from: options.effectiveFrom ?? now,
    superseded_at: options.supersededAt ?? null,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
  }
}

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
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
  }
}

export function createMockTrainingEventRow(options: MockTrainingEventOptions = {}): TrainingEventRow {
  const event = createMockTrainingEvent(options)

  return {
    id: event.id,
    client_id: event.clientId,
    training_plan_id: event.trainingPlanId,
    training_session_id: event.trainingSessionId,
    date: event.date,
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
