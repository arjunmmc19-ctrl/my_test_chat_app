import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

// Fixed, non-user-derived path — request input never reaches the filesystem
// path, so there is no traversal risk here.
const FEEDBACK_FILE = path.join(process.cwd(), "feedback.csv");
const CSV_HEADER = "timestamp,assistant_response,reaction,feedback\n";
const MAX_FIELD_LENGTH = 5000;

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { response, reaction, feedback } = body as Record<string, unknown>;

    if (typeof response !== "string" || response.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing assistant response" },
        { status: 400 }
      );
    }
    if (typeof feedback !== "string" || feedback.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing feedback text" },
        { status: 400 }
      );
    }

    const normalizedReaction = reaction === "up" || reaction === "down" ? reaction : "";

    const row =
      [
        new Date().toISOString(),
        response.slice(0, MAX_FIELD_LENGTH),
        normalizedReaction,
        feedback.trim().slice(0, MAX_FIELD_LENGTH),
      ]
        .map(csvField)
        .join(",") + "\n";

    let fileExists = true;
    try {
      await fs.access(FEEDBACK_FILE);
    } catch {
      fileExists = false;
    }
    if (!fileExists) {
      await fs.writeFile(FEEDBACK_FILE, CSV_HEADER, "utf8");
    }

    await fs.appendFile(FEEDBACK_FILE, row, "utf8");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Feedback API error:", error);
    return NextResponse.json(
      { error: "Failed to save feedback." },
      { status: 500 }
    );
  }
}
