// Body metrics source
export type BodyMetricsSource = "check_in" | "metrics_api" | "intake_sync" | "nutrition_plan" | "coach_entry";

// Body metrics event record (matches database schema)
// Immutable event log — no updatedAt.
export type BodyMetricsEvent = {
  id: string;
  clientId: string;
  weight?: number;
  weightUnit?: string;
  bodyFatPercentage?: number;
  bmr?: number;
  tdee?: number;
  source: BodyMetricsSource;
  sourceId?: string;
  recordedAt: string;
  createdAt: string;
};

// Input type for creating body metrics events (excludes server-managed fields)
export type BodyMetricsEventInput = Omit<BodyMetricsEvent, "id" | "createdAt">;

// Database row shape (until types/database.ts is regenerated)
export type BodyMetricsEventRow = {
  id: string;
  client_id: string;
  weight: number | null;
  weight_unit: string | null;
  body_fat_percentage: number | null;
  bmr: number | null;
  tdee: number | null;
  source: string; // DB returns string; cast to BodyMetricsSource in mapper
  source_id: string | null;
  recorded_at: string;
  created_at: string;
};
