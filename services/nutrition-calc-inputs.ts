import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import { weightToKg } from "@/utils/nutrition-helpers";
import type { Client } from "@/types/check-in";
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
      weightUnit: "lbs" | "kg";
      tdee: number | null;
      goalWeightKg?: number;
      goalDeadline?: string;
      /** Named to match `NutritionCalculationInput.startDate` exactly — a
       *  mismatched name would compile (the field is optional) and silently
       *  fall back to today, weakening the deficit for future-dated goals. */
      startDate: string;
      /** Client-local today. */
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
  const [today, latestMetrics, currentGoals] = await Promise.all([
    prefetched?.today ?? getClientTodayString(clientId),
    getLatestBodyMetrics(clientId),
    prefetched?.currentGoals !== undefined
      ? Promise.resolve(prefetched.currentGoals)
      : getCurrentGoals(clientId),
  ]);

  // Prefer the event tables, fall back to the denormalized client.* cache for
  // pre-migration clients. Same ladder the write path has always used.
  const currentWeight = latestMetrics?.weight ?? client.currentWeight;
  const weightUnit = (latestMetrics?.weightUnit ?? client.weightUnit ?? "lbs") as "lbs" | "kg";
  const bmr = latestMetrics?.bmr ?? client.bmr;
  const tdee = latestMetrics?.tdee ?? client.tdee;

  // Validity is COMPUTED here and THROWN by the caller (write path only).
  const validation = validateClientForNutrition({
    currentWeight: currentWeight ?? undefined,
    bmr: bmr ?? undefined,
    tdee: tdee ?? undefined,
    gender: client.gender,
    weightUnit,
  });

  if (!validation.valid) {
    return { status: "incomplete", missing: validation.errors, today };
  }

  // The long-term client goal drives. This is the ONE place display-unit goal
  // weights are normalized to kg, and the deadline comes from this single scope
  // — never from a request body.
  const effective = resolveEffectiveGoal({
    weightUnit,
    clientGoal: {
      goalWeight: currentGoals?.goalWeight ?? client.goalWeight ?? null,
      goalBodyFatPercentage:
        currentGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage ?? null,
      deadline: currentGoals?.goalDeadline ?? client.goalDeadline ?? null,
      startDate: currentGoals?.goalStartDate ?? null,
    },
    today,
  });

  return {
    status: "ready",
    // Non-null by construction: validateClientForNutrition rejected falsy
    // values for all four above, so this branch is unreachable without them.
    currentWeightKg: weightToKg(currentWeight as number, weightUnit),
    bmr: bmr as number,
    gender: client.gender as "male" | "female" | "other",
    weightUnit,
    tdee: tdee ?? null,
    goalWeightKg: effective.goalWeightKg ?? undefined,
    goalDeadline: effective.deadline ?? undefined,
    startDate: effective.startDate,
    today,
  };
}
