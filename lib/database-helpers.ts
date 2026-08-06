import type { Database } from "@/types/database";

// Database row types for easy reference
export type CheckInRow = Database["public"]["Tables"]["check_ins"]["Row"];
export type TrainingPlanRow = Database["public"]["Tables"]["training_plans"]["Row"];
export type TrainingSessionRow = Database["public"]["Tables"]["training_sessions"]["Row"];
export type TrainingExerciseRow = Database["public"]["Tables"]["training_exercises"]["Row"];
export type ExerciseRow = Database["public"]["Tables"]["exercises"]["Row"];
export type ExerciseInsert = Database["public"]["Tables"]["exercises"]["Insert"];
export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type CheckInReminderRow = Database["public"]["Tables"]["check_in_reminders"]["Row"];
export type ClientInvitationRow = Database["public"]["Tables"]["client_invitations"]["Row"];
export type ContentFolderRow = Database["public"]["Tables"]["content_folders"]["Row"];
export type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
export type ContentAssignmentRow = Database["public"]["Tables"]["content_assignments"]["Row"];
export type CoachRow = Database["public"]["Tables"]["coaches"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type SessionLogRow = Database["public"]["Tables"]["session_logs"]["Row"];
export type SessionLogInsert = Database["public"]["Tables"]["session_logs"]["Insert"];
export type SessionLogUpdate = Database["public"]["Tables"]["session_logs"]["Update"];
export type ExerciseLogRow = Database["public"]["Tables"]["exercise_logs"]["Row"];
export type ExerciseLogInsert = Database["public"]["Tables"]["exercise_logs"]["Insert"];
export type ExerciseLogUpdate = Database["public"]["Tables"]["exercise_logs"]["Update"];
export type SetLogRow = Database["public"]["Tables"]["set_logs"]["Row"];
export type SetLogInsert = Database["public"]["Tables"]["set_logs"]["Insert"];
export type SetLogUpdate = Database["public"]["Tables"]["set_logs"]["Update"];
/** @deprecated Use SessionLogRow */
export type ClientSessionCompletionRow = SessionLogRow;
export type CheckInExerciseHighlightRow = Database["public"]["Tables"]["check_in_exercise_highlights"]["Row"];

// Additional helper types for insert/update operations
export type CheckInInsert = Database["public"]["Tables"]["check_ins"]["Insert"];
export type CheckInUpdate = Database["public"]["Tables"]["check_ins"]["Update"];
export type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
export type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
export type TrainingPlanInsert = Database["public"]["Tables"]["training_plans"]["Insert"];
export type TrainingPlanUpdate = Database["public"]["Tables"]["training_plans"]["Update"];
export type TrainingSessionInsert = Database["public"]["Tables"]["training_sessions"]["Insert"];
export type TrainingSessionUpdate = Database["public"]["Tables"]["training_sessions"]["Update"];
export type TrainingExerciseInsert = Database["public"]["Tables"]["training_exercises"]["Insert"];
export type TrainingExerciseUpdate = Database["public"]["Tables"]["training_exercises"]["Update"];
export type TrainingEventRow = Database["public"]["Tables"]["training_events"]["Row"];
export type TrainingEventInsert = Database["public"]["Tables"]["training_events"]["Insert"];
export type NutritionEventRow = Database["public"]["Tables"]["nutrition_events"]["Row"];
export type NutritionEventInsert = Database["public"]["Tables"]["nutrition_events"]["Insert"];

// Goals & metrics types
export type ClientGoalRow = Database["public"]["Tables"]["client_goals"]["Row"];
export type BodyMetricsRow = Database["public"]["Tables"]["body_metrics"]["Row"];
export type ClientGoalInsert = Database["public"]["Tables"]["client_goals"]["Insert"];
export type ClientGoalUpdate = Database["public"]["Tables"]["client_goals"]["Update"];
export type BodyMetricsInsert = Database["public"]["Tables"]["body_metrics"]["Insert"];
// No BodyMetricsUpdate — immutable event table

// Coach library types (added by migration 084)
export type CoachSavedPlanRow = Database["public"]["Tables"]["coach_saved_plans"]["Row"];
export type CoachSavedPlanInsert = Database["public"]["Tables"]["coach_saved_plans"]["Insert"];
export type CoachSavedPlanUpdate = Database["public"]["Tables"]["coach_saved_plans"]["Update"];
export type CoachSavedSessionRow = Database["public"]["Tables"]["coach_saved_sessions"]["Row"];
export type CoachSavedSessionInsert = Database["public"]["Tables"]["coach_saved_sessions"]["Insert"];
export type CoachSavedSessionUpdate = Database["public"]["Tables"]["coach_saved_sessions"]["Update"];
export type CoachSavedExerciseRow = Database["public"]["Tables"]["coach_saved_exercises"]["Row"];
export type CoachSavedExerciseInsert = Database["public"]["Tables"]["coach_saved_exercises"]["Insert"];
export type CoachSavedExerciseUpdate = Database["public"]["Tables"]["coach_saved_exercises"]["Update"];