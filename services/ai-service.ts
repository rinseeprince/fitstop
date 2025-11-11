import OpenAI from "openai";
import type {
  CheckIn,
  AICheckInSummary,
  AIInsight,
  AIRecommendation,
} from "@/types/check-in";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate AI summary for a check-in
export const generateCheckInSummary = async (
  currentCheckIn: CheckIn,
  previousCheckIns: CheckIn[],
  clientName: string
): Promise<AICheckInSummary> => {
  try {
    const prompt = buildCheckInAnalysisPrompt(
      currentCheckIn,
      previousCheckIns,
      clientName
    );

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert fitness coach assistant analyzing client check-ins.
Provide concise, actionable insights and recommendations. Be encouraging but honest about concerns.
Your analysis will help coaches quickly understand progress and formulate responses.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0]?.message?.content || "";

    // Parse the AI response into structured format
    return parseAIResponse(responseText);
  } catch (error) {
    console.error("Error generating AI summary:", error);
    throw new Error("Failed to generate AI summary");
  }
};

// Build the prompt for AI analysis
const buildCheckInAnalysisPrompt = (
  current: CheckIn,
  previous: CheckIn[],
  clientName: string
): string => {
  let prompt = `Analyze this check-in for ${clientName}:\n\n`;

  // Current check-in data
  prompt += "**CURRENT CHECK-IN:**\n";
  prompt += `Date: ${new Date(current.createdAt).toLocaleDateString()}\n`;

  if (current.mood || current.energy || current.sleep || current.stress) {
    prompt += "\nSubjective Metrics:\n";
    if (current.mood) prompt += `- Mood: ${current.mood}/5\n`;
    if (current.energy) prompt += `- Energy: ${current.energy}/10\n`;
    if (current.sleep) prompt += `- Sleep: ${current.sleep}/10\n`;
    if (current.stress) prompt += `- Stress: ${current.stress}/10\n`;
  }

  if (current.weight || current.bodyFatPercentage) {
    prompt += "\nBody Metrics:\n";
    if (current.weight)
      prompt += `- Weight: ${current.weight} ${current.weightUnit || "lbs"}\n`;
    if (current.bodyFatPercentage)
      prompt += `- Body Fat: ${current.bodyFatPercentage}%\n`;
  }

  if (current.workoutsCompleted || current.adherencePercentage) {
    prompt += "\nTraining & Nutrition:\n";
    if (current.workoutsCompleted)
      prompt += `- Workouts Completed: ${current.workoutsCompleted}\n`;
    if (current.adherencePercentage)
      prompt += `- Adherence: ${current.adherencePercentage}%\n`;
  }

  if (current.prs) prompt += `\nPersonal Records: ${current.prs}\n`;
  if (current.challenges) prompt += `\nChallenges: ${current.challenges}\n`;
  if (current.notes) prompt += `\nNotes: ${current.notes}\n`;

  // Previous check-ins for context
  if (previous.length > 0) {
    prompt += "\n**PREVIOUS CHECK-INS (for trend analysis):**\n";
    previous.slice(0, 3).forEach((prev, idx) => {
      prompt += `\n${idx + 1}. ${new Date(prev.createdAt).toLocaleDateString()}\n`;
      if (prev.weight) prompt += `   Weight: ${prev.weight} ${prev.weightUnit || "lbs"}\n`;
      if (prev.adherencePercentage) prompt += `   Adherence: ${prev.adherencePercentage}%\n`;
      if (prev.workoutsCompleted) prompt += `   Workouts: ${prev.workoutsCompleted}\n`;
      if (prev.mood) prompt += `   Mood: ${prev.mood}/5\n`;
    });
  }

  prompt += `\n**TASK:**
Provide your analysis in this EXACT format:

SUMMARY:
[2-3 sentence overview of this week's check-in]

INSIGHTS:
[strength] [insight text]
[concern] [insight text]
[trend] [insight text]

RECOMMENDATIONS:
[high] [recommendation text]
[medium] [recommendation text]
[low] [recommendation text]

RESPONSE_DRAFT:
[Draft a warm, personalized message to ${clientName} acknowledging their progress and addressing any concerns. Keep it conversational and encouraging.]
`;

  return prompt;
};

// Parse AI response into structured format
const parseAIResponse = (responseText: string): AICheckInSummary => {
  const sections = {
    summary: "",
    insights: [] as AIInsight[],
    recommendations: [] as AIRecommendation[],
    responseDraft: "",
  };

  const summaryMatch = responseText.match(/SUMMARY:\s*([\s\S]*?)(?=INSIGHTS:|$)/i);
  if (summaryMatch) {
    sections.summary = summaryMatch[1].trim();
  }

  const insightsMatch = responseText.match(
    /INSIGHTS:\s*([\s\S]*?)(?=RECOMMENDATIONS:|$)/i
  );
  if (insightsMatch) {
    const insightLines = insightsMatch[1].trim().split("\n");
    insightLines.forEach((line) => {
      const match = line.match(/\[(strength|concern|trend)\]\s*(.+)/i);
      if (match) {
        sections.insights.push({
          type: match[1].toLowerCase() as "strength" | "concern" | "trend",
          text: match[2].trim(),
        });
      }
    });
  }

  const recommendationsMatch = responseText.match(
    /RECOMMENDATIONS:\s*([\s\S]*?)(?=RESPONSE_DRAFT:|$)/i
  );
  if (recommendationsMatch) {
    const recLines = recommendationsMatch[1].trim().split("\n");
    recLines.forEach((line) => {
      const match = line.match(/\[(high|medium|low)\]\s*(.+)/i);
      if (match) {
        sections.recommendations.push({
          priority: match[1].toLowerCase() as "high" | "medium" | "low",
          text: match[2].trim(),
        });
      }
    });
  }

  const responseMatch = responseText.match(/RESPONSE_DRAFT:\s*([\s\S]*?)$/i);
  if (responseMatch) {
    sections.responseDraft = responseMatch[1].trim();
  }

  // Fallback if parsing fails
  if (!sections.summary) {
    sections.summary = "Unable to generate summary. Please review manually.";
  }
  if (sections.insights.length === 0) {
    sections.insights.push({
      type: "concern",
      text: "AI analysis failed. Manual review required.",
    });
  }
  if (sections.recommendations.length === 0) {
    sections.recommendations.push({
      priority: "high",
      text: "Review check-in manually and provide feedback.",
    });
  }
  if (!sections.responseDraft) {
    sections.responseDraft =
      "Great work this week! I've reviewed your check-in and will follow up with detailed feedback soon.";
  }

  return sections;
};

// Regenerate AI summary with different focus
export const regenerateAISummary = async (
  checkIn: CheckIn,
  previousCheckIns: CheckIn[],
  clientName: string,
  focus?: "positive" | "detailed" | "concise"
): Promise<AICheckInSummary> => {
  const focusInstructions = {
    positive: "Focus on positive aspects and wins. Be extra encouraging.",
    detailed:
      "Provide very detailed analysis with specific metrics and comparisons.",
    concise: "Keep analysis brief and to the point. Highlight only key items.",
  };

  const instruction = focus ? focusInstructions[focus] : "";

  // Modify the system prompt based on focus
  const prompt = buildCheckInAnalysisPrompt(checkIn, previousCheckIns, clientName);
  const modifiedPrompt = instruction
    ? `${instruction}\n\n${prompt}`
    : prompt;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert fitness coach assistant. ${instruction}`,
      },
      {
        role: "user",
        content: modifiedPrompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 1000,
  });

  const responseText = completion.choices[0]?.message?.content || "";
  return parseAIResponse(responseText);
};
