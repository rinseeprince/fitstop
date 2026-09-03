import { getCurrentGoals } from "@/services/client-goals-service";
import { getClientTodayString } from "@/services/today-service";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
} from "@/lib/goals/resolve-effective-goal";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import type { ActivityLevel, Client } from "@/types/check-in";
import { toActivityLevel } from "@/services/client-energy-calc";
import type { ClientGoal } from "@/types/client-goals";

/**
 * The inputs `generateNutritionPlan` needs, resolved once and shared by BOTH
 * the write path (the plan POST) and the read path (the coach GET, which sends
 * them to the browser so the builder can preview a plan live as the coach moves
 * a picker).
 *
 * This is the whole point of the module: preview and save must agree, and the
 * only way to guarantee that is for both to run the same pure calculator over
 * the same resolved inputs. Resolving them twice, in two places, is how they
 * drift.
 *
 * A discriminated union rather than a bag of nullables plus a flag: the guard
 * and the type narrowing have to be the same act, or the call site still needs
 * non-null assertions to satisfy `NutritionCalculationInput`, and an assertion
 * in the browser has nothing behind it (`bmr` undefined makes `Math.round(bmr *
 * multiplier)` NaN, and the minimum-calorie floor does not catch NaN).
 *
 * The "ready" arm mirrors `NutritionCalculationInput` field-for-field including
 * optionality — `goalWeightKg`/`goalDeadline` are `?: number`/`?: string` there,
 * so the `?? undefined` conversion happens HERE rather than at every call site.
 */
export type NutritionCalcInputs =
  | {
      status: "ready";
      currentWeightKg: number;
      bmr: number;
      gender: "male" | "female" | "other";
      /** Non-null by construction: validateClientForNutrition rejects a client
       *  without one, because the calculator now CONSUMES this rather than
       *  re-deriving it from bmr x activity. */
      tdee: number;
      /** The CLIENT's activity level. NOT a calculator input — the calculator
       *  takes `tdee` directly. This is carried solely so the saved plan can
       *  SNAPSHOT what the client's activity was at generation time. */
      workActivityLevel: ActivityLevel;
      goalWeightKg?: number;
      goalDeadline?: string;
      /** Client-local today. No `startDate` rides here: the calculator's
       *  window starts at the day the plan takes effect, which the orchestrator
       *  and the drawer hand in themselves (commit 8bb). */
      today: string;
    }
  | {
      status: "incomplete";
      /** `validateClientForNutrition`'s messages, RETURNED not thrown — the
       *  write path turns these into a 400; the read path renders them. */
      missing: string[];
      /** Still useful to the UI even when the calc cannot run. */
      today: string;
    };

/**
 * Resolve the calculator inputs for a client.
 *
 * The caller owns `getClientById` and the ownership check — this takes the
 * already-fetched `client` so it cannot be used to reach a client the caller
 * has not authorized.
 *
 * `prefetched` exists so a caller that already resolved these can hand them in
 * rather than paying for them twice: the coach GET already computes the client's
 * today and reads the current goals for its drift check, and without this the
 * route would issue both queries a second time.
 *
 * Throws only on genuine DB failures (the underlying services throw). It never
 * throws for a client who is simply missing data — that is `status:
 * "incomplete"`, because a read path must not 500 just because a client has no
 * BMR yet.
 */
export async function resolveNutritionCalcInputs(
  clientId: string,
  client: Client,
  prefetched?: { today?: string; currentGoals?: ClientGoal | null }
): Promise<NutritionCalcInputs> {
  const [today, currentGoals] = await Promise.all([
    prefetched?.today ?? getClientTodayString(clientId),
    prefetched?.currentGoals !== undefined
      ? Promise.resolve(prefetched.currentGoals)
      : getCurrentGoals(clientId),
  ]);

  // The client object carries both inputs from their single owners. WEIGHT is
  // the newest reading in the measurement log, of any source
  // (`client_current_measurements`, read into `Client.currentWeight`). The
  // ENERGY pair is the profile's: one helper writes it atomically from the
  // client's own activity level (services/client-energy-service.ts), and it
  // recomputes whenever a newest reading lands. A profile with no pair is a
  // client the calculator cannot be run for — `validateClientForNutrition`
  // reports it below rather than a rescue inventing one. Canonical kilograms.
  const currentWeight = client.currentWeight;
  const bmr = client.bmr;
  const tdee = client.tdee;

  // Validity is COMPUTED here and THROWN by the caller (write path only).
  const validation = validateClientForNutrition({
    currentWeight: currentWeight ?? undefined,
    bmr: bmr ?? undefined,
    tdee: tdee ?? undefined,
    gender: client.gender,
  });

  if (!validation.valid) {
    return { status: "incomplete", missing: validation.errors, today };
  }

  // The long-term client goal drives, and the deadline comes from this single
  // scope — never from a request body. No unit normalization happens anywhere
  // any more: goal weights are stored in kilograms (migration 141).
  const effective = resolveEffectiveGoal({
    clientGoal: toClientGoalInput(currentGoals, client),
  });

  return {
    status: "ready",
    // Non-null by construction: validateClientForNutrition rejected falsy
    // values for all four above, so this branch is unreachable without them.
    currentWeightKg: currentWeight as number,
    bmr: bmr as number,
    gender: client.gender as "male" | "female" | "other",
    tdee: tdee as number,
    workActivityLevel: toActivityLevel(client.workActivityLevel).level,
    goalWeightKg: effective.goalWeightKg ?? undefined,
    goalDeadline: effective.deadline ?? undefined,
    today,
  };
}
