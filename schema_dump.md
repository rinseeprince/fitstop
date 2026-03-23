| table_name                   | column_name                  | data_type                | is_nullable |
| ---------------------------- | ---------------------------- | ------------------------ | ----------- |
| activity_suggestions         | id                           | uuid                     | NO          |
| activity_suggestions         | activity_name                | text                     | NO          |
| activity_suggestions         | category                     | text                     | NO          |
| activity_suggestions         | default_met_low              | numeric                  | NO          |
| activity_suggestions         | default_met_moderate         | numeric                  | NO          |
| activity_suggestions         | default_met_vigorous         | numeric                  | NO          |
| activity_suggestions         | muscle_groups_impacted       | ARRAY                    | YES         |
| activity_suggestions         | recovery_notes               | text                     | YES         |
| activity_suggestions         | popularity_score             | integer                  | YES         |
| activity_suggestions         | created_at                   | timestamp with time zone | NO          |
| activity_suggestions         | updated_at                   | timestamp with time zone | NO          |
| check_in_exercise_highlights | id                           | uuid                     | NO          |
| check_in_exercise_highlights | check_in_id                  | uuid                     | NO          |
| check_in_exercise_highlights | exercise_id                  | uuid                     | YES         |
| check_in_exercise_highlights | exercise_name                | text                     | NO          |
| check_in_exercise_highlights | highlight_type               | text                     | NO          |
| check_in_exercise_highlights | details                      | text                     | YES         |
| check_in_exercise_highlights | weight_value                 | numeric                  | YES         |
| check_in_exercise_highlights | weight_unit                  | text                     | YES         |
| check_in_exercise_highlights | reps                         | integer                  | YES         |
| check_in_exercise_highlights | created_at                   | timestamp with time zone | NO          |
| check_in_external_activities | id                           | uuid                     | NO          |
| check_in_external_activities | check_in_id                  | uuid                     | NO          |
| check_in_external_activities | activity_name                | text                     | NO          |
| check_in_external_activities | intensity_level              | text                     | NO          |
| check_in_external_activities | duration_minutes             | integer                  | NO          |
| check_in_external_activities | estimated_calories           | integer                  | YES         |
| check_in_external_activities | day_performed                | text                     | YES         |
| check_in_external_activities | notes                        | text                     | YES         |
| check_in_external_activities | created_at                   | timestamp with time zone | NO          |
| check_in_reminders           | id                           | uuid                     | NO          |
| check_in_reminders           | client_id                    | uuid                     | NO          |
| check_in_reminders           | sent_at                      | timestamp with time zone | YES         |
| check_in_reminders           | reminder_type                | text                     | NO          |
| check_in_reminders           | days_overdue                 | integer                  | YES         |
| check_in_reminders           | responded                    | boolean                  | YES         |
| check_in_reminders           | responded_at                 | timestamp with time zone | YES         |
| check_in_reminders           | check_in_id                  | uuid                     | YES         |
| check_in_reminders           | sent_via                     | text                     | YES         |
| check_in_reminders           | notes                        | text                     | YES         |
| check_in_reminders           | created_at                   | timestamp with time zone | YES         |
| check_in_session_completions | id                           | uuid                     | NO          |
| check_in_session_completions | check_in_id                  | uuid                     | NO          |
| check_in_session_completions | training_session_id          | uuid                     | NO          |
| check_in_session_completions | completed                    | boolean                  | NO          |
| check_in_session_completions | completion_quality           | text                     | YES         |
| check_in_session_completions | notes                        | text                     | YES         |
| check_in_session_completions | created_at                   | timestamp with time zone | NO          |
| check_in_tokens              | id                           | uuid                     | NO          |
| check_in_tokens              | token                        | text                     | NO          |
| check_in_tokens              | expires_at                   | timestamp with time zone | NO          |
| check_in_tokens              | used_at                      | timestamp with time zone | YES         |
| check_in_tokens              | check_in_id                  | uuid                     | YES         |
| check_in_tokens              | created_at                   | timestamp with time zone | YES         |
| check_in_tokens              | client_id                    | uuid                     | NO          |
| check_ins                    | id                           | uuid                     | NO          |
| check_ins                    | status                       | text                     | NO          |
| check_ins                    | mood                         | integer                  | YES         |
| check_ins                    | energy                       | integer                  | YES         |
| check_ins                    | sleep                        | integer                  | YES         |
| check_ins                    | stress                       | integer                  | YES         |
| check_ins                    | notes                        | text                     | YES         |
| check_ins                    | weight                       | numeric                  | YES         |
| check_ins                    | weight_unit                  | text                     | YES         |
| check_ins                    | body_fat_percentage          | numeric                  | YES         |
| check_ins                    | waist                        | numeric                  | YES         |
| check_ins                    | hips                         | numeric                  | YES         |
| check_ins                    | chest                        | numeric                  | YES         |
| check_ins                    | arms                         | numeric                  | YES         |
| check_ins                    | thighs                       | numeric                  | YES         |
| check_ins                    | measurement_unit             | text                     | YES         |
| check_ins                    | photo_front                  | text                     | YES         |
| check_ins                    | photo_side                   | text                     | YES         |
| check_ins                    | photo_back                   | text                     | YES         |
| check_ins                    | workouts_completed           | integer                  | YES         |
| check_ins                    | adherence_percentage         | integer                  | YES         |
| check_ins                    | prs                          | text                     | YES         |
| check_ins                    | challenges                   | text                     | YES         |
| check_ins                    | ai_summary                   | text                     | YES         |
| check_ins                    | ai_insights                  | jsonb                    | YES         |
| check_ins                    | ai_recommendations           | jsonb                    | YES         |
| check_ins                    | ai_response_draft            | text                     | YES         |
| check_ins                    | ai_processed_at              | timestamp with time zone | YES         |
| check_ins                    | coach_response               | text                     | YES         |
| check_ins                    | coach_reviewed_at            | timestamp with time zone | YES         |
| check_ins                    | response_sent_at             | timestamp with time zone | YES         |
| check_ins                    | created_at                   | timestamp with time zone | YES         |
| check_ins                    | updated_at                   | timestamp with time zone | YES         |
| check_ins                    | client_id                    | uuid                     | NO          |
| check_ins                    | nutrition_days_on_target     | integer                  | YES         |
| check_ins                    | nutrition_notes              | text                     | YES         |
| check_ins                    | daily_logs_start_date        | date                     | YES         |
| check_ins                    | daily_logs_end_date          | date                     | YES         |
| check_ins                    | uses_daily_logs              | boolean                  | NO          |
| check_ins                    | period_start                 | date                     | YES         |
| check_ins                    | period_end                   | date                     | YES         |
| client_intake                | id                           | uuid                     | NO          |
| client_intake                | client_id                    | uuid                     | NO          |
| client_intake                | status                       | text                     | NO          |
| client_intake                | primary_goal                 | text                     | YES         |
| client_intake                | goal_details                 | text                     | YES         |
| client_intake                | date_of_birth                | date                     | YES         |
| client_intake                | gender                       | text                     | YES         |
| client_intake                | height                       | numeric                  | YES         |
| client_intake                | height_unit                  | text                     | YES         |
| client_intake                | current_weight               | numeric                  | YES         |
| client_intake                | weight_unit                  | text                     | YES         |
| client_intake                | work_activity_level          | text                     | YES         |
| client_intake                | dietary_requirements         | ARRAY                    | YES         |
| client_intake                | cooking_frequency            | text                     | YES         |
| client_intake                | nutrition_notes              | text                     | YES         |
| client_intake                | training_experience_level    | text                     | YES         |
| client_intake                | training_time_preference     | text                     | YES         |
| client_intake                | training_location            | text                     | YES         |
| client_intake                | available_equipment          | ARRAY                    | YES         |
| client_intake                | days_per_week                | integer                  | YES         |
| client_intake                | session_duration_minutes     | integer                  | YES         |
| client_intake                | injuries_or_limitations      | text                     | YES         |
| client_intake                | medical_notes                | text                     | YES         |
| client_intake                | completed_at                 | timestamp with time zone | YES         |
| client_intake                | created_at                   | timestamp with time zone | YES         |
| client_intake                | updated_at                   | timestamp with time zone | YES         |
| client_intake                | body_fat_percentage          | numeric                  | YES         |
| client_intake                | target_weight                | numeric                  | YES         |
| client_intake                | goal_deadline                | date                     | YES         |
| client_intake                | goal_description             | text                     | YES         |
| client_intake                | motivation                   | text                     | YES         |
| client_intake                | food_allergies               | text                     | YES         |
| client_intake                | diet_description             | text                     | YES         |
| client_intake                | has_tracked_macros_before    | boolean                  | YES         |
| client_intake                | meals_per_day                | integer                  | YES         |
| client_intake                | biggest_nutrition_challenge  | text                     | YES         |
| client_intake                | previous_coaching_experience | boolean                  | YES         |
| client_intake                | previous_coaching_details    | text                     | YES         |
| client_intake                | anything_else                | text                     | YES         |
| client_intake                | started_at                   | timestamp with time zone | YES         |
| client_intake                | reviewed_at                  | timestamp with time zone | YES         |
| client_intake                | reviewed_by                  | uuid                     | YES         |
| client_intake                | coach_review_notes           | text                     | YES         |
| client_intake                | goal_body_fat_percentage     | numeric                  | YES         |
| client_invitations           | id                           | uuid                     | NO          |
| client_invitations           | client_id                    | uuid                     | NO          |
| client_invitations           | status                       | text                     | NO          |
| client_invitations           | invited_at                   | timestamp with time zone | YES         |
| client_invitations           | accepted_at                  | timestamp with time zone | YES         |
| client_invitations           | expires_at                   | timestamp with time zone | YES         |
| client_invitations           | created_at                   | timestamp with time zone | NO          |
| client_invitations           | updated_at                   | timestamp with time zone | NO          |
| client_invitations           | token                        | text                     | YES         |
| client_invitations           | email                        | text                     | NO          |
| clients                      | id                           | uuid                     | NO          |
| clients                      | coach_id                     | uuid                     | NO          |
| clients                      | name                         | text                     | NO          |
| clients                      | email                        | text                     | NO          |
| clients                      | avatar_url                   | text                     | YES         |
| clients                      | active                       | boolean                  | YES         |
| clients                      | created_at                   | timestamp with time zone | YES         |
| clients                      | updated_at                   | timestamp with time zone | YES         |
| clients                      | notes                        | text                     | YES         |
| clients                      | check_in_frequency           | text                     | YES         |
| clients                      | check_in_frequency_days      | integer                  | YES         |
| clients                      | expected_check_in_day        | text                     | YES         |
| clients                      | last_reminder_sent_at        | timestamp with time zone | YES         |
| clients                      | reminder_preferences         | jsonb                    | YES         |
| clients                      | total_check_ins_expected     | integer                  | YES         |
| clients                      | total_check_ins_completed    | integer                  | YES         |
| clients                      | check_in_adherence_rate      | numeric                  | YES         |
| clients                      | current_streak               | integer                  | YES         |
| clients                      | longest_streak               | integer                  | YES         |
| clients                      | goal_weight                  | numeric                  | YES         |
| clients                      | weight_unit                  | text                     | YES         |
| clients                      | current_weight               | numeric                  | YES         |
| clients                      | current_body_fat_percentage  | numeric                  | YES         |
| clients                      | goal_body_fat_percentage     | numeric                  | YES         |
| clients                      | height                       | numeric                  | YES         |
| clients                      | height_unit                  | text                     | YES         |
| clients                      | gender                       | text                     | YES         |
| clients                      | bmr                          | numeric                  | YES         |
| clients                      | tdee                         | numeric                  | YES         |
| clients                      | date_of_birth                | date                     | YES         |
| clients                      | unit_preference              | text                     | YES         |
| clients                      | goal_deadline                | date                     | YES         |
| clients                      | bmr_manual_override          | boolean                  | YES         |
| clients                      | tdee_manual_override         | boolean                  | YES         |
| clients                      | starting_weight              | numeric                  | YES         |
| clients                      | starting_body_fat_percentage | numeric                  | YES         |
| clients                      | user_id                      | uuid                     | YES         |
| clients                      | include_activity_burn        | boolean                  | NO          |
| clients                      | onboarding_status            | text                     | YES         |
| clients                      | welcome_message              | text                     | YES         |
| clients                      | walkthrough_completed_at     | timestamp with time zone | YES         |
| clients                      | start_date                   | date                     | YES         |
| clients                      | work_activity_level          | text                     | YES         |
| coaches                      | id                           | uuid                     | NO          |
| coaches                      | user_id                      | uuid                     | YES         |
| coaches                      | name                         | text                     | NO          |
| coaches                      | email                        | text                     | NO          |
| coaches                      | avatar_url                   | text                     | YES         |
| coaches                      | created_at                   | timestamp with time zone | YES         |
| coaches                      | updated_at                   | timestamp with time zone | YES         |
| content_assignments          | id                           | uuid                     | NO          |
| content_assignments          | content_id                   | uuid                     | NO          |
| content_assignments          | client_id                    | uuid                     | NO          |
| content_assignments          | assigned_by                  | uuid                     | NO          |
| content_assignments          | assigned_at                  | timestamp with time zone | NO          |
| content_folders              | id                           | uuid                     | NO          |
| content_folders              | coach_id                     | uuid                     | NO          |
| content_folders              | name                         | text                     | NO          |
| content_folders              | parent_folder_id             | uuid                     | YES         |
| content_folders              | sort_order                   | integer                  | YES         |
| content_folders              | created_at                   | timestamp with time zone | NO          |
| content_folders              | updated_at                   | timestamp with time zone | NO          |
| content_items                | id                           | uuid                     | NO          |
| content_items                | coach_id                     | uuid                     | NO          |
| content_items                | folder_id                    | uuid                     | YES         |
| content_items                | title                        | text                     | NO          |
| content_items                | description                  | text                     | YES         |
| content_items                | type                         | USER-DEFINED             | NO          |
| content_items                | url                          | text                     | YES         |
| content_items                | storage_path                 | text                     | YES         |
| content_items                | file_name                    | text                     | YES         |
| content_items                | file_size                    | bigint                   | YES         |
| content_items                | mime_type                    | text                     | YES         |
| content_items                | thumbnail_url                | text                     | YES         |
| content_items                | metadata                     | jsonb                    | YES         |
| content_items                | is_library                   | boolean                  | YES         |
| content_items                | sort_order                   | integer                  | YES         |
| content_items                | created_at                   | timestamp with time zone | NO          |
| content_items                | updated_at                   | timestamp with time zone | NO          |
| daily_external_activities    | id                           | uuid                     | NO          |
| daily_external_activities    | client_id                    | uuid                     | NO          |
| daily_external_activities    | date                         | date                     | NO          |
| daily_external_activities    | activity_name                | text                     | NO          |
| daily_external_activities    | intensity_level              | text                     | NO          |
| daily_external_activities    | duration_minutes             | integer                  | NO          |
| daily_external_activities    | estimated_calories           | integer                  | YES         |
| daily_external_activities    | notes                        | text                     | YES         |
| daily_external_activities    | created_at                   | timestamp with time zone | NO          |
| daily_external_activities    | updated_at                   | timestamp with time zone | NO          |
| daily_habit_logs             | id                           | uuid                     | NO          |
| daily_habit_logs             | daily_habit_id               | uuid                     | NO          |
| daily_habit_logs             | client_id                    | uuid                     | NO          |
| daily_habit_logs             | date                         | date                     | NO          |
| daily_habit_logs             | completed                    | boolean                  | NO          |
| daily_habit_logs             | value                        | numeric                  | YES         |
| daily_habit_logs             | notes                        | text                     | YES         |
| daily_habit_logs             | created_at                   | timestamp with time zone | NO          |
| daily_habit_logs             | updated_at                   | timestamp with time zone | NO          |
| daily_habit_logs             | phase_id                     | uuid                     | YES         |
| daily_habits                 | id                           | uuid                     | NO          |
| daily_habits                 | coach_id                     | uuid                     | NO          |
| daily_habits                 | client_id                    | uuid                     | NO          |
| daily_habits                 | name                         | text                     | NO          |
| daily_habits                 | description                  | text                     | YES         |
| daily_habits                 | target_value                 | numeric                  | YES         |
| daily_habits                 | target_unit                  | text                     | YES         |
| daily_habits                 | is_boolean                   | boolean                  | NO          |
| daily_habits                 | is_active                    | boolean                  | NO          |
| daily_habits                 | sort_order                   | integer                  | NO          |
| daily_habits                 | created_at                   | timestamp with time zone | NO          |
| daily_habits                 | updated_at                   | timestamp with time zone | NO          |
| daily_logs                   | id                           | uuid                     | NO          |
| daily_logs                   | client_id                    | uuid                     | NO          |
| daily_logs                   | date                         | date                     | NO          |
| daily_logs                   | notes                        | text                     | YES         |
| daily_logs                   | created_at                   | timestamp with time zone | NO          |
| daily_logs                   | updated_at                   | timestamp with time zone | NO          |
| daily_logs                   | phase_id                     | uuid                     | YES         |
| daily_logs_full              | id                           | uuid                     | YES         |
| daily_logs_full              | client_id                    | uuid                     | YES         |
| daily_logs_full              | date                         | date                     | YES         |
| daily_logs_full              | notes                        | text                     | YES         |
| daily_logs_full              | phase_id                     | uuid                     | YES         |
| daily_logs_full              | created_at                   | timestamp with time zone | YES         |
| daily_logs_full              | updated_at                   | timestamp with time zone | YES         |
| daily_logs_full              | mood                         | integer                  | YES         |
| daily_logs_full              | energy                       | integer                  | YES         |
| daily_logs_full              | sleep                        | integer                  | YES         |
| daily_logs_full              | stress                       | integer                  | YES         |
| daily_logs_full              | calories_consumed            | integer                  | YES         |
| daily_logs_full              | protein_g                    | integer                  | YES         |
| daily_logs_full              | carbs_g                      | integer                  | YES         |
| daily_logs_full              | fat_g                        | integer                  | YES         |
| daily_logs_full              | target_calories              | integer                  | YES         |
| daily_logs_full              | target_protein_g             | integer                  | YES         |
| daily_logs_full              | target_carbs_g               | integer                  | YES         |
| daily_logs_full              | target_fat_g                 | integer                  | YES         |
| daily_logs_full              | nutrition_adherence          | text                     | YES         |
| daily_logs_full              | calorie_surplus_deficit      | integer                  | YES         |
| daily_logs_full              | trained                      | boolean                  | YES         |
| daily_logs_full              | training_session_id          | uuid                     | YES         |
| daily_logs_full              | training_data                | jsonb                    | YES         |
| exercise_logs                | id                           | uuid                     | NO          |
| exercise_logs                | session_log_id               | uuid                     | NO          |
| exercise_logs                | training_exercise_id         | uuid                     | YES         |
| exercise_logs                | completed                    | boolean                  | YES         |
| exercise_logs                | actual_sets                  | integer                  | YES         |
| exercise_logs                | actual_reps                  | text                     | YES         |
| exercise_logs                | actual_weight                | numeric                  | YES         |
| exercise_logs                | weight_unit                  | text                     | YES         |
| exercise_logs                | notes                        | text                     | YES         |
| exercise_logs                | created_at                   | timestamp with time zone | NO          |
| exercise_logs                | updated_at                   | timestamp with time zone | NO          |
| exercise_logs                | prescribed_exercise_snapshot | jsonb                    | YES         |
| nutrition_logs               | id                           | uuid                     | NO          |
| nutrition_logs               | daily_log_id                 | uuid                     | NO          |
| nutrition_logs               | client_id                    | uuid                     | NO          |
| nutrition_logs               | date                         | date                     | NO          |
| nutrition_logs               | calories_consumed            | integer                  | YES         |
| nutrition_logs               | protein_g                    | integer                  | YES         |
| nutrition_logs               | carbs_g                      | integer                  | YES         |
| nutrition_logs               | fat_g                        | integer                  | YES         |
| nutrition_logs               | target_calories              | integer                  | YES         |
| nutrition_logs               | target_protein_g             | integer                  | YES         |
| nutrition_logs               | target_carbs_g               | integer                  | YES         |
| nutrition_logs               | target_fat_g                 | integer                  | YES         |
| nutrition_logs               | nutrition_adherence          | text                     | YES         |
| nutrition_logs               | calorie_surplus_deficit      | integer                  | YES         |
| nutrition_logs               | created_at                   | timestamp with time zone | NO          |
| nutrition_logs               | updated_at                   | timestamp with time zone | NO          |
| nutrition_logs               | nutrition_plan_id            | uuid                     | YES         |
| nutrition_plan_daily_targets | id                           | uuid                     | NO          |
| nutrition_plan_daily_targets | nutrition_plan_id            | uuid                     | NO          |
| nutrition_plan_daily_targets | day_of_week                  | text                     | NO          |
| nutrition_plan_daily_targets | calories                     | integer                  | NO          |
| nutrition_plan_daily_targets | protein_g                    | numeric                  | NO          |
| nutrition_plan_daily_targets | carb_g                       | numeric                  | NO          |
| nutrition_plan_daily_targets | fat_g                        | numeric                  | NO          |
| nutrition_plan_daily_targets | is_training_day              | boolean                  | NO          |
| nutrition_plans              | id                           | uuid                     | NO          |
| nutrition_plans              | client_id                    | uuid                     | NO          |
| nutrition_plans              | coach_id                     | uuid                     | NO          |
| nutrition_plans              | name                         | text                     | YES         |
| nutrition_plans              | status                       | text                     | NO          |
| nutrition_plans              | effective_from               | date                     | NO          |
| nutrition_plans              | effective_until              | date                     | YES         |
| nutrition_plans              | work_activity_level          | text                     | NO          |
| nutrition_plans              | training_volume_hours        | text                     | NO          |
| nutrition_plans              | protein_target_g_per_kg      | numeric                  | NO          |
| nutrition_plans              | diet_type                    | text                     | NO          |
| nutrition_plans              | goal_weight_kg               | numeric                  | YES         |
| nutrition_plans              | goal_deadline                | date                     | YES         |
| nutrition_plans              | baseline_calories            | integer                  | NO          |
| nutrition_plans              | protein_target_g             | numeric                  | NO          |
| nutrition_plans              | carb_target_g                | numeric                  | NO          |
| nutrition_plans              | fat_target_g                 | numeric                  | NO          |
| nutrition_plans              | base_weight_kg               | numeric                  | NO          |
| nutrition_plans              | bmr                          | numeric                  | YES         |
| nutrition_plans              | tdee                         | numeric                  | YES         |
| nutrition_plans              | custom_macros_enabled        | boolean                  | NO          |
| nutrition_plans              | custom_calories              | integer                  | YES         |
| nutrition_plans              | custom_protein_g             | numeric                  | YES         |
| nutrition_plans              | custom_carb_g                | numeric                  | YES         |
| nutrition_plans              | custom_fat_g                 | numeric                  | YES         |
| nutrition_plans              | regeneration_reason          | text                     | YES         |
| nutrition_plans              | created_at                   | timestamp with time zone | NO          |
| nutrition_plans              | updated_at                   | timestamp with time zone | NO          |
| nutrition_weekly_summaries   | id                           | uuid                     | NO          |
| nutrition_weekly_summaries   | client_id                    | uuid                     | NO          |
| nutrition_weekly_summaries   | week_start_date              | date                     | NO          |
| nutrition_weekly_summaries   | weekly_calorie_target        | integer                  | NO          |
| nutrition_weekly_summaries   | weekly_protein_target_g      | integer                  | YES         |
| nutrition_weekly_summaries   | weekly_carbs_target_g        | integer                  | YES         |
| nutrition_weekly_summaries   | weekly_fat_target_g          | integer                  | YES         |
| nutrition_weekly_summaries   | training_days_per_week       | integer                  | YES         |
| nutrition_weekly_summaries   | rest_days_per_week           | integer                  | YES         |
| nutrition_weekly_summaries   | days_completed               | integer                  | YES         |
| nutrition_weekly_summaries   | total_days                   | integer                  | YES         |
| nutrition_weekly_summaries   | completion_percentage        | numeric                  | YES         |
| nutrition_weekly_summaries   | created_at                   | timestamp with time zone | NO          |
| nutrition_weekly_summaries   | updated_at                   | timestamp with time zone | NO          |
| nutrition_weekly_summaries   | week_end_date                | date                     | YES         |
| nutrition_weekly_summaries   | total_calories_consumed      | numeric                  | YES         |
| nutrition_weekly_summaries   | total_protein_consumed_g     | numeric                  | YES         |
| nutrition_weekly_summaries   | total_carbs_consumed_g       | numeric                  | YES         |
| nutrition_weekly_summaries   | total_fat_consumed_g         | numeric                  | YES         |
| nutrition_weekly_summaries   | calorie_difference           | numeric                  | YES         |
| nutrition_weekly_summaries   | adherence_percentage         | numeric                  | YES         |
| nutrition_weekly_summaries   | weekly_adherence             | text                     | YES         |
| nutrition_weekly_summaries   | days_logged                  | integer                  | YES         |
| nutrition_weekly_summaries   | days_on_target               | integer                  | YES         |
| nutrition_weekly_summaries   | days_over                    | integer                  | YES         |
| nutrition_weekly_summaries   | days_under                   | integer                  | YES         |
| profiles                     | id                           | uuid                     | NO          |
| profiles                     | user_id                      | uuid                     | NO          |
| profiles                     | role                         | text                     | NO          |
| profiles                     | created_at                   | timestamp with time zone | NO          |
| profiles                     | updated_at                   | timestamp with time zone | NO          |
| session_logs                 | id                           | uuid                     | NO          |
| session_logs                 | client_id                    | uuid                     | NO          |
| session_logs                 | training_session_id          | uuid                     | YES         |
| session_logs                 | completed_at                 | timestamp with time zone | NO          |
| session_logs                 | completion_quality           | text                     | YES         |
| session_logs                 | notes                        | text                     | YES         |
| session_logs                 | week_start_date              | date                     | NO          |
| session_logs                 | created_at                   | timestamp with time zone | NO          |
| session_logs                 | updated_at                   | timestamp with time zone | NO          |
| session_logs                 | prescribed_session_snapshot  | jsonb                    | YES         |
| training_exercises           | id                           | uuid                     | NO          |
| training_exercises           | session_id                   | uuid                     | NO          |
| training_exercises           | name                         | text                     | NO          |
| training_exercises           | order_index                  | integer                  | NO          |
| training_exercises           | sets                         | integer                  | NO          |
| training_exercises           | reps_min                     | integer                  | YES         |
| training_exercises           | reps_max                     | integer                  | YES         |
| training_exercises           | reps_target                  | text                     | YES         |
| training_exercises           | rpe_target                   | numeric                  | YES         |
| training_exercises           | percentage_1rm               | numeric                  | YES         |
| training_exercises           | tempo                        | text                     | YES         |
| training_exercises           | rest_seconds                 | integer                  | YES         |
| training_exercises           | notes                        | text                     | YES         |
| training_exercises           | superset_group               | text                     | YES         |
| training_exercises           | is_warmup                    | boolean                  | YES         |
| training_exercises           | created_at                   | timestamp with time zone | NO          |
| training_exercises           | updated_at                   | timestamp with time zone | NO          |
| training_exercises           | is_active                    | boolean                  | NO          |
| training_logs                | id                           | uuid                     | NO          |
| training_logs                | daily_log_id                 | uuid                     | NO          |
| training_logs                | client_id                    | uuid                     | NO          |
| training_logs                | date                         | date                     | NO          |
| training_logs                | trained                      | boolean                  | YES         |
| training_logs                | training_session_id          | uuid                     | YES         |
| training_logs                | training_data                | jsonb                    | YES         |
| training_logs                | created_at                   | timestamp with time zone | NO          |
| training_logs                | updated_at                   | timestamp with time zone | NO          |
| training_logs                | training_plan_id             | uuid                     | YES         |
| training_plan_history        | id                           | uuid                     | NO          |
| training_plan_history        | client_id                    | uuid                     | NO          |
| training_plan_history        | plan_id                      | uuid                     | YES         |
| training_plan_history        | coach_prompt                 | text                     | NO          |
| training_plan_history        | ai_response_raw              | text                     | YES         |
| training_plan_history        | plan_snapshot                | jsonb                    | NO          |
| training_plan_history        | client_metrics_snapshot      | jsonb                    | YES         |
| training_plan_history        | check_in_data_snapshot       | jsonb                    | YES         |
| training_plan_history        | regeneration_reason          | text                     | YES         |
| training_plan_history        | created_by_coach_id          | uuid                     | YES         |
| training_plan_history        | created_at                   | timestamp with time zone | NO          |
| training_plans               | id                           | uuid                     | NO          |
| training_plans               | client_id                    | uuid                     | NO          |
| training_plans               | coach_id                     | uuid                     | NO          |
| training_plans               | name                         | text                     | NO          |
| training_plans               | description                  | text                     | YES         |
| training_plans               | status                       | text                     | NO          |
| training_plans               | coach_prompt                 | text                     | NO          |
| training_plans               | ai_response_raw              | text                     | YES         |
| training_plans               | split_type                   | text                     | NO          |
| training_plans               | frequency_per_week           | integer                  | NO          |
| training_plans               | program_duration_weeks       | integer                  | YES         |
| training_plans               | client_weight_kg             | numeric                  | YES         |
| training_plans               | client_body_fat_percentage   | numeric                  | YES         |
| training_plans               | client_goal_weight_kg        | numeric                  | YES         |
| training_plans               | client_tdee                  | integer                  | YES         |
| training_plans               | avg_mood                     | numeric                  | YES         |
| training_plans               | avg_energy                   | numeric                  | YES         |
| training_plans               | avg_sleep                    | numeric                  | YES         |
| training_plans               | avg_stress                   | numeric                  | YES         |
| training_plans               | recent_adherence_percentage  | numeric                  | YES         |
| training_plans               | created_at                   | timestamp with time zone | NO          |
| training_plans               | updated_at                   | timestamp with time zone | NO          |
| training_plans               | deleted_at                   | timestamp with time zone | YES         |
| training_sessions            | id                           | uuid                     | NO          |
| training_sessions            | plan_id                      | uuid                     | NO          |
| training_sessions            | name                         | text                     | NO          |
| training_sessions            | day_of_week                  | text                     | YES         |
| training_sessions            | order_index                  | integer                  | NO          |
| training_sessions            | focus                        | text                     | YES         |
| training_sessions            | notes                        | text                     | YES         |
| training_sessions            | estimated_duration_minutes   | integer                  | YES         |
| training_sessions            | created_at                   | timestamp with time zone | NO          |
| training_sessions            | updated_at                   | timestamp with time zone | NO          |
| training_sessions            | session_type                 | text                     | NO          |
| training_sessions            | activity_metadata            | jsonb                    | YES         |
| training_sessions            | estimated_calories           | integer                  | YES         |
| training_sessions            | calories_calculated_at       | timestamp with time zone | YES         |
| training_sessions            | is_active                    | boolean                  | NO          |
| wellness_logs                | id                           | uuid                     | NO          |
| wellness_logs                | daily_log_id                 | uuid                     | NO          |
| wellness_logs                | client_id                    | uuid                     | NO          |
| wellness_logs                | date                         | date                     | NO          |
| wellness_logs                | mood                         | integer                  | YES         |
| wellness_logs                | energy                       | integer                  | YES         |
| wellness_logs                | sleep                        | integer                  | YES         |
| wellness_logs                | stress                       | integer                  | YES         |
| wellness_logs                | created_at                   | timestamp with time zone | NO          |
| wellness_logs                | updated_at                   | timestamp with time zone | NO          |