/**
 * Saves the copy of every check-in that has none (migration 195;
 * lib/check-in/sent-snapshot.ts): the check-ins sent before copies existed,
 * each frozen with exactly what its review shows now (owner, 2026-09-22), and
 * any a seed script inserted directly. Only ever writes an empty copy — the
 * database refuses a change to one already saved — so it is safe to rerun.
 *
 *   npx tsx scripts/fill-check-in-sent-snapshots.ts [concurrency]
 *
 * Runs against the linked project in .env.local. Exits non-zero when any
 * check-in failed, listing each; those stay empty for the next run.
 */
import "./env-bootstrap";
import { fillSentSnapshots } from "@/services/check-in-sent-snapshot-fill";

async function main(): Promise<void> {
  const concurrency = Number(process.argv[2] ?? 8);
  const started = Date.now();
  const result = await fillSentSnapshots({ concurrency });
  console.info(
    `Filled ${result.filled}, already filled ${result.alreadyFilled}, failed ${result.failed.length} in ${Math.round((Date.now() - started) / 1000)}s`
  );
  for (const failure of result.failed) console.error(`  ${failure.id}: ${failure.error}`);
  if (result.failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
