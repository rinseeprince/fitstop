/**
 * Mock data builders for FitStop test suite
 * These factories create type-safe test data with sensible defaults
 */

import { generateUUID, generateISODate } from './test-utils'
import type { Client } from '@/types/check-in'
import type { CheckInRow, CheckInTokenRow, ClientRow, TrainingPlanRow, TrainingSessionRow, TrainingExerciseRow, TrainingEventRow } from '@/lib/database-helpers'
import type { BodyMetricsEventRow, ClientGoalRow, Milestone, RoadmapRow, PhaseRow } from '@/types/roadmap'
import type { TrainingEvent, TrainingEventStatus } from '@/types/training'

// =============================================================================
// Client Builders
// =============================================================================

export interface MockClientOptions {
  id?: string
  coachId?: string
  name?: string
  email?: string
  active?: boolean
  currentWeight?: number
  goalWeight?: number
  weightUnit?: 'lbs' | 'kg'
  createdAt?: string
  updatedAt?: string
}

export function createMockClient(options: MockClientOptions = {}): Client {
  const id = options.id ?? generateUUID()
  const now = generateISODate()

  return {
    id,
    coachId: options.coachId ?? generateUUID(),
    name: options.name ?? 'Test Client',
    email: options.email ?? `test-${id.slice(0, 8)}@example.com`,
    active: options.active ?? true,
    currentWeight: options.currentWeight ?? 180,
    goalWeight: options.goalWeight ?? 170,
    weightUnit: options.weightUnit ?? 'lbs',
    includeActivityBurn: true,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
  }
}

export function createMockClientDatabaseRow(options: MockClientOptions = {}): ClientRow {
  const client = createMockClient(options)

  return {
    id: client.id,
    coach_id: client.coachId,
    name: client.name,
    email: client.email,
    avatar_url: null,
    notes: null,
    active: client.active,
    height: null,
    height_unit: 'in',
    gender: null,
    date_of_birth: null,
    goal_weight: client.goalWeight ?? null,
    goal_body_fat_percentage: null,
    weight_unit: client.weightUnit ?? null,
    current_weight: client.currentWeight ?? null,
    current_body_fat_percentage: null,
    bmr: null,
    tdee: null,
    check_in_frequency: 'weekly',
    check_in_frequency_days: 7,
    expected_check_in_day: 'monday',
    last_reminder_sent_at: null,
    reminder_preferences: null,
    total_check_ins_expected: 0,
    total_check_ins_completed: 0,
    check_in_adherence_rate: null,
    current_streak: 0,
    longest_streak: 0,
    unit_preference: 'imperial',
    goal_deadline: null,
    starting_weight: client.currentWeight ?? null,
    starting_body_fat_percentage: null,
    include_activity_burn: true,
    bmr_manual_override: null,
    tdee_manual_override: null,
    user_id: null,
    welcome_message: null,
    onboarding_status: null,
    walkthrough_completed_at: null,
    start_date: null,
    work_activity_level: null,
    created_at: client.createdAt,
    updated_at: client.updatedAt,
  }
}

// =============================================================================
// Check-In Builders
// =============================================================================

export interface MockCheckInOptions {
  id?: string
  clientId?: string
  status?: 'pending' | 'ai_processed' | 'reviewed'
  mood?: number
  energy?: number
  sleep?: number
  stress?: number
  weight?: number
  weightUnit?: 'lbs' | 'kg'
  createdAt?: string
  updatedAt?: string
}

export function createMockCheckInRow(options: MockCheckInOptions = {}): CheckInRow {
  const id = options.id ?? generateUUID()
  const now = generateISODate()

  return {
    id,
    client_id: options.clientId ?? generateUUID(),
    status: options.status ?? 'pending',
    mood: options.mood ?? 4,
    energy: options.energy ?? 7,
    sleep: options.sleep ?? 7,
    stress: options.stress ?? 5,
    notes: null,
    weight: options.weight ?? 180,
    weight_unit: options.weightUnit ?? 'lbs',
    body_fat_percentage: null,
    waist: null,
    hips: null,
    chest: null,
    arms: null,
    thighs: null,
    measurement_unit: 'in',
    photo_front: null,
    photo_side: null,
    photo_back: null,
    workouts_completed: null,
    adherence_percentage: null,
    prs: null,
    challenges: null,
    nutrition_days_on_target: null,
    nutrition_notes: null,
    ai_summary: null,
    ai_insights: null,
    ai_recommendations: null,
    ai_response_draft: null,
    ai_processed_at: null,
    coach_response: null,
    coach_reviewed_at: null,
    response_sent_at: null,
    period_start: null,
    period_end: null,
    period_snapshot: null,
    daily_logs_start_date: null,
    daily_logs_end_date: null,
    uses_daily_logs: false,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
  }
}

// =============================================================================
// Check-In Token Builders
// =============================================================================

export interface MockCheckInTokenOptions {
  id?: string
  clientId?: string
  token?: string
  expiresAt?: string
  usedAt?: string | null
  checkInId?: string | null
  createdAt?: string
}

