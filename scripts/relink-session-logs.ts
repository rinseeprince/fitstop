/**
 * Re-link session logs to training events.
 * Run: npx tsx scripts/relink-session-logs.ts
 *
 * Finds session_logs that aren't linked to any event and links them.
 * Safe to re-run — skips already-linked logs.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  getEventForSessionAndDate,
  linkSessionLogToEvent,
  mapCompletionQualityToEventStatus,
} from "@/services/training-event-service";

async function relinkLogs() {
  const { data: logs, error } = await supabaseAdmin
    .from("session_logs")
    .select("id, client_id, training_session_id, completed_at, completion_quality")
    .not("training_session_id", "is", null);

  if (error) {
    console.error("Failed to fetch session logs:", error.message);
    process.exit(1);
  }

  console.log(`Session logs to check: ${logs.length}`);

  let linked = 0;
  let alreadyLinked = 0;
  let notFound = 0;

  for (const log of logs) {
    if (!log.training_session_id || !log.completed_at) continue;
    const dateStr = log.completed_at.substring(0, 10);

    try {
      const event = await getEventForSessionAndDate(
        log.client_id,
        log.training_session_id,
        dateStr
      );

      if (!event) {
        notFound++;
        console.log(`  No event: ${dateStr} session=${log.training_session_id.substring(0, 8)}... client=${log.client_id.substring(0, 8)}...`);
        continue;
      }

      if (event.sessionLogId === log.id) {
        alreadyLinked++;
        continue;
      }

      await linkSessionLogToEvent(
        event.id,
        log.id,
        mapCompletionQualityToEventStatus((log.completion_quality ?? "full") as "full" | "partial" | "skipped")
      );
      linked++;
      console.log(`  Linked: ${dateStr} ${event.sessionName} → ${log.completion_quality}`);
    } catch (err) {
      console.error(`  Error linking log ${log.id}:`, err);
    }
  }

  console.log(
    `\nAlready linked: ${alreadyLinked} | Newly linked: ${linked} | No matching event: ${notFound}`
  );
}

relinkLogs().catch((err) => {
  console.error("Re-link failed:", err);
  process.exit(1);
});
