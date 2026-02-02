import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getClientById } from "@/services/client-service";
import { getClientCheckIns } from "@/services/check-in-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { weightToKg } from "@/utils/nutrition-helpers";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// POST - Generate AI-powered prompt suggestions based on client context
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    // Gather client context for personalized suggestions
    const currentWeightKg = client.currentWeight
      ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
      : undefined;
    const goalWeightKg = client.goalWeight
      ? weightToKg(client.goalWeight, client.weightUnit || "lbs")
      : undefined;

    // Get recent check-ins for context
    const { checkIns } = await getClientCheckIns(clientId, { limit: 4 });

    let contextInfo = `Client: ${client.name}`;
    if (currentWeightKg) contextInfo += `\nCurrent weight: ${currentWeightKg}kg`;
    if (goalWeightKg) contextInfo += `\nGoal weight: ${goalWeightKg}kg`;
    if (client.currentBodyFatPercentage) contextInfo += `\nBody fat: ${client.currentBodyFatPercentage}%`;
    if (client.tdee) contextInfo += `\nTDEE: ${client.tdee} kcal`;
    if (client.gender) contextInfo += `\nGender: ${client.gender}`;

    // Add check-in insights if available
    if (checkIns.length > 0) {
      const avgEnergy = checkIns.reduce((sum, c) => sum + (c.energy || 0), 0) / checkIns.length;
      const avgSleep = checkIns.reduce((sum, c) => sum + (c.sleep || 0), 0) / checkIns.length;
      if (avgEnergy > 0) contextInfo += `\nAverage energy level: ${avgEnergy.toFixed(1)}/10`;
      if (avgSleep > 0) contextInfo += `\nAverage sleep quality: ${avgSleep.toFixed(1)}/10`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a fitness coach assistant. Generate 3 short training program suggestions based on the client's profile. Each suggestion should be 1 sentence focused ONLY on workout structure, exercise selection, or training frequency.

IMPORTANT: Do NOT mention nutrition, calories, macros, protein intake, or diet. Focus ONLY on:
- Training splits (PPL, upper/lower, full body)
- Exercise selection (compound vs isolation, specific movements)
- Training frequency and volume
- Progressive overload approaches

Keep each suggestion under 80 characters. Be specific and actionable.`,
        },
        {
          role: "user",
          content: `Generate training program suggestions for this client:\n\n${contextInfo}`,
        },
      ],
      temperature: 0.8,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "";

    // Parse suggestions from response (split by newlines or numbered items)
    const suggestions = content
      .split(/\n+/)
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter((line) => line.length > 20 && line.length < 300);

    return NextResponse.json({
      success: true,
      suggestions: suggestions.slice(0, 3),
    });
  } catch (error) {
    console.error("Error generating suggestions:", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 }
    );
  }
}