export function createMockCheckInTokenRow(options: MockCheckInTokenOptions = {}): CheckInTokenRow {
  const now = generateISODate()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // Default 7 days expiry

  return {
    id: options.id ?? generateUUID(),
    client_id: options.clientId ?? generateUUID(),
    token: options.token ?? `tok_${generateUUID().replace(/-/g, '')}`,
    expires_at: options.expiresAt ?? expiresAt.toISOString(),
    used_at: options.usedAt ?? null,
    check_in_id: options.checkInId ?? null,
    created_at: options.createdAt ?? now,
  }
}

// =============================================================================
// Training Plan Builders
// =============================================================================

export interface MockTrainingPlanOptions {
  id?: string
  clientId?: string
  coachId?: string
  name?: string
  status?: 'active' | 'archived' | 'draft'
  splitType?: string
  frequencyPerWeek?: number
  createdAt?: string
  updatedAt?: string
}

export function createMockTrainingPlanRow(options: MockTrainingPlanOptions = {}): TrainingPlanRow {
  const id = options.id ?? generateUUID()
  const now = generateISODate()

  return {
    id,
    client_id: options.clientId ?? generateUUID(),
    coach_id: options.coachId ?? generateUUID(),
    name: options.name ?? 'Test Training Plan',
    description: null,
    status: options.status ?? 'active',
    coach_prompt: 'Test prompt for training plan generation',
    ai_response_raw: null,
    split_type: options.splitType ?? 'push_pull_legs',
    frequency_per_week: options.frequencyPerWeek ?? 4,
    program_duration_weeks: 12,
    client_weight_kg: null,
    client_body_fat_percentage: null,
    client_goal_weight_kg: null,
    client_tdee: null,
    avg_mood: null,
    avg_energy: null,
    avg_sleep: null,
    avg_stress: null,
    recent_adherence_percentage: null,
    effective_from: (options.createdAt ?? now).split('T')[0],
    effective_until: null,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
    deleted_at: null,
    phase_id: null,
    saved_plan_id: null,
  }
}

// =============================================================================
// Training Session Builders
// =============================================================================

export interface MockTrainingSessionOptions {
  id?: string
  planId?: string
  name?: string
  dayOfWeek?: string | null
  orderIndex?: number
  createdAt?: string
  updatedAt?: string
}

export function createMockTrainingSessionRow(options: MockTrainingSessionOptions = {}): TrainingSessionRow {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    plan_id: options.planId ?? generateUUID(),
    name: options.name ?? 'Push Day',
    day_of_week: options.dayOfWeek ?? 'monday',
    order_index: options.orderIndex ?? 0,
    focus: 'Chest, Shoulders, Triceps',
    notes: null,
    estimated_duration_minutes: 60,
    estimated_calories: null,
    calories_calculated_at: null,
    calorie_surplus_percentage: null,
    is_active: true,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
  }
}

// =============================================================================
// Training Exercise Builders
// =============================================================================

export interface MockTrainingExerciseOptions {
  id?: string
  sessionId?: string
  name?: string
  orderIndex?: number
  sets?: number
  repsMin?: number | null
  repsMax?: number | null
  createdAt?: string
  updatedAt?: string
}

export function createMockTrainingExerciseRow(options: MockTrainingExerciseOptions = {}): TrainingExerciseRow {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    session_id: options.sessionId ?? generateUUID(),
    name: options.name ?? 'Bench Press',
    order_index: options.orderIndex ?? 0,
    sets: options.sets ?? 4,
    reps_min: options.repsMin ?? 8,
    reps_max: options.repsMax ?? 12,
    reps_target: null,
    rpe_target: 8,
    percentage_1rm: null,
    tempo: null,
    rest_seconds: 90,
    notes: null,
    superset_group: null,
    is_warmup: false,
    is_active: true,
    exercise_id: null,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
  }
}

// =============================================================================
// Check-In Form Data Builders
// =============================================================================

export interface MockCheckInFormDataOptions {
  token?: string
  mood?: number
  energy?: number
  sleep?: number
  stress?: number
  weight?: number
  weightUnit?: 'lbs' | 'kg'
  notes?: string
}

export function createMockCheckInFormData(options: MockCheckInFormDataOptions = {}) {
  return {
    token: options.token ?? `tok_${generateUUID().replace(/-/g, '')}`,
    mood: options.mood ?? 4,
    energy: options.energy ?? 7,
    sleep: options.sleep ?? 7,
    stress: options.stress ?? 5,
    weight: options.weight ?? 180,
    weightUnit: options.weightUnit ?? 'lbs',
    notes: options.notes,
  }
}

// =============================================================================
// Session Completion Builders
// =============================================================================

export function createMockSessionCompletion(options: {
  trainingSessionId?: string
  sessionName?: string
  completed?: boolean
  completionQuality?: 'full' | 'partial' | 'skipped'
} = {}) {
  return {
    trainingSessionId: options.trainingSessionId ?? generateUUID(),
    sessionName: options.sessionName ?? 'Push Day',
    completed: options.completed ?? true,
    completionQuality: options.completionQuality ?? 'full',
  }
}

