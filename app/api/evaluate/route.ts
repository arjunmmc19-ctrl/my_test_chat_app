import { ApiError, GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { buildJudgePrompt, parseJudgeResponse, pickJudgeModel } from "@/app/lib/judge";

export const runtime = "nodejs";

// Fixed, non-user-derived path — request input never reaches the filesystem
// path, so there is no traversal risk here.
const EVALUATIONS_FILE = path.join(process.cwd(), "evaluations.csv");
const CSV_HEADER = "timestamp,question,answer,context,verdict,reasoning,judge_model\n";
const MAX_FIELD_LENGTH = 8000;

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { question, answer, context, answerModel } = body as Record<string, unknown>;

    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }
    if (typeof answer !== "string" || !answer.trim()) {
      return NextResponse.json({ error: "Answer is required" }, { status: 400 });
    }

    const contextText = typeof context === "string" && context.trim() ? context : undefined;
    const judgeModel = pickJudgeModel(typeof answerModel === "string" ? answerModel : undefined);

    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildJudgePrompt(question, answer, contextText);

    const response = await ai.models.generateContent({
      model: judgeModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0 },
    });

    const rawText =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "incorrect\nThe judge did not return a response.";
    const { verdict, reasoning } = parseJudgeResponse(rawText);

    const row =
      [question, answer, contextText ?? "", verdict, reasoning, judgeModel]
        .map((v) => csvField(v.slice(0, MAX_FIELD_LENGTH)))
        .join(",");
    const fullRow = `${csvField(new Date().toISOString())},${row}\n`;

    let fileExists = true;
    try {
      await fs.access(EVALUATIONS_FILE);
    } catch {
      fileExists = false;
    }
    if (!fileExists) {
      await fs.writeFile(EVALUATIONS_FILE, CSV_HEADER, "utf8");
    }
    await fs.appendFile(EVALUATIONS_FILE, fullRow, "utf8");

    return NextResponse.json({
      verdict,
      reasoning,
      judgeModel,
      contextAvailable: Boolean(contextText),
    });
  } catch (error) {
    console.error("Evaluate API error:", error);

    if (error instanceof ApiError) {
      const friendlyMessages: Record<number, string> = {
        429: "The judge model has hit its rate limit or daily quota. Please wait a moment and try again.",
        503: "The judge model is temporarily overloaded. Please try again in a few seconds.",
        400: "The judge model rejected the request.",
      };
      return NextResponse.json(
        {
          error:
            friendlyMessages[error.status] ||
            "Failed to evaluate the response. Please try again.",
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Failed to evaluate the response. Please try again." },
      { status: 500 }
    );
  }
}
