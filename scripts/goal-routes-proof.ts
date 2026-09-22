/**
 * Request-level proof of the goal routes (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 8d) against the linked DEV database through a running `next dev`:
 * the full coach chain, every write, its audit row, and the undo.
 *
 *   npx tsx scripts/goal-routes-proof.ts
 *
 * A vitest that mocks the services proves nothing about a route's chain or the
 * functions behind it. This drives the real routes as the owner's coach with a
 * minted session, on two throwaway clients created under that coach and removed
 * at the end (their goals go with them, ON DELETE CASCADE; their audit rows are
 * removed last). Every fixture number is distinct.
 *
 *   1  a fresh client has no goal
 *   2  a goal set from today: 201, current, its start reading, audited
 *   3  planning inside the current goal's deadline is refused, offering to end it the day before
 *   4  the offered fix: the deadline ended the day before — audited
 *   5  the planned goal is set, and stays out of today's
 *   6  a planned goal moves, whole — audited
 *   7  a deadline running into the planned goal is refused, offering move or delete
 *   8  a rename — audited
 *   9  delete hands back an undo; the goal is gone — audited
 *  10  the undo puts it back exactly — audited; a second undo is refused
 *  11  a tampered, a foreign and an expired undo are refused
 *  12  today's goal is corrected in place from the details sheet — audited
 *  13  a goal that started before today refuses an edit
 *  14  another coach's client is 404; another client's goal through this URL is 404 and stays
 *  15  a write without the Origin the CSRF check reads is refused
 *  16  the manual Add client sets the first goal from today, typed from its targets — audited
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { getClientTodayString } from "@/services/today-service";
import { signGoalUndo } from "@/services/goal-undo-token";
import { addDaysToDateString } from "@/lib/date-helpers";
import { GOAL_UNDO_WINDOW_MS } from "@/lib/constants";
import { mintSession, send, PROOF_BASE } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

type Overview = {
  current: { id: string; name: string; type: string; targetWeight: number | null; deadline: string | null; startsOn: string; startReadings: { weight: number | null } } | null;
  planned: Array<{ id: string; name: string; startsOn: string; deadline: string | null; description: string | null }>;
};
type Body = { success: boolean; data: Overview & { undo?: string }; error?: string; code?: string; fixes?: unknown[] };

/**
 * Whether the client's audit rows for an action reach `expected`. The routes
 * record their audit fire-and-forget, after answering, so the row may land a
 * moment after the response: poll briefly before judging.
 */