// =============================================================================
// Exercise Highlight Builders
// =============================================================================

export function createMockExerciseHighlight(options: {
  exerciseId?: string
  exerciseName?: string
  highlightType?: 'pr' | 'struggle' | 'note'
  details?: string
  weightValue?: number
  weightUnit?: 'lbs' | 'kg'
  reps?: number
} = {}) {
  return {
    exerciseId: options.exerciseId ?? generateUUID(),
    exerciseName: options.exerciseName ?? 'Bench Press',
    highlightType: options.highlightType ?? 'pr',
    details: options.details ?? 'New personal record!',
    weightValue: options.weightValue ?? 225,
    weightUnit: options.weightUnit ?? 'lbs',
    reps: options.reps ?? 5,
  }
}

// =============================================================================
// Client Goals Builders
// =============================================================================

export interface MockClientGoalsRowOptions {
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
// Body Metrics Builders
// =============================================================================

export interface MockBodyMetricsRowOptions {
  id?: string
  clientId?: string
  weight?: number | null
  weightUnit?: string | null
  bodyFatPercentage?: number | null
  bmr?: number | null
  tdee?: number | null
  source?: string
  sourceId?: string | null
  recordedAt?: string
  createdAt?: string
}

export function createMockBodyMetricsRow(options: MockBodyMetricsRowOptions = {}): BodyMetricsEventRow {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    client_id: options.clientId ?? generateUUID(),
    weight: options.weight ?? 180,
    weight_unit: options.weightUnit ?? 'lbs',
    body_fat_percentage: options.bodyFatPercentage ?? null,
    bmr: options.bmr ?? null,
    tdee: options.tdee ?? null,
    source: options.source ?? 'check_in',
    source_id: options.sourceId ?? null,
    recorded_at: options.recordedAt ?? now,
    created_at: options.createdAt ?? now,
  }
}

// =============================================================================
// Roadmap Builders
// =============================================================================

export interface MockRoadmapRowOptions {
  id?: string
  clientId?: string
  coachId?: string
  name?: string
  longTermGoal?: string | null
  goalWeight?: number | null
  goalBodyFatPercentage?: number | null
  status?: string
  startedAt?: string | null
  targetEndDate?: string | null
  createdAt?: string
  updatedAt?: string
}

export function createMockRoadmapRow(options: MockRoadmapRowOptions = {}): RoadmapRow {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    client_id: options.clientId ?? generateUUID(),
    coach_id: options.coachId ?? generateUUID(),
    name: options.name ?? 'Test Roadmap',
    long_term_goal: options.longTermGoal ?? null,
    goal_weight: options.goalWeight ?? null,
    goal_body_fat_percentage: options.goalBodyFatPercentage ?? null,
    status: options.status ?? 'active',
    started_at: options.startedAt ?? now,
    target_end_date: options.targetEndDate ?? null,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
  }
}

// =============================================================================
// Phase Builders
// =============================================================================

export interface MockPhaseRowOptions {
  id?: string
  roadmapId?: string
  clientId?: string
  name?: string
  description?: string | null
  objectives?: string | null
  orderIndex?: number
  status?: string
  startDate?: string | null
  endDate?: string | null
  durationWeeks?: number | null
  phaseGoalsSnapshot?: Record<string, unknown> | null
  phaseGoalWeight?: number | null
  phaseGoalBodyFatPercentage?: number | null
  coachReflection?: string | null
  phaseSummary?: Record<string, unknown> | null
  milestones?: Milestone[]
  completionSeen?: boolean
  createdAt?: string
  updatedAt?: string
}

export function createMockPhaseRow(options: MockPhaseRowOptions = {}): PhaseRow {
  const now = generateISODate()

  return {
    id: options.id ?? generateUUID(),
    roadmap_id: options.roadmapId ?? generateUUID(),
    client_id: options.clientId ?? generateUUID(),
    name: options.name ?? 'Phase 1',
    description: options.description ?? null,
    objectives: options.objectives ?? null,
    order_index: options.orderIndex ?? 0,
    status: options.status ?? 'planned',
    start_date: options.startDate ?? null,
    end_date: options.endDate ?? null,
    duration_weeks: options.durationWeeks ?? null,
    phase_goals_snapshot: options.phaseGoalsSnapshot ?? null,
    phase_goal_weight: options.phaseGoalWeight ?? null,
    phase_goal_body_fat_percentage: options.phaseGoalBodyFatPercentage ?? null,
    coach_reflection: options.coachReflection ?? null,
    phase_summary: options.phaseSummary ?? null,
    milestones: options.milestones ?? [],
    completion_seen: options.completionSeen ?? false,
    created_at: options.createdAt ?? now,
    updated_at: options.updatedAt ?? now,
  }
}

// =============================================================================
// Training Event Builders
// =============================================================================

export interface MockTrainingEventOptions {
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
