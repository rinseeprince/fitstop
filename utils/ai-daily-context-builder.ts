import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import { NUTRITION_ADHERENCE_HIT_THRESHOLD, NUTRITION_ADHERENCE_PARTIAL_THRESHOLD } from "@/lib/constants";

export function buildDailyContextForAI(
  dailyLogs: DailyLog[],
  habitLogs: HabitLogWithDetails[],
  startDate: Date,
  endDate: Date
): string {
  if (dailyLogs.length === 0) {
    return "";
  }

  // Sort logs by date
  const sortedLogs = [...dailyLogs].sort((a, b) => a.date.localeCompare(b.date));
  
  // Build date range info
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  let context = `DAILY TRACKING DATA (${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}, ${sortedLogs.length} of ${totalDays} days logged):\n\n`;

  // Daily summaries
  sortedLogs.forEach(log => {
    const date = new Date(log.date);
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    
    context += `${dateStr}: `;
    
    // Wellness metrics
    const wellness = [];
    if (log.mood !== undefined) wellness.push(`Mood ${log.mood}`);
    if (log.energy !== undefined) wellness.push(`Energy ${log.energy}`);
    if (log.sleep !== undefined) wellness.push(`Sleep ${log.sleep}`);
    if (log.stress !== undefined) wellness.push(`Stress ${log.stress}`);
    if (wellness.length > 0) context += wellness.join(', ') + '. ';
    
    // Nutrition
    if (log.caloriesConsumed !== undefined && log.targetCalories) {
      const diff = log.caloriesConsumed - log.targetCalories;
      const status = Math.abs(diff) <= NUTRITION_ADHERENCE_HIT_THRESHOLD ? 'hit' : Math.abs(diff) <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD ? 'partial' : 'missed';
      context += `Calories: ${log.caloriesConsumed}/${log.targetCalories} (${status}). `;
    } else if (log.caloriesConsumed === undefined && log.targetCalories) {
      context += `Calories: not logged (target ${log.targetCalories}). `;
    }
    
    // Training
    if (log.trainingData) {
      if (log.trainingData.trainingSessionName) {
        context += `Training: "${log.trainingData.trainingSessionName}" ${log.trainingData.sessionCompleted ? 'completed' : 'missed'}`;
        
        if (log.trainingData.activityStatuses) {
          const activities = Object.values(log.trainingData.activityStatuses);
          const completed = activities.filter(a => a.completed).length;
          context += `, ${completed}/${activities.length} activities done`;
          
          const skipped = activities.filter(a => !a.completed).map(a => a.activityName);
          if (skipped.length > 0) {
            context += ` (skipped: ${skipped.join(', ')})`;
          }
        }
        context += '. ';
      } else if (log.trainingData.unplannedActivities?.length) {
        context += `Training: ${log.trainingData.unplannedActivities.length} unplanned activities. `;
      }
    }
    
    // Habits for this day
    const dayHabits = habitLogs.filter(h => h.date === log.date);
    if (dayHabits.length > 0) {
      const habitStatus = dayHabits.map(h => `${h.habitName} ${h.completed ? '✓' : '✗'}`);
      context += `Habits: ${habitStatus.join(', ')}`;
    }
    
    context += '\n';
  });

  // Weekly patterns
  context += '\nWEEKLY PATTERNS:\n';
  
  // Nutrition patterns
  const nutritionLogs = sortedLogs.filter(l => l.caloriesConsumed !== undefined && l.targetCalories);
  if (nutritionLogs.length > 0) {
    const avgCalories = Math.round(nutritionLogs.reduce((sum, l) => sum + (l.caloriesConsumed ?? 0), 0) / nutritionLogs.length);
    const avgTarget = Math.round(nutritionLogs.reduce((sum, l) => sum + (l.targetCalories ?? 0), 0) / nutritionLogs.length);
    const deficit = avgCalories - avgTarget;
    
    const hitDays = nutritionLogs.filter(l => Math.abs((l.caloriesConsumed ?? 0) - (l.targetCalories ?? 0)) <= NUTRITION_ADHERENCE_HIT_THRESHOLD).length;
    const partialDays = nutritionLogs.filter(l => {
      const diff = Math.abs((l.caloriesConsumed ?? 0) - (l.targetCalories ?? 0));
      return diff > NUTRITION_ADHERENCE_HIT_THRESHOLD && diff <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD;
    }).length;
    const missedDays = nutritionLogs.length - hitDays - partialDays;
    
    context += `- Avg calories: ${avgCalories}/day vs ${avgTarget} target (${deficit > 0 ? 'surplus' : 'deficit'} of ${Math.abs(deficit)}/day)\n`;
    context += `- Nutrition adherence: ${hitDays} hit, ${partialDays} partial, ${missedDays} missed\n`;
  }
  
  // Training patterns
  const trainingLogs = sortedLogs.filter(l => l.trainingData?.trainingSessionId);
  if (trainingLogs.length > 0) {
    const completedSessions = trainingLogs.filter(l => l.trainingData?.sessionCompleted).length;
    context += `- Training: ${completedSessions}/${trainingLogs.length} sessions completed`;
    
    // Note any session swaps
    const swaps = trainingLogs.filter(l => l.trainingData?.isAlternativeSession);
    if (swaps.length > 0) {
      const swapDetails = swaps.map(l => {
        const date = new Date(l.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        return `swapped to ${l.trainingData?.trainingSessionName} on ${dayName}`;
      }).join(', ');
      context += `. Session swaps: ${swapDetails}`;
    }
    context += '\n';
  }
  
  // Habit patterns - group by habit ID with proper date range calculation
  const habitsById: Record<string, { name: string; completed: number; total: number; createdAt: string }> = {};
  habitLogs.forEach(log => {
    if (!habitsById[log.dailyHabitId]) {
      // Calculate days the habit existed in the period
      const habitCreatedDate = new Date(log.habitCreatedAt);
      const habitStartDate = habitCreatedDate > startDate ? habitCreatedDate : startDate;
      const daysExisted = Math.floor((endDate.getTime() - habitStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      habitsById[log.dailyHabitId] = {
        name: log.habitName,
        completed: 0,
        total: Math.max(1, daysExisted),
        createdAt: log.habitCreatedAt,
      };
    }
    if (log.completed) habitsById[log.dailyHabitId].completed++;
  });
  
  // Convert to by-name for display
  const habitsByName = Object.values(habitsById).reduce((acc, habit) => {
    acc[habit.name] = { completed: habit.completed, total: habit.total };
    return acc;
  }, {} as Record<string, { completed: number; total: number }>);
  
  if (Object.keys(habitsByName).length > 0) {
    context += '- Habit completion: ';
    const habitSummaries = Object.entries(habitsByName).map(
      ([name, stats]) => `${name} ${stats.completed}/${stats.total}`
    );
    context += habitSummaries.join(', ') + '\n';
  }
  
  // Energy/mood correlation notes
  const lowEnergyDays = sortedLogs.filter(l => l.energy !== undefined && l.energy < 5);
  if (lowEnergyDays.length > 0) {
    const lowEnergyWithMissedNutrition = lowEnergyDays.filter(l => {
      if (!l.caloriesConsumed || !l.targetCalories) return false;
      return Math.abs(l.caloriesConsumed - l.targetCalories) > NUTRITION_ADHERENCE_PARTIAL_THRESHOLD;
    });
    
    if (lowEnergyWithMissedNutrition.length > 0) {
      const days = lowEnergyWithMissedNutrition.map(l => 
        new Date(l.date).toLocaleDateString('en-US', { weekday: 'short' })
      ).join('/');
      context += `- Energy dipped below 5 on ${days} (correlated with calorie misses)\n`;
    } else {
      const days = lowEnergyDays.map(l => 
        new Date(l.date).toLocaleDateString('en-US', { weekday: 'short' })
      ).join('/');
      context += `- Energy dipped below 5 on ${days}\n`;
    }
  }

  return context;
}