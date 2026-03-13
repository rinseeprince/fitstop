import type { Database } from "@/types/database";

// Database row types for easy reference
export type CheckInRow = Database["public"]["Tables"]["check_ins"]["Row"];
export type CheckInTokenRow = Database["public"]["Tables"]["check_in_tokens"]["Row"];
export type TrainingPlanRow = Database["public"]["Tables"]["training_plans"]["Row"];
export type TrainingSessionRow = Database["public"]["Tables"]["training_sessions"]["Row"];
export type TrainingExerciseRow = Database["public"]["Tables"]["training_exercises"]["Row"];
export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type CheckInReminderRow = Database["public"]["Tables"]["check_in_reminders"]["Row"];
export type ClientInvitationRow = Database["public"]["Tables"]["client_invitations"]["Row"];
export type ContentFolderRow = Database["public"]["Tables"]["content_folders"]["Row"];
export type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
export type ContentAssignmentRow = Database["public"]["Tables"]["content_assignments"]["Row"];
export type CoachRow = Database["public"]["Tables"]["coaches"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type ClientSessionCompletionRow = Database["public"]["Tables"]["client_session_completions"]["Row"];
export type CheckInSessionCompletionRow = Database["public"]["Tables"]["check_in_session_completions"]["Row"];
export type CheckInExerciseHighlightRow = Database["public"]["Tables"]["check_in_exercise_highlights"]["Row"];
export type CheckInExternalActivityRow = Database["public"]["Tables"]["check_in_external_activities"]["Row"];

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