/**
 * One-time cleanup: remove duplicate-week artifacts stranded on past dates.
 *
 *   npx tsx scripts/cleanup-stuck-past-duplicates.ts \
 *     --client <clientId> --from 2026-07-13 --to 2026-07-19 [--created-since 2026-07-23] [--execute]
 *
 * Before 2026-07-24, "Duplicate to next week" had no past-date guard and no
 * replace step: it could insert scheduled events onto dates that had already
 * passed, which deleteEvent's past guard then refused to remove — leaving
 * junk events no UI can clean up. The service fix prevents new ones; this
 * script removes the stranded rows.
 *
 * What it targets, deliberately narrow:
 *   - scheduled training_events for ONE client in an explicit date range,
 *   - is_modified = true (the duplicate path inserts with this flag),
 *   - optionally created on/after --created-since (the buggy-duplicate day),
 *     to spare amended originals that also carry is_modified.
 *
 * After deleting events it deactivates (is_active = false, never hard-delete)
 * the cloned training_sessions those events pointed at — but ONLY when no
 * other training_event and no session_log still references the session.
 *
 * Dry-run by default — pass --execute to actually write.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { supabaseAdmin } from "@/services/supabase-admin";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const clientId = flag("client");
const from = flag("from");
const to = flag("to");
const createdSince = flag("created-since");
const execute = process.argv.includes("--execute");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<void> {
  if (!clientId || !from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    console.error(
      "Usage: npx tsx scripts/cleanup-stuck-past-duplicates.ts --client <clientId> --from YYYY-MM-DD --to YYYY-MM-DD [--created-since YYYY-MM-DD] [--execute]",
    );
    process.exit(1);
  }

  let query = supabaseAdmin
    .from("training_events")
    .select("id, date, session_name, status, is_modified, created_at, training_session_id, training_plan_id")
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .eq("is_modified", true)
    .gte("date", from)
    .lte("date", to)
    .order("date");
  if (createdSince) query = query.gte("created_at", createdSince);

  const { data: candidates, error } = await query;
  if (error) throw new Error(`Failed to read events: ${error.message}`);

  if (!candidates || candidates.length === 0) {
    console.info("No matching events — nothing to do.");
    return;
  }

  console.info(`${execute ? "DELETING" : "DRY RUN — would delete"} ${candidates.length} event(s):`);
  for (const e of candidates) {
    console.info(`  ${e.date}  ${e.session_name}  (event ${e.id}, created ${e.created_at})`);
  }

  if (!execute) {
    console.info("\nRe-run with --execute to apply. Eyeball the list first —");
    console.info("every row above will be deleted, and their now-orphaned cloned sessions deactivated.");
    return;
  }

  const eventIds = candidates.map((e) => e.id);
  const { error: deleteError } = await supabaseAdmin
    .from("training_events")
    .delete()
    .in("id", eventIds);
  if (deleteError) throw new Error(`Failed to delete events: ${deleteError.message}`);
  console.info(`Deleted ${eventIds.length} event(s).`);

  // Deactivate cloned sessions that nothing references anymore.
  const sessionIds = [
    ...new Set(candidates.map((e) => e.training_session_id).filter((v): v is string => !!v)),
  ];
  let deactivated = 0;
  for (const sessionId of sessionIds) {
    const { count: eventRefs } = await supabaseAdmin
      .from("training_events")
      .select("id", { count: "exact", head: true })
      .eq("training_session_id", sessionId);
    const { count: logRefs } = await supabaseAdmin
      .from("session_logs")
      .select("id", { count: "exact", head: true })
      .eq("training_session_id", sessionId);
    if ((eventRefs ?? 0) > 0 || (logRefs ?? 0) > 0) continue;

    const { error: deactivateError } = await supabaseAdmin
      .from("training_sessions")
      .update({ is_active: false })
      .eq("id", sessionId);
    if (deactivateError) {
      console.error(`  Failed to deactivate session ${sessionId}: ${deactivateError.message}`);
      continue;
    }
    deactivated += 1;
  }
  console.info(`Deactivated ${deactivated} orphaned cloned session(s).`);
  console.info("Done. Reload the calendar to confirm.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