async function auditedTimes(clientId: string, action: string, expected: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { count, error } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("action", action);
    if (error) throw new Error(error.message);
    if ((count ?? 0) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const made: string[] = [];
  const makeClient = async (name: string) => {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({ coach_id: coach.id, name, email: `goal-routes-proof-${made.length}-${stamp}@fixture.local` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`client insert: ${error?.message}`);
    made.push(data.id);
    return data.id;
  };

  try {
    const A = await makeClient("Goal routes proof A");
    const B = await makeClient("Goal routes proof B");
    const today = await getClientTodayString(A);
    const day = (n: number) => addDaysToDateString(today, n);
    await appendMeasurements({ clientId: A, source: "coach_entry", recordedOn: today, values: { weight: 82.6 }, createdBy: coach.id });

    const session = await mintSession(COACH_EMAIL, "coach");
    const goals = `/api/clients/${A}/goals`;
    const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => {
      const res = await send(session, method, path, body);
      return { status: res.status, body: res.json as Body };
    };

    console.info("1. A fresh client has no goal");
    const fresh = await call("GET", goals);
    check("no current goal, nothing planned", fresh.status === 200 && fresh.body.data.current === null && fresh.body.data.planned.length === 0, fresh);

    console.info("2. A goal set from today");
    const set = await call("POST", goals, { type: "lose_weight", targetWeight: 71.3, deadline: day(64) });
    const current = set.body.data?.current;
    check("201, today's goal, named from its type", set.status === 201 && current?.startsOn === today && current?.name === "Lose weight", set);
    check("its progress starts at the reading on its start day", current?.startReadings.weight === 82.6, current);
    check("audited as goal.create", await auditedTimes(A, "goal.create", 1));
    const currentId = current!.id;

    console.info("3. Planning inside the current goal's deadline");
    const early = await call("POST", goals, { type: "build_muscle", targetWeight: 86.9, startsOn: day(30) });
    check("409, naming the fix: end the deadline the day before", early.status === 409 && early.body.code === "previous_deadline" && JSON.stringify(early.body.fixes).includes(day(29)), early);

    console.info("4. The fix: end the current goal's deadline the day before");
    const ended = await call("PUT", `${goals}/${currentId}/deadline`, { deadline: day(29) });
    check("200, the deadline recorded", ended.status === 200 && ended.body.data.current?.deadline === day(29), ended);
    check("audited as goal.deadline", await auditedTimes(A, "goal.deadline", 1));

    console.info("5. The planned goal");
    const planned = await call("POST", goals, { type: "build_muscle", targetWeight: 86.9, startsOn: day(30) });
    const plannedGoal = planned.body.data?.planned[0];
    check("201, listed as planned", planned.status === 201 && plannedGoal?.startsOn === day(30), planned);
    check("today's goal is still today's", planned.body.data?.current?.id === currentId);
    const plannedId = plannedGoal?.id ?? "";

    console.info("6. A planned goal moves, whole");
    const moved = await call("PATCH", `${goals}/${plannedId}`, {
      type: "build_muscle", name: "Build muscle", targetWeight: 87.4, targetBodyFatPercentage: null,
      description: null, startsOn: day(35), deadline: day(97),
    });
    check("200, on its new day with its deadline", moved.status === 200 && moved.body.data.planned[0]?.startsOn === day(35) && moved.body.data.planned[0]?.deadline === day(97), moved);
    check("audited as goal.update", await auditedTimes(A, "goal.update", 1));

    console.info("7. A deadline running into the planned goal");
    const into = await call("PUT", `${goals}/${currentId}/deadline`, { deadline: day(40) });
    check("409, offering to move it past the deadline or delete it", into.status === 409 && into.body.code === "deadline_after_next" && JSON.stringify(into.body.fixes).includes(day(41)) && JSON.stringify(into.body.fixes).includes("delete_goal"), into);

    console.info("8. A rename");
    const renamed = await call("PUT", `${goals}/${plannedId}/name`, { name: "Summer build", description: "Add size" });
    check("200, renamed with its description", renamed.status === 200 && renamed.body.data.planned[0]?.name === "Summer build" && renamed.body.data.planned[0]?.description === "Add size", renamed);
    check("audited as goal.rename", await auditedTimes(A, "goal.rename", 1));

    console.info("9. Delete");
    const deleted = await call("DELETE", `${goals}/${plannedId}`);
    const undo = deleted.body.data?.undo;
    check("200 with an undo, the goal gone", deleted.status === 200 && typeof undo === "string" && deleted.body.data.planned.length === 0, deleted);
    check("audited as goal.delete", await auditedTimes(A, "goal.delete", 1));

    console.info("10. The undo");
    const restored = await call("POST", `${goals}/restore`, { undo });
    const back = restored.body.data?.planned[0];
    check("200, back exactly: the same id, name, day and deadline", restored.status === 200 && back?.id === plannedId && back?.name === "Summer build" && back?.startsOn === day(35) && back?.deadline === day(97), restored);
    check("audited as goal.restore", await auditedTimes(A, "goal.restore", 1));
    const twice = await call("POST", `${goals}/restore`, { undo });
    check("a second undo of the same delete is refused", twice.status === 409 && twice.body.code === "exists", twice);

    console.info("11. Undos that are not this server's, this client's, or in time");
    const [payload, signature] = (undo as string).split(".");
    const tampered = await call("POST", `${goals}/restore`, { undo: `${payload}x.${signature}` });
    check("a tampered undo is refused", tampered.status === 400, tampered);
    const { data: bGoalId } = await supabaseAdmin.rpc("add_client_goal", {
      p_client_id: B, p_today: today, p_starts_on: today, p_type: "maintain", p_name: "Maintain", p_source: "coach", p_set_by: coach.id,
    });
    const bDeleted = await send(session, "DELETE", `/api/clients/${B}/goals/${bGoalId}`);
    const foreign = await call("POST", `${goals}/restore`, { undo: (bDeleted.json as Body).data.undo });
    check("another client's undo is refused here", foreign.status === 400, foreign);
    const late = signGoalUndo(A, { goal: {}, deadlines: [] }, Date.now() - GOAL_UNDO_WINDOW_MS - 1_000).token;
    const expired = await call("POST", `${goals}/restore`, { undo: late });
    check("an expired undo is refused as too late", expired.status === 410, expired);

    console.info("12. Today's goal corrected from the details sheet");
    const sheet = await call("PUT", goals, { goalWeight: 70.2 });
    check("200, corrected in place — the same goal, the new target", sheet.status === 200 && sheet.body.data.current?.id === currentId && sheet.body.data.current?.targetWeight === 70.2, sheet);
    check("audited as goal.update", await auditedTimes(A, "goal.update", 2));

    console.info("13. A goal that started before today");
    const { data: pastGoalId } = await supabaseAdmin.rpc("add_client_goal", {
      p_client_id: B, p_today: day(-12), p_starts_on: day(-12), p_type: "lose_weight", p_name: "Lose weight", p_source: "coach", p_set_by: coach.id, p_target_weight: 64.8,
    });
    if (!pastGoalId) throw new Error("Setup: the past goal was not written");
    const pastId: string = pastGoalId;
    const started = await send(session, "PATCH", `/api/clients/${B}/goals/${pastId}`, {
      type: "lose_weight", name: "Lose weight", targetWeight: 63.7, targetBodyFatPercentage: null, description: null, startsOn: day(-12), deadline: null,
    });
    check("refused: it changes only its deadline and name", started.status === 409 && (started.json as Body).code === "started", started.json);

    console.info("14. Ownership");
    const { data: foreignClient } = await supabaseAdmin
      .from("clients")
      .select("id")
      .neq("coach_id", coach.id)
      .limit(1)
      .single();
    if (!foreignClient) throw new Error("Setup: no client of another coach to try");
    const otherCoach = await call("GET", `/api/clients/${foreignClient.id}/goals`);
    check("another coach's client is 404", otherCoach.status === 404, otherCoach);
    const crossed = await call("DELETE", `${goals}/${pastId}`);
    const { count: stillThere } = await supabaseAdmin.from("client_goals").select("id", { count: "exact", head: true }).eq("id", pastId);
    check("another client's goal through this URL is 404, and stays", crossed.status === 404 && stillThere === 1, crossed);

    console.info("16. The manual Add client");
    const added = await send(session, "POST", "/api/clients", {
      name: "Goal routes proof C",
      email: `goal-routes-proof-add-${stamp}@fixture.local`,
      setupMode: "manual",
      currentWeight: 91.8,
      goalWeight: 84.2,
    });
    const addedId = (added.json as { client?: { id?: string } } | null)?.client?.id;
    if (addedId) made.push(addedId);
    check("201, and the client carries no goal field", added.status === 201 && !!addedId && !added.text.includes("goalWeight"), added.text.slice(0, 300));
    if (addedId) {
      const firstGoal = (await send(session, "GET", `/api/clients/${addedId}/goals`)).json as Body;
      check(
        "its first goal starts today, typed from its target against the weight it was given",
        firstGoal.data.current?.startsOn === today && firstGoal.data.current?.type === "lose_weight" && firstGoal.data.current?.targetWeight === 84.2,
        firstGoal.data
      );
      check("audited as goal.create", await auditedTimes(addedId, "goal.create", 1));
    }

    console.info("15. CSRF");
    const noOrigin = await fetch(`${PROOF_BASE}${goals}`, {
      method: "POST",
      headers: { Cookie: session.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "maintain" }),
    });
    check("a write without the Origin is refused", noOrigin.status === 403, noOrigin.status);
  } finally {
    if (made.length > 0) {
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().in("client_id", made);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().in("id", made);
      if (auditError || clientError) console.error("Cleanup failed:", auditError?.message, clientError?.message);
      else console.info(`Cleanup: ${made.length} throwaway clients removed with their goals and audit rows.`);
    }
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every route check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
